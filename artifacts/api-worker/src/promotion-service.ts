import {
  promotionProductsTable,
  promotionsTable,
  type Promotion,
} from "@workspace/db/schema";
import { and, eq, inArray, isNull, lte, or, gte } from "drizzle-orm";

import type { openDb } from "./db";
import type {
  PromotionChannel,
  PromotionDefinition,
} from "./promotion-engine";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

function toDefinition(
  row: Promotion,
  productRows: Array<{
    productId: number;
    role: string;
  }>,
): PromotionDefinition {
  return {
    id: row.id,
    name: row.name,
    publicLabel: row.publicLabel,
    description: row.description,

    kind: row.kind as PromotionDefinition["kind"],
    scope: row.scope as PromotionDefinition["scope"],
    channel: row.channel as PromotionDefinition["channel"],

    buyQuantity: row.buyQuantity,
    rewardQuantity: row.rewardQuantity,
    rewardMode: row.rewardMode as PromotionDefinition["rewardMode"],
    rewardPercent: row.rewardPercent,
    rewardPriceMinor: row.rewardPriceMinor,
    rewardSelectionMode:
      row.rewardSelectionMode as PromotionDefinition["rewardSelectionMode"],

    percentOff: row.percentOff,

    bundleQuantity: row.bundleQuantity,
    bundlePriceMinor: row.bundlePriceMinor,

    repeatable: row.repeatable,
    maxApplicationsPerOrder: row.maxApplicationsPerOrder,

    stackWithOtherPromotions: row.stackWithOtherPromotions,
    stackWithDiscountCodes: row.stackWithDiscountCodes,
    stackWithShippingPromotion: row.stackWithShippingPromotion,

    priority: row.priority,

    qualifyingProductIds: productRows
      .filter((item) => item.role === "qualifying")
      .map((item) => item.productId),

    rewardProductIds: productRows
      .filter((item) => item.role === "reward")
      .map((item) => item.productId),

    excludedProductIds: productRows
      .filter((item) => item.role === "excluded")
      .map((item) => item.productId),
  };
}

export async function loadActivePromotions(
  db: Db,
  channel: PromotionChannel,
  now = new Date(),
): Promise<PromotionDefinition[]> {
  const rows = await db
    .select()
    .from(promotionsTable)
    .where(
      and(
        eq(promotionsTable.status, "active"),
        or(
          eq(promotionsTable.channel, "both"),
          eq(promotionsTable.channel, channel),
        ),
        or(
          isNull(promotionsTable.startsAt),
          lte(promotionsTable.startsAt, now),
        ),
        or(
          isNull(promotionsTable.endsAt),
          gte(promotionsTable.endsAt, now),
        ),
      ),
    );

  if (rows.length === 0) {
    return [];
  }

  const ids = rows.map((row) => row.id);

  const products = await db
    .select({
      promotionId: promotionProductsTable.promotionId,
      productId: promotionProductsTable.productId,
      role: promotionProductsTable.role,
    })
    .from(promotionProductsTable)
    .where(inArray(promotionProductsTable.promotionId, ids));

  return rows.map((row) =>
    toDefinition(
      row,
      products.filter((item) => item.promotionId === row.id),
    ),
  );
}

export function serializePromotionSnapshot(
  promotion: PromotionDefinition,
) {
  return {
    id: promotion.id,
    name: promotion.name,
    publicLabel: promotion.publicLabel,
    kind: promotion.kind,
    scope: promotion.scope,
    channel: promotion.channel,
    buyQuantity: promotion.buyQuantity ?? null,
    rewardQuantity: promotion.rewardQuantity ?? null,
    rewardMode: promotion.rewardMode ?? null,
    rewardPercent: promotion.rewardPercent ?? null,
    rewardPriceMinor: promotion.rewardPriceMinor ?? null,
    rewardSelectionMode: promotion.rewardSelectionMode,
    percentOff: promotion.percentOff ?? null,
    bundleQuantity: promotion.bundleQuantity ?? null,
    bundlePriceMinor: promotion.bundlePriceMinor ?? null,
    repeatable: promotion.repeatable,
    maxApplicationsPerOrder:
      promotion.maxApplicationsPerOrder ?? null,
    stackWithOtherPromotions:
      promotion.stackWithOtherPromotions,
    stackWithDiscountCodes:
      promotion.stackWithDiscountCodes,
    stackWithShippingPromotion:
      promotion.stackWithShippingPromotion,
    priority: promotion.priority,
    qualifyingProductIds: promotion.qualifyingProductIds,
    rewardProductIds: promotion.rewardProductIds,
    excludedProductIds: promotion.excludedProductIds,
  };
}
