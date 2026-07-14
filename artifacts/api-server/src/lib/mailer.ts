import { Resend } from "resend";
import { logger } from "./logger";

let _client: Resend | null = null;

function getClient(): Resend {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY_missing: environment variable is not set");
  }
  if (!_client) {
    _client = new Resend(process.env.RESEND_API_KEY);
  }
  return _client;
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  resetLink: string;
  userName: string;
}): Promise<void> {
  const client = getClient();

  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="utf-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f9f9f9;margin:0;padding:32px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
    <h2 style="color:#1a1a1a;margin:0 0 8px">مرحباً ${opts.userName} 👋</h2>
    <p style="color:#555;margin:0 0 24px;line-height:1.7">
      تلقّينا طلباً لإعادة تعيين كلمة المرور لحسابك في <strong>Lovely Kids</strong>.
      انقر على الزر أدناه لتعيين كلمة مرور جديدة.
    </p>
    <a href="${opts.resetLink}"
       style="display:inline-block;background:#6b21a8;color:#fff;text-decoration:none;
              padding:14px 28px;border-radius:10px;font-weight:700;font-size:15px">
      إعادة تعيين كلمة المرور
    </a>
    <p style="color:#888;font-size:13px;margin:24px 0 0;line-height:1.7">
      صالح لمدة <strong>30 دقيقة</strong> فقط.<br/>
      إذا لم تطلب ذلك، تجاهل هذه الرسالة.
    </p>
    <p style="color:#bbb;font-size:12px;margin:16px 0 0">Lovely Kids · نابلس، فلسطين</p>
  </div>
</body>
</html>`;

  const result = await client.emails.send({
    from: "Lovely Kids <onboarding@resend.dev>",
    to: opts.to,
    subject: "إعادة تعيين كلمة المرور - Lovely Kids",
    html,
  });

  if (result.error) {
    // Log the exact Resend error code and message for diagnosis
    logger.error(
      { resendErrorName: result.error.name, resendErrorMessage: result.error.message },
      "mailer: Resend rejected the send request"
    );
    throw new Error(result.error.message ?? "فشل إرسال البريد الإلكتروني");
  }

  logger.info({ messageId: result.data?.id }, "mailer: reset email sent successfully");
}
