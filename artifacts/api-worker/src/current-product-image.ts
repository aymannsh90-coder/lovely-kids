import { productsTable } from "@workspace/db/schema";
import { and, inArray, isNull } from "drizzle-orm";

import type { openDb } from "./db";

type Db =
  Awaited<
    ReturnType<typeof openDb>
  >["db"];

export async function getCurrentProductImageMap(
  db: Db,
  productIds: Array<number | null | undefined>,
): Promise<Map<number, string | null>> {
  const ids = [
    ...new Set(
      productIds.filter(
        (id): id is number =>
          typeof id === "number" &&
          Number.isSafeInteger(id) &&
          id > 0,
      ),
    ),
  ];

  if (ids.length === 0) {
    return new Map();
  }

  const rows =
    await db
      .select({
        id: productsTable.id,
        image: productsTable.image,
      })
      .from(productsTable)
      .where(
        and(
          inArray(
            productsTable.id,
            ids,
          ),
          isNull(
            productsTable.deletedAt,
          ),
        ),
      );

  return new Map(
    rows.map((row) => [
      row.id,
      row.image ?? null,
    ]),
  );
}

export function resolveCurrentProductImage(
  imageByProductId: ReadonlyMap<number, string | null>,
  productId: number | null | undefined,
): string | null {
  if (
    typeof productId !== "number" ||
    !Number.isSafeInteger(productId) ||
    productId <= 0
  ) {
    return null;
  }

  return imageByProductId.get(productId) ?? null;
}
