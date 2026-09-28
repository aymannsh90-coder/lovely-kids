type ColorVariant = {
  sizes?: Array<{
    stock?: number | null;
  }>;
};

/**
 * Product/model-level physical quantity.
 *
 * Variant sizes are quantity dimensions only; cost remains product-level.
 *
 * Rules:
 * - general stock + fully tracked size stock => MIN(general, variants)
 * - only general => general
 * - only fully tracked variants => variants
 * - neither => unknown
 */
export function getProductQuantity(input: {
  stock: number | null;
  colorVariants: unknown;
}): number | null {
  const variants = Array.isArray(input.colorVariants)
    ? (input.colorVariants as ColorVariant[])
    : [];

  const variantSizes = variants.flatMap((variant) =>
    Array.isArray(variant.sizes) ? variant.sizes : [],
  );

  const allVariantStocksTracked =
    variantSizes.length > 0 &&
    variantSizes.every(
      (size) =>
        typeof size.stock === "number" &&
        Number.isFinite(size.stock),
    );

  const variantStock = allVariantStocksTracked
    ? variantSizes.reduce(
        (sum, size) =>
          sum + Math.max(0, size.stock ?? 0),
        0,
      )
    : null;

  const generalStock =
    typeof input.stock === "number" &&
    Number.isFinite(input.stock)
      ? Math.max(0, input.stock)
      : null;

  if (
    generalStock !== null &&
    variantStock !== null
  ) {
    return Math.min(
      generalStock,
      variantStock,
    );
  }

  if (generalStock !== null) {
    return generalStock;
  }

  if (variantStock !== null) {
    return variantStock;
  }

  return null;
}
