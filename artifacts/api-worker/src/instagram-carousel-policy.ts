import { productStorefrontUrl } from "./facebook-post-composer";

export const MAX_INSTAGRAM_CAROUSEL_ITEMS = 10;
export type CarouselProduct = { id: number; nameAr: string | null; name: string | null; image: string };

export function parseCarouselIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_INSTAGRAM_CAROUSEL_ITEMS) return null;
  if (!value.every(v => typeof v === "number" && Number.isSafeInteger(v) && v > 0)) return null;
  if (new Set(value).size !== value.length) return null;
  return value;
}

export function composeInstagramCarouselCaption(products: readonly CarouselProduct[]): string {
  if (!parseCarouselIds(products.map(p => p.id))) throw new Error("INVALID_CAROUSEL_PRODUCTS");
  const lines = products.map((product, index) => {
    const title = product.nameAr?.trim() || product.name?.trim() || ("موديل " + product.id);
    return (index + 1) + ". " + title + "\n" + productStorefrontUrl(product.id);
  });
  const caption = [
    "🛍️ موديلات مختارة من Lovely Kids",
    "للمقاسات والألوان والطلب، روابط الموديلات على متجرنا الإلكتروني:",
    ...lines,
    "#LovelyKids #ملابس_أطفال",
  ].join("\n\n");
  if (caption.length > 2200) throw new Error("INSTAGRAM_CAPTION_TOO_LONG");
  return caption;
}

export function validCarouselImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

export function instagramCarouselReady(env: {
  META_INSTAGRAM_CAROUSEL_ENABLED?: string;
  META_INSTAGRAM_FEED_USE_NEXT_TOKEN?: string;
  META_INSTAGRAM_ACCOUNT_ID?: string;
  META_INSTAGRAM_ACCESS_TOKEN_NEXT?: string;
}): boolean {
  return env.META_INSTAGRAM_CAROUSEL_ENABLED?.trim() === "true" &&
    env.META_INSTAGRAM_FEED_USE_NEXT_TOKEN?.trim() === "true" &&
    /^\d+$/.test(env.META_INSTAGRAM_ACCOUNT_ID?.trim() ?? "") &&
    !!env.META_INSTAGRAM_ACCESS_TOKEN_NEXT?.trim();
}
