import { productsTable } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import { resolveFacebookPageAccessToken } from "./facebook-page-access-token";
import { productStorefrontUrl } from "./facebook-post-composer";
import { instagramPublishingToken } from "./instagram-publish-token";
import {
  publishFacebookPhotoStory,
  publishInstagramPhotoStory,
  safeMetaError,
} from "./owner-story-meta-publish";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
type Target = "facebook" | "instagram";
const MAX_STORY_PRODUCTS = 10;

type StoryRequest = {
  productIds?: unknown;
  targets?: unknown;
  confirmed?: unknown;
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
}

function configured(env: Env, target: Target): boolean {
  return target === "facebook"
    ? /^\d+$/.test(env.META_FACEBOOK_PAGE_ID?.trim() ?? "") &&
        !!(env.META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN?.trim() || env.META_FACEBOOK_PAGE_ACCESS_TOKEN?.trim())
    : /^\d+$/.test(env.META_INSTAGRAM_ACCOUNT_ID?.trim() ?? "") &&
        !!instagramPublishingToken(env, "stories");
}

export type StorySelection = { productIds: number[]; targets: Target[] };

export function validateStorySelection(input: StoryRequest | null): StorySelection | null {
  if (!input || !Array.isArray(input.productIds) || !Array.isArray(input.targets)) return null;
  const ids = input.productIds;
  const targets = input.targets;
  if (
    ids.length < 1 || ids.length > MAX_STORY_PRODUCTS ||
    ids.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) ||
    new Set(ids).size !== ids.length ||
    targets.length < 1 || targets.length > 2 ||
    targets.some((target) => target !== "facebook" && target !== "instagram") ||
    new Set(targets).size !== targets.length
  ) {
    return null;
  }
  return { productIds: ids as number[], targets: targets as Target[] };
}

export async function handleOwnerStoryRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const isPreview = pathname === "/api/owner/stories/preview";
  const isPublish = pathname === "/api/owner/stories/publish";
  if (!isPreview && !isPublish) return null;
  if (request.method !== "POST") return json({ error: "طريقة الطلب غير مدعومة" }, 405);

  const user = await getCurrentUser(db, request, env);
  if (!user) return json({ error: "يجب تسجيل الدخول أولًا" }, 401);
  if (user.isOwner !== true) return json({ error: "نشر القصص متاح للمالك فقط" }, 403);

  const body = (await request.json().catch(() => null)) as StoryRequest | null;
  const selection = validateStorySelection(body);
  if (!selection) return json({ error: "اختَر من 1 إلى 10 موديلات مختلفة، وحدّد فيسبوك أو إنستغرام" }, 400);
  if (isPublish && body?.confirmed !== true) {
    return json({ error: "يلزم تأكيد نشر القصص صراحةً" }, 400);
  }

  const rows = await db.select({
    id: productsTable.id,
    nameAr: productsTable.nameAr,
    name: productsTable.name,
    image: productsTable.image,
    isHidden: productsTable.isHidden,
    deletedAt: productsTable.deletedAt,
  }).from(productsTable).where(inArray(productsTable.id, selection.productIds));

  const byId = new Map(rows.map((product) => [product.id, product]));
  const products = selection.productIds.map((id) => byId.get(id));
  if (products.some((p) => !p || p.isHidden || p.deletedAt)) {
    return json({ error: "أحد الموديلات محذوف أو مخفي أو غير موجود. حدّث القائمة." }, 400);
  }

  const validProducts = products.filter((p): p is NonNullable<typeof p> => !!p);
  if (validProducts.some((p) => {
    try {
      const url = new URL(p.image);
      return url.protocol !== "https:" || !url.hostname || !!url.username || !!url.password;
    } catch {
      return true;
    }
  })) {
    return json({ error: "بعض الموديلات ليس لها رابط صورة HTTPS صالح" }, 400);
  }

  const ready = {
    facebook: configured(env, "facebook"),
    instagram: configured(env, "instagram"),
  };
  const preview = {
    targets: selection.targets,
    ready,
    products: validProducts.map((p) => ({
      id: p.id,
      name: p.nameAr?.trim() || p.name?.trim() || "صنف " + p.id,
      image: p.image,
      productUrl: productStorefrontUrl(p.id),
    })),
    note: "كل صورة ستكون قصة مستقلة. روابط المنتجات تظهر في المعاينة فقط، ولا تُضاف كرابط قابل للضغط داخل القصص. لإنستغرام يُفضّل ملف JPEG عمودي بنسبة 9:16؛ قد ترفض Meta الصور غير المتوافقة.",
  };

  if (isPreview) return json(preview);

  for (const target of selection.targets) {
    if (!ready[target]) {
      return json({
        error: (target === "facebook" ? "بيانات صفحة فيسبوك" : "بيانات إنستغرام") +
          " غير مكتملة في Cloudflare؛ لم يتم نشر أي قصة.",
      }, 503);
    }
  }

  const published: Array<{ target: Target; productId: number; storyId: string }> = [];
  let pageToken: string | null = null;
  try {
    if (selection.targets.includes("facebook")) {
      // Resolve and validate the correct Page before making any write request.
      pageToken = await resolveFacebookPageAccessToken(env);
    }
  } catch {
    return json({
      error: "تعذر استخراج رمز صفحة فيسبوك من مستخدم النظام؛ لم يتم نشر أي قصة.",
    }, 502);
  }

  for (const target of selection.targets) {
    for (const product of validProducts) {
      try {
        const storyId = target === "facebook"
          ? await publishFacebookPhotoStory(
            env.META_FACEBOOK_PAGE_ID!.trim(),
            pageToken!,
            product.image,
          )
          : await publishInstagramPhotoStory(
            env.META_INSTAGRAM_ACCOUNT_ID!.trim(),
            instagramPublishingToken(env, "stories"),
            product.image,
          );
        published.push({ target, productId: product.id, storyId });
      } catch (error) {
        // Stop at the first uncertain outcome: retries could duplicate stories.
        return json({
          ok: false,
          published,
          failed: { target, productId: product.id, reason: safeMetaError(error) },
          error: "توقف نشر القصص بسبب رفض Meta أو عدم اكتمال المعالجة. راجع قصص الصفحة والحساب قبل أي إعادة محاولة حتى لا تتكرر الصور. إذا كان إنستغرام هو المتعثر، تأكد أن الصور JPEG مناسبة للقصص وأن الحساب تجاري وله صلاحية النشر.",
        });
      }
    }
  }

  return json({
    ok: true,
    published,
    count: published.length,
    note: "أُرسلت طلبات النشر بنجاح إلى Meta. تحقق من ظهور القصص على الحسابات.",
  });
}
