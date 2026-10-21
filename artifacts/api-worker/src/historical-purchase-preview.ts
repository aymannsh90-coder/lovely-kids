import {
  inventoryMovementsTable,
  posPurchaseItemsTable,
  posPurchasesTable,
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
  const rows =
    await tx
      .select({
        movementType:
          inventoryMovementsTable.movementType,
        sourceType:
          inventoryMovementsTable.sourceType,
        quantityDelta:
          inventoryMovementsTable.quantityDelta,
      })
      .from(inventoryMovementsTable)
      .where(
        eq(
          inventoryMovementsTable.productId,
          productId,
        ),
      );

  let outboundQuantity = 0;
  let inboundQuantity = 0;
  let customerNetDelta = 0;
  let manualAdjustmentOutQuantity = 0;

  for (const row of rows) {
    if (
      row.movementType === "adjustment" &&
      row.sourceType === "manual" &&
      row.quantityDelta < 0
    ) {
      manualAdjustmentOutQuantity +=
        Math.abs(row.quantityDelta);
    }

    if (
      !CUSTOMER_MOVEMENT_TYPES.includes(
        row.movementType as
          (typeof CUSTOMER_MOVEMENT_TYPES)[number],
      )
    ) {
      continue;
    }

    customerNetDelta +=
      row.quantityDelta;

    if (row.quantityDelta < 0) {
      outboundQuantity +=
        Math.abs(row.quantityDelta);
    } else {
      inboundQuantity +=
        row.quantityDelta;
    }
  }

  const netSoldQuantity =
    -customerNetDelta;

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
