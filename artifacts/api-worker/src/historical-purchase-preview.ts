import {
  exchangeDocumentsTable,
  exchangeReturnItemsTable,
  exchangeSaleItemsTable,
  ordersTable,
  posPurchaseItemsTable,
  posPurchasesTable,
  posSaleItemsTable,
  posSaleReturnItemsTable,
  posSaleReturnsTable,
  posSalesTable,
  productCostLedgerTable,
  productCostStateTable,
  productsTable,
} from "@workspace/db/schema";
import {
  and,
  asc,
  eq,
  inArray,
} from "drizzle-orm";

import {
  getPendingPurchaseQuantityForProduct,
} from "./purchase-draft-service";
import {
  getProductQuantity,
} from "./product-quantity";

export class HistoricalPurchasePreviewError extends Error {}

function parseProductId(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  return Number.isSafeInteger(numeric) && numeric > 0
    ? numeric
    : null;
}

function parseQuantity(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  return Number.isSafeInteger(numeric) && numeric > 0
    ? numeric
    : null;
}

function deriveUnitCostMinor(
  totalMinor: number,
  quantity: number,
): number | null {
  if (
    !Number.isSafeInteger(totalMinor) ||
    totalMinor <= 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0
  ) {
    return null;
  }

  return Math.round(totalMinor / quantity);
}

async function getNetCompletedSoldQuantity(
  tx: any,
  productId: number,
) {
  const [
    posSales,
    posReturns,
    exchangeSales,
    exchangeReturns,
    orders,
  ] = await Promise.all([
    tx
      .select({
        quantity: posSaleItemsTable.quantity,
      })
      .from(posSaleItemsTable)
      .innerJoin(
        posSalesTable,
        eq(
          posSalesTable.id,
          posSaleItemsTable.saleId,
        ),
      )
      .where(
        and(
          eq(
            posSaleItemsTable.productId,
            productId,
          ),
          eq(
            posSalesTable.status,
            "completed",
          ),
        ),
      ),

    tx
      .select({
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
      .where(
        and(
          eq(
            posSaleReturnItemsTable.productId,
            productId,
          ),
          eq(
            posSaleReturnsTable.status,
            "completed",
          ),
        ),
      ),

    tx
      .select({
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
      .where(
        and(
          eq(
            exchangeSaleItemsTable.productId,
            productId,
          ),
          eq(
            exchangeDocumentsTable.status,
            "completed",
          ),
          inArray(
            exchangeDocumentsTable.sourceType,
            ["pos_sale", "pos_no_receipt"],
          ),
        ),
      ),

    tx
      .select({
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
      .where(
        and(
          eq(
            exchangeReturnItemsTable.productId,
            productId,
          ),
          eq(
            exchangeDocumentsTable.status,
            "completed",
          ),
          inArray(
            exchangeDocumentsTable.sourceType,
            ["pos_sale", "pos_no_receipt"],
          ),
        ),
      ),

    tx
      .select({
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

  let onlineSold = 0;

  for (const order of orders) {
    if (!Array.isArray(order.items)) {
      continue;
    }

    for (const rawItem of order.items) {
      if (
        !rawItem ||
        typeof rawItem !== "object" ||
        Array.isArray(rawItem)
      ) {
        continue;
      }

      const item =
        rawItem as Record<string, unknown>;

      if (
        parseProductId(item.id) !==
        productId
      ) {
        continue;
      }

      const quantity =
        parseQuantity(item.quantity);

      if (quantity === null) {
        throw new HistoricalPurchasePreviewError(
          "تعذر قراءة كمية إحدى المبيعات القديمة",
        );
      }

      onlineSold += quantity;
    }
  }

  const positiveQuantity =
    posSales.reduce(
      (sum: number, row: { quantity: number }) =>
        sum + row.quantity,
      0,
    ) +
    exchangeSales.reduce(
      (sum: number, row: { quantity: number }) =>
        sum + row.quantity,
      0,
    ) +
    onlineSold;

  const returnQuantity =
    posReturns.reduce(
      (sum: number, row: { quantity: number }) =>
        sum + row.quantity,
      0,
    ) +
    exchangeReturns.reduce(
      (sum: number, row: { quantity: number }) =>
        sum + row.quantity,
      0,
    );

  const net =
    positiveQuantity -
    returnQuantity;

  if (
    !Number.isSafeInteger(net) ||
    net < 0
  ) {
    throw new HistoricalPurchasePreviewError(
      "صافي المبيعات القديمة غير صالح للحساب التلقائي",
    );
  }

  return {
    positiveQuantity,
    returnQuantity,
    netSoldQuantity: net,
  };
}

export async function getHistoricalPurchasePreview(
  tx: any,
  input: {
    productId: number;
    warehouseKey?: string;
  },
) {
  const productRows =
    await tx
      .select()
      .from(productsTable)
      .where(
        eq(
          productsTable.id,
          input.productId,
        ),
      )
      .limit(1);

  const product =
    productRows[0];

  if (!product) {
    throw new HistoricalPurchasePreviewError(
      "المنتج غير موجود",
    );
  }

  const physicalQuantity =
    getProductQuantity(product);

  if (physicalQuantity === null) {
    throw new HistoricalPurchasePreviewError(
      "تعذر حساب كمية المخزون الحالية للصنف",
    );
  }

  const [
    ledgerRows,
    costStateRows,
    sold,
    documentedRows,
    pendingStockReceiptQuantity,
  ] = await Promise.all([
    tx
      .select({
        id:
          productCostLedgerTable.id,
        eventType:
          productCostLedgerTable.eventType,
        sourceType:
          productCostLedgerTable.sourceType,
        quantityDelta:
          productCostLedgerTable.quantityDelta,
        inventoryValueDeltaMinor:
          productCostLedgerTable.inventoryValueDeltaMinor,
        costQuality:
          productCostLedgerTable.costQuality,
        createdAt:
          productCostLedgerTable.createdAt,
      })
      .from(productCostLedgerTable)
      .where(
        eq(
          productCostLedgerTable.productId,
          input.productId,
        ),
      )
      .orderBy(
        asc(
          productCostLedgerTable.id,
        ),
      ),

    tx
      .select({
        quantityOnHand:
          productCostStateTable.quantityOnHand,
        inventoryValueMinor:
          productCostStateTable.inventoryValueMinor,
        referenceUnitCostMinor:
          productCostStateTable.referenceUnitCostMinor,
        costQuality:
          productCostStateTable.costQuality,
      })
      .from(productCostStateTable)
      .where(
        eq(
          productCostStateTable.productId,
          input.productId,
        ),
      )
      .limit(1),

    getNetCompletedSoldQuantity(
      tx,
      input.productId,
    ),

    tx
      .select({
        sourceKey:
          posPurchaseItemsTable.historicalSourceKey,
      })
      .from(posPurchaseItemsTable)
      .innerJoin(
        posPurchasesTable,
        eq(
          posPurchasesTable.id,
          posPurchaseItemsTable.purchaseId,
        ),
      )
      .where(
        and(
          eq(
            posPurchaseItemsTable.productId,
            input.productId,
          ),
          eq(
            posPurchaseItemsTable.entryMode,
            "historical",
          ),
          inArray(
            posPurchasesTable.status,
            ["draft", "completed"],
          ),
        ),
      ),

    getPendingPurchaseQuantityForProduct(
      tx,
      {
        productId:
          input.productId,
        warehouseKey:
          input.warehouseKey ?? "main",
      },
    ),
  ]);

  const documentedKeys =
    new Set(
      documentedRows
        .map(
          (row: {
            sourceKey: string | null;
          }) =>
            row.sourceKey,
        )
        .filter(
          (
            value: string | null,
          ): value is string =>
            typeof value === "string" &&
            value.length > 0,
        ),
    );

  const acquisitionRows =
    ledgerRows.filter(
      (row: {
        eventType: string;
        sourceType: string | null;
        quantityDelta: number;
      }) =>
        row.quantityDelta > 0 &&
        (
          (
            row.eventType ===
              "opening" &&
            row.sourceType ===
              "manual_opening"
          ) ||
          (
            row.eventType ===
              "adjustment_in" &&
            row.sourceType ===
              "manual_stock"
          )
        ),
    );

  const purchaseBackedQuantity =
    ledgerRows.reduce(
      (
        sum: number,
        row: {
          eventType: string;
          sourceType: string | null;
          quantityDelta: number;
        },
      ) =>
        row.quantityDelta > 0 &&
        row.eventType ===
          "purchase" &&
        row.sourceType ===
          "pos_purchase"
          ? sum +
            row.quantityDelta
          : sum,
      0,
    );

  const manualAdjustmentOutQuantity =
    ledgerRows.reduce(
      (
        sum: number,
        row: {
          eventType: string;
          sourceType: string | null;
          quantityDelta: number;
        },
      ) =>
        row.quantityDelta < 0 &&
        row.eventType ===
          "adjustment_out" &&
        row.sourceType ===
          "manual_stock"
          ? sum +
            Math.abs(
              row.quantityDelta,
            )
          : sum,
      0,
    );

  const totalHistoricalQuantity =
    physicalQuantity -
    pendingStockReceiptQuantity +
    sold.netSoldQuantity +
    manualAdjustmentOutQuantity -
    purchaseBackedQuantity;

  if (
    !Number.isSafeInteger(
      totalHistoricalQuantity,
    ) ||
    totalHistoricalQuantity < 0
  ) {
    throw new HistoricalPurchasePreviewError(
      "تعذر موازنة الكمية التاريخية مع المخزون والمبيعات",
    );
  }

  type PreviewBatch = {
    sourceKey: string;
    quantity: number;
    unitCostMinor: number | null;
    totalCostMinor: number | null;
    occurredAt: string | null;
    documentationOnly: boolean;
    sourceType:
      | "opening"
      | "repeat_purchase"
      | "untracked";
  };

  const batches:
    PreviewBatch[] = [];

  if (acquisitionRows.length > 0) {
    const first =
      acquisitionRows[0]!;

    const later =
      acquisitionRows.slice(1);

    const laterQuantity =
      later.reduce(
        (
          sum: number,
          row: { quantityDelta: number },
        ) =>
          sum +
          row.quantityDelta,
        0,
      );

    const firstQuantity =
      totalHistoricalQuantity -
      laterQuantity;

    if (firstQuantity < 0) {
      throw new HistoricalPurchasePreviewError(
        "دفعات التكلفة المسجلة أكبر من الكمية التاريخية المحسوبة",
      );
    }

    if (firstQuantity > 0) {
      const unitCostMinor =
        deriveUnitCostMinor(
          first.inventoryValueDeltaMinor,
          first.quantityDelta,
        );

      const sourceKey =
        `product:${input.productId}:opening:${first.id}`;

      if (!documentedKeys.has(sourceKey)) {
        batches.push({
          sourceKey,
          quantity:
            firstQuantity,
          unitCostMinor,
          totalCostMinor:
            unitCostMinor === null
              ? null
              : unitCostMinor *
                firstQuantity,
          occurredAt:
            first.createdAt
              ?.toISOString() ??
            null,
          documentationOnly:
            true,
          sourceType:
            "opening",
        });
      }
    }

    for (const row of later) {
      const sourceKey =
        `product:${input.productId}:ledger:${row.id}`;

      if (
        documentedKeys.has(
          sourceKey,
        )
      ) {
        continue;
      }

      const unitCostMinor =
        deriveUnitCostMinor(
          row.inventoryValueDeltaMinor,
          row.quantityDelta,
        );

      batches.push({
        sourceKey,
        quantity:
          row.quantityDelta,
        unitCostMinor,
        totalCostMinor:
          row.inventoryValueDeltaMinor,
        occurredAt:
          row.createdAt
            ?.toISOString() ??
          null,
        documentationOnly:
          true,
        sourceType:
          "repeat_purchase",
      });
    }
  } else if (
    totalHistoricalQuantity > 0
  ) {
    const currentReferenceCost =
      costStateRows[0]
        ?.referenceUnitCostMinor ??
      null;

    const hasKnownCurrentCost =
      typeof currentReferenceCost ===
        "number" &&
      currentReferenceCost > 0;

    const sourceKey =
      hasKnownCurrentCost
        ? `product:${input.productId}:cost-state:v1`
        : `product:${input.productId}:untracked:v1`;

    if (!documentedKeys.has(sourceKey)) {
      batches.push({
        sourceKey,
        quantity:
          totalHistoricalQuantity,
        unitCostMinor:
          hasKnownCurrentCost
            ? currentReferenceCost
            : null,
        totalCostMinor:
          hasKnownCurrentCost
            ? currentReferenceCost *
              totalHistoricalQuantity
            : null,
        occurredAt:
          null,
        documentationOnly:
          hasKnownCurrentCost,
        sourceType:
          hasKnownCurrentCost
            ? "opening"
            : "untracked",
      });
    }
  }

  return {
    product: {
      id:
        String(product.id),
      productCode:
        product.productCode ??
        null,
      nameAr:
        product.nameAr,
    },
    physicalQuantity,
    pendingStockReceiptQuantity,
    soldQuantity:
      sold.positiveQuantity,
    returnedQuantity:
      sold.returnQuantity,
    netSoldQuantity:
      sold.netSoldQuantity,
    totalHistoricalQuantity,
    currentCost:
      costStateRows[0]
        ? {
            quantityOnHand:
              costStateRows[0]
                .quantityOnHand,
            inventoryValueMinor:
              costStateRows[0]
                .inventoryValueMinor,
            referenceUnitCostMinor:
              costStateRows[0]
                .referenceUnitCostMinor,
            costQuality:
              costStateRows[0]
                .costQuality,
          }
        : null,
    batches,
  };
}
