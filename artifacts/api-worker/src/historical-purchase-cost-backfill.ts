import {
  exchangeDocumentsTable,
  exchangeReturnItemCostsTable,
  exchangeReturnItemsTable,
  exchangeSaleItemCostsTable,
  exchangeSaleItemsTable,
  orderItemCostsTable,
  ordersTable,
  posSaleItemCostsTable,
  posSaleItemsTable,
  posSaleReturnItemCostsTable,
  posSaleReturnItemsTable,
  posSaleReturnsTable,
  posSalesTable,
  productCostLedgerTable,
  productCostStateTable,
  productHistoricalCostsTable,
} from "@workspace/db/schema";
import {
  and,
  eq,
  inArray,
  isNull,
} from "drizzle-orm";

import {
  deriveUnitCostMinor,
} from "./inventory-cost-engine";

const MAX_MINOR = 2_000_000_000;

export class HistoricalPurchaseCostBackfillError extends Error {}

type PositiveMovement =
  | {
      kind: "pos_sale";
      quantity: number;
      saleItemId: number;
    }
  | {
      kind: "exchange_sale";
      quantity: number;
      saleItemId: number;
    }
  | {
      kind: "online_order";
      quantity: number;
      orderId: number;
      lineNumber: number;
      color: string | null;
      size: string | null;
    };

type ReturnMovement =
  | {
      kind: "pos_return";
      quantity: number;
      returnItemId: number;
      originalSaleItemId: number | null;
    }
  | {
      kind: "exchange_return";
      quantity: number;
      returnItemId: number;
    };

function parseProductId(
  value: unknown,
): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  return Number.isSafeInteger(numeric) &&
    numeric > 0
    ? numeric
    : null;
}

function parseQuantity(
  value: unknown,
): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  return Number.isSafeInteger(numeric) &&
    numeric > 0
    ? numeric
    : null;
}

function safeMultiply(
  left: number,
  right: number,
) {
  const total =
    left * right;

  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    total > MAX_MINOR
  ) {
    throw new HistoricalPurchaseCostBackfillError(
      "قيمة التكلفة التاريخية أكبر من الحد المسموح",
    );
  }

  return total;
}

function adjustPositiveCosts(
  totals: number[],
  desiredTotal: number,
) {
  let currentTotal =
    totals.reduce(
      (sum, value) =>
        sum + value,
      0,
    );

  if (
    !Number.isSafeInteger(currentTotal) ||
    currentTotal < 0 ||
    currentTotal > MAX_MINOR
  ) {
    throw new HistoricalPurchaseCostBackfillError(
      "إجمالي تكلفة الحركات التاريخية غير صالح",
    );
  }

  let delta =
    desiredTotal -
    currentTotal;

  if (
    !Number.isSafeInteger(delta)
  ) {
    throw new HistoricalPurchaseCostBackfillError(
      "فرق توزيع التكلفة التاريخية غير صالح",
    );
  }

  if (delta > 0) {
    if (totals.length < 1) {
      throw new HistoricalPurchaseCostBackfillError(
        "لا توجد حركة بيع تاريخية لتحميل تكلفة البضاعة المباعة عليها",
      );
    }

    const index =
      totals.length - 1;

    const next =
      totals[index]! +
      delta;

    if (
      !Number.isSafeInteger(next) ||
      next < 0 ||
      next > MAX_MINOR
    ) {
      throw new HistoricalPurchaseCostBackfillError(
        "تعذر ضبط تكلفة الحركات التاريخية",
      );
    }

    totals[index] = next;
    delta = 0;
  }

  if (delta < 0) {
    let remaining =
      -delta;

    for (
      let index =
        totals.length - 1;
      index >= 0 &&
      remaining > 0;
      index -= 1
    ) {
      const available =
        totals[index] ?? 0;

      const reduction =
        Math.min(
          available,
          remaining,
        );

      totals[index] =
        available -
        reduction;

      remaining -=
        reduction;
    }

    if (remaining !== 0) {
      throw new HistoricalPurchaseCostBackfillError(
        "تعذر مطابقة تكلفة المبيعات التاريخية مع فاتورة الشراء",
      );
    }
  }

  currentTotal =
    totals.reduce(
      (sum, value) =>
        sum + value,
      0,
    );

  if (
    currentTotal !==
    desiredTotal
  ) {
    throw new HistoricalPurchaseCostBackfillError(
      "توزيع تكلفة المبيعات التاريخية غير متوازن",
    );
  }

  return totals;
}

export async function backfillHistoricalPurchaseCosts(
  tx: any,
  input: {
    productId: number;
    productName: string;
    productCreatedAt: Date;
    purchasePublicId: string;
    receivedQuantity: number;
    purchaseCostTotalMinor: number;
    historicalSoldQuantity: number;
    historicalSoldCostTotalMinor: number;
    createdByUserId: number;
  },
) {
  const [
    costStateRows,
    costLedgerRows,
    historicalCostRows,
    existingPosSaleCostRows,
    existingPosReturnCostRows,
    existingExchangeSaleCostRows,
    existingExchangeReturnCostRows,
    existingOnlineCostRows,
  ] =
    await Promise.all([
      tx
        .select({
          productId:
            productCostStateTable.productId,
        })
        .from(productCostStateTable)
        .where(
          eq(
            productCostStateTable.productId,
            input.productId,
          ),
        )
        .limit(1),

      tx
        .select({
          id:
            productCostLedgerTable.id,
        })
        .from(productCostLedgerTable)
        .where(
          eq(
            productCostLedgerTable.productId,
            input.productId,
          ),
        )
        .limit(1),

      tx
        .select({
          id:
            productHistoricalCostsTable.id,
        })
        .from(productHistoricalCostsTable)
        .where(
          eq(
            productHistoricalCostsTable.productId,
            input.productId,
          ),
        )
        .limit(1),

      tx
        .select({
          saleItemId:
            posSaleItemCostsTable.saleItemId,
        })
        .from(posSaleItemCostsTable)
        .where(
          eq(
            posSaleItemCostsTable.productId,
            input.productId,
          ),
        )
        .limit(1),

      tx
        .select({
          returnItemId:
            posSaleReturnItemCostsTable.returnItemId,
        })
        .from(posSaleReturnItemCostsTable)
        .where(
          eq(
            posSaleReturnItemCostsTable.productId,
            input.productId,
          ),
        )
        .limit(1),

      tx
        .select({
          saleItemId:
            exchangeSaleItemCostsTable.saleItemId,
        })
        .from(exchangeSaleItemCostsTable)
        .where(
          eq(
            exchangeSaleItemCostsTable.productId,
            input.productId,
          ),
        )
        .limit(1),

      tx
        .select({
          returnItemId:
            exchangeReturnItemCostsTable.returnItemId,
        })
        .from(exchangeReturnItemCostsTable)
        .where(
          eq(
            exchangeReturnItemCostsTable.productId,
            input.productId,
          ),
        )
        .limit(1),

      tx
        .select({
          id:
            orderItemCostsTable.id,
        })
        .from(orderItemCostsTable)
        .where(
          eq(
            orderItemCostsTable.productId,
            input.productId,
          ),
        )
        .limit(1),
    ]);

  if (
    costStateRows[0] ||
    costLedgerRows[0] ||
    historicalCostRows[0] ||
    existingPosSaleCostRows[0] ||
    existingPosReturnCostRows[0] ||
    existingExchangeSaleCostRows[0] ||
    existingExchangeReturnCostRows[0] ||
    existingOnlineCostRows[0]
  ) {
    throw new HistoricalPurchaseCostBackfillError(
      `الصنف ${input.productName} لديه تكلفة أو تاريخ تكلفة مسجل مسبقًا. لا يمكن إدخاله كشراء سابق تلقائيًا حتى لا تتكرر التكلفة.`,
    );
  }

  const [
    posSales,
    posReturns,
    exchangeSales,
    exchangeReturns,
    historicalOrders,
  ] =
    await Promise.all([
      tx
        .select({
          saleItemId:
            posSaleItemsTable.id,
          quantity:
            posSaleItemsTable.quantity,
        })
        .from(posSaleItemsTable)
        .innerJoin(
          posSalesTable,
          eq(
            posSalesTable.id,
            posSaleItemsTable.saleId,
          ),
        )
        .leftJoin(
          posSaleItemCostsTable,
          eq(
            posSaleItemCostsTable.saleItemId,
            posSaleItemsTable.id,
          ),
        )
        .where(
          and(
            eq(
              posSaleItemsTable.productId,
              input.productId,
            ),
            eq(
              posSalesTable.status,
              "completed",
            ),
            isNull(
              posSaleItemCostsTable.saleItemId,
            ),
          ),
        ),

      tx
        .select({
          returnItemId:
            posSaleReturnItemsTable.id,
          originalSaleItemId:
            posSaleReturnItemsTable.originalSaleItemId,
          quantity:
            posSaleReturnItemsTable.quantity,
        })
        .from(posSaleReturnItemsTable)
        .innerJoin(
          posSaleReturnsTable,
          eq(
            posSaleReturnsTable.id,
            posSaleReturnItemsTable.returnId,
          ),
        )
        .leftJoin(
          posSaleReturnItemCostsTable,
          eq(
            posSaleReturnItemCostsTable.returnItemId,
            posSaleReturnItemsTable.id,
          ),
        )
        .where(
          and(
            eq(
              posSaleReturnItemsTable.productId,
              input.productId,
            ),
            eq(
              posSaleReturnsTable.status,
              "completed",
            ),
            isNull(
              posSaleReturnItemCostsTable.returnItemId,
            ),
          ),
        ),

      tx
        .select({
          saleItemId:
            exchangeSaleItemsTable.id,
          quantity:
            exchangeSaleItemsTable.quantity,
        })
        .from(exchangeSaleItemsTable)
        .innerJoin(
          exchangeDocumentsTable,
          eq(
            exchangeDocumentsTable.id,
            exchangeSaleItemsTable.exchangeId,
          ),
        )
        .leftJoin(
          exchangeSaleItemCostsTable,
          eq(
            exchangeSaleItemCostsTable.saleItemId,
            exchangeSaleItemsTable.id,
          ),
        )
        .where(
          and(
            eq(
              exchangeSaleItemsTable.productId,
              input.productId,
            ),
            eq(
              exchangeDocumentsTable.status,
              "completed",
            ),
            inArray(
              exchangeDocumentsTable.sourceType,
              [
                "pos_sale",
                "pos_no_receipt",
              ],
            ),
            isNull(
              exchangeSaleItemCostsTable.saleItemId,
            ),
          ),
        ),

      tx
        .select({
          returnItemId:
            exchangeReturnItemsTable.id,
          quantity:
            exchangeReturnItemsTable.quantity,
        })
        .from(exchangeReturnItemsTable)
        .innerJoin(
          exchangeDocumentsTable,
          eq(
            exchangeDocumentsTable.id,
            exchangeReturnItemsTable.exchangeId,
          ),
        )
        .leftJoin(
          exchangeReturnItemCostsTable,
          eq(
            exchangeReturnItemCostsTable.returnItemId,
            exchangeReturnItemsTable.id,
          ),
        )
        .where(
          and(
            eq(
              exchangeReturnItemsTable.productId,
              input.productId,
            ),
            eq(
              exchangeDocumentsTable.status,
              "completed",
            ),
            inArray(
              exchangeDocumentsTable.sourceType,
              [
                "pos_sale",
                "pos_no_receipt",
              ],
            ),
            isNull(
              exchangeReturnItemCostsTable.returnItemId,
            ),
          ),
        ),

      tx
        .select({
          id:
            ordersTable.id,
          items:
            ordersTable.items,
        })
        .from(ordersTable)
        .where(
          eq(
            ordersTable.status,
            "done",
          ),
        ),
    ]);

  const positiveMovements:
    PositiveMovement[] = [
      ...posSales.map(
        (item: {
          saleItemId: number;
          quantity: number;
        }) => ({
          kind:
            "pos_sale" as const,
          quantity:
            item.quantity,
          saleItemId:
            item.saleItemId,
        }),
      ),

      ...exchangeSales.map(
        (item: {
          saleItemId: number;
          quantity: number;
        }) => ({
          kind:
            "exchange_sale" as const,
          quantity:
            item.quantity,
          saleItemId:
            item.saleItemId,
        }),
      ),
    ];

  const returnMovements:
    ReturnMovement[] = [
      ...posReturns.map(
        (item: {
          returnItemId: number;
          originalSaleItemId:
            number | null;
          quantity: number;
        }) => ({
          kind:
            "pos_return" as const,
          quantity:
            item.quantity,
          returnItemId:
            item.returnItemId,
          originalSaleItemId:
            item.originalSaleItemId,
        }),
      ),

      ...exchangeReturns.map(
        (item: {
          returnItemId: number;
          quantity: number;
        }) => ({
          kind:
            "exchange_return" as const,
          quantity:
            item.quantity,
          returnItemId:
            item.returnItemId,
        }),
      ),
    ];

  for (
    const order of
    historicalOrders
  ) {
    if (
      !Array.isArray(
        order.items,
      )
    ) {
      continue;
    }

    for (
      let index = 0;
      index <
      order.items.length;
      index += 1
    ) {
      const rawItem =
        order.items[index];

      if (
        !rawItem ||
        typeof rawItem !==
          "object" ||
        Array.isArray(
          rawItem,
        )
      ) {
        continue;
      }

      const item =
        rawItem as Record<
          string,
          unknown
        >;

      if (
        parseProductId(
          item.id,
        ) !==
        input.productId
      ) {
        continue;
      }

      const quantity =
        parseQuantity(
          item.quantity,
        );

      if (quantity === null) {
        throw new HistoricalPurchaseCostBackfillError(
          `تعذر قراءة كمية طلب قديم للصنف ${input.productName}`,
        );
      }

      positiveMovements.push({
        kind:
          "online_order",
        quantity,
        orderId:
          order.id,
        lineNumber:
          index + 1,
        color:
          typeof item.color ===
          "string"
            ? item.color
            : null,
        size:
          typeof item.size ===
          "string"
            ? item.size
            : null,
      });
    }
  }

  const positiveQuantity =
    positiveMovements.reduce(
      (sum, movement) =>
        sum +
        movement.quantity,
      0,
    );

  const returnQuantity =
    returnMovements.reduce(
      (sum, movement) =>
        sum +
        movement.quantity,
      0,
    );

  const netHistoricalSoldQuantity =
    positiveQuantity -
    returnQuantity;

  if (
    !Number.isSafeInteger(
      netHistoricalSoldQuantity,
    ) ||
    netHistoricalSoldQuantity <
      0
  ) {
    throw new HistoricalPurchaseCostBackfillError(
      `صافي الحركات القديمة للصنف ${input.productName} غير صالح للمطابقة التلقائية.`,
    );
  }

  if (
    netHistoricalSoldQuantity !==
    input.historicalSoldQuantity
  ) {
    throw new HistoricalPurchaseCostBackfillError(
      `كمية الشراء السابق للصنف ${input.productName} لا تطابق الحركات القديمة غير المسعرة. المطلوب للمبيعات القديمة: ${netHistoricalSoldQuantity}، بينما الفاتورة تحاول تسوية ${input.historicalSoldQuantity}. لم يتم اعتماد الفاتورة حتى لا تُحسب التكلفة بشكل خاطئ.`,
    );
  }

  const unitCostMinor =
    deriveUnitCostMinor(
      input.purchaseCostTotalMinor,
      input.receivedQuantity,
    );

  const returnCosts =
    returnMovements.map(
      (movement) =>
        safeMultiply(
          unitCostMinor,
          movement.quantity,
        ),
    );

  const returnCostTotalMinor =
    returnCosts.reduce(
      (sum, value) =>
        sum + value,
      0,
    );

  if (
    !Number.isSafeInteger(
      returnCostTotalMinor,
    ) ||
    returnCostTotalMinor >
      MAX_MINOR
  ) {
    throw new HistoricalPurchaseCostBackfillError(
      "إجمالي تكلفة المرتجعات التاريخية أكبر من الحد المسموح",
    );
  }

  const positiveCosts =
    adjustPositiveCosts(
      positiveMovements.map(
        (movement) =>
          safeMultiply(
            unitCostMinor,
            movement.quantity,
          ),
      ),
      input.historicalSoldCostTotalMinor +
        returnCostTotalMinor,
    );

  for (
    let index = 0;
    index <
    positiveMovements.length;
    index += 1
  ) {
    const movement =
      positiveMovements[index]!;

    const costTotalMinor =
      positiveCosts[index]!;

    if (
      movement.kind ===
      "pos_sale"
    ) {
      await tx
        .insert(
          posSaleItemCostsTable,
        )
        .values({
          saleItemId:
            movement.saleItemId,
          productId:
            input.productId,
          quantity:
            movement.quantity,
          unitCostMinor:
            deriveUnitCostMinor(
              costTotalMinor,
              movement.quantity,
            ),
          costTotalMinor,
          costQuality:
            "confirmed",
        });

      continue;
    }

    if (
      movement.kind ===
      "exchange_sale"
    ) {
      await tx
        .insert(
          exchangeSaleItemCostsTable,
        )
        .values({
          saleItemId:
            movement.saleItemId,
          productId:
            input.productId,
          quantity:
            movement.quantity,
          unitCostMinor:
            deriveUnitCostMinor(
              costTotalMinor,
              movement.quantity,
            ),
          costTotalMinor,
          costQuality:
            "confirmed",
        });

      continue;
    }

    await tx
      .insert(
        orderItemCostsTable,
      )
      .values({
        orderId:
          movement.orderId,
        lineNumber:
          movement.lineNumber,
        productId:
          input.productId,
        color:
          movement.color,
        size:
          movement.size,
        quantity:
          movement.quantity,
        unitCostMinor:
          deriveUnitCostMinor(
            costTotalMinor,
            movement.quantity,
          ),
        costTotalMinor,
        costQuality:
          "confirmed",
      });
  }

  for (
    let index = 0;
    index <
    returnMovements.length;
    index += 1
  ) {
    const movement =
      returnMovements[index]!;

    const costTotalMinor =
      returnCosts[index]!;

    if (
      movement.kind ===
      "pos_return"
    ) {
      await tx
        .insert(
          posSaleReturnItemCostsTable,
        )
        .values({
          returnItemId:
            movement.returnItemId,
          originalSaleItemId:
            movement.originalSaleItemId,
          productId:
            input.productId,
          quantity:
            movement.quantity,
          costTotalMinor,
          costQuality:
            "confirmed",
        });

      continue;
    }

    await tx
      .insert(
        exchangeReturnItemCostsTable,
      )
      .values({
        returnItemId:
          movement.returnItemId,
        productId:
          input.productId,
        quantity:
          movement.quantity,
        unitCostMinor:
          deriveUnitCostMinor(
            costTotalMinor,
            movement.quantity,
          ),
        costTotalMinor,
        costQuality:
          "confirmed",
      });
  }

  const now =
    new Date();

  const effectiveTo =
    now.getTime() >
      input.productCreatedAt.getTime()
      ? now
      : new Date(
          input.productCreatedAt.getTime() +
            1,
        );

  await tx
    .insert(
      productHistoricalCostsTable,
    )
    .values({
      productId:
        input.productId,
      effectiveFrom:
        input.productCreatedAt,
      effectiveTo,
      unitCostMinor,
      costQuality:
        "confirmed",
      note:
        `Historical supplier purchase ${input.purchasePublicId}`,
      createdByUserId:
        input.createdByUserId,
    });

  return {
    unitCostMinor,
    positiveQuantity,
    returnQuantity,
    netHistoricalSoldQuantity,
    posSaleRows:
      posSales.length,
    posReturnRows:
      posReturns.length,
    exchangeSaleRows:
      exchangeSales.length,
    exchangeReturnRows:
      exchangeReturns.length,
    onlineOrderRows:
      positiveMovements.filter(
        (movement) =>
          movement.kind ===
          "online_order",
      ).length,
  };
}
