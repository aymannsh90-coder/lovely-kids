import type { CartItem } from "@/context/CartContext";
import {
  type Product,
  getAvailableStock,
  isSizeOutOfStock,
} from "@/data/products";

export type CartStockIssueKind =
  | "product_unavailable"
  | "selection_unavailable"
  | "quantity_exceeds_stock";

export interface CartStockStatus {
  valid: boolean;
  kind: CartStockIssueKind | null;
  message: string | null;
  detail: string | null;
  hasAlternatives: boolean;
  availableQuantity: number | null;
}

export function isProductFullyUnavailable(product: Product): boolean {
  if (
    product.stock !== undefined &&
    product.stock !== null &&
    product.stock <= 0
  ) {
    return true;
  }

  const variants = product.colorVariants ?? [];

  if (variants.length === 0) {
    return false;
  }

  return !variants.some((variant) => {
    const sizes = Array.isArray(variant.sizes) ? variant.sizes : [];

    if (sizes.length === 0) {
      return true;
    }

    return sizes.some((size) => !isSizeOutOfStock(size));
  });
}

function hasAlternativeSelection(
  product: Product,
  item: CartItem,
): boolean {
  const variants = product.colorVariants ?? [];

  if (variants.length > 0) {
    return variants.some((variant) => {
      const sizes = Array.isArray(variant.sizes) ? variant.sizes : [];

      if (sizes.length === 0) {
        return variant.color !== item.color;
      }

      return sizes.some(
        (size) =>
          !isSizeOutOfStock(size) &&
          (variant.color !== item.color || size.size !== item.size),
      );
    });
  }

  const sizes = product.sizes ?? [];
  return sizes.some((size) => size !== item.size);
}

function unavailableSelectionMessage(item: CartItem): string {
  if (item.color && item.size) {
    return `المقاس ${item.size} من اللون ${item.color} لم يعد متوفرًا`;
  }

  if (item.size) {
    return `المقاس ${item.size} لم يعد متوفرًا`;
  }

  if (item.color) {
    return `اللون ${item.color} لم يعد متوفرًا`;
  }

  return "الاختيار المحفوظ لهذا المنتج لم يعد متوفرًا";
}

export function getCartStockStatus(
  item: CartItem,
  product: Product | undefined,
): CartStockStatus {
  if (!product) {
    return {
      valid: false,
      kind: "product_unavailable",
      message: "هذا المنتج انتهى أو لم يعد متوفرًا للطلب",
      detail: "يمكنك حذفه من السلة ومتابعة باقي الطلب.",
      hasAlternatives: false,
      availableQuantity: 0,
    };
  }

  if (isProductFullyUnavailable(product)) {
    return {
      valid: false,
      kind: "product_unavailable",
      message: "هذا المنتج نفد بالكامل",
      detail: "نفدت جميع الخيارات المتاحة لهذا المنتج. يمكنك حذفه من السلة ومتابعة باقي الطلب.",
      hasAlternatives: false,
      availableQuantity: 0,
    };
  }

  const variants = product.colorVariants ?? [];

  if (variants.length > 0) {
    if (!item.color) {
      return {
        valid: false,
        kind: "selection_unavailable",
        message: unavailableSelectionMessage(item),
        detail: "توجد ألوان أو مقاسات أخرى متوفرة.",
        hasAlternatives: true,
        availableQuantity: null,
      };
    }

    const variant = variants.find((entry) => entry.color === item.color);

    if (!variant) {
      return {
        valid: false,
        kind: "selection_unavailable",
        message: unavailableSelectionMessage(item),
        detail: "توجد ألوان أو مقاسات أخرى متوفرة.",
        hasAlternatives: true,
        availableQuantity: null,
      };
    }

    const sizes = Array.isArray(variant.sizes) ? variant.sizes : [];

    if (sizes.length > 0) {
      if (!item.size) {
        return {
          valid: false,
          kind: "selection_unavailable",
          message: unavailableSelectionMessage(item),
          detail: "توجد ألوان أو مقاسات أخرى متوفرة.",
          hasAlternatives: true,
          availableQuantity: null,
        };
      }

      const size = sizes.find((entry) => entry.size === item.size);

      if (!size || isSizeOutOfStock(size)) {
        return {
          valid: false,
          kind: "selection_unavailable",
          message: unavailableSelectionMessage(item),
          detail: "توجد ألوان أو مقاسات أخرى متوفرة.",
          hasAlternatives: true,
          availableQuantity: 0,
        };
      }
    } else if (item.size) {
      return {
        valid: false,
        kind: "selection_unavailable",
        message: unavailableSelectionMessage(item),
        detail: "توجد ألوان أو مقاسات أخرى متوفرة.",
        hasAlternatives: true,
        availableQuantity: null,
      };
    }
  } else {
    if (item.color) {
      return {
        valid: false,
        kind: "selection_unavailable",
        message: unavailableSelectionMessage(item),
        detail: "توجد خيارات أخرى متوفرة لهذا المنتج.",
        hasAlternatives: true,
        availableQuantity: null,
      };
    }

    const sizes = product.sizes ?? [];

    if (sizes.length > 0) {
      if (!item.size || !sizes.includes(item.size)) {
        return {
          valid: false,
          kind: "selection_unavailable",
          message: unavailableSelectionMessage(item),
          detail: "توجد مقاسات أخرى متوفرة.",
          hasAlternatives: true,
          availableQuantity: null,
        };
      }
    } else if (item.size) {
      return {
        valid: false,
        kind: "selection_unavailable",
        message: unavailableSelectionMessage(item),
        detail: "توجد خيارات أخرى متوفرة لهذا المنتج.",
        hasAlternatives: true,
        availableQuantity: null,
      };
    }
  }

  const availableQuantity = getAvailableStock(
    product,
    item.size,
    item.color,
  );

  if (
    availableQuantity !== null &&
    availableQuantity < item.quantity
  ) {
    if (availableQuantity <= 0) {
      return {
        valid: false,
        kind: "selection_unavailable",
        message: unavailableSelectionMessage(item),
        detail: "توجد ألوان أو مقاسات أخرى متوفرة.",
        hasAlternatives: true,
        availableQuantity: 0,
      };
    }

    const hasAlternatives = hasAlternativeSelection(product, item);

    return {
      valid: false,
      kind: "quantity_exceeds_stock",
      message: `الكمية الموجودة في السلة ${item.quantity}، والمتوفر الآن ${availableQuantity} فقط`,
      detail: hasAlternatives
        ? "يمكنك تحديث الكمية للمتوفر أو اختيار لون/مقاس آخر."
        : "يمكنك تحديث الكمية للمتوفر ثم متابعة الطلب.",
      hasAlternatives,
      availableQuantity,
    };
  }

  return {
    valid: true,
    kind: null,
    message: null,
    detail: null,
    hasAlternatives: false,
    availableQuantity,
  };
}
