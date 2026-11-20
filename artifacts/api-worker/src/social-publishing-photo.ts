import type { ColorVariant } from "@workspace/db/schema";

export type SocialPublishingPhotoProduct = {
  image: string;
  stock?: number | null;
  colorVariants?: ColorVariant[] | null;
};

/** POS effectiveQuantity: when both totals are tracked, the smaller total wins. */
export function socialPublishingQuantity(product: SocialPublishingPhotoProduct): number | null {
  const variants = product.colorVariants ?? [];
  const sizes = variants.flatMap((variant) => variant.sizes ?? []);
  const allSizesTracked = sizes.length > 0 &&
    sizes.every((size) => typeof size.stock === "number" && Number.isFinite(size.stock));
  const variantTotal = allSizesTracked
    ? sizes.reduce((sum, size) => sum + Math.max(0, size.stock ?? 0), 0)
    : null;
  const general = typeof product.stock === "number" && Number.isFinite(product.stock)
    ? Math.max(0, product.stock) : null;
  if (general !== null && variantTotal !== null) return Math.min(general, variantTotal);
  return general ?? variantTotal;
}

/**
 * Use an existing available color's image ONLY when all color/size stock is
 * tracked and exactly one color remains in stock. No copies or R2 writes.
 * Unknown quantities mean we keep the product's original main image.
 *
 * An optional validator makes the same rule safe for Instagram JPEG Stories.
 */
/**
 * Stories prefer the dedicated portrait image (when valid for that platform).
 * No conversion, duplication, or mutation; when absent, keep the proven
 * single-in-stock-color fallback used by the existing social publisher.
 */
export function socialPublishingStoryPhoto(
  product: SocialPublishingPhotoProduct & { storyImage?: string | null },
  validImage: (url: string) => boolean,
): string {
  const dedicated = product.storyImage?.trim();
  return dedicated && validImage(dedicated)
    ? dedicated
    : socialPublishingPhoto(product, validImage);
}

export function socialPublishingPhoto(
  product: SocialPublishingPhotoProduct,
  validImage: (url: string) => boolean = (url) => {
    try { return new URL(url).protocol === "https:"; }
    catch { return false; }
  },
): string {
  const variants = product.colorVariants ?? [];
  if (variants.length < 2) return product.image;
  if (!variants.every((variant) =>
    (variant.sizes?.length ?? 0) > 0 &&
    variant.sizes.every((size) =>
      typeof size.stock === "number" && Number.isFinite(size.stock))
  )) return product.image;
  if (socialPublishingQuantity(product) === 0) return product.image;
  const inStock = variants.filter((variant) =>
    variant.sizes.some((size) => (size.stock ?? 0) > 0));
  if (inStock.length !== 1) return product.image;
  const image = inStock[0]?.image?.trim();
  return image && validImage(image) ? image : product.image;
}
