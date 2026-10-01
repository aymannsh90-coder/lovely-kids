import {
  inventoryMovementsTable,
  appSettingsTable,
  orderItemCostsTable,
  ordersTable,
  productsTable,
  type ColorVariant,
} from "@workspace/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import type { openDb } from "./db";
import {
  addProductCostAtCurrentAverage,
  consumeProductCost,
  restoreExactProductCost,
} from "./inventory-cost-engine";
import {
  allocateOrderCostAcrossLines,
  combineOrderCostQualities,
  type OrderCostLine,
} from "./order-cost-helpers";
import {
  resolveShippingCost,
  resolveShippingZone,
  STORE_PICKUP_LABEL,
} from "./order-service";

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
  actorUserId?: number | null,
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

    const stockCardOccurredAt = new Date();
    const stockCardOperationId =
      crypto.randomUUID();

    const existingCostRows =
      await tx
        .select()
        .from(orderItemCostsTable)
        .where(
          eq(
            orderItemCostsTable.orderId,
            orderId,
          ),
        )
        .orderBy(
          asc(orderItemCostsTable.lineNumber),
        );

    const costByLineNumber =
      new Map(
        existingCostRows.map((cost) => [
          cost.lineNumber,
          cost,
        ]),
      );

    // A cancelled order can later be reactivated and
    // cancelled again. Use a movement instance token so
    // every real lifecycle movement remains unique.
    const cancelMovementRef =
      globalThis.crypto.randomUUID();

    for (const [itemIndex, item] of items.entries()) {
      const lineNumber = itemIndex + 1;
      const productId = Number(item.id);
      const quantity = Number(item.quantity);

      if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity <= 0) {
        continue;
      }

      const productRows = await tx
        .select({
          id: productsTable.id,
          nameAr: productsTable.nameAr,
          productCode: productsTable.productCode,
          barcode: productsTable.barcode,
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

      let generalStockBefore: number | null = null;
      let generalStockAfter: number | null = null;
      let variantStockBefore: number | null = null;
      let variantStockAfter: number | null = null;

      if (product.stock !== null && product.stock !== undefined) {
        generalStockBefore = product.stock;
        generalStockAfter =
          product.stock + quantity;

        updates.stock = generalStockAfter;
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
              variantStockBefore =
                currentSize.stock;
              variantStockAfter =
                currentSize.stock + quantity;

              const nextSizes = variant.sizes.map(
                (size, index) =>
                  index === sizeIndex
                    ? {
                        ...size,
                        stock: variantStockAfter!,
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

        // stock-card:online-order:cancelled
        await tx
          .insert(inventoryMovementsTable)
          .values({
            productId,
            barcode: product.barcode ?? null,
            productCode:
              product.productCode ?? null,
            productNameAr: product.nameAr,
            color:
              typeof item.color === "string"
                ? item.color
                : null,
            size:
              typeof item.size === "string"
                ? item.size
                : null,

            movementType:
              "online_order_cancel",
            quantityDelta: quantity,

            generalStockBefore,
            generalStockAfter,
            variantStockBefore,
            variantStockAfter,

            sourceType: "online_order",
            sourceId: orderId,
            sourceItemId: null,
            sourcePublicId:
              String(orderId),

            eventKey:
              `online-order:${orderId}:cancel:${stockCardOperationId}:${itemIndex + 1}`,

            occurredAt:
              stockCardOccurredAt,
          });
      }

      const originalCost =
        costByLineNumber.get(lineNumber);

      if (originalCost) {
        if (
          originalCost.productId !== productId ||
          originalCost.quantity !== quantity
        ) {
          throw new OrderEditError(
            "بيانات تكلفة الطلب غير متطابقة",
            409,
          );
        }

        const restoredCost =
          await restoreExactProductCost(
            tx,
            {
              productId,
              quantity,
              costTotalMinor:
                originalCost.costTotalMinor,
              costQuality:
                originalCost.costQuality as
                  | "confirmed"
                  | "estimated"
                  | "mixed",

              eventType:
                "online_order_cancel",

              sourceType:
                "online_order_cancel",

              sourceRef:
                String(orderId),

              sourceItemRef:
                `${cancelMovementRef}:${lineNumber}`,

              note:
                `Online order cancel ${orderId}`,

              createdByUserId:
                actorUserId ?? null,
            },
          );

        // A snapshot proves this order was cost-tracked.
        // Missing state here indicates accounting corruption,
        // so don't silently make physical/accounting stock diverge.
        if (!restoredCost.tracked) {
          throw new OrderEditError(
            "تعذر إعادة تكلفة مخزون الطلب",
            409,
          );
        }
      } else {
        // Legacy/pre-cutover order:
        // restore physical stock and estimate its value using
        // the current/reference product average.
        const restoredLegacyCost =
          await addProductCostAtCurrentAverage(
            tx,
            {
              productId,
              quantity,

              eventType:
                "online_order_cancel",

              sourceType:
                "online_order_cancel",

              sourceRef:
                String(orderId),

              sourceItemRef:
                `${cancelMovementRef}:${lineNumber}`,

              note:
                `Legacy online order cancel ${orderId}`,

              createdByUserId:
                actorUserId ?? null,
            },
          );

        if (!restoredLegacyCost.tracked) {
          console.warn(
            "ONLINE_ORDER_CANCEL_LEGACY_COST_UNTRACKED",
            {
              orderId,
              lineNumber,
              productId,
              reason:
                restoredLegacyCost.reason,
            },
          );
        }
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

interface EditOrderDetailsInput {
  customerName?: unknown;
  customerPhone?: unknown;
  customerAddress?: unknown;
  shippingZone?: unknown;
  notes?: unknown;
  invoiceDiscount?: unknown;
  paymentMethod?: unknown;
}

function parseRequiredOrderEditText(
  value: unknown,
  fieldName: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new OrderEditError(`${fieldName} غير صالح`);
  }

  const text = value.trim();

  if (!text) {
    throw new OrderEditError(`${fieldName} مطلوب`);
  }

  if (text.length > maxLength) {
    throw new OrderEditError(`${fieldName} طويل جدًا`);
  }

  return text;
}

function parseOptionalOrderEditText(
  value: unknown,
  fieldName: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new OrderEditError(`${fieldName} غير صالح`);
  }

  const text = value.trim();

  if (text.length > maxLength) {
    throw new OrderEditError(`${fieldName} طويل جدًا`);
  }

  return text || null;
}

interface EditOrderItemInput {
  id: number;
  quantity: number;
  color?: string;
  size?: string;
  price?: number;
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

// stock-card:online-order:helpers
function getTrackedVariantStock(
  variants: ColorVariant[],
  color?: string | null,
  size?: string | null,
): number | null {
  if (!color || !size) {
    return null;
  }

  const variant = variants.find(
    (entry) => entry.color === color,
  );

  if (!variant) {
    return null;
  }

  const selectedSize = variant.sizes.find(
    (entry) => entry.size === size,
  );

  return typeof selectedSize?.stock === "number"
    ? selectedSize.stock
    : null;
}

interface StockCardOrderMovementDraft {
  productId: number;
  barcode: string | null;
  productCode: string | null;
  productNameAr: string;
  color: string | null;
  size: string | null;
  quantityDelta: number;
  generalStockBefore: number | null;
  generalStockAfter: number | null;
  variantStockBefore: number | null;
  variantStockAfter: number | null;
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

    const rawPrice =
      item.price;

    const price =
      rawPrice === undefined
        ? undefined
        : typeof rawPrice === "number"
          ? rawPrice
          : typeof rawPrice === "string" &&
              rawPrice.trim()
            ? Number(rawPrice)
            : Number.NaN;

    if (
      price !== undefined &&
      (
        !Number.isSafeInteger(price) ||
        price < 0 ||
        price > 2_147_483_647
      )
    ) {
      throw new OrderEditError(
        "سعر أحد المنتجات غير صالح",
      );
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
      if (
        price !== undefined &&
        existing.price !== undefined &&
        existing.price !== price
      ) {
        throw new OrderEditError(
          "لا يمكن دمج نفس المنتج بسعرين مختلفين",
        );
      }

      if (
        existing.price === undefined &&
        price !== undefined
      ) {
        existing.price = price;
      }

      existing.quantity += quantity;

      if (existing.quantity > 99) {
        throw new OrderEditError(
          "كمية أحد المنتجات تتجاوز الحد المسموح",
        );
      }
    } else {
      grouped.set(key, {
        id,
        quantity,
        price,
        color,
        size,
      });
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

function parseOrderEditPaymentMethod(
  value: unknown,
): "cod" | "bank_transfer" {
  if (value !== "cod" && value !== "bank_transfer") {
    throw new OrderEditError("طريقة الدفع غير صالحة");
  }
  return value;
}

function parseOrderInvoiceDiscount(
  value: unknown,
): number {
  const amount = Number(value);

  if (
    !Number.isSafeInteger(amount) ||
    amount < 0
  ) {
    throw new OrderEditError(
      "الخصم العام غير صالح",
    );
  }

  return amount;
}

function allocateOrderInvoiceDiscount(
  items: Array<{ price: number; quantity: number }>,
  invoiceDiscount: number,
): number[] {
  if (invoiceDiscount === 0) {
    return items.map(() => 0);
  }

  const productsTotal = items.reduce(
    (sum, item) =>
      sum + item.price * item.quantity,
    0,
  );

  if (
    productsTotal <= 0 ||
    invoiceDiscount > productsTotal
  ) {
    throw new OrderEditError(
      "الخصم العام أكبر من إجمالي المنتجات",
    );
  }

  const discountMinor = invoiceDiscount * 100;

  if (!Number.isSafeInteger(discountMinor)) {
    throw new OrderEditError(
      "الخصم العام غير صالح",
    );
  }

  const denominator = BigInt(productsTotal);

  const rows = items.map((item, index) => {
    const gross =
      item.price * item.quantity;
    const grossMinor = gross * 100;

    const numerator =
      BigInt(discountMinor) *
      BigInt(gross);

    return {
      index,
      grossMinor,
      amount: Number(
        numerator / denominator,
      ),
      remainder:
        numerator % denominator,
    };
  });

  let allocated = rows.reduce(
    (sum, row) => sum + row.amount,
    0,
  );

  let remaining =
    discountMinor - allocated;

  const ranked = [...rows].sort(
    (a, b) => {
      if (a.remainder === b.remainder) {
        return a.index - b.index;
      }

      return a.remainder > b.remainder
        ? -1
        : 1;
    },
  );

  for (
    let i = 0;
    remaining > 0 && i < ranked.length;
    i += 1
  ) {
    if (
      ranked[i].amount <
      ranked[i].grossMinor
    ) {
      ranked[i].amount += 1;
      remaining -= 1;
    }
  }

  allocated = rows.reduce(
    (sum, row) => sum + row.amount,
    0,
  );

  if (allocated !== discountMinor) {
    throw new OrderEditError(
      "تعذر توزيع الخصم العام",
      409,
    );
  }

  return rows
    .sort((a, b) => a.index - b.index)
    .map((row) => row.amount);
}

export async function editOrderItemsAndAdjustStock(
  db: Db,
  orderId: number,
  rawItems: unknown,
  rawDetails?: EditOrderDetailsInput,
  actorUserId?: number | null,
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

    if (
      order.status !== "new" &&
      order.status !== "confirmed" &&
      order.status !== "delivering"
    ) {
      throw new OrderEditError(
        "يمكن تعديل الطلبات الجديدة أو المؤكدة أو قيد التوصيل فقط",
        409,
      );
    }

    const oldItems = Array.isArray(order.items)
      ? (order.items as StoredOrderItem[])
      : [];

    const oldCostRows =
      await tx
        .select()
        .from(orderItemCostsTable)
        .where(
          eq(
            orderItemCostsTable.orderId,
            orderId,
          ),
        )
        .orderBy(
          asc(orderItemCostsTable.lineNumber),
        );

    const oldCostByLineNumber =
      new Map(
        oldCostRows.map((cost) => [
          cost.lineNumber,
          cost,
        ]),
      );

    for (
      const [index, oldItem]
      of oldItems.entries()
    ) {
      const lineNumber = index + 1;
      const cost =
        oldCostByLineNumber.get(
          lineNumber,
        );

      if (!cost) continue;

      const productId =
        Number(oldItem.id);
      const quantity =
        Number(oldItem.quantity);

      if (
        cost.productId !== productId ||
        cost.quantity !== quantity
      ) {
        throw new OrderEditError(
          "بيانات تكلفة الطلب القديم غير متطابقة",
          409,
        );
      }
    }

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

    const stockCardInitialStates =
      new Map<
        number,
        {
          stock: number | null;
          colorVariants: ColorVariant[];
        }
      >();

    for (const [productId, state] of states) {
      stockCardInitialStates.set(
        productId,
        {
          stock: state.stock,
          colorVariants:
            cloneColorVariants(
              state.colorVariants,
            ),
        },
      );
    }

    const stockCardOccurredAt = new Date();
    const stockCardOperationId =
      crypto.randomUUID();

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
        item.price ??
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

    const oldQuantities = new Map<
      string,
      {
        productId: number;
        color: string | null;
        size: string | null;
        quantity: number;
      }
    >();

    for (const oldItem of oldItems) {
      const productId = Number(oldItem.id);
      const color =
        typeof oldItem.color === "string" &&
        oldItem.color.trim()
          ? oldItem.color.trim()
          : null;
      const size =
        typeof oldItem.size === "string" &&
        oldItem.size.trim()
          ? oldItem.size.trim()
          : null;

      const key = editableOrderItemKey(
        productId,
        color ?? undefined,
        size ?? undefined,
      );

      const current = oldQuantities.get(key);

      if (current) {
        current.quantity +=
          Number(oldItem.quantity);
      } else {
        oldQuantities.set(key, {
          productId,
          color,
          size,
          quantity:
            Number(oldItem.quantity),
        });
      }
    }

    const newQuantities = new Map<
      string,
      {
        productId: number;
        color: string | null;
        size: string | null;
        quantity: number;
      }
    >();

    for (const newItem of trustedItems) {
      const productId =
        Number(newItem.id);

      const color =
        newItem.color ?? null;
      const size =
        newItem.size ?? null;

      const key = editableOrderItemKey(
        productId,
        color ?? undefined,
        size ?? undefined,
      );

      const current =
        newQuantities.get(key);

      if (current) {
        current.quantity +=
          newItem.quantity;
      } else {
        newQuantities.set(key, {
          productId,
          color,
          size,
          quantity:
            newItem.quantity,
        });
      }
    }

    const stockCardKeys = [
      ...new Set([
        ...oldQuantities.keys(),
        ...newQuantities.keys(),
      ]),
    ].sort();

    const stockCardGeneralCursors =
      new Map<number, number | null>();

    for (
      const [productId, initial]
      of stockCardInitialStates
    ) {
      stockCardGeneralCursors.set(
        productId,
        initial.stock,
      );
    }

    const stockCardMovementDrafts:
      StockCardOrderMovementDraft[] = [];

    for (const key of stockCardKeys) {
      const oldEntry =
        oldQuantities.get(key);

      const newEntry =
        newQuantities.get(key);

      const entry =
        newEntry ?? oldEntry;

      if (!entry) {
        continue;
      }

      const oldQuantity =
        oldEntry?.quantity ?? 0;

      const newQuantity =
        newEntry?.quantity ?? 0;

      const quantityDelta =
        oldQuantity - newQuantity;

      if (quantityDelta === 0) {
        continue;
      }

      const state =
        states.get(entry.productId);

      const initial =
        stockCardInitialStates.get(
          entry.productId,
        );

      if (!state || !initial) {
        throw new OrderEditError(
          "تعذر تسجيل حركة تعديل الطلب",
          409,
        );
      }

      const generalStockBefore =
        stockCardGeneralCursors.get(
          entry.productId,
        ) ?? null;

      const generalStockAfter =
        generalStockBefore === null
          ? null
          : generalStockBefore +
            quantityDelta;

      stockCardGeneralCursors.set(
        entry.productId,
        generalStockAfter,
      );

      const variantStockBefore =
        getTrackedVariantStock(
          initial.colorVariants,
          entry.color,
          entry.size,
        );

      const variantStockAfter =
        variantStockBefore === null
          ? null
          : variantStockBefore +
            quantityDelta;

      stockCardMovementDrafts.push({
        productId:
          entry.productId,
        barcode:
          state.row.barcode ?? null,
        productCode:
          state.row.productCode ?? null,
        productNameAr:
          state.row.nameAr,
        color: entry.color,
        size: entry.size,
        quantityDelta,
        generalStockBefore,
        generalStockAfter,
        variantStockBefore,
        variantStockAfter,
      });
    }

    // stock-card:online-order:edited
    if (stockCardMovementDrafts.length > 0) {
      await tx
        .insert(inventoryMovementsTable)
        .values(
          stockCardMovementDrafts.map(
            (movement, index) => ({
              ...movement,
              movementType:
                "online_order_edit",
              sourceType:
                "online_order",
              sourceId:
                order.id,
              sourceItemId: null,
              sourcePublicId:
                String(order.id),
              eventKey:
                `online-order:${order.id}:edit:${stockCardOperationId}:${index + 1}`,
              occurredAt:
                stockCardOccurredAt,
            }),
          ),
        );
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

    const details = rawDetails ?? {};

    const customerName =
      details.customerName === undefined
        ? order.customerName
        : parseRequiredOrderEditText(
            details.customerName,
            "اسم الزبون",
            200,
          );

    const customerPhone =
      details.customerPhone === undefined
        ? order.customerPhone
        : parseRequiredOrderEditText(
            details.customerPhone,
            "رقم الهاتف",
            50,
          );

    const requestedShippingZone =
      details.shippingZone === undefined
        ? order.shippingZone
        : parseRequiredOrderEditText(
            details.shippingZone,
            "منطقة التوصيل",
            100,
          );

    if (!requestedShippingZone) {
      throw new OrderEditError("منطقة التوصيل مطلوبة");
    }

    const settingsRows = await tx
      .select({ data: appSettingsTable.data })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.id, 1));

    const settingsData = settingsRows[0]?.data;

    let shipping;

    try {
      shipping = resolveShippingZone(
        settingsData,
        requestedShippingZone,
      );
    } catch (error) {
      throw new OrderEditError(
        error instanceof Error
          ? error.message
          : "منطقة التوصيل غير صالحة",
      );
    }

    const rawCustomerAddress =
      details.customerAddress === undefined
        ? order.customerAddress
        : typeof details.customerAddress === "string"
          ? details.customerAddress.trim()
          : "";

    const customerAddress =
      shipping.label === STORE_PICKUP_LABEL
        ? STORE_PICKUP_LABEL
        : rawCustomerAddress;

    if (
      shipping.label !== STORE_PICKUP_LABEL &&
      !customerAddress
    ) {
      throw new OrderEditError(
        "العنوان مطلوب لطلبات التوصيل",
      );
    }

    if (customerAddress.length > 500) {
      throw new OrderEditError("العنوان طويل جدًا");
    }

    const notes =
      details.notes === undefined
        ? order.notes
        : parseOptionalOrderEditText(
            details.notes,
            "الملاحظات",
            1000,
          );

    const paymentMethod =
      details.paymentMethod === undefined
        ? order.paymentMethod
        : parseOrderEditPaymentMethod(details.paymentMethod);

    const paymentMethodChanged =
      paymentMethod !== order.paymentMethod;

    const paymentStatus = paymentMethodChanged
      ? paymentMethod === "bank_transfer"
        ? "awaiting_transfer"
        : "pending"
      : order.paymentStatus;

    const paymentProof = paymentMethodChanged
      ? null
      : order.paymentProof;

    const existingDiscountMinor =
      oldItems.reduce(
        (sum, item) => {
          const raw = (
            item as StoredOrderItem & {
              invoiceDiscountMinor?: unknown;
            }
          ).invoiceDiscountMinor;

          if (raw === undefined) {
            return sum;
          }

          if (
            !Number.isSafeInteger(raw) ||
            Number(raw) < 0
          ) {
            throw new OrderEditError(
              "بيانات الخصم القديم غير صالحة",
              409,
            );
          }

          const next =
            sum + Number(raw);

          if (!Number.isSafeInteger(next)) {
            throw new OrderEditError(
              "إجمالي الخصم القديم غير صالح",
              409,
            );
          }

          return next;
        },
        0,
      );

    if (existingDiscountMinor % 100 !== 0) {
      throw new OrderEditError(
        "إجمالي الخصم القديم غير صالح",
        409,
      );
    }

    const invoiceDiscount =
      details.invoiceDiscount === undefined
        ? existingDiscountMinor / 100
        : parseOrderInvoiceDiscount(
            details.invoiceDiscount,
          );

    if (invoiceDiscount > productsTotal) {
      throw new OrderEditError(
        "الخصم العام أكبر من إجمالي المنتجات",
      );
    }

    const invoiceDiscountAllocations =
      allocateOrderInvoiceDiscount(
        trustedItems,
        invoiceDiscount,
      );

    trustedItems.forEach((item, index) => {
      (
        item as EditedStoredOrderItem & {
          invoiceDiscountMinor?: number;
        }
      ).invoiceDiscountMinor =
        invoiceDiscountAllocations[index];
    });

    const shippingCost = resolveShippingCost(
      settingsData,
      shipping,
      productsTotal,
    );

    const totalPrice =
      productsTotal -
      invoiceDiscount +
      shippingCost;

    if (
      !Number.isSafeInteger(totalPrice) ||
      totalPrice < 0
    ) {
      throw new OrderEditError("إجمالي الطلب غير صالح");
    }

    // =================================================
    // Differential inventory-cost accounting
    //
    // Cost belongs to PRODUCT/MODEL only.
    // Color/size changes alone never change product cost.
    // =================================================

    const editMovementRef =
      globalThis.crypto.randomUUID();

    const oldCostLines: OrderCostLine[] =
      oldItems.map(
        (item, index) => {
          const productId =
            Number(item.id);
          const quantity =
            Number(item.quantity);

          if (
            !Number.isSafeInteger(productId) ||
            productId <= 0 ||
            !Number.isSafeInteger(quantity) ||
            quantity <= 0
          ) {
            throw new OrderEditError(
              "بيانات أحد منتجات الطلب القديم غير صالحة",
              409,
            );
          }

          return {
            lineNumber:
              index + 1,
            productId,
            quantity,
            color:
              typeof item.color === "string"
                ? item.color
                : null,
            size:
              typeof item.size === "string"
                ? item.size
                : null,
          };
        },
      );

    const newCostLines: OrderCostLine[] =
      trustedItems.map(
        (item, index) => ({
          lineNumber:
            index + 1,
          productId:
            Number(item.id),
          quantity:
            item.quantity,
          color:
            item.color ?? null,
          size:
            item.size ?? null,
        }),
      );

    const oldLinesByProduct =
      new Map<number, OrderCostLine[]>();

    const newLinesByProduct =
      new Map<number, OrderCostLine[]>();

    for (const line of oldCostLines) {
      const group =
        oldLinesByProduct.get(
          line.productId,
        ) ?? [];

      group.push(line);

      oldLinesByProduct.set(
        line.productId,
        group,
      );
    }

    for (const line of newCostLines) {
      const group =
        newLinesByProduct.get(
          line.productId,
        ) ?? [];

      group.push(line);

      newLinesByProduct.set(
        line.productId,
        group,
      );
    }

    const costProductIds = [
      ...new Set([
        ...oldLinesByProduct.keys(),
        ...newLinesByProduct.keys(),
      ]),
    ].sort(
      (left, right) =>
        left - right,
    );

    const nextOrderCostRows: Array<
      typeof orderItemCostsTable.$inferInsert
    > = [];

    for (
      const productId
      of costProductIds
    ) {
      const oldLines =
        oldLinesByProduct.get(
          productId,
        ) ?? [];

      const newLines =
        newLinesByProduct.get(
          productId,
        ) ?? [];

      const oldQuantity =
        oldLines.reduce(
          (total, line) =>
            total + line.quantity,
          0,
        );

      const newQuantity =
        newLines.reduce(
          (total, line) =>
            total + line.quantity,
          0,
        );

      const oldCostsForProduct =
        oldLines.map((line) =>
          oldCostByLineNumber.get(
            line.lineNumber,
          ),
        );

      const fullyTrackedOldProduct =
        oldQuantity > 0 &&
        oldCostsForProduct.length > 0 &&
        oldCostsForProduct.every(
          (cost) => cost !== undefined,
        );

      // ===============================================
      // A) Product newly added to the order
      // ===============================================
      if (oldQuantity === 0) {
        if (newQuantity === 0) {
          continue;
        }

        const consumed =
          await consumeProductCost(
            tx,
            {
              productId,
              quantity:
                newQuantity,

              eventType:
                "online_order",

              sourceType:
                "online_order_edit",

              sourceRef:
                String(orderId),

              sourceItemRef:
                `${editMovementRef}:${productId}`,

              note:
                `Online order edit add ${orderId}`,

              createdByUserId:
                actorUserId ?? null,
            },
          );

        if (!consumed.tracked) {
          console.warn(
            "ONLINE_ORDER_EDIT_NEW_PRODUCT_COST_UNTRACKED",
            {
              orderId,
              productId,
              reason:
                consumed.reason,
            },
          );

          continue;
        }

        nextOrderCostRows.push(
          ...allocateOrderCostAcrossLines(
            orderId,
            newLines,
            consumed.costTotalMinor,
            consumed.costQuality,
          ),
        );

        continue;
      }

      // ===============================================
      // B) Legacy/pre-cutover product
      //
      // Do not invent historical cost for the preserved
      // portion. Only keep accounting quantity in sync.
      // ===============================================
      if (!fullyTrackedOldProduct) {
        if (
          newQuantity >
          oldQuantity
        ) {
          const addedQuantity =
            newQuantity -
            oldQuantity;

          const consumed =
            await consumeProductCost(
              tx,
              {
                productId,
                quantity:
                  addedQuantity,

                eventType:
                  "online_order",

                sourceType:
                  "online_order_edit",

                sourceRef:
                  String(orderId),

                sourceItemRef:
                  `${editMovementRef}:${productId}`,

                note:
                  `Legacy online order edit increase ${orderId}`,

                createdByUserId:
                  actorUserId ?? null,
              },
            );

          if (!consumed.tracked) {
            console.warn(
              "ONLINE_ORDER_EDIT_LEGACY_INCREASE_COST_UNTRACKED",
              {
                orderId,
                productId,
                reason:
                  consumed.reason,
              },
            );
          }
        } else if (
          newQuantity <
          oldQuantity
        ) {
          const restoredQuantity =
            oldQuantity -
            newQuantity;

          const restored =
            await addProductCostAtCurrentAverage(
              tx,
              {
                productId,
                quantity:
                  restoredQuantity,

                eventType:
                  "online_order_edit_reverse",

                sourceType:
                  "online_order_edit",

                sourceRef:
                  String(orderId),

                sourceItemRef:
                  `${editMovementRef}:${productId}`,

                note:
                  `Legacy online order edit reverse ${orderId}`,

                createdByUserId:
                  actorUserId ?? null,
              },
            );

          if (!restored.tracked) {
            console.warn(
              "ONLINE_ORDER_EDIT_LEGACY_REVERSE_COST_UNTRACKED",
              {
                orderId,
                productId,
                reason:
                  restored.reason,
              },
            );
          }
        }

        continue;
      }

      // ===============================================
      // C) Fully tracked product
      // ===============================================

      const trackedOldCosts =
        oldCostsForProduct as Array<
          typeof orderItemCostsTable.$inferSelect
        >;

      const oldCostTotalMinor =
        trackedOldCosts.reduce(
          (total, cost) =>
            total +
            cost.costTotalMinor,
          0,
        );

      if (
        !Number.isSafeInteger(
          oldCostTotalMinor,
        ) ||
        oldCostTotalMinor < 0
      ) {
        throw new OrderEditError(
          "تعذر احتساب تكلفة الطلب",
          409,
        );
      }

      const oldCostQuality =
        combineOrderCostQualities(
          trackedOldCosts.map(
            (cost) =>
              cost.costQuality as
                | "confirmed"
                | "estimated"
                | "mixed",
          ),
        );

      let nextCostTotalMinor =
        oldCostTotalMinor;

      let nextCostQuality =
        oldCostQuality;

      if (
        newQuantity <
        oldQuantity
      ) {
        const removedQuantity =
          oldQuantity -
          newQuantity;

        const removedCostMinor =
          removedQuantity ===
          oldQuantity
            ? oldCostTotalMinor
            : (
                BigInt(
                  oldCostTotalMinor,
                ) *
                  BigInt(
                    removedQuantity,
                  ) +
                BigInt(
                  oldQuantity,
                ) /
                  2n
              ) /
              BigInt(
                oldQuantity,
              );

        const removedCostNumber =
          typeof removedCostMinor === "bigint"
            ? Number(
                removedCostMinor,
              )
            : removedCostMinor;

        if (
          !Number.isSafeInteger(
            removedCostNumber,
          ) ||
          removedCostNumber < 0
        ) {
          throw new OrderEditError(
            "تعذر احتساب تكلفة الكمية المحذوفة",
            409,
          );
        }

        const restored =
          await restoreExactProductCost(
            tx,
            {
              productId,
              quantity:
                removedQuantity,

              costTotalMinor:
                removedCostNumber,

              costQuality:
                oldCostQuality,

              eventType:
                "online_order_edit_reverse",

              sourceType:
                "online_order_edit",

              sourceRef:
                String(orderId),

              sourceItemRef:
                `${editMovementRef}:${productId}`,

              note:
                `Online order edit reverse ${orderId}`,

              createdByUserId:
                actorUserId ?? null,
            },
          );

        if (!restored.tracked) {
          throw new OrderEditError(
            "تعذر إعادة تكلفة مخزون الطلب",
            409,
          );
        }

        nextCostTotalMinor =
          oldCostTotalMinor -
          removedCostNumber;
      } else if (
        newQuantity >
        oldQuantity
      ) {
        const addedQuantity =
          newQuantity -
          oldQuantity;

        const consumed =
          await consumeProductCost(
            tx,
            {
              productId,
              quantity:
                addedQuantity,

              eventType:
                "online_order",

              sourceType:
                "online_order_edit",

              sourceRef:
                String(orderId),

              sourceItemRef:
                `${editMovementRef}:${productId}`,

              note:
                `Online order edit increase ${orderId}`,

              createdByUserId:
                actorUserId ?? null,
            },
          );

        if (!consumed.tracked) {
          throw new OrderEditError(
            "تعذر احتساب تكلفة الكمية المضافة",
            409,
          );
        }

        nextCostTotalMinor =
          oldCostTotalMinor +
          consumed.costTotalMinor;

        nextCostQuality =
          combineOrderCostQualities([
            oldCostQuality,
            consumed.costQuality,
          ]);
      }

      // Same product + same quantity:
      // preserve the historical cost exactly.
      if (newQuantity > 0) {
        nextOrderCostRows.push(
          ...allocateOrderCostAcrossLines(
            orderId,
            newLines,
            nextCostTotalMinor,
            nextCostQuality,
          ),
        );
      }
    }

    // Replace only current order cost snapshots.
    // Historical movement evidence remains in product_cost_ledger.
    await tx
      .delete(orderItemCostsTable)
      .where(
        eq(
          orderItemCostsTable.orderId,
          orderId,
        ),
      );

    if (
      nextOrderCostRows.length > 0
    ) {
      await tx
        .insert(orderItemCostsTable)
        .values(
          nextOrderCostRows,
        );
    }

    const updatedRows = await tx
      .update(ordersTable)
      .set({
        customerName,
        customerPhone,
        customerAddress,
        shippingZone: shipping.label,
        shippingCost,
        fulfillmentMethod:
          shipping.label === STORE_PICKUP_LABEL
            ? "pickup"
            : order.status === "delivering"
              ? (order.fulfillmentMethod ??
                  "delivery")
              : null,
        deliveryCompanyId:
          shipping.label === STORE_PICKUP_LABEL
            ? null
            : order.status === "delivering"
              ? order.deliveryCompanyId
              : null,
        deliveryCompanyCost:
          shipping.label === STORE_PICKUP_LABEL
            ? 0
            : order.status === "delivering"
              ? order.deliveryCompanyCost
              : null,
        notes,
        paymentMethod,
        paymentStatus,
        paymentProof,
        items: trustedItems,
        totalPrice,
      })
      .where(eq(ordersTable.id, orderId))
      .returning();

    return updatedRows[0];
  });
}


export async function restoreCancelledOrderAndDeductStock(
  db: Db,
  orderId: number,
  targetStatus: string,
  actorUserId?: number | null,
) {
  const allowedTargets = new Set([
    "confirmed",
    "delivering",
    "done",
  ]);

  if (!allowedTargets.has(targetStatus)) {
    throw new OrderEditError(
      "الحالة المطلوبة لإرجاع الطلب غير صالحة",
      400,
    );
  }

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

    if (order.status !== "cancelled") {
      throw new OrderEditError(
        "يمكن استخدام هذه العملية للطلبات الملغية فقط",
        409,
      );
    }

    const storedItems = Array.isArray(order.items)
      ? (order.items as Array<
          StoredOrderItem & {
            price?: number;
          }
        >)
      : [];

    if (storedItems.length === 0) {
      throw new OrderEditError(
        "الطلب لا يحتوي على منتجات صالحة",
        409,
      );
    }

    const productIds = [
      ...new Set(
        storedItems.map((item) => {
          const id = Number(item.id);

          if (!Number.isSafeInteger(id) || id <= 0) {
            throw new OrderEditError(
              "أحد منتجات الطلب غير صالح",
              409,
            );
          }

          return id;
        }),
      ),
    ].sort((a, b) => a - b);

    const products = await tx
      .select()
      .from(productsTable)
      .where(inArray(productsTable.id, productIds))
      .orderBy(asc(productsTable.id))
      .for("update");

    if (products.length !== productIds.length) {
      throw new OrderEditError(
        "أحد منتجات الطلب لم يعد موجودًا",
        409,
      );
    }

    const states = new Map<number, EditableProductState>();

    const stockCardMovementDrafts:
      StockCardOrderMovementDraft[] = [];

    const stockCardOccurredAt = new Date();
    const stockCardOperationId =
      crypto.randomUUID();

    for (const product of products) {
      states.set(product.id, {
        row: product,
        stock: product.stock ?? null,
        colorVariants: cloneColorVariants(product.colorVariants),
        changed: false,
      });
    }

    for (const storedItem of storedItems) {
      const productId = Number(storedItem.id);
      const quantity = Number(storedItem.quantity);

      if (
        !Number.isSafeInteger(quantity) ||
        quantity <= 0 ||
        quantity > 99
      ) {
        throw new OrderEditError(
          "كمية أحد منتجات الطلب غير صالحة",
          409,
        );
      }

      const state = states.get(productId);

      if (!state) {
        throw new OrderEditError(
          "أحد منتجات الطلب لم يعد موجودًا",
          409,
        );
      }

      const color =
        typeof storedItem.color === "string" &&
        storedItem.color.trim()
          ? storedItem.color.trim()
          : undefined;

      const size =
        typeof storedItem.size === "string" &&
        storedItem.size.trim()
          ? storedItem.size.trim()
          : undefined;

      const generalStockBefore =
        state.stock;

      const variantStockBefore =
        getTrackedVariantStock(
          state.colorVariants,
          color,
          size,
        );

      applyEditedOrderItemStock(
        state,
        {
          id: productId,
          quantity,
          color,
          size,
        },
        typeof storedItem.price === "number"
          ? storedItem.price
          : undefined,
      );

      const generalStockAfter =
        state.stock;

      const variantStockAfter =
        getTrackedVariantStock(
          state.colorVariants,
          color,
          size,
        );

      if (
        generalStockBefore !== generalStockAfter ||
        variantStockBefore !== variantStockAfter
      ) {
        stockCardMovementDrafts.push({
          productId,
          barcode:
            state.row.barcode ?? null,
          productCode:
            state.row.productCode ?? null,
          productNameAr:
            state.row.nameAr,
          color: color ?? null,
          size: size ?? null,
          quantityDelta: -quantity,
          generalStockBefore,
          generalStockAfter,
          variantStockBefore,
          variantStockAfter,
        });
      }
    }

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

    // stock-card:online-order:restored
    if (stockCardMovementDrafts.length > 0) {
      await tx
        .insert(inventoryMovementsTable)
        .values(
          stockCardMovementDrafts.map(
            (movement, index) => ({
              ...movement,
              movementType:
                "online_order_restore",
              sourceType:
                "online_order",
              sourceId: orderId,
              sourceItemId: null,
              sourcePublicId:
                String(orderId),
              eventKey:
                `online-order:${orderId}:restore:${stockCardOperationId}:${index + 1}`,
              occurredAt:
                stockCardOccurredAt,
            }),
          ),
        );
    }

    // Reactivation is a NEW stock-out moment.
    // Therefore the order receives fresh moving-average
    // cost snapshots instead of reviving stale old costs.
    const reactivationCostLines: OrderCostLine[] =
      storedItems.map(
        (item, index) => {
          const productId =
            Number(item.id);
          const quantity =
            Number(item.quantity);

          if (
            !Number.isSafeInteger(productId) ||
            productId <= 0 ||
            !Number.isSafeInteger(quantity) ||
            quantity <= 0
          ) {
            throw new OrderEditError(
              "بيانات أحد منتجات الطلب غير صالحة",
              409,
            );
          }

          return {
            lineNumber:
              index + 1,
            productId,
            quantity,
            color:
              typeof item.color === "string"
                ? item.color
                : null,
            size:
              typeof item.size === "string"
                ? item.size
                : null,
          };
        },
      );

    const reactivationLinesByProduct =
      new Map<
        number,
        OrderCostLine[]
      >();

    for (
      const line
      of reactivationCostLines
    ) {
      const group =
        reactivationLinesByProduct.get(
          line.productId,
        ) ?? [];

      group.push(line);

      reactivationLinesByProduct.set(
        line.productId,
        group,
      );
    }

    const newOrderCostRows: Array<
      typeof orderItemCostsTable.$inferInsert
    > = [];

    const reactivationMovementRef =
      globalThis.crypto.randomUUID();

    for (
      const productId
      of [...reactivationLinesByProduct.keys()]
        .sort((left, right) => left - right)
    ) {
      const lines =
        reactivationLinesByProduct.get(
          productId,
        ) ?? [];

      const quantity =
        lines.reduce(
          (total, line) =>
            total + line.quantity,
          0,
        );

      if (
        !Number.isSafeInteger(quantity) ||
        quantity <= 0
      ) {
        throw new OrderEditError(
          "كمية أحد منتجات الطلب غير صالحة",
          409,
        );
      }

      const consumedCost =
        await consumeProductCost(
          tx,
          {
            productId,
            quantity,

            eventType:
              "online_order",

            sourceType:
              "online_order_reactivation",

            sourceRef:
              String(orderId),

            sourceItemRef:
              `${reactivationMovementRef}:${productId}`,

            note:
              `Online order reactivation ${orderId}`,

            createdByUserId:
              actorUserId ?? null,
          },
        );

      if (!consumedCost.tracked) {
        console.warn(
          "ONLINE_ORDER_REACTIVATION_COST_UNTRACKED",
          {
            orderId,
            productId,
            reason:
              consumedCost.reason,
          },
        );

        continue;
      }

      newOrderCostRows.push(
        ...allocateOrderCostAcrossLines(
          orderId,
          lines,
          consumedCost.costTotalMinor,
          consumedCost.costQuality,
        ),
      );
    }

    // Remove snapshots from the previous lifecycle.
    // The cancellation itself remains permanently recorded
    // in product_cost_ledger.
    await tx
      .delete(orderItemCostsTable)
      .where(
        eq(
          orderItemCostsTable.orderId,
          orderId,
        ),
      );

    if (newOrderCostRows.length > 0) {
      await tx
        .insert(orderItemCostsTable)
        .values(newOrderCostRows);
    }

    const updatedRows = await tx
      .update(ordersTable)
      .set({
        status: targetStatus,
      })
      .where(eq(ordersTable.id, orderId))
      .returning();

    if (!updatedRows[0]) {
      throw new OrderEditError(
        "تعذر إعادة تفعيل الطلب",
        409,
      );
    }

    return updatedRows[0];
  });
}
