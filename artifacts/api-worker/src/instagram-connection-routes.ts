import { getCurrentUser } from "./auth";
import { instagramVerificationToken } from "./instagram-verification-token";
import type { Env, openDb } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

function responseJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
}

export async function handleInstagramConnectionRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const isNext = pathname === "/api/owner/instagram/verify-next";
  if (pathname !== "/api/owner/instagram/verify" && !isNext) return null;
  if (request.method !== "GET") {
    return responseJson({ error: "طريقة الطلب غير مدعومة" }, 405);
  }
  const user = await getCurrentUser(db, request, env);
  if (!user) return responseJson({ error: "يجب تسجيل الدخول أولًا" }, 401);
  if (user.isOwner !== true) {
    return responseJson({ error: "فحص حساب إنستغرام متاح للمالك فقط" }, 403);
  }

  const id = env.META_INSTAGRAM_ACCOUNT_ID?.trim() ?? "";
  // Never fall back to the current token while checking the new app.
  const token = instagramVerificationToken(env, isNext ? "next" : "current");
  if (!/^[0-9]+$/.test(id) || !token) {
    return responseJson({ connected: false, error: isNext
      ? "رمز إنستغرام الجديد أو رقم الحساب غير مكتمل في Cloudflare"
      : "بيانات إنستغرام غير مكتملة في Cloudflare" });
  }

  // Unified Login issues a Business Integration System User token for the
  // Facebook Graph API host; this is a read-only identity request.
  try {
    const result = await fetch(
      "https://graph.facebook.com/v27.0/" + id + "?fields=id,username",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    const data = (await result.json().catch(() => null)) as {
      id?: string;
      username?: string;
      error?: { code?: number; error_subcode?: number };
    } | null;
    if (!result.ok || !data?.id || data.error) {
      const code = data?.error?.code;
      const subcode = data?.error?.error_subcode;
      const diagnostic = typeof code === "number"
        ? " (Meta " + code + (typeof subcode === "number" ? "/" + subcode : "") + ")"
        : " (HTTP " + result.status + ")";
      return responseJson({
        connected: false,
        error: "تعذّر تأكيد اتصال إنستغرام. راجع صلاحيات الحساب أو صلاحية الرمز." + diagnostic,
      });
    }
    if (data.id !== id) {
      return responseJson({ connected: false, error: "رمز إنستغرام لا يطابق رقم الحساب المحدد." });
    }
    return responseJson({
      connected: true,
      username: data.username || "حساب إنستغرام",
      note: isNext
        ? "رمز التطبيق الجديد صالح لقراءة الحساب. لم يتغير رمز النشر الحالي، ولا يؤكد الفحص نجاح نشر الصور أو القصص."
        : "هذا فحص قراءة فقط، ولا يؤكد نجاح النشر قبل تجربته.",
    });
  } catch {
    return responseJson({ connected: false, error: "تعذّر التواصل مع Meta. أعد المحاولة لاحقًا." });
  }
}
