import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { passwordResetTokensTable } from "@workspace/db";
import { eq, and, isNull, gt } from "drizzle-orm";
import { normalizePhone } from "./auth";
import { sendPasswordResetEmail } from "../lib/mailer";

const router = Router();

const RESET_TTL_MINUTES = 30;
const isDev = process.env.NODE_ENV !== "production";

// POST /api/auth/forgot-password
// Accepts { phone }. Always responds 200 OK (security: don't reveal if account exists).
router.post("/auth/forgot-password", async (req, res) => {
  const { phone } = req.body as { phone?: string };

  if (!phone?.trim()) {
    res.status(400).json({ error: "رقم الجوال مطلوب" });
    return;
  }

  const normalPhone = normalizePhone(phone.trim());

  // Generic 200 — always returned regardless of outcome
  const sendOk = () => res.json({ ok: true });

  try {
    const users = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.phone, normalPhone));

    const user = users[0];

    // Dev-only safe diagnostics — never log full phone, email, or token
    if (isDev) {
      req.log?.info(
        {
          phoneMasked: normalPhone.slice(0, 4) + "****",
          userFound: !!user,
          hasEmail: !!(user?.email),
        },
        "forgot-password: lookup result"
      );
    }

    if (!user?.email) {
      // Not revealing whether the account exists or has email
      sendOk();
      return;
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);

    await db.insert(passwordResetTokensTable).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost:80";
    const resetLink = `https://${domain}/api/auth/reset-password?token=${rawToken}`;

    try {
      await sendPasswordResetEmail({
        to: user.email,
        resetLink,
        userName: user.name,
      });

      if (isDev) {
        req.log?.info({ userId: user.id }, "forgot-password: reset email dispatched");
      }
    } catch (mailErr) {
      // Diagnose the specific Resend failure reason
      const errMsg = mailErr instanceof Error ? mailErr.message : String(mailErr);

      // Categorise common Resend rejection reasons
      let cause = "unknown";
      if (!process.env.RESEND_API_KEY) {
        cause = "RESEND_API_KEY_missing";
      } else if (/testing emails to your own email/i.test(errMsg)) {
        cause = "resend_onboarding_domain_restriction: recipient must match Resend account email";
      } else if (/invalid.*email|email.*invalid/i.test(errMsg)) {
        cause = "resend_invalid_recipient_email";
      } else if (/unauthorized|api.*key/i.test(errMsg)) {
        cause = "resend_auth_failure: check RESEND_API_KEY value";
      } else if (/rate limit/i.test(errMsg)) {
        cause = "resend_rate_limited";
      } else {
        cause = "resend_error: " + errMsg;
      }

      req.log?.error({ userId: user.id, cause }, "forgot-password: email send failed");

      // Mark the token as already-used so it can't be exploited
      await db
        .update(passwordResetTokensTable)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokensTable.tokenHash, tokenHash))
        .catch(() => { /* best-effort */ });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    req.log?.error({ errMsg }, "forgot-password: unexpected server error");
  }

  // Always return generic OK — never reveal whether an email was sent
  sendOk();
});

// GET /api/auth/reset-password?token=...
// Renders a simple HTML form for entering the new password
router.get("/auth/reset-password", async (req, res) => {
  const rawToken = req.query.token as string | undefined;

  if (!rawToken) {
    res.status(400).send(resetPage({ error: "رابط غير صالح" }));
    return;
  }

  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const now = new Date();

  const rows = await db
    .select()
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
        gt(passwordResetTokensTable.expiresAt, now)
      )
    );

  if (rows.length === 0) {
    res.status(400).send(resetPage({ error: "الرابط منتهي الصلاحية أو تم استخدامه مسبقاً" }));
    return;
  }

  res.send(resetPage({ token: rawToken }));
});

// POST /api/auth/reset-password
// Accepts { token, password }
router.post("/auth/reset-password", async (req, res) => {
  const { token: rawToken, password } = req.body as {
    token?: string;
    password?: string;
  };

  if (!rawToken || !password || password.length < 4) {
    res.status(400).json({ error: "بيانات غير مكتملة" });
    return;
  }

  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const now = new Date();

  const rows = await db
    .select()
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
        gt(passwordResetTokensTable.expiresAt, now)
      )
    );

  if (rows.length === 0) {
    res.status(400).json({ error: "الرابط منتهي الصلاحية أو تم استخدامه مسبقاً" });
    return;
  }

  const resetRow = rows[0];
  const newHash = await bcrypt.hash(password, 10);

  await db
    .update(passwordResetTokensTable)
    .set({ usedAt: now })
    .where(eq(passwordResetTokensTable.id, resetRow.id));

  await db
    .update(usersTable)
    .set({ passwordHash: newHash })
    .where(eq(usersTable.id, resetRow.userId));

  await db
    .delete(sessionsTable)
    .where(eq(sessionsTable.userId, resetRow.userId));

  req.log?.info({ userId: resetRow.userId }, "reset-password: password updated, sessions invalidated");

  res.json({ ok: true });
});

// ─── HTML helpers ────────────────────────────────────────────────────────────

function resetPage(opts: { token?: string; error?: string; success?: boolean }): string {
  const { token, error, success } = opts;

  const body = success
    ? `<div class="icon">✅</div>
       <h2>تم تغيير كلمة المرور</h2>
       <p>يمكنك الآن فتح التطبيق وتسجيل الدخول بكلمة المرور الجديدة.</p>`
    : error
    ? `<div class="icon">❌</div>
       <h2>خطأ</h2>
       <p class="error">${error}</p>
       <p>يرجى طلب رابط استعادة جديد من التطبيق.</p>`
    : `<h2>تعيين كلمة مرور جديدة</h2>
       <p>أدخل كلمة مرور جديدة لحسابك في Lovely Kids</p>
       <form id="f" onsubmit="submit(event)">
         <input type="hidden" name="token" value="${token}" />
         <input type="password" name="password" placeholder="كلمة المرور الجديدة (4 أحرف على الأقل)"
                minlength="4" required autocomplete="new-password" />
         <input type="password" name="confirm" placeholder="تأكيد كلمة المرور"
                minlength="4" required autocomplete="new-password" />
         <div id="err" class="error" style="display:none"></div>
         <button type="submit" id="btn">تعيين كلمة المرور</button>
       </form>
       <script>
         async function submit(e) {
           e.preventDefault();
           const f = e.target;
           const pw = f.password.value;
           const cf = f.confirm.value;
           const errEl = document.getElementById('err');
           const btn = document.getElementById('btn');
           if (pw !== cf) { errEl.textContent = 'كلمتا المرور غير متطابقتين'; errEl.style.display='block'; return; }
           btn.disabled = true; btn.textContent = 'جاري الحفظ...';
           try {
             const r = await fetch('/api/auth/reset-password', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ token: f.token.value, password: pw })
             });
             const d = await r.json();
             if (d.ok) {
               document.body.innerHTML = '<div style="font-family:Arial,sans-serif;direction:rtl;text-align:center;padding:60px 24px"><div style=\\"font-size:64px\\">✅</div><h2>تم تغيير كلمة المرور</h2><p>يمكنك الآن فتح التطبيق وتسجيل الدخول بكلمة المرور الجديدة.</p></div>';
             } else {
               errEl.textContent = d.error || 'حدث خطأ'; errEl.style.display='block';
               btn.disabled = false; btn.textContent = 'تعيين كلمة المرور';
             }
           } catch { errEl.textContent = 'حدث خطأ في الاتصال'; errEl.style.display='block'; btn.disabled=false; btn.textContent='تعيين كلمة المرور'; }
         }
       </script>`;

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Lovely Kids – إعادة تعيين كلمة المرور</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;background:#f3e8ff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:#fff;border-radius:20px;padding:36px 28px;max-width:420px;width:100%;box-shadow:0 4px 20px rgba(107,33,168,0.12);text-align:center}
  h2{color:#1a1a1a;margin-bottom:12px;font-size:20px}
  p{color:#555;line-height:1.7;margin-bottom:16px;font-size:14px}
  .icon{font-size:56px;margin-bottom:16px}
  input[type=password]{display:block;width:100%;border:2px solid #e9d5ff;border-radius:10px;padding:12px 14px;font-size:15px;margin-bottom:12px;outline:none;direction:rtl;text-align:right}
  input[type=password]:focus{border-color:#6b21a8}
  button{display:block;width:100%;background:#6b21a8;color:#fff;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;margin-top:4px}
  button:disabled{opacity:0.6}
  .error{color:#dc2626;font-size:13px;margin-bottom:10px;font-weight:600}
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

export default router;
