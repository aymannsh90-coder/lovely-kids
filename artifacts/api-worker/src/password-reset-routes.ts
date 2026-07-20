import bcrypt from "bcryptjs";
import {
  passwordResetTokensTable,
  sessionsTable,
  usersTable,
} from "@workspace/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Env, openDb } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

const RESET_TTL_MINUTES = 30;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });

const html = (content: string, status = 200) =>
  new Response(content, {
    status,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    },
  });

function escapeHtml(value: string) {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };

  return value.replace(
    /[&<>"']/g,
    (character) => replacements[character] ?? character,
  );
}

function generateResetToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashResetToken(token: string) {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoded,
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sendPasswordResetEmail(
  env: Env,
  options: {
    to: string;
    userName: string;
    resetLink: string;
  },
) {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is missing");
  }

  const safeName = escapeHtml(
    options.userName || "عميلنا",
  );

  const safeLink = escapeHtml(options.resetLink);

  const emailHtml = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<body style="font-family:Arial,sans-serif;background:#f9f9f9;padding:32px">
  <div style="max-width:480px;margin:auto;background:#fff;border-radius:16px;padding:32px">
    <h2>مرحباً ${safeName} 👋</h2>
    <p>
      تلقّينا طلباً لإعادة تعيين كلمة المرور
      لحسابك في <strong>Lovely Kids</strong>.
    </p>
    <a href="${safeLink}">
      إعادة تعيين كلمة المرور
    </a>
    <p>الرابط صالح لمدة 30 دقيقة فقط.</p>
  </div>
</body>
</html>`;

  const response = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Lovely Kids <no-reply@lovelykids.net>",
        to: [options.to],
        subject:
          "إعادة تعيين كلمة المرور - Lovely Kids",
        html: emailHtml,
      }),
    },
  );

  if (!response.ok) {
    const details = (
      await response.text()
    ).slice(0, 500);

    throw new Error(
      `Resend failed (${response.status}): ${details}`,
    );
  }
}

async function handleForgotPassword(
  request: Request,
  db: Db,
  env: Env,
) {
  const body = await request.json().catch(() => null) as {
    email?: unknown;
  } | null;

  if (
    typeof body?.email !== "string" ||
    !body.email.trim()
  ) {
    return json(
      { error: "البريد الإلكتروني مطلوب" },
      400,
    );
  }

  const email = body.email.trim().toLowerCase();

  if (email.length > 320) {
    return json(
      { error: "البريد الإلكتروني غير صالح" },
      400,
    );
  }

  const genericResponse = () => json({ ok: true });

  try {
    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    const user = rows[0];

    if (!user?.email) {
      return genericResponse();
    }

    const rawToken = generateResetToken();
    const tokenHash = await hashResetToken(rawToken);

    const expiresAt = new Date(
      Date.now() + RESET_TTL_MINUTES * 60 * 1000,
    );

    await db.insert(passwordResetTokensTable).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    const origin = new URL(request.url).origin;

    const resetLink =
      `${origin}/api/auth/reset-password?token=${rawToken}`;

    try {
      await sendPasswordResetEmail(env, {
        to: user.email,
        userName: user.name,
        resetLink,
      });
    } catch (error) {
      console.error(
        "password-reset email failed",
        error instanceof Error ? error.message : error,
      );

      await db
        .update(passwordResetTokensTable)
        .set({ usedAt: new Date() })
        .where(
          eq(
            passwordResetTokensTable.tokenHash,
            tokenHash,
          ),
        )
        .catch(() => undefined);
    }
  } catch (error) {
    console.error(
      "forgot-password failed",
      error instanceof Error ? error.message : error,
    );
  }

  return genericResponse();
}

async function handleResetPage(
  request: Request,
  db: Db,
) {
  const rawToken =
    new URL(request.url).searchParams.get("token") ?? "";

  if (!TOKEN_PATTERN.test(rawToken)) {
    return html(
      resetPage({ error: "رابط غير صالح" }),
      400,
    );
  }

  const tokenHash = await hashResetToken(rawToken);
  const now = new Date();

  const rows = await db
    .select({ id: passwordResetTokensTable.id })
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
        gt(passwordResetTokensTable.expiresAt, now),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    return html(
      resetPage({
        error:
          "الرابط منتهي الصلاحية أو تم استخدامه مسبقاً",
      }),
      400,
    );
  }

  return html(resetPage({ token: rawToken }));
}

async function handleResetPassword(
  request: Request,
  db: Db,
) {
  const body = await request.json().catch(() => null) as {
    token?: unknown;
    password?: unknown;
  } | null;

  const rawToken =
    typeof body?.token === "string" ? body.token : "";

  const password =
    typeof body?.password === "string"
      ? body.password
      : "";

  if (
    !TOKEN_PATTERN.test(rawToken) ||
    password.length < 4 ||
    password.length > 128
  ) {
    return json(
      { error: "بيانات غير مكتملة" },
      400,
    );
  }

  const tokenHash = await hashResetToken(rawToken);
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();

  const userId = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: now })
      .where(
        and(
          eq(
            passwordResetTokensTable.tokenHash,
            tokenHash,
          ),
          isNull(passwordResetTokensTable.usedAt),
          gt(passwordResetTokensTable.expiresAt, now),
        ),
      )
      .returning({
        userId: passwordResetTokensTable.userId,
      });

    const reset = claimed[0];

    if (!reset) {
      return null;
    }

    await tx
      .update(usersTable)
      .set({ passwordHash })
      .where(eq(usersTable.id, reset.userId));

    await tx
      .delete(sessionsTable)
      .where(eq(sessionsTable.userId, reset.userId));

    return reset.userId;
  });

  if (userId === null) {
    return json(
      {
        error:
          "الرابط منتهي الصلاحية أو تم استخدامه مسبقاً",
      },
      400,
    );
  }

  return json({ ok: true });
}

function resetPage(options: {
  token?: string;
  error?: string;
}) {
  const content = options.error
    ? `
      <div class="icon">❌</div>
      <h2>خطأ</h2>
      <p class="error">
        ${escapeHtml(options.error)}
      </p>
      <p>يرجى طلب رابط استعادة جديد من التطبيق.</p>
    `
    : `
      <h2>تعيين كلمة مرور جديدة</h2>
      <p>
        أدخل كلمة مرور جديدة لحسابك في Lovely Kids
      </p>

      <form id="reset-form">
        <input
          type="hidden"
          name="token"
          value="${escapeHtml(options.token ?? "")}"
        >

        <input
          type="password"
          name="password"
          placeholder="كلمة المرور الجديدة"
          minlength="4"
          maxlength="128"
          required
          autocomplete="new-password"
        >

        <input
          type="password"
          name="confirm"
          placeholder="تأكيد كلمة المرور"
          minlength="4"
          maxlength="128"
          required
          autocomplete="new-password"
        >

        <div id="error" class="error hidden"></div>

        <button type="submit" id="button">
          تعيين كلمة المرور
        </button>
      </form>
    `;

  const script = `
    <script>
      document
        .getElementById("reset-form")
        ?.addEventListener("submit", async (event) => {
          event.preventDefault();

          const form = event.currentTarget;
          const password = form.password.value;
          const confirm = form.confirm.value;
          const error = document.getElementById("error");
          const button = document.getElementById("button");

          error.classList.add("hidden");

          if (password !== confirm) {
            error.textContent =
              "كلمتا المرور غير متطابقتين";
            error.classList.remove("hidden");
            return;
          }

          button.disabled = true;
          button.textContent = "جاري الحفظ...";

          try {
            const response = await fetch(
              "/api/auth/reset-password",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  token: form.token.value,
                  password,
                }),
              },
            );

            const data = await response.json();

            if (!response.ok || !data.ok) {
              throw new Error(
                data.error || "حدث خطأ",
              );
            }

            document.querySelector(".card").innerHTML =
              '<div class="icon">✅</div>' +
              '<h2>تم تغيير كلمة المرور</h2>' +
              '<p>يمكنك الآن فتح التطبيق وتسجيل الدخول بكلمة المرور الجديدة.</p>';
          } catch (requestError) {
            error.textContent =
              requestError instanceof Error
                ? requestError.message
                : "حدث خطأ في الاتصال";

            error.classList.remove("hidden");
            button.disabled = false;
            button.textContent = "تعيين كلمة المرور";
          }
        });
    </script>
  `;

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width,initial-scale=1"
  >
  <title>
    Lovely Kids – إعادة تعيين كلمة المرور
  </title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      font-family: Arial, sans-serif;
      background: #f3e8ff;
      min-height: 100vh;
      margin: 0;
      padding: 24px;
    }
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .card {
      width: 100%;
      max-width: 420px;
      padding: 36px 28px;
      background: #ffffff;
      border-radius: 20px;
      text-align: center;
    }

    input {
      width: 100%;
      padding: 12px;
      margin-bottom: 12px;
      border: 2px solid #e9d5ff;
      border-radius: 10px;
      font-size: 15px;
    }

    input:focus {
      border-color: #6b21a8;
      outline: none;
    }

    button {
      width: 100%;
      padding: 14px;
      border: none;
      border-radius: 10px;
      background: #6b21a8;
      color: white;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.6;
    }

    .error {
      color: #dc2626;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 10px;
    }

    .hidden {
      display: none;
    }

    .icon {
      font-size: 56px;
      margin-bottom: 16px;
    }
  </style>
</head>

<body>
  <div class="card">${content}</div>
  ${script}
</body>
</html>`;
}

export async function handlePasswordResetRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "POST" &&
    path === "/api/auth/forgot-password"
  ) {
    return handleForgotPassword(request, db, env);
  }

  if (
    request.method === "GET" &&
    path === "/api/auth/reset-password"
  ) {
    return handleResetPage(request, db);
  }

  if (
    request.method === "POST" &&
    path === "/api/auth/reset-password"
  ) {
    return handleResetPassword(request, db);
  }

  return null;
}
