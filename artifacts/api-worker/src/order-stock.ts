import {
  ordersTable,
  productsTable,
  type ColorVariant,
} from "@workspace/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import type { openDb } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

interface StoredOrderItem {
  id: string;
  quantity: number;
  size?: string;
  color?: string;
}

export async function cancelOrderAndRestoreStock(
  db: Db,
  orderId: number,
  allowedStatuses: readonly string[] = ["new"],
) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        status: ordersTable.status,
        items: ordersTable.items,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .for("update");

    const order = rows[0];

    if (!order) {
      return { kind: "not_found" } as const;
    }

    if (
      order.status === "cancelled" ||
      order.status === "done" ||
      !allowedStatuses.includes(order.status)
    ) {
      return {
        kind: "invalid_status",
        status: order.status,
      } as const;
    }

    const items = Array.isArray(order.items)
      ? (order.items as StoredOrderItem[])
      : [];

    for (const item of items) {
      const productId = Number(item.id);
      const quantity = Number(item.quantity);

      if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity <= 0) {
        continue;
      }

      const productRows = await tx
        .select({
          id: productsTable.id,
          stock: productsTable.stock,
          colorVariants: productsTable.colorVariants,
        })
        .from(productsTable)
        .where(eq(productsTable.id, productId))
        .for("update");

      const product = productRows[0];

      if (!product) {
        continue;
      }

      const updates: {
        stock?: number;
        colorVariants?: ColorVariant[];
      } = {};

      if (product.stock !== null && product.stock !== undefined) {
        updates.stock = product.stock + quantity;
      }

      const colorVariants =
        (product.colorVariants as ColorVariant[] | null) ?? [];

      if (item.color && item.size && colorVariants.length > 0) {
        const variantIndex = colorVariants.findIndex(
          (variant) => variant.color === item.color,
        );

        if (variantIndex >= 0) {
          const variant = colorVariants[variantIndex];
          const sizeIndex = variant.sizes.findIndex(
            (size) => size.size === item.size,
          );

          if (sizeIndex >= 0) {
            const currentSize = variant.sizes[sizeIndex];

            if (
              currentSize.stock !== null &&
              currentSize.stock !== undefined
            ) {
              const nextSizes = variant.sizes.map(
                (size, index) =>
                  index === sizeIndex
                    ? {
                        ...size,
                        stock: currentSize.stock! + quantity,
                        outOfStock: false,
                      }
                    : size,
              );

              updates.colorVariants = colorVariants.map(
                (colorVariant, index) =>
                  index === variantIndex
                    ? { ...colorVariant, sizes: nextSizes }
                    : colorVariant,
              );
            }
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        await tx
          .update(productsTable)
          .set(updates)
          .where(eq(productsTable.id, productId));
      }
    }

    const updated = await tx
      .update(ordersTable)
      .set({ status: "cancelled" })
      .where(eq(ordersTable.id, orderId))
      .returning();

    return {
      kind: "updated",
      order: updated[0],
    } as const;
  });
}


export class OrderEditError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface EditOrderItemInput {
  id: number;
  quantity: number;
  color?: string;
  size?: string;
}

interface EditableProductState {
  row: typeof productsTable.$inferSelect;
  stock: number | null;
  colorVariants: ColorVariant[];
  changed: boolean;
}

interface EditedStoredOrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  color?: string;
  size?: string;
}

function editableOrderItemKey(
  id: number,
  color?: string,
  size?: string,
) {
  return JSON.stringify([id, color ?? "", size ?? ""]);
}

function cloneColorVariants(value: unknown): ColorVariant[] {
  const variants = (value as ColorVariant[] | null) ?? [];

  return variants.map((variant) => ({
    ...variant,
    sizes: Array.isArray(variant.sizes)
      ? variant.sizes.map((size) => ({ ...size }))
      : [],
  }));
}

function parseEditOrderItems(value: unknown): EditOrderItemInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new OrderEditError("يجب أن يحتوي الطلب على منتج واحد على الأقل");
  }

  const grouped = new Map<string, EditOrderItemInput>();

  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new OrderEditError("بيانات أحد المنتجات غير صالحة");
    }

    const item = raw as Record<string, unknown>;
    const rawId = item.id ?? item.productId;
    const id =
      typeof rawId === "number"
        ? rawId
        : typeof rawId === "string"
          ? Number(rawId)
          : Number.NaN;

    const quantity =
      typeof item.quantity === "number"
        ? item.quantity
        : typeof item.quantity === "string"
          ? Number(item.quantity)
          : Number.NaN;

    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new OrderEditError("رقم أحد المنتجات غير صالح");
    }

    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new OrderEditError("كمية أحد المنتجات غير صالحة");
    }

    const color =
      typeof item.color === "string" && item.color.trim()
        ? item.color.trim()
        : undefined;

    const size =
      typeof item.size === "string" && item.size.trim()
        ? item.size.trim()
        : undefined;

    const key = editableOrderItemKey(id, color, size);
    const existing = grouped.get(key);

    if (existing) {
      existing.quantity += quantity;

      if (existing.quantity > 99) {
        throw new OrderEditError("كمية أحد المنتجات تتجاوز الحد المسموح");
      }
    } else {
      grouped.set(key, { id, quantity, color, size });
    }
  }

  return [...grouped.values()];
}

function restoreEditedOrderItemStock(
  state: EditableProductState,
  item: StoredOrderItem,
) {
  const quantity = Number(item.quantity);

  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new OrderEditError("بيانات الطلب القديم غير صالحة", 409);
  }

  if (state.stock !== null) {
    const nextStock = state.stock + quantity;

    if (!Number.isSafeInteger(nextStock) || nextStock < 0) {
      throw new OrderEditError("تعذر إعادة مخزون المنتج", 409);
    }

    state.stock = nextStock;
    state.changed = true;
  }

  if (
    item.color &&
    item.size &&
    state.colorVariants.length > 0
  ) {
    const variantIndex = state.colorVariants.findIndex(
      (variant) => variant.color === item.color,
    );

    if (variantIndex < 0) {
      throw new OrderEditError(
        "لون أحد منتجات الطلب القديم لم يعد موجودًا",
        409,
      );
    }

    const variant = state.colorVariants[variantIndex];
    const sizeIndex = variant.sizes.findIndex(
      (entry) => entry.size === item.size,
    );

    if (sizeIndex < 0) {
      throw new OrderEditError(
        "مقاس أحد منتجات الطلب القديم لم يعد موجودًا",
        409,
      );
    }

    const selectedSize = variant.sizes[sizeIndex];

    if (
      selectedSize.stock !== null &&
      selectedSize.stock !== undefined
    ) {
      const nextStock = selectedSize.stock + quantity;

      variant.sizes[sizeIndex] = {
        ...selectedSize,
        stock: nextStock,
        outOfStock: false,
      };

      state.changed = true;
    }
  }
}

function applyEditedOrderItemStock(
  state: EditableProductState,
  item: EditOrderItemInput,
  unitPrice?: number,
): EditedStoredOrderItem {
  const product = state.row;
  const trustedUnitPrice = unitPrice ?? product.price;

  if (
    !Number.isSafeInteger(trustedUnitPrice) ||
    trustedUnitPrice < 0
  ) {
    throw new OrderEditError(
      `سعر المنتج ${product.nameAr} غير صالح`,
      409,
    );
  }

  const generalSizes = (product.sizes as string[] | null) ?? [];

  let selectedImage = product.image;

  if (state.colorVariants.length > 0) {
    if (!item.color) {
      throw new OrderEditError(`اختر لون المنتج ${product.nameAr}`);
    }

    const variantIndex = state.colorVariants.findIndex(
      (variant) => variant.color === item.color,
    );

    if (variantIndex < 0) {
      throw new OrderEditError(`اللون المحدد للمنتج ${product.nameAr} غير متوفر`);
    }

    const variant = state.colorVariants[variantIndex];
    selectedImage = variant.image?.trim() || product.image;

    const sizes = Array.isArray(variant.sizes) ? variant.sizes : [];

    if (sizes.length > 0) {
      if (!item.size) {
        throw new OrderEditError(`اختر مقاس المنتج ${product.nameAr}`);
      }

      const sizeIndex = sizes.findIndex(
        (entry) => entry.size === item.size,
      );

      if (sizeIndex < 0) {
        throw new OrderEditError(`المقاس المحدد للمنتج ${product.nameAr} غير متوفر`);
      }

      const selectedSize = sizes[sizeIndex];

      if (
        selectedSize.outOfStock ||
        (
          selectedSize.stock !== null &&
          selectedSize.stock !== undefined &&
          selectedSize.stock < item.quantity
        )
      ) {
        throw new OrderEditError(
          `الكمية المطلوبة من ${product.nameAr} غير متوفرة`,
          409,
        );
      }

      if (
        selectedSize.stock !== null &&
        selectedSize.stock !== undefined
      ) {
        const nextStock = selectedSize.stock - item.quantity;

        variant.sizes[sizeIndex] = {
          ...selectedSize,
          stock: nextStock,
          outOfStock: nextStock <= 0,
        };

        state.changed = true;
      }
    } else if (item.size) {
      throw new OrderEditError(
        `المقاس المحدد للمنتج ${product.nameAr} غير صالح`,
      );
    }
  } else {
    if (item.color) {
      throw new OrderEditError(
        `اللون المحدد للمنتج ${product.nameAr} غير صالح`,
      );
    }

    if (
      generalSizes.length > 0 &&
      (!item.size || !generalSizes.includes(item.size))
    ) {
      throw new OrderEditError(
        `المقاس المحدد للمنتج ${product.nameAr} غير متوفر`,
      );
    }

    if (generalSizes.length === 0 && item.size) {
      throw new OrderEditError(
        `المقاس المحدد للمنتج ${product.nameAr} غير صالح`,
      );
    }
  }

  if (state.stock !== null) {
    if (state.stock < item.quantity) {
      throw new OrderEditError(
        `الكمية المطلوبة من ${product.nameAr} غير متوفرة`,
        409,
      );
    }

    state.stock -= item.quantity;
    state.changed = true;
  }

  return {
    id: String(product.id),
    name: product.nameAr,
    price: trustedUnitPrice,
    quantity: item.quantity,
    image: selectedImage,
    color: item.color,
    size: item.size,
  };
}

export async function editOrderItemsAndAdjustStock(
  db: Db,
  orderId: number,
  rawItems: unknown,
) {
  const requestedItems = parseEditOrderItems(rawItems);

  return db.transaction(async (tx) => {
    const orderRows = await tx
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .for("update");

    const order = orderRows[0];

    if (!order) {
      throw new OrderEditError("الطلب غير موجود", 404);
    }

    if (order.status !== "new" && order.status !== "confirmed") {
      throw new OrderEditError(
        "يمكن تعديل الطلبات الجديدة أو المؤكدة فقط",
        409,
      );
    }

    const oldItems = Array.isArray(order.items)
      ? (order.items as StoredOrderItem[])
      : [];

    const oldProductIds = oldItems.map((item) => {
      const id = Number(item.id);

      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new OrderEditError(
          "أحد منتجات الطلب القديم غير صالح",
          409,
        );
      }

      return id;
    });

    const productIds = [
      ...new Set([
        ...oldProductIds,
        ...requestedItems.map((item) => item.id),
      ]),
    ].sort((a, b) => a - b);

    const products = await tx
      .select()
      .from(productsTable)
      .where(inArray(productsTable.id, productIds))
      .orderBy(asc(productsTable.id))
      .for("update");

    if (products.length !== productIds.length) {
      throw new OrderEditError(
        "أحد المنتجات لم يعد موجودًا",
        409,
      );
    }

    const states = new Map<number, EditableProductState>();

    for (const product of products) {
      states.set(product.id, {
        row: product,
        stock: product.stock ?? null,
        colorVariants: cloneColorVariants(product.colorVariants),
        changed: false,
      });
    }

    const oldUnitPrices = new Map<string, number>();

    for (const oldItem of oldItems) {
      const stored = oldItem as StoredOrderItem & {
        price?: number;
      };

      const productId = Number(stored.id);

      if (
        typeof stored.price !== "number" ||
        !Number.isSafeInteger(stored.price) ||
        stored.price < 0
      ) {
        throw new OrderEditError(
          "سعر أحد منتجات الطلب القديم غير صالح",
          409,
        );
      }

      const key = editableOrderItemKey(
        productId,
        stored.color,
        stored.size,
      );

      if (!oldUnitPrices.has(key)) {
        oldUnitPrices.set(key, stored.price);
      }
    }

    // أولاً: نرجع مخزون الطلب القديم بالكامل
    for (const oldItem of oldItems) {
      const productId = Number(oldItem.id);
      const state = states.get(productId);

      if (!state) {
        throw new OrderEditError(
          "تعذر العثور على أحد منتجات الطلب القديم",
          409,
        );
      }

      restoreEditedOrderItemStock(state, oldItem);
    }

    // ثانياً: نطبق التشكيلة الجديدة
    const trustedItems: EditedStoredOrderItem[] = [];
    let productsTotal = 0;

    for (const item of requestedItems) {
      const state = states.get(item.id);

      if (!state) {
        throw new OrderEditError("أحد المنتجات غير موجود", 409);
      }

      const trustedItem = applyEditedOrderItemStock(
        state,
        item,
        oldUnitPrices.get(
          editableOrderItemKey(
            item.id,
            item.color,
            item.size,
          ),
        ),
      );
      trustedItems.push(trustedItem);

      productsTotal += trustedItem.price * trustedItem.quantity;

      if (!Number.isSafeInteger(productsTotal) || productsTotal < 0) {
        throw new OrderEditError("إجمالي الطلب غير صالح");
      }
    }

    // ثالثاً: نحفظ المخزون الجديد
    for (const state of [...states.values()].sort(
      (a, b) => a.row.id - b.row.id,
    )) {
      if (!state.changed) continue;

      await tx
        .update(productsTable)
        .set({
          stock: state.stock,
          colorVariants: state.colorVariants,
        })
        .where(eq(productsTable.id, state.row.id));
    }

    const oldProductsTotal = oldItems.reduce((sum, item) => {
      const stored = item as StoredOrderItem & { price?: number };
      const price =
        typeof stored.price === "number" &&
        Number.isFinite(stored.price)
          ? stored.price
          : 0;

      return sum + price * Number(item.quantity || 0);
    }, 0);

    const shippingCost =
      typeof order.shippingCost === "number" &&
      Number.isSafeInteger(order.shippingCost) &&
      order.shippingCost >= 0
        ? order.shippingCost
        : Math.max(0, order.totalPrice - oldProductsTotal);

    const totalPrice = productsTotal + shippingCost;

    const updatedRows = await tx
      .update(ordersTable)
      .set({
        items: trustedItems,
        totalPrice,
      })
      .where(eq(ordersTable.id, orderId))
      .returning();

    return updatedRows[0];
  });
}
