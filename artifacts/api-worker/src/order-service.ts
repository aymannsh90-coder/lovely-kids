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
}

export interface TrustedOrderItem {
  id: string;
  quantity: number;
  size?: string;
  color?: string;
}

export interface TrustedOrderInput {
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

const DEFAULT_SHIPPING_ZONES: ShippingZone[] = [
  { label: "الضفة الغربية", cost: 20 },
  { label: "القدس", cost: 30 },
  { label: "أراضي الـ48", cost: 70 },
];

function resolveShippingZone(
  settingsData: unknown,
  requestedLabel?: string,
): ShippingZone {
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

    const shipping = resolveShippingZone(
      settingsRows[0]?.data,
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

    const totalPrice = productsTotal + shipping.cost;

    const orderRows = await tx
      .insert(ordersTable)
      .values({
        customerName,
        customerPhone,
        customerAddress,
        notes,
        items: trustedItems,
        totalPrice,
        shippingZone: shipping.label,
        shippingCost: shipping.cost,
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
