import {
  exchangeDocumentsTable,
  exchangeReturnItemsTable,
  exchangeSaleItemsTable,
  inventoryMovementsTable,
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

const CUSTOMER_MOVEMENT_TYPES = [
  "pos_sale",
  "pos_sale_void",
  "pos_sale_edit",
  "pos_sale_return",
  "pos_sale_return_void",
  "online_order",
  "online_order_cancel",
  "online_order_restore",
  "online_order_edit",
  "exchange_return",
  "exchange_sale",
  "exchange_return_void",
  "exchange_sale_void",
] as const;

async function getInventoryMovementSummary(
  tx: any,
  productId: number,
) {
  const [
    movementRows,
    posSales,
    posReturns,
    exchangeSales,
    exchangeReturns,
    orders,
  ] = await Promise.all([
    tx
      .select({
        movementType:
          inventoryMovementsTable.movementType,
        sourceType:
          inventoryMovementsTable.sourceType,
        sourceId:
          inventoryMovementsTable.sourceId,
        sourcePublicId:
          inventoryMovementsTable.sourcePublicId,
        eventKey:
          inventoryMovementsTable.eventKey,
        quantityDelta:
          inventoryMovementsTable.quantityDelta,
      })
      .from(inventoryMovementsTable)
      .where(
        eq(
          inventoryMovementsTable.productId,
          productId,
        ),
      ),

    tx
      .select({
        sourceId:
          posSalesTable.id,
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
        sourceId:
          posSaleReturnsTable.id,
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
        sourceId:
          exchangeDocumentsTable.id,
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
        sourceId:
          exchangeDocumentsTable.id,
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
        id:
          ordersTable.id,
        status:
          ordersTable.status,
        mergedIntoOrderId:
          ordersTable.mergedIntoOrderId,
        items:
          ordersTable.items,
      })
      .from(ordersTable)
      .where(
        inArray(
          ordersTable.status,
          ["done", "merged"],
        ),
      ),
  ]);

  let outboundQuantity = 0;
  let inboundQuantity = 0;
  let manualAdjustmentOutQuantity = 0;

  const coveredSources =
    new Set<string>();

  const manualAdjustmentNetByOperation =
    new Map<string, number>();

  for (const row of movementRows) {
    if (
      row.movementType === "adjustment" &&
      row.sourceType === "manual"
    ) {
      const operationKey =
        row.eventKey.replace(
          /:(?:general|variant:\d+)$/,
          "",
        );

      manualAdjustmentNetByOperation.set(
        operationKey,
        (
          manualAdjustmentNetByOperation.get(
            operationKey,
          ) ?? 0
        ) +
          row.quantityDelta,
      );
    }

    if (
      !CUSTOMER_MOVEMENT_TYPES.includes(
        row.movementType as
          (typeof CUSTOMER_MOVEMENT_TYPES)[number],
      )
    ) {
      continue;
    }

    if (row.sourceId !== null) {
      coveredSources.add(
        `${row.sourceType}:${row.sourceId}`,
      );
    }

    const publicNumericId =
      row.sourcePublicId === null
        ? null
        : Number(row.sourcePublicId);

    if (
      publicNumericId !== null &&
      Number.isSafeInteger(
        publicNumericId,
      ) &&
      publicNumericId > 0
    ) {
      coveredSources.add(
        `${row.sourceType}:${publicNumericId}`,
      );
    }

    if (row.quantityDelta < 0) {
      outboundQuantity +=
        Math.abs(row.quantityDelta);
    } else {
      inboundQuantity +=
        row.quantityDelta;
    }
  }

  for (
    const netDelta
    of manualAdjustmentNetByOperation.values()
  ) {
    if (netDelta < 0) {
      manualAdjustmentOutQuantity +=
        Math.abs(netDelta);
    }
  }

  // When a source online order is merged into a surviving order, stock is
  // intentionally not moved again. A movement recorded on the source order
  // therefore also covers the surviving order (and any later merge chain).
  let mergeCoverageChanged = true;

  while (mergeCoverageChanged) {
    mergeCoverageChanged = false;

    for (const order of orders) {
      if (
        order.status !== "merged" ||
        order.mergedIntoOrderId ===
          null ||
        !coveredSources.has(
          `online_order:${order.id}`,
        )
      ) {
        continue;
      }

      const targetKey =
        `online_order:${order.mergedIntoOrderId}`;

      if (
        !coveredSources.has(
          targetKey,
        )
      ) {
        coveredSources.add(
          targetKey,
        );
        mergeCoverageChanged =
          true;
      }
    }
  }

  // Stock-card coverage predates some older transactions. Reconcile only
  // completed legacy transactions that have no inventory movement source.
  for (const row of posSales) {
    if (
      !coveredSources.has(
        `pos_sale:${row.sourceId}`,
      )
    ) {
      outboundQuantity +=
        row.quantity;
    }
  }

  for (const row of posReturns) {
    if (
      !coveredSources.has(
        `pos_sale_return:${row.sourceId}`,
      )
    ) {
      inboundQuantity +=
        row.quantity;
    }
  }

  const exchangeIds =
    new Set([
      ...exchangeSales.map(
        (row: { sourceId: number }) =>
          row.sourceId,
      ),
      ...exchangeReturns.map(
        (row: { sourceId: number }) =>
          row.sourceId,
      ),
    ]);

  for (const sourceId of exchangeIds) {
    if (
      coveredSources.has(
        `exchange:${sourceId}`,
      )
    ) {
      continue;
    }

    outboundQuantity +=
      exchangeSales
        .filter(
          (row: { sourceId: number }) =>
            row.sourceId ===
            sourceId,
        )
        .reduce(
          (
            sum: number,
            row: { quantity: number },
          ) =>
            sum +
            row.quantity,
          0,
        );

    inboundQuantity +=
      exchangeReturns
        .filter(
          (row: { sourceId: number }) =>
            row.sourceId ===
            sourceId,
        )
        .reduce(
          (
            sum: number,
            row: { quantity: number },
          ) =>
            sum +
            row.quantity,
          0,
        );
  }

  for (const order of orders) {
    if (
      order.status !== "done" ||
      coveredSources.has(
        `online_order:${order.id}`,
      ) ||
      !Array.isArray(order.items)
    ) {
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

      outboundQuantity +=
        quantity;
    }
  }

  const netSoldQuantity =
    outboundQuantity -
    inboundQuantity;

  if (
    !Number.isSafeInteger(
      netSoldQuantity,
    ) ||
    netSoldQuantity < 0 ||
    !Number.isSafeInteger(
      manualAdjustmentOutQuantity,
    )
  ) {
    throw new HistoricalPurchasePreviewError(
      "صافي حركات البيع القديمة غير صالح للحساب التلقائي",
    );
  }

  return {
    positiveQuantity:
      outboundQuantity,
    returnQuantity:
      inboundQuantity,
    netSoldQuantity,
    manualAdjustmentOutQuantity,
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

    getInventoryMovementSummary(
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
          eq(
            posPurchasesTable.status,
            "completed",
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

  const totalHistoricalQuantity =
    physicalQuantity -
    pendingStockReceiptQuantity +
    sold.netSoldQuantity +
    sold.manualAdjustmentOutQuantity -
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
