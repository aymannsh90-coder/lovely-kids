import {
  appSettingsTable,
  ordersTable,
  productsTable,
  type ColorVariant,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { openDb } from "./db";

type Db = Awaited<
  ReturnType<typeof openDb>
>["db"];

export class OrderValidationError extends Error {}

interface ShippingZone {
  label: string;
  cost: number;
  promoCost?: number;
}

export interface TrustedOrderItem {
  id: string;
  quantity: number;
  size?: string;
  color?: string;
}

export interface TrustedOrderInput {
  userId?: number | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  notes?: string | null;
  shippingZone?: string;
  paymentMethod?: "cod" | "bank_transfer";
  items: TrustedOrderItem[];
}

interface GroupedItem {
  productId: number;
  quantity: number;
  size?: string;
  color?: string;
}

function groupItems(items: TrustedOrderItem[]): GroupedItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new OrderValidationError("السلة فارغة");
  }

  const grouped = new Map<string, GroupedItem>();

  for (const item of items) {
    const productId = Number(item.id);
    const quantity = Number(item.quantity);
    const size = item.size?.trim() || undefined;
    const color = item.color?.trim() || undefined;

    if (!Number.isInteger(productId) || productId <= 0) {
      throw new OrderValidationError("معرّف أحد المنتجات غير صالح");
    }

    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 99) {
      throw new OrderValidationError("كمية أحد المنتجات غير صالحة");
    }

    const key = JSON.stringify([productId, color ?? "", size ?? ""]);
    const current = grouped.get(key);

    if (current) {
      current.quantity += quantity;
      if (current.quantity > 99) {
        throw new OrderValidationError("كمية أحد المنتجات تتجاوز الحد المسموح");
      }
    } else {
      grouped.set(key, { productId, quantity, size, color });
    }
  }

  return [...grouped.values()];
}

const STORE_PICKUP_LABEL = "استلام من المحل";

const DEFAULT_SHIPPING_ZONES: ShippingZone[] = [
  { label: "الضفة الغربية", cost: 20, promoCost: 20 },
  { label: "القدس", cost: 30, promoCost: 30 },
  { label: "أراضي الـ48", cost: 70, promoCost: 70 },
];

function resolveShippingZone(
  settingsData: unknown,
  requestedLabel?: string,
): ShippingZone {
  const requested = requestedLabel?.trim();

  if (requested === STORE_PICKUP_LABEL) {
    return {
      label: STORE_PICKUP_LABEL,
      cost: 0,
      promoCost: 0,
    };
  }

  const rawZones = (
    settingsData as { shippingZones?: unknown } | null | undefined
  )?.shippingZones;

  const configuredZones = Array.isArray(rawZones)
    ? rawZones.filter(
        (zone): zone is ShippingZone =>
          typeof zone === "object" &&
          zone !== null &&
          typeof (zone as ShippingZone).label === "string" &&
          Number.isInteger((zone as ShippingZone).cost) &&
          (zone as ShippingZone).cost >= 0,
      )
    : [];

  const zones =
    configuredZones.length > 0
      ? configuredZones
      : DEFAULT_SHIPPING_ZONES;

  const label = requestedLabel?.trim();
  const selected = zones.find((zone) => zone.label === label);

  if (!selected) {
    throw new OrderValidationError("منطقة التوصيل غير صالحة");
  }

  return selected;
}

function getStoreDate(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());

    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );

    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function resolveShippingCost(
  settingsData: unknown,
  shipping: ShippingZone,
  productsTotal: number,
): number {
  const settings =
    settingsData as
      | {
          shippingPromotionEnabled?: unknown;
          shippingPromotionThreshold?: unknown;
          shippingPromotionStartDate?: unknown;
          shippingPromotionEndDate?: unknown;
        }
      | null
      | undefined;

  if (settings?.shippingPromotionEnabled !== true) {
    return shipping.cost;
  }

  const threshold = settings.shippingPromotionThreshold;

  if (
    typeof threshold !== "number" ||
    !Number.isInteger(threshold) ||
    threshold < 0 ||
    productsTotal < threshold
  ) {
    return shipping.cost;
  }

  const today = getStoreDate();

  const startDate =
    typeof settings.shippingPromotionStartDate === "string"
      ? settings.shippingPromotionStartDate.trim()
      : "";

  const endDate =
    typeof settings.shippingPromotionEndDate === "string"
      ? settings.shippingPromotionEndDate.trim()
      : "";

  if (startDate) {
    if (!isValidDateOnly(startDate) || today < startDate) {
      return shipping.cost;
    }
  }

  if (endDate) {
    if (!isValidDateOnly(endDate) || today > endDate) {
      return shipping.cost;
    }
  }

  const promoCost = shipping.promoCost;

  if (
    typeof promoCost !== "number" ||
    !Number.isInteger(promoCost) ||
    promoCost < 0
  ) {
    return shipping.cost;
  }

  return promoCost;
}

interface TrustedStoredItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  size?: string;
  color?: string;
}

export async function createTrustedOrder(db: Db, input: TrustedOrderInput) {
  const customerName = input.customerName.trim();
  const customerPhone = input.customerPhone.trim();
  const customerAddress = input.customerAddress.trim();
  const notes = input.notes?.trim() || null;
  const paymentMethod = input.paymentMethod ?? "cod";

  if (!customerName || !customerPhone || !customerAddress) {
    throw new OrderValidationError("بيانات العميل غير مكتملة");
  }

  const groupedItems = groupItems(input.items);

  return db.transaction(async (tx) => {
    const settingsRows = await tx
      .select({ data: appSettingsTable.data })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.id, 1));

    const settingsData = settingsRows[0]?.data;

    const shipping = resolveShippingZone(
      settingsData,
      input.shippingZone,
    );

    const trustedItems: TrustedStoredItem[] = [];
    let productsTotal = 0;

    for (const item of groupedItems) {
      const productRows = await tx
        .select({
          id: productsTable.id,
          nameAr: productsTable.nameAr,
          price: productsTable.price,
          image: productsTable.image,
          sizes: productsTable.sizes,
          colorVariants: productsTable.colorVariants,
          stock: productsTable.stock,
        })
        .from(productsTable)
        .where(eq(productsTable.id, item.productId))
        .for("update");

      const product = productRows[0];

      if (!product) {
        throw new OrderValidationError("أحد المنتجات لم يعد متوفرًا");
      }

      if (!Number.isInteger(product.price) || product.price < 0) {
        throw new OrderValidationError(
          `سعر المنتج ${product.nameAr} غير صالح`,
        );
      }

      const colorVariants =
        (product.colorVariants as ColorVariant[] | null) ?? [];
      const generalSizes = (product.sizes as string[] | null) ?? [];

      let selectedImage = product.image;
      let nextColorVariants: ColorVariant[] | undefined;

      if (colorVariants.length > 0) {
        if (!item.color) {
          throw new OrderValidationError(
            `اختر لون المنتج ${product.nameAr}`,
          );
        }

        const variantIndex = colorVariants.findIndex(
          (variant) => variant.color === item.color,
        );

        if (variantIndex === -1) {
          throw new OrderValidationError(
            `اللون المحدد للمنتج ${product.nameAr} غير متوفر`,
          );
        }

        const variant = colorVariants[variantIndex];
        selectedImage = variant.image?.trim() || product.image;

        const variantSizes = Array.isArray(variant.sizes)
          ? variant.sizes
          : [];

        if (variantSizes.length > 0) {
          if (!item.size) {
            throw new OrderValidationError(
              `اختر مقاس المنتج ${product.nameAr}`,
            );
          }

          const sizeIndex = variantSizes.findIndex(
            (size) => size.size === item.size,
          );

          if (sizeIndex === -1) {
            throw new OrderValidationError(
              `المقاس المحدد للمنتج ${product.nameAr} غير متوفر`,
            );
          }

          const selectedSize = variantSizes[sizeIndex];

          if (
            selectedSize.outOfStock ||
            (selectedSize.stock !== null &&
              selectedSize.stock !== undefined &&
              selectedSize.stock < item.quantity)
          ) {
            throw new OrderValidationError(
              `الكمية المطلوبة من ${product.nameAr} غير متوفرة`,
            );
          }

          if (
            selectedSize.stock !== null &&
            selectedSize.stock !== undefined
          ) {
            const newSizeStock =
              selectedSize.stock - item.quantity;

            const nextSizes = variantSizes.map((size, index) =>
              index === sizeIndex
                ? {
                    ...size,
                    stock: newSizeStock,
                    outOfStock: newSizeStock <= 0,
                  }
                : size,
            );

            nextColorVariants = colorVariants.map(
              (colorVariant, index) =>
                index === variantIndex
                  ? { ...colorVariant, sizes: nextSizes }
                  : colorVariant,
            );
          }
        } else if (item.size) {
          throw new OrderValidationError(
            `المقاس المحدد للمنتج ${product.nameAr} غير صالح`,
          );
        }
      } else {
        if (item.color) {
          throw new OrderValidationError(
            `اللون المحدد للمنتج ${product.nameAr} غير صالح`,
          );
        }

        if (generalSizes.length > 0) {
          if (!item.size || !generalSizes.includes(item.size)) {
            throw new OrderValidationError(
              `المقاس المحدد للمنتج ${product.nameAr} غير متوفر`,
            );
          }
        } else if (item.size) {
          throw new OrderValidationError(
            `المقاس المحدد للمنتج ${product.nameAr} غير صالح`,
          );
        }
      }

      let nextStock: number | undefined;

      if (
        product.stock !== null &&
        product.stock !== undefined
      ) {
        if (product.stock < item.quantity) {
          throw new OrderValidationError(
            `الكمية المطلوبة من ${product.nameAr} غير متوفرة`,
          );
        }

        nextStock = product.stock - item.quantity;
      }

      const updates: {
        stock?: number;
        colorVariants?: ColorVariant[];
      } = {};

      if (nextStock !== undefined) {
        updates.stock = nextStock;
      }

      if (nextColorVariants !== undefined) {
        updates.colorVariants = nextColorVariants;
      }

      if (Object.keys(updates).length > 0) {
        await tx
          .update(productsTable)
          .set(updates)
          .where(eq(productsTable.id, product.id));
      }

      trustedItems.push({
        id: String(product.id),
        name: product.nameAr,
        price: product.price,
        quantity: item.quantity,
        image: selectedImage,
        size: item.size,
        color: item.color,
      });

      productsTotal += product.price * item.quantity;
    }

    const shippingCost = resolveShippingCost(
      settingsData,
      shipping,
      productsTotal,
    );

    const totalPrice = productsTotal + shippingCost;

    const orderRows = await tx
      .insert(ordersTable)
      .values({
        userId: input.userId ?? null,
        customerName,
        customerPhone,
        customerAddress,
        notes,
        items: trustedItems,
        totalPrice,
        shippingZone: shipping.label,
        shippingCost,
        status: "new",
        paymentMethod,
        paymentStatus:
          paymentMethod === "bank_transfer"
            ? "awaiting_transfer"
            : "pending",
        paymentProof: null,
      })
      .returning();

    return orderRows[0];
  });
}
