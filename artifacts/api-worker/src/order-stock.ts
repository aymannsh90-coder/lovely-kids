import {
  ordersTable,
  productsTable,
  type ColorVariant,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
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
