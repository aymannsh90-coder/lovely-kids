/**
 * Single source of truth for the product-list Story image badge and filters.
 * Count only an explicitly saved, nonblank Story image URL as assigned.
 */
export function hasAssignedStoryImage(
  product: { storyImage?: string | null },
): boolean {
  return typeof product.storyImage === "string" &&
    product.storyImage.trim().length > 0;
}
