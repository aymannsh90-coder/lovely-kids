import { productsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import { productStorefrontUrl } from "./facebook-post-composer";
import type { Env, openDb } from "./db";
import { publishInstagramSinglePhoto, safeInstagramFeedError } from "./instagram-feed-publisher";
import { instagramFeedPilotReady, instagramPublishingToken } from "./instagram-publish-token";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
}

export async function handleInstagramFeedRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const isPreview = path === "/api/owner/instagram/feed/preview";
  const isPublish = path === "/api/owner/instagram/feed/publish";
  if (!isPreview && !isPublish) return null;
  if (request.method !== "POST") return json({ error: "طريقة الطلب غير مدعومة" }, 405);
  const user = await getCurrentUser(db, request, env);
  if (!user) return json({ error: "يجب تسجيل الدخول أولًا" }, 401);
  if (user.isOwner !== true) return json({ error: "نشر إنستغرام متاح للمالك فقط" }, 403);

  const body = (await request.json().catch(() => null)) as {
    productId?: unknown;
    confirmed?: unknown;
  } | null;
  if (!body || typeof body.productId !== "number" || !Number.isSafeInteger(body.productId) || body.productId <= 0) {
    return json({ error: "اختَر موديلًا واحدًا فقط لمنشور إنستغرام التجريبي" }, 400);
  }
  if (isPublish && body.confirmed !== true) {
    return json({ error: "يلزم تأكيد نشر الصورة على إنستغرام" }, 400);
  }

  const rows = await db.select({
    id: productsTable.id,
    nameAr: productsTable.nameAr,
    name: productsTable.name,
    image: productsTable.image,
    isHidden: productsTable.isHidden,
    deletedAt: productsTable.deletedAt,
  }).from(productsTable).where(eq(productsTable.id, body.productId)).limit(1);
  const product = rows[0];
  if (!product || product.isHidden || product.deletedAt) {
    return json({ error: "الموديل غير موجود أو مخفي أو محذوف" }, 400);
  }
  try {
    const image = new URL(product.image);
    if (image.protocol !== "https:" || !image.hostname || image.username || image.password) {
      return json({ error: "الصورة يجب أن تكون برابط HTTPS صالح" }, 400);
    }
  } catch {
    return json({ error: "رابط صورة الموديل غير صالح" }, 400);
  }

  const name = product.nameAr?.trim() || product.name?.trim() || "موديل " + product.id;
  const caption = "✨ " + name + "\n\n" +
    "شاهدي تفاصيل الموديل والمقاسات والألوان المتوفرة على متجر Lovely Kids:\n" +
    productStorefrontUrl(product.id) + "\n\n" +
    "#LovelyKids #ملابس_أطفال";
  const id = env.META_INSTAGRAM_ACCOUNT_ID?.trim() ?? "";
  const configured = instagramFeedPilotReady(env);
  // The route rejects disabled pilots before any Meta write and never uses legacy token.
  const token = configured ? instagramPublishingToken(env, "feed") : "";

  const preview = {
    configured,
    product: { id: product.id, name, image: product.image },
    caption,
    note: "إنستغرام لا يجعل روابط وصف المنشور قابلة للنقر. يُفضّل JPEG بنسبة أبعاد مدعومة. التجربة بصورة واحدة فقط.",
  };
  if (isPreview) return json(preview);
  if (!configured) {
    return json({
      error: "نشر إنستغرام التجريبي ما زال معطّلًا. يلزم تفعيل مفتاح META_INSTAGRAM_FEED_USE_NEXT_TOKEN في Wrangler بعد اعتماد الاختبارات.",
    }, 503);
  }

  try {
    const published = await publishInstagramSinglePhoto(id, token, product.image, caption);
    return json({
      ok: true,
      productId: product.id,
      mediaId: published.mediaId,
      permalink: published.permalink,
      note: "أُرسلت الصورة بنجاح إلى Meta. تحقق من ظهورها للعامة قبل نشر صورة أخرى.",
    });
  } catch (err) {
    // An uncertain media_publish outcome must not be retried automatically.
    return json({
      error: "تعذّر تأكيد نشر الصورة على إنستغرام (" + safeInstagramFeedError(err) +
        "). تحقق من الحساب قبل إعادة المحاولة لمنع تكرار المنشور.",
    }, 502);
  }
}
