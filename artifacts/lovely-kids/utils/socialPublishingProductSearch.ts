import type { Product } from "@/data/products";

/**
 * Matches the POS ProductManagementPage's effective-quantity calculation.
 * A null result means stock is not completely tracked, not that stock is zero.
 * NEVER hide such products based on an assumption.
 */
export function socialPublishingEffectiveStock(
  product: Pick<Product, "stock" | "colorVariants">,
): number | null {
  const sizes = (product.colorVariants ?? []).flatMap(
    (variant) => variant.sizes ?? [],
  );
  const allTracked =
    sizes.length > 0 &&
    sizes.every(
      (size) =>
        typeof size.stock === "number" &&
        Number.isFinite(size.stock),
    );
  const variantQuantity = allTracked
    ? sizes.reduce((total, size) => total + Math.max(0, size.stock ?? 0), 0)
    : null;
  const generalQuantity =
    typeof product.stock === "number" && Number.isFinite(product.stock)
      ? Math.max(0, product.stock)
      : null;
  if (variantQuantity !== null && generalQuantity !== null) {
    return Math.min(generalQuantity, variantQuantity);
  }
  return generalQuantity ?? variantQuantity;
}

export function eligibleForSocialPublishing(product: Product): boolean {
  return !product.isHidden &&
    !product.deletedAt &&
    socialPublishingEffectiveStock(product) !== 0;
}

function searchToken(value: string): string {
  return value.trim().toLowerCase();
}

export function matchesSocialPublishingProduct(
  product: Product,
  rawQuery: string,
): boolean {
  const query = searchToken(rawQuery);
  if (!query) return true;
  return [
    product.nameAr,
    product.name,
    product.id,
    product.productCode,
    product.barcode,
    ...(product.additionalBarcodes ?? []).map(({ barcode }) => barcode),
  ].some((value) => String(value ?? "").toLowerCase().includes(query));
}

/** A scanner result is only auto-selected if exactly one eligible product matches. */
export function exactSocialPublishingBarcodeMatches(
  products: Product[],
  rawBarcode: string,
): Product[] {
  const barcode = searchToken(rawBarcode);
  if (!barcode) return [];
  return products.filter((product) => eligibleForSocialPublishing(product) &&
    [
      product.id,
      product.productCode,
      product.barcode,
      ...(product.additionalBarcodes ?? []).map(({ barcode: value }) => value),
    ].some((value) => searchToken(String(value ?? "")) === barcode));
}
