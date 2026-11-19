import { productsTable } from "@workspace/db/schema";
import { socialPublishingPhoto, socialPublishingQuantity } from "./social-publishing-photo";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import { publishInstagramPhotoStory, safeMetaError } from "./owner-story-meta-publish";
import {
  instagramNextStoryPilotReady,
  validInstagramStoryPhotoUrl,
  validateInstagramNextStoryProductId,
} from "./instagram-next-story-pilot";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
}

/** New app / NEXT only. Deliberately separate from /api/owner/stories/* legacy workflow. */
export async function handleInstagramNextStoryRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const isPreview = path === "/api/owner/instagram/story-next/preview";
  const isPublish = path === "/api/owner/instagram/story-next/publish";
  if (!isPreview && !isPublish) return null;
  if (request.method !== "POST") return json({ error: "طريقة الطلب غير مدعومة" }, 405);

  const user = await getCurrentUser(db, request, env);
  if (!user) return json({ error: "يجب تسجيل الدخول أولًا" }, 401);
  if (user.isOwner !== true) return json({ error: "نشر قصص إنستغرام متاح للمالك فقط" }, 403);

  const body = (await request.json().catch(() => null)) as {
    productId?: unknown;
    confirmed?: unknown;
  } | null;
  const productId = validateInstagramNextStoryProductId(body?.productId);
  if (productId === null) return json({ error: "اختَر موديلًا واحدًا فقط لمعاينة القصة" }, 400);
  if (isPublish && body?.confirmed !== true) return json({ error: "يلزم تأكيد نشر القصة صراحةً" }, 400);

  const rows = await db.select({
    id: productsTable.id,
    nameAr: productsTable.nameAr,
    name: productsTable.name,
    image: productsTable.image,
    stock: productsTable.stock,
    colorVariants: productsTable.colorVariants,
    isHidden: productsTable.isHidden,
    deletedAt: productsTable.deletedAt,
  }).from(productsTable).where(eq(productsTable.id, productId)).limit(1);

  const product = rows[0];
  if (!product || product.isHidden || product.deletedAt || socialPublishingQuantity(product) === 0) {
    return json({ error: "الموديل غير متوفر بالمخزون أو مخفي أو محذوف" }, 400);
  }
  const storyImage = socialPublishingPhoto(product, validInstagramStoryPhotoUrl);
  if (!validInstagramStoryPhotoUrl(storyImage)) {
    return json({ error: "تحتاج القصة لصورة JPEG برابط HTTPS عام. لا نعدّل الصور تلقائيًا." }, 400);
  }

  const configured = instagramNextStoryPilotReady(env);
  if (isPreview) {
    return json({
      configured,
      account: "lovely.kids.nablus",
      product: {
        id: product.id,
        name: product.nameAr?.trim() || product.name?.trim() || "موديل " + product.id,
        image: storyImage,
      },
      note: "هذه صورة معاينة فقط وليست نسخة 9:16 معالجة. قصص إنستغرام لا تتضمن رابط منتج قابلًا للضغط أو ملصقات تلقائية. جرّب قصة واحدة وراجعها على الهاتف.",
    });
  }
  // No fallback to previous Instagram token, the Facebook token, or feed token.
  if (!configured) return json({
    error: "نشر قصة إنستغرام بالتطبيق الجديد ما زال معطّلًا. المعاينة فقط متاحة.",
  }, 503);

  try {
    const storyId = await publishInstagramPhotoStory(
      env.META_INSTAGRAM_ACCOUNT_ID!.trim(),
      env.META_INSTAGRAM_ACCESS_TOKEN_NEXT!.trim(),
      storyImage,
    );
    return json({
      ok: true,
      productId: product.id,
      storyId,
      note: "أُرسلت القصة إلى Meta. تأكد من ظهورها على الحساب قبل نشر قصة أخرى.",
    });
  } catch (err) {
    return json({
      error: "لم نتمكن من تأكيد نشر القصة (" + safeMetaError(err) +
        "). راجع قصص الحساب قبل أي إعادة محاولة، حتى لا يتكرر النشر.",
    }, 502);
  }
}
