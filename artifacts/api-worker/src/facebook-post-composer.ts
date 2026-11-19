/** Product captions shared by the admin preview and the server-side Page publisher. */
export const DEFAULT_FACEBOOK_POST_INTRO = "🛍️ موديلات مختارة من Lovely Kids";
/** Owner-facing Facebook Page post description, validated in both preview and publish. */
export const MAX_FACEBOOK_POST_INTRO_LENGTH = 10_000;
export const FACEBOOK_PRODUCT_LINK_PROMPT =
  "لمشاهدة هذا الموديل على متجرنا الإلكتروني والتعرّف على النمر والألوان المتوفرة، ادخلي على رابط الموديل 👇";

export type FacebookPostProduct = {
  id: number;
  nameAr: string | null;
  name: string | null;
};

export function productStorefrontUrl(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid storefront product ID");
  }
  return "https://lovelykids.net/product/" + id;
}

export function composeFacebookPhotoCaption(product: FacebookPostProduct): string {
  const title =
    product.nameAr?.trim() || product.name?.trim() || ("صنف " + product.id);
  return [
    title,
    FACEBOOK_PRODUCT_LINK_PROMPT,
    productStorefrontUrl(product.id),
  ].join("\n");
}

export function composeFacebookProductCaption(
  products: readonly FacebookPostProduct[],
  intro = DEFAULT_FACEBOOK_POST_INTRO,
): string {
  if (products.length === 0) {
    throw new Error("Choose at least one product");
  }
  const trimmedIntro = intro.trim();
  if (trimmedIntro.length > MAX_FACEBOOK_POST_INTRO_LENGTH) {
    throw new Error("Intro is too long");
  }
  if (new Set(products.map((product) => product.id)).size !== products.length) {
    throw new Error("Duplicate products are not allowed");
  }
  // Photo titles and product-specific links already live in each photo caption.
  // Keep the feed caption brief instead of duplicating every product block.
  return trimmedIntro || DEFAULT_FACEBOOK_POST_INTRO;
}
