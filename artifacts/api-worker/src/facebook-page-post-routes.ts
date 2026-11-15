import { productsTable } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import {
  MAX_FACEBOOK_POST_PRODUCTS,
  composeFacebookProductCaption,
  composeFacebookPhotoCaption,
} from "./facebook-post-composer";
import { resolveFacebookPageAccessToken } from "./facebook-page-access-token";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
type FacebookResponse = {
  id?: string;
  error?: { code?: number; message?: string };
};

const GRAPH_VERSION = "v27.0";

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
}

function isConfigured(env: Env): boolean {
  return !!(
    (env.META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN?.trim() || env.META_FACEBOOK_PAGE_ACCESS_TOKEN?.trim()) &&
    /^\d+$/.test(env.META_FACEBOOK_PAGE_ID?.trim() ?? "")
  );
}

async function postToFacebook(
  pageToken: string,
  endpoint: string,
  fields: URLSearchParams,
): Promise<FacebookResponse> {
  if (!pageToken) throw new Error("FACEBOOK_NOT_CONFIGURED");
  fields.set("access_token", pageToken);
  const response = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: fields.toString(),
  });
  const data = (await response.json().catch(() => null)) as FacebookResponse | null;
  if (!response.ok || !data || data.error || !data.id) {
    const code = data?.error?.code;
    throw new Error("FACEBOOK_API_FAILED" + (typeof code === "number" ? "_" + code : ""));
  }
  return data;
}

export async function handleFacebookPagePostRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (
    pathname !== "/api/owner/facebook/status" &&
    pathname !== "/api/owner/facebook/verify" &&
    pathname !== "/api/owner/facebook/preview" &&
    pathname !== "/api/owner/facebook/publish"
  ) {
    return null;
  }

  const user = await getCurrentUser(db, request, env);
  if (!user) return json({ error: "يجب تسجيل الدخول أولًا" }, 401);
  if (user.isOwner !== true) {
    return json({ error: "النشر متاح للمالك فقط" }, 403);
  }

  if (pathname === "/api/owner/facebook/status" && request.method === "GET") {
    return json({ configured: isConfigured(env) });
  }
  if (pathname === "/api/owner/facebook/verify" && request.method === "GET") {
    // Read-only Graph API check: never create photos/posts or expose Page token.
    if (!isConfigured(env)) {
      return json({ connected: false, error: "صفحة فيسبوك غير مجهزة بعد" });
    }
    const pageId = env.META_FACEBOOK_PAGE_ID!.trim();
    try {
      const token = await resolveFacebookPageAccessToken(env);
      const response = await fetch(
        "https://graph.facebook.com/" + GRAPH_VERSION + "/" + pageId + "?fields=id,name",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer " + token,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(8000),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        id?: string;
        name?: string;
        error?: { code?: number; error_subcode?: number };
      } | null;
      if (!response.ok || data?.error || !data?.id) {
        const code = data?.error?.code;
        const subcode = data?.error?.error_subcode;
        const diagnostic = typeof code === "number"
          ? " (Meta " + code + (typeof subcode === "number" ? "/" + subcode : "") + ")"
          : " (HTTP " + response.status + ")";
        return json({
          connected: false,
          error: "تعذّر التحقق من رمز الصفحة. قد يكون الرمز منتهي الصلاحية أو تنقصه الأذونات." + diagnostic,
        });
      }
      if (data.id !== pageId) {
        return json({ connected: false, error: "رمز الوصول لا يتطابق مع صفحة Lovely Kids المحددة." });
      }
      return json({
        connected: true,
        pageName: data.name || "Lovely Kids",
        note: "تم التحقق من الوصول للصفحة فقط؛ صلاحية إنشاء منشور تُتحقق عند النشر الفعلي.",
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      const isSystemPageMissing = reason === "FACEBOOK_SYSTEM_PAGE_NOT_FOUND";
      const systemError = reason.match(/^FACEBOOK_SYSTEM_TOKEN_FAILED_(\d+)(?:_(\d+))?$/);
      const diagnostic = systemError ? " (Meta " + systemError[1] + (systemError[2] ? "/" + systemError[2] : "") + ")" : "";
      return json({
        connected: false,
        error: isSystemPageMissing
          ? "لم تظهر صفحة Lovely Kids ضمن صفحات مستخدم النظام. راجع صلاحيات الصفحة والأذونات."
          : reason.startsWith("FACEBOOK_SYSTEM_TOKEN_FAILED")
            ? "تعذّر استخراج رمز الصفحة من رمز مستخدم النظام. راجع صلاحية الرمز والأذونات." + diagnostic
            : "تعذّر الاتصال بـ Meta للتحقق من الصفحة. أعد الفحص لاحقًا.",
      });
    }
  }
  if (request.method !== "POST") {
    return json({ error: "طريقة الطلب غير مدعومة" }, 405);
  }

  if (pathname === "/api/owner/facebook/publish" && !isConfigured(env)) {
    return json({ error: "ربط صفحة فيسبوك للنشر غير مفعّل بعد" }, 503);
  }

  const body = (await request.json().catch(() => null)) as {
    productIds?: unknown;
    intro?: unknown;
  } | null;

  if (!body || !Array.isArray(body.productIds)) {
    return json({ error: "اختَر الموديلات المراد نشرها" }, 400);
  }
  const ids = body.productIds;
  if (
    ids.length < 1 ||
    ids.length > MAX_FACEBOOK_POST_PRODUCTS ||
    ids.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) ||
    new Set(ids).size !== ids.length
  ) {
    return json({ error: "اختَر من 1 إلى 10 موديلات مختلفة" }, 400);
  }
  if (body.intro !== undefined && (typeof body.intro !== "string" || body.intro.length > 500)) {
    return json({ error: "مقدمة المنشور غير صالحة" }, 400);
  }

  const rows = await db
    .select({
      id: productsTable.id,
      nameAr: productsTable.nameAr,
      name: productsTable.name,
      image: productsTable.image,
      isHidden: productsTable.isHidden,
      deletedAt: productsTable.deletedAt,
    })
    .from(productsTable)
    .where(inArray(productsTable.id, ids as number[]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const products = (ids as number[]).map((id) => byId.get(id));

  if (products.some((product) => !product || product.isHidden || product.deletedAt)) {
    return json({ error: "أحد الموديلات محذوف أو مخفي أو غير موجود. حدّث القائمة." }, 400);
  }

  const validProducts = products.filter((product): product is NonNullable<typeof product> => !!product);
  if (validProducts.some((product) => {
    try {
      return new URL(product.image).protocol !== "https:";
    } catch {
      return true;
    }
  })) {
    return json({ error: "يوجد موديل بدون رابط صورة HTTPS صالح للنشر" }, 400);
  }

  let caption: string;
  try {
    caption = composeFacebookProductCaption(validProducts, (body.intro as string | undefined));
  } catch {
    return json({ error: "تعذر تجهيز وصف المنشور" }, 400);
  }

  if (pathname === "/api/owner/facebook/preview") {
    return json({
      configured: isConfigured(env),
      caption,
      products: validProducts.map((product) => ({
        id: product.id,
        name: product.nameAr?.trim() || product.name?.trim(),
        image: product.image,
        photoCaption: composeFacebookPhotoCaption(product),
      })),
    });
  }

  try {
    // Resolve a fresh Page token once for this operation. Do not fall back to an expired
    // legacy token when a system-user token is configured but fails validation.
    const pageToken = await resolveFacebookPageAccessToken(env);
    // One unpublished photo per selected model, in the original selection order.
    // This does not modify the product catalog, ads, inventory or storefront.
    const photoIds: string[] = [];
    for (const product of validProducts) {
      const params = new URLSearchParams({
        url: product.image,
        published: "false",
        caption: composeFacebookPhotoCaption(product),
      });
      const photo = await postToFacebook(pageToken, env.META_FACEBOOK_PAGE_ID!.trim() + "/photos", params);
      photoIds.push(photo.id!);
    }

    const postParams = new URLSearchParams({ message: caption });
    photoIds.forEach((photoId, index) => {
      postParams.set("attached_media[" + index + "]", JSON.stringify({ media_fbid: photoId }));
    });
    const published = await postToFacebook(
      pageToken,
      env.META_FACEBOOK_PAGE_ID!.trim() + "/feed",
      postParams,
    );

    return json({
      ok: true,
      postId: published.id,
      postUrl: "https://www.facebook.com/" + encodeURIComponent(published.id!),
      productCount: validProducts.length,
      caption,
    });
  } catch (error) {
    // Do not auto-retry publishing: if the final request succeeded but timed out,
    // a retry could create a duplicate post. Never log or return the access token.
    const apiCode = error instanceof Error && /^FACEBOOK_API_FAILED(?:_\d+)?$/.test(error.message)
      ? error.message.replace("FACEBOOK_API_FAILED", "")
      : "";
    return json({
      error: "تعذر التأكد من نشر المنشور على فيسبوك" + (apiCode ? " (رمز Meta " + apiCode.slice(1) + ")" : "") +
        ". تحقّق من الصفحة قبل إعادة المحاولة حتى لا يتكرر المنشور.",
    }, 502);
  }
}
