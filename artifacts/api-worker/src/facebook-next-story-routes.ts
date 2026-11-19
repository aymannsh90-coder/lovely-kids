import { productsTable } from "@workspace/db/schema";
import { socialPublishingPhoto, socialPublishingQuantity } from "./social-publishing-photo";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import { resolveFacebookPageAccessToken } from "./facebook-page-access-token";
import { publishFacebookPhotoStory, safeMetaError } from "./owner-story-meta-publish";
import {
  facebookNextStoryPilotReady,
  facebookNextStoryProductId,
  validFacebookNextStoryImage,
} from "./facebook-next-story-policy";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
}

/**
 * Owner-only NEXT Facebook Page Stories. The legacy /api/owner/stories/*
 * and Facebook feed endpoints are NOT changed or used by this route.
 * One original product image per request; preview is always read-only.
 */
export async function handleFacebookNextStoryRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const isPreview = pathname === "/api/owner/facebook/story-next/preview";
  const isPublish = pathname === "/api/owner/facebook/story-next/publish";
  if (!isPreview && !isPublish) return null;
  if (request.method !== "POST") return json({ error: "طريقة الطلب غير مدعومة" }, 405);

  const user = await getCurrentUser(db, request, env);
  if (!user) return json({ error: "يجب تسجيل الدخول أولًا" }, 401);
  if (user.isOwner !== true) return json({ error: "قصص فيسبوك متاحة للمالك فقط" }, 403);

  const body = (await request.json().catch(() => null)) as {
    productId?: unknown;
    confirmed?: unknown;
  } | null;
  const productId = facebookNextStoryProductId(body?.productId);
  if (productId === null) return json({ error: "اختَر موديلًا واحدًا صحيحًا للقصة" }, 400);
  if (isPublish && body?.confirmed !== true) {
    return json({ error: "يلزم تأكيد نشر القصة صراحةً" }, 400);
  }

  const records = await db.select({
    id: productsTable.id,
    nameAr: productsTable.nameAr,
    name: productsTable.name,
    image: productsTable.image,
    stock: productsTable.stock,
    colorVariants: productsTable.colorVariants,
    isHidden: productsTable.isHidden,
    deletedAt: productsTable.deletedAt,
  }).from(productsTable).where(eq(productsTable.id, productId)).limit(1);

  const product = records[0];
  if (!product || product.isHidden || product.deletedAt || socialPublishingQuantity(product) === 0) {
    return json({ error: "الموديل غير متوفر بالمخزون أو مخفي أو محذوف" }, 400);
  }
  const storyImage = socialPublishingPhoto(product, validFacebookNextStoryImage);
  if (!validFacebookNextStoryImage(storyImage)) {
    return json({
      error: "قصة فيسبوك تحتاج صورة JPEG أو PNG برابط HTTPS أصلي. لن ننسخ صور R2.",
    }, 400);
  }

  // Must be explicitly enabled by a future, separately reviewed rollout.
  const configured = facebookNextStoryPilotReady(env);
  if (isPreview) {
    return json({
      configured,
      page: "Lovely Kids",
      product: {
        id: product.id,
        name: product.nameAr?.trim() || product.name?.trim() || "موديل " + product.id,
        image: storyImage,
      },
      note: "هذه معاينة للصورة الأصلية فقط. قد يقص فيسبوك الأطراف عند عرض القصة عموديًا. لا توجد صور إضافية على R2 أو ملصقات أو رابط تفاعلي تلقائي.",
    });
  }
  if (!configured) return json({
    error: "نشر قصص فيسبوك من التطبيق الجديد معطّل حاليًا. المعاينة فقط متاحة.",
  }, 503);

  try {
    // Always use the NEXT system token and exact Page. No legacy fallback.
    const pageToken = await resolveFacebookPageAccessToken(env, "next");
    const storyId = await publishFacebookPhotoStory(
      env.META_FACEBOOK_PAGE_ID!.trim(),
      pageToken,
      storyImage,
    );
    return json({
      ok: true,
      storyId,
      productId,
      note: "تم قبول نشر قصة فيسبوك لدى Meta. تأكد من ظهورها على الصفحة.",
    });
  } catch (error) {
    // Unknown publish outcomes are not retried.
    return json({
      error: "تعذر تأكيد نشر قصة فيسبوك (" + safeMetaError(error) +
        "). راجع قصص الصفحة قبل إعادة أي محاولة حتى لا تتكرر.",
    }, 502);
  }
}
