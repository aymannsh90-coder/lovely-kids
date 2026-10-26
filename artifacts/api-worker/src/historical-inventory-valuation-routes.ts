import {
  inventoryMovementsTable,
  productCostLedgerTable,
  productHistoricalCostsTable,
  productsTable,
} from "@workspace/db/schema";
import {
  asc,
  isNotNull,
} from "drizzle-orm";

import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import { getProductQuantity } from "./product-quantity";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

const BUSINESS_TIME_ZONE = "Asia/Hebron";

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });

function localDate(
  value: Date,
): string {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        BUSINESS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).format(value);
}

function parseReportDate(
  value: string | null,
): string | null {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    return null;
  }

  const parsed =
    new Date(
      `${value}T00:00:00Z`,
    );

  if (
    Number.isNaN(
      parsed.getTime(),
    ) ||
    parsed
      .toISOString()
      .slice(0, 10) !== value
  ) {
    return null;
  }

  return value;
}

function historicalCostAtDate(
  rows: Array<{
    effectiveFrom: Date;
    effectiveTo: Date | null;
    unitCostMinor: number;
    costQuality: string;
  }>,
  asOf: string,
) {
  return rows
    .filter((row) => {
      const from =
        localDate(
          row.effectiveFrom,
        );

      const to =
        row.effectiveTo
          ? localDate(
              row.effectiveTo,
            )
          : null;

      return (
        from <= asOf &&
        (
          !to ||
          asOf <= to
        )
      );
    })
    .sort(
      (left, right) =>
        right.effectiveFrom
          .getTime() -
        left.effectiveFrom
          .getTime(),
    )[0] ?? null;
}

function latestLedgerAtDate(
  rows: Array<{
    id: number;
    quantityAfter: number;
    inventoryValueAfterMinor: number;
    costQuality: string;
    createdAt: Date;
  }>,
  asOf: string,
) {
  return rows
    .filter(
      (row) =>
        localDate(
          row.createdAt,
        ) <= asOf,
    )
    .sort((left, right) => {
      const byTime =
        right.createdAt
          .getTime() -
        left.createdAt
          .getTime();

      return byTime !== 0
        ? byTime
        : right.id -
            left.id;
    })[0] ?? null;
}

function safeInventoryValue(
  quantity: number,
  unitCostMinor: number,
): number | null {
  const value =
    quantity *
    unitCostMinor;

  return Number.isSafeInteger(
    value,
  ) &&
    value >= 0
    ? value
    : null;
}

export async function handleHistoricalInventoryValuationRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const url =
    new URL(request.url);

  if (
    request.method !== "GET" ||
    url.pathname !==
      "/api/owner/reports/inventory-valuation-history"
  ) {
    return null;
  }

  const owner =
    await getCurrentUser(
      db,
      request,
      env,
    );

  if (!owner?.isOwner) {
    return json(
      {
        error:
          "هذا التقرير متاح للمالك فقط",
      },
      403,
    );
  }

  const asOf =
    parseReportDate(
      url.searchParams.get(
        "asOf",
      ),
    );

  if (!asOf) {
    return json(
      {
        error:
          "حدد تاريخ التقييم بشكل صحيح",
      },
      400,
    );
  }

  const today =
    localDate(
      new Date(),
    );

  if (asOf > today) {
    return json(
      {
        error:
          "لا يمكن تقييم المخزون بتاريخ مستقبلي",
      },
      400,
    );
  }

  const [
    productRows,
    movementRows,
    ledgerRows,
    historicalCostRows,
  ] =
    await Promise.all([
      db
        .select({
          id:
            productsTable.id,
          nameAr:
            productsTable.nameAr,
          productCode:
            productsTable.productCode,
          barcode:
            productsTable.barcode,
          category:
            productsTable.category,
          isHidden:
            productsTable.isHidden,
          stock:
            productsTable.stock,
          colorVariants:
            productsTable.colorVariants,
          createdAt:
            productsTable.createdAt,
          deletedAt:
            productsTable.deletedAt,
        })
        .from(productsTable)
        .orderBy(
          asc(
            productsTable.id,
          ),
        ),

      db
        .select({
          productId:
            inventoryMovementsTable.productId,
          quantityDelta:
            inventoryMovementsTable.quantityDelta,
          occurredAt:
            inventoryMovementsTable.occurredAt,
        })
        .from(
          inventoryMovementsTable,
        )
        .where(
          isNotNull(
            inventoryMovementsTable.productId,
          ),
        ),

      db
        .select({
          id:
            productCostLedgerTable.id,
          productId:
            productCostLedgerTable.productId,
          quantityAfter:
            productCostLedgerTable.quantityAfter,
          inventoryValueAfterMinor:
            productCostLedgerTable.inventoryValueAfterMinor,
          costQuality:
            productCostLedgerTable.costQuality,
          createdAt:
            productCostLedgerTable.createdAt,
        })
        .from(
          productCostLedgerTable,
        ),

      db
        .select({
          productId:
            productHistoricalCostsTable.productId,
          effectiveFrom:
            productHistoricalCostsTable.effectiveFrom,
          effectiveTo:
            productHistoricalCostsTable.effectiveTo,
          unitCostMinor:
            productHistoricalCostsTable.unitCostMinor,
          costQuality:
            productHistoricalCostsTable.costQuality,
        })
        .from(
          productHistoricalCostsTable,
        ),
    ]);

  const movementDates =
    movementRows.map(
      (row) =>
        localDate(
          row.occurredAt,
        ),
    );

  const minimumSupportedDate =
    movementDates.length > 0
      ? movementDates.reduce(
          (
            earliest,
            date,
          ) =>
            date < earliest
              ? date
              : earliest,
        )
      : today;

  if (
    asOf <
    minimumSupportedDate
  ) {
    return json(
      {
        error:
          `التقييم التاريخي للكمية متاح من ${minimumSupportedDate} فما بعد`,
        minimumSupportedDate,
      },
      409,
    );
  }

  const movementDeltaAfter =
    new Map<
      number,
      number
    >();

  for (
    const movement of
    movementRows
  ) {
    if (
      movement.productId ===
        null ||
      localDate(
        movement.occurredAt,
      ) <= asOf
    ) {
      continue;
    }

    movementDeltaAfter.set(
      movement.productId,
      (
        movementDeltaAfter.get(
          movement.productId,
        ) ?? 0
      ) +
        movement.quantityDelta,
    );
  }

  const ledgerByProduct =
    new Map<
      number,
      Array<{
        id: number;
        quantityAfter: number;
        inventoryValueAfterMinor: number;
        costQuality: string;
        createdAt: Date;
      }>
    >();

  for (
    const row of ledgerRows
  ) {
    const existing =
      ledgerByProduct.get(
        row.productId,
      ) ?? [];

    existing.push({
      id: row.id,
      quantityAfter:
        row.quantityAfter,
      inventoryValueAfterMinor:
        row.inventoryValueAfterMinor,
      costQuality:
        row.costQuality,
      createdAt:
        row.createdAt,
    });

    ledgerByProduct.set(
      row.productId,
      existing,
    );
  }

  const historicalByProduct =
    new Map<
      number,
      Array<{
        effectiveFrom: Date;
        effectiveTo: Date | null;
        unitCostMinor: number;
        costQuality: string;
      }>
    >();

  for (
    const row of
    historicalCostRows
  ) {
    const existing =
      historicalByProduct.get(
        row.productId,
      ) ?? [];

    existing.push({
      effectiveFrom:
        row.effectiveFrom,
      effectiveTo:
        row.effectiveTo,
      unitCostMinor:
        row.unitCostMinor,
      costQuality:
        row.costQuality,
    });

    historicalByProduct.set(
      row.productId,
      existing,
    );
  }

  const products:
    Array<{
      productId: string;
      nameAr: string;
      productCode:
        | string
        | null;
      barcode:
        | string
        | null;
      category: string;
      isHidden: boolean;
      quantity: number | null;
      unitCostMinor:
        | number
        | null;
      inventoryValueMinor:
        | number
        | null;
      costQuality:
        | "confirmed"
        | "estimated"
        | "mixed"
        | null;
      source:
        | "ledger"
        | "historical_cost"
        | "missing_cost"
        | "untracked_quantity";
      ledgerQuantity:
        | number
        | null;
      quantityMatchesLedger:
        | boolean
        | null;
    }> = [];

  for (
    const product of
    productRows
  ) {
    const createdDate =
      localDate(
        product.createdAt,
      );

    const deletedDate =
      product.deletedAt
        ? localDate(
            product.deletedAt,
          )
        : null;

    if (
      createdDate > asOf ||
      (
        deletedDate &&
        deletedDate <= asOf
      )
    ) {
      continue;
    }

    const currentQuantity =
      getProductQuantity({
        stock:
          product.stock,
        colorVariants:
          product.colorVariants,
      });

    const quantity =
      currentQuantity ===
        null
        ? null
        : currentQuantity -
          (
            movementDeltaAfter.get(
              product.id,
            ) ?? 0
          );

    const normalizedQuantity =
      quantity !== null &&
      Number.isSafeInteger(
        quantity,
      ) &&
      quantity >= 0
        ? quantity
        : null;

    const ledger =
      latestLedgerAtDate(
        ledgerByProduct.get(
          product.id,
        ) ?? [],
        asOf,
      );

    const historicalCost =
      historicalCostAtDate(
        historicalByProduct.get(
          product.id,
        ) ?? [],
        asOf,
      );

    let unitCostMinor:
      | number
      | null = null;

    let inventoryValueMinor:
      | number
      | null = null;

    let costQuality:
      | "confirmed"
      | "estimated"
      | "mixed"
      | null = null;

    let source:
      | "ledger"
      | "historical_cost"
      | "missing_cost"
      | "untracked_quantity";

    const quantityMatchesLedger =
      ledger &&
      normalizedQuantity !== null
        ? ledger.quantityAfter ===
          normalizedQuantity
        : null;

    if (
      normalizedQuantity ===
      null
    ) {
      source =
        "untracked_quantity";
    } else if (
      ledger &&
      ledger.quantityAfter ===
        normalizedQuantity
    ) {
      inventoryValueMinor =
        ledger.inventoryValueAfterMinor;

      unitCostMinor =
        normalizedQuantity > 0
          ? Math.round(
              ledger.inventoryValueAfterMinor /
                normalizedQuantity,
            )
          : historicalCost
            ?.unitCostMinor ??
            null;

      costQuality =
        ledger.costQuality ===
          "confirmed" ||
        ledger.costQuality ===
          "estimated" ||
        ledger.costQuality ===
          "mixed"
          ? ledger.costQuality
          : null;

      source =
        "ledger";
    } else if (
      historicalCost
    ) {
      unitCostMinor =
        historicalCost.unitCostMinor;

      inventoryValueMinor =
        safeInventoryValue(
          normalizedQuantity,
          unitCostMinor,
        );

      costQuality =
        historicalCost
          .costQuality ===
          "confirmed" ||
        historicalCost
          .costQuality ===
          "estimated"
          ? historicalCost
              .costQuality
          : null;

      source =
        "historical_cost";
    } else if (
      normalizedQuantity === 0
    ) {
      inventoryValueMinor =
        0;
      source =
        "missing_cost";
    } else {
      source =
        "missing_cost";
    }

    products.push({
      productId:
        String(product.id),
      nameAr:
        product.nameAr,
      productCode:
        product.productCode ??
        null,
      barcode:
        product.barcode ??
        null,
      category:
        product.category,
      isHidden:
        product.isHidden,
      quantity:
        normalizedQuantity,
      unitCostMinor,
      inventoryValueMinor,
      costQuality,
      source,
      ledgerQuantity:
        ledger?.quantityAfter ??
        null,
      quantityMatchesLedger,
    });
  }

  let totalQuantity = 0;
  let totalInventoryValueMinor = 0;
  let productsWithStock = 0;
  let valuedProductsWithStock = 0;
  let missingCostProducts = 0;
  let unknownQuantityProducts = 0;
  let ledgerProducts = 0;
  let historicalCostProducts = 0;

  for (
    const product of
    products
  ) {
    if (
      product.quantity ===
      null
    ) {
      unknownQuantityProducts +=
        1;
      continue;
    }

    totalQuantity +=
      product.quantity;

    if (
      product.quantity > 0
    ) {
      productsWithStock +=
        1;
    }

    if (
      product.inventoryValueMinor !==
      null
    ) {
      totalInventoryValueMinor +=
        product.inventoryValueMinor;

      if (
        product.quantity > 0
      ) {
        valuedProductsWithStock +=
          1;
      }
    } else if (
      product.quantity > 0
    ) {
      missingCostProducts +=
        1;
    }

    if (
      product.source ===
      "ledger"
    ) {
      ledgerProducts +=
        1;
    } else if (
      product.source ===
      "historical_cost"
    ) {
      historicalCostProducts +=
        1;
    }
  }

  const coveragePercent =
    productsWithStock === 0
      ? 100
      : Math.round(
          (
            valuedProductsWithStock /
            productsWithStock
          ) *
            10000,
        ) /
        100;

  return json({
    asOf,
    generatedAt:
      new Date()
        .toISOString(),
    minimumSupportedDate,
    summary: {
      productCount:
        products.length,
      productsWithStock,
      totalQuantity,
      totalInventoryValueMinor,
      valuedProductsWithStock,
      missingCostProducts,
      unknownQuantityProducts,
      ledgerProducts,
      historicalCostProducts,
      coveragePercent,
      complete:
        missingCostProducts ===
          0 &&
        unknownQuantityProducts ===
          0,
    },
    products,
  });
}
