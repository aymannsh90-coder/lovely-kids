import {
  exchangeDocumentsTable,
  exchangeSaleItemsTable,
  financeTransactionsTable,
  inventoryMovementsTable,
  ordersTable,
  posPurchaseItemsTable,
  posPurchasesTable,
  posSaleItemsTable,
  posSalesTable,
  productBarcodesTable,
  productCostStateTable,
  productsTable,
  type ColorVariant,
} from "@workspace/db/schema";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
} from "drizzle-orm";

import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import { getProductQuantity } from "./product-quantity";

type Db =
  Awaited<ReturnType<typeof openDb>>["db"];

type MovementClass =
  | "fast"
  | "normal"
  | "slow"
  | "dead"
  | "new";

type StockState =
  | "in_stock"
  | "out_of_stock"
  | "untracked";

type CoverageSignal =
  | "untracked"
  | "insufficient_history"
  | "no_net_demand"
  | "out_of_stock"
  | "low"
  | "healthy"
  | "high";

type InventoryRiskSignal =
  | "untracked"
  | "insufficient_history"
  | "balanced"
  | "stockout_now"
  | "stockout_high"
  | "stockout_watch"
  | "overstock_high"
  | "overstock_watch";

type InventoryActionSignal =
  | "untracked"
  | "insufficient_history"
  | "reorder"
  | "reduce"
  | "review_no_demand"
  | "balanced";

type InventoryActionPlan = {
  reliable: boolean;
  signal: InventoryActionSignal;
  targetStockUnits: number | null;
  maxHealthyStockUnits: number | null;
  suggestedReorderQuantity: number | null;
  excessUnits: number | null;
};

type ProductInventoryMovement = {
  movementType: string;
  quantityDelta: number;
  movementDate: string;
  color: string | null;
  size: string | null;
};

type SellThroughWindow = {
  reliable: boolean;
  observationStartDate: string;
  observationDays: number;
  netDemandQuantity: number;
  availableUnits: number | null;
  percent: number | null;
};

type ProductSales = {
  sold30: number;
  sold90: number;
  totalSold: number;
  lastSaleDate: string | null;
};

type ProductPurchases = {
  firstPurchaseDate: string | null;
  lastPurchaseDate: string | null;
};

const FAST_30_THRESHOLD = 6;
const FAST_90_THRESHOLD = 15;
const SLOW_30_MAX = 1;
const SLOW_90_MAX = 3;
const NEW_PRODUCT_DAYS = 30;
const DEAD_PRODUCT_DAYS = 90;
const MIN_VELOCITY_HISTORY_DAYS = 7;
const STOCKOUT_HIGH_DAYS = 7;
const LOW_COVERAGE_DAYS = 14;
const HIGH_COVERAGE_DAYS = 60;
const TARGET_COVERAGE_DAYS = 30;
const OVERSTOCK_HIGH_DAYS = 120;
const MIN_OVERSTOCK_AGE_DAYS = 30;

const DEMAND_MOVEMENT_TYPES =
  new Set([
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
  ]);

const json = (
  data: unknown,
  status = 200,
) =>
  Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });

async function requireOwner(
  request: Request,
  db: Db,
  env: Env,
) {
  const owner = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!owner?.isOwner) {
    return {
      ok: false as const,
      response: json(
        {
          error:
            "هذه البيانات متاحة للمالك فقط",
        },
        403,
      ),
    };
  }

  return {
    ok: true as const,
    owner,
  };
}

function hebronDateKey(
  value: Date,
) {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Hebron",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).format(value);
}

function dateKeyFromUnknown(
  value: unknown,
): string | null {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return value;
  }

  if (value instanceof Date) {
    return hebronDateKey(value);
  }

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    const parsed =
      new Date(value);

    if (
      !Number.isNaN(
        parsed.getTime(),
      )
    ) {
      return hebronDateKey(parsed);
    }
  }

  return null;
}

function addDays(
  dateKey: string,
  days: number,
) {
  const date =
    new Date(
      `${dateKey}T00:00:00Z`,
    );

  date.setUTCDate(
    date.getUTCDate() + days,
  );

  return date
    .toISOString()
    .slice(0, 10);
}

function daysBetween(
  from: string,
  to: string,
) {
  const fromDate =
    new Date(
      `${from}T00:00:00Z`,
    );

  const toDate =
    new Date(
      `${to}T00:00:00Z`,
    );

  return Math.max(
    0,
    Math.floor(
      (
        toDate.getTime() -
        fromDate.getTime()
      ) /
        86_400_000,
    ),
  );
}

function roundOneDecimal(
  value: number,
) {
  return Math.round(
    value * 10,
  ) / 10;
}

function latestDateKey(
  first: string,
  ...rest: string[]
) {
  return rest.reduce(
    (latest, current) =>
      current > latest
        ? current
        : latest,
    first,
  );
}

function variantKey(
  productId: number,
  color: string,
  size: string,
) {
  return JSON.stringify([
    productId,
    color.trim(),
    size.trim(),
  ]);
}

function netDemandContribution(
  movementType: string,
  quantityDelta: number,
) {
  return DEMAND_MOVEMENT_TYPES.has(
    movementType,
  )
    ? -quantityDelta
    : 0;
}

function calculateSellThroughWindow(
  input: {
    currentQuantity: number | null;
    inventoryStartDate: string;
    trackingStartDate: string | null;
    today: string;
    maximumDays: number;
    movements: ProductInventoryMovement[];
  },
): SellThroughWindow {
  const requestedStartDate =
    addDays(
      input.today,
      -(input.maximumDays - 1),
    );

  const observationStartDate =
    latestDateKey(
      requestedStartDate,
      input.inventoryStartDate,
    );

  const observationDays =
    daysBetween(
      observationStartDate,
      input.today,
    ) + 1;

  const reliable =
    input.currentQuantity !== null &&
    input.trackingStartDate !== null &&
    input.trackingStartDate <=
      observationStartDate;

  if (!reliable) {
    return {
      reliable: false,
      observationStartDate,
      observationDays,
      netDemandQuantity: 0,
      availableUnits: null,
      percent: null,
    };
  }

  const windowMovements =
    input.movements.filter(
      (movement) =>
        movement.movementDate >=
          observationStartDate &&
        movement.movementDate <=
          input.today,
    );

  const totalInventoryDelta =
    windowMovements.reduce(
      (sum, movement) =>
        sum +
        movement.quantityDelta,
      0,
    );

  const rawNetDemand =
    windowMovements.reduce(
      (sum, movement) =>
        sum +
        netDemandContribution(
          movement.movementType,
          movement.quantityDelta,
        ),
      0,
    );

  const nonDemandInventoryDelta =
    windowMovements.reduce(
      (sum, movement) =>
        DEMAND_MOVEMENT_TYPES.has(
          movement.movementType,
        )
          ? sum
          : sum +
            movement.quantityDelta,
      0,
    );

  const beginningInventory =
    Math.max(
      0,
      input.currentQuantity ?? 0,
    ) -
    totalInventoryDelta;

  const availableUnits =
    beginningInventory +
    nonDemandInventoryDelta;

  if (
    beginningInventory < 0 ||
    availableUnits < 0
  ) {
    return {
      reliable: false,
      observationStartDate,
      observationDays,
      netDemandQuantity: 0,
      availableUnits: null,
      percent: null,
    };
  }

  const netDemandQuantity =
    Math.max(
      0,
      rawNetDemand,
    );

  return {
    reliable: true,
    observationStartDate,
    observationDays,
    netDemandQuantity,
    availableUnits,
    percent:
      availableUnits > 0
        ? roundOneDecimal(
            Math.min(
              100,
              (
                netDemandQuantity /
                availableUnits
              ) * 100,
            ),
          )
        : null,
  };
}

function validPositiveInteger(
  value: unknown,
) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  return Number.isSafeInteger(
    numeric,
  ) &&
    numeric > 0
    ? numeric
    : null;
}

function recordSale(
  map: Map<number, ProductSales>,
  input: {
    productId: number;
    quantity: number;
    saleDate: string;
    cutoff30: string;
    cutoff90: string;
  },
) {
  const current =
    map.get(input.productId) ?? {
      sold30: 0,
      sold90: 0,
      totalSold: 0,
      lastSaleDate: null,
    };

  current.totalSold +=
    input.quantity;

  if (
    input.saleDate >=
    input.cutoff90
  ) {
    current.sold90 +=
      input.quantity;
  }

  if (
    input.saleDate >=
    input.cutoff30
  ) {
    current.sold30 +=
      input.quantity;
  }

  if (
    current.lastSaleDate === null ||
    input.saleDate >
      current.lastSaleDate
  ) {
    current.lastSaleDate =
      input.saleDate;
  }

  map.set(
    input.productId,
    current,
  );
}

function recordPurchase(
  map: Map<
    number,
    ProductPurchases
  >,
  input: {
    productId: number;
    purchaseDate: string;
  },
) {
  const current =
    map.get(input.productId) ?? {
      firstPurchaseDate: null,
      lastPurchaseDate: null,
    };

  if (
    current.firstPurchaseDate ===
      null ||
    input.purchaseDate <
      current.firstPurchaseDate
  ) {
    current.firstPurchaseDate =
      input.purchaseDate;
  }

  if (
    current.lastPurchaseDate ===
      null ||
    input.purchaseDate >
      current.lastPurchaseDate
  ) {
    current.lastPurchaseDate =
      input.purchaseDate;
  }

  map.set(
    input.productId,
    current,
  );
}

function movementClassFor(input: {
  currentQuantity: number | null;
  ageDays: number;
  sold30: number;
  sold90: number;
  hasThirtyDayHistory: boolean;
  hasNinetyDayHistory: boolean;
}): MovementClass {
  if (
    input.sold30 >=
      FAST_30_THRESHOLD ||
    input.sold90 >=
      FAST_90_THRESHOLD
  ) {
    return "fast";
  }

  if (
    input.ageDays <
    NEW_PRODUCT_DAYS
  ) {
    return "new";
  }

  if (
    input.currentQuantity !== null &&
    input.currentQuantity > 0 &&
    input.hasNinetyDayHistory &&
    input.ageDays >=
      DEAD_PRODUCT_DAYS &&
    input.sold90 === 0
  ) {
    return "dead";
  }

  if (
    input.currentQuantity !== null &&
    input.currentQuantity > 0 &&
    input.hasThirtyDayHistory &&
    input.sold30 <=
      SLOW_30_MAX &&
    (
      !input.hasNinetyDayHistory ||
      input.sold90 <=
        SLOW_90_MAX
    )
  ) {
    return "slow";
  }

  return "normal";
}

function inventoryRiskSignalFor(input: {
  currentQuantity: number | null;
  ageDays: number;
  daysSinceLastSale: number | null;
  daysOfSupply: number | null;
  coverageSignal: CoverageSignal;
  movementClass: MovementClass;
}): InventoryRiskSignal {
  if (input.currentQuantity === null) {
    return "untracked";
  }

  if (input.currentQuantity <= 0) {
    return input.daysSinceLastSale !== null &&
      input.daysSinceLastSale <=
        LOW_COVERAGE_DAYS
      ? "stockout_now"
      : input.coverageSignal ===
          "insufficient_history"
        ? "insufficient_history"
        : "balanced";
  }

  if (
    input.coverageSignal ===
    "insufficient_history"
  ) {
    return "insufficient_history";
  }

  if (
    input.daysOfSupply !== null &&
    input.daysOfSupply <=
      STOCKOUT_HIGH_DAYS
  ) {
    return "stockout_high";
  }

  if (
    input.daysOfSupply !== null &&
    input.daysOfSupply <=
      LOW_COVERAGE_DAYS
  ) {
    return "stockout_watch";
  }

  if (
    input.ageDays >=
    MIN_OVERSTOCK_AGE_DAYS
  ) {
    if (
      input.movementClass ===
        "dead" ||
      (
        input.coverageSignal ===
          "no_net_demand" &&
        input.ageDays >=
          DEAD_PRODUCT_DAYS
      ) ||
      (
        input.daysOfSupply !==
          null &&
        input.daysOfSupply >
          OVERSTOCK_HIGH_DAYS
      )
    ) {
      return "overstock_high";
    }

    if (
      input.movementClass ===
        "slow" ||
      input.coverageSignal ===
        "no_net_demand" ||
      (
        input.daysOfSupply !==
          null &&
        input.daysOfSupply >
          HIGH_COVERAGE_DAYS
      )
    ) {
      return "overstock_watch";
    }
  }

  return "balanced";
}

function calculateInventoryActionPlan(input: {
  currentQuantity: number | null;
  averageDailyNetDemand: number | null;
  velocityHistoryReliable: boolean;
  ageDays: number;
}): InventoryActionPlan {
  if (input.currentQuantity === null) {
    return {
      reliable: false,
      signal: "untracked",
      targetStockUnits: null,
      maxHealthyStockUnits: null,
      suggestedReorderQuantity: null,
      excessUnits: null,
    };
  }

  if (
    !input.velocityHistoryReliable ||
    input.averageDailyNetDemand === null
  ) {
    return {
      reliable: false,
      signal: "insufficient_history",
      targetStockUnits: null,
      maxHealthyStockUnits: null,
      suggestedReorderQuantity: null,
      excessUnits: null,
    };
  }

  const currentQuantity =
    Math.max(
      0,
      input.currentQuantity,
    );

  if (
    input.averageDailyNetDemand <= 0
  ) {
    const reviewNoDemand =
      input.ageDays >=
        MIN_OVERSTOCK_AGE_DAYS &&
      currentQuantity > 0;

    return {
      reliable: true,
      signal: reviewNoDemand
        ? "review_no_demand"
        : "balanced",
      targetStockUnits: null,
      maxHealthyStockUnits: null,
      suggestedReorderQuantity: 0,
      excessUnits: reviewNoDemand
        ? currentQuantity
        : 0,
    };
  }

  const targetStockUnits =
    Math.ceil(
      input.averageDailyNetDemand *
        TARGET_COVERAGE_DAYS,
    );

  const maxHealthyStockUnits =
    Math.ceil(
      input.averageDailyNetDemand *
        HIGH_COVERAGE_DAYS,
    );

  const suggestedReorderQuantity =
    Math.max(
      0,
      targetStockUnits -
        currentQuantity,
    );

  const excessUnits =
    input.ageDays >=
    MIN_OVERSTOCK_AGE_DAYS
      ? Math.max(
          0,
          currentQuantity -
            maxHealthyStockUnits,
        )
      : 0;

  return {
    reliable: true,
    signal:
      excessUnits > 0
        ? "reduce"
        : suggestedReorderQuantity > 0
          ? "reorder"
          : "balanced",
    targetStockUnits,
    maxHealthyStockUnits,
    suggestedReorderQuantity,
    excessUnits,
  };
}

function orderItems(
  value: unknown,
) {
  if (!Array.isArray(value)) {
    return [] as Array<{
      productId: number;
      quantity: number;
    }>;
  }

  return value.flatMap(
    (item) => {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item)
      ) {
        return [];
      }

      const record =
        item as Record<
          string,
          unknown
        >;

      const productId =
        validPositiveInteger(
          record.id,
        );

      const quantity =
        validPositiveInteger(
          record.quantity,
        );

      if (
        productId === null ||
        quantity === null
      ) {
        return [];
      }

      return [
        {
          productId,
          quantity,
        },
      ];
    },
  );
}

async function handleReport(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requireOwner(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const today =
    hebronDateKey(
      new Date(),
    );

  const cutoff30 =
    addDays(
      today,
      -(NEW_PRODUCT_DAYS - 1),
    );

  const cutoff90 =
    addDays(
      today,
      -(DEAD_PRODUCT_DAYS - 1),
    );

  const [
    products,
    posSaleRows,
    onlineOrders,
    onlineDoneTransactions,
    exchangeSaleRows,
    purchaseRows,
    productBarcodeRows,
    earliestMovementRows,
    recentMovementRows,
  ] = await Promise.all([
    db
      .select({
        id: productsTable.id,
        nameAr:
          productsTable.nameAr,
        productCode:
          productsTable.productCode,
        barcode:
          productsTable.barcode,
        image:
          productsTable.image,
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

        costProductId:
          productCostStateTable.productId,
        costQuantityOnHand:
          productCostStateTable.quantityOnHand,
        inventoryValueMinor:
          productCostStateTable.inventoryValueMinor,
        referenceUnitCostMinor:
          productCostStateTable.referenceUnitCostMinor,
        costQuality:
          productCostStateTable.costQuality,
      })
      .from(productsTable)
      .leftJoin(
        productCostStateTable,
        eq(
          productCostStateTable.productId,
          productsTable.id,
        ),
      )
      .where(
        isNull(
          productsTable.deletedAt,
        ),
      ),

    db
      .select({
        productId:
          posSaleItemsTable.productId,
        quantity:
          posSaleItemsTable.quantity,
        soldAt:
          posSalesTable.createdAt,
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
        eq(
          posSalesTable.status,
          "completed",
        ),
      ),

    db
      .select({
        id: ordersTable.id,
        items: ordersTable.items,
        createdAt:
          ordersTable.createdAt,
      })
      .from(ordersTable)
      .where(
        eq(
          ordersTable.status,
          "done",
        ),
      ),

    db
      .select({
        sourceId:
          financeTransactionsTable.sourceId,
        businessDate:
          financeTransactionsTable.businessDate,
      })
      .from(
        financeTransactionsTable,
      )
      .where(
        and(
          eq(
            financeTransactionsTable.sourceType,
            "web_order",
          ),
          eq(
            financeTransactionsTable.sourceEvent,
            "done",
          ),
          eq(
            financeTransactionsTable.status,
            "posted",
          ),
        ),
      ),

    db
      .select({
        productId:
          exchangeSaleItemsTable.productId,
        quantity:
          exchangeSaleItemsTable.quantity,
        soldAt:
          exchangeDocumentsTable.createdAt,
      })
      .from(
        exchangeSaleItemsTable,
      )
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
        ),
      ),

    db
      .select({
        productId:
          posPurchaseItemsTable.productId,
        businessDate:
          posPurchasesTable.businessDate,
      })
      .from(
        posPurchaseItemsTable,
      )
      .innerJoin(
        posPurchasesTable,
        eq(
          posPurchasesTable.id,
          posPurchaseItemsTable.purchaseId,
        ),
      )
      .where(
        eq(
          posPurchasesTable.status,
          "completed",
        ),
      ),

    db
      .select({
        productId:
          productBarcodesTable.productId,
        barcode:
          productBarcodesTable.barcode,
        color:
          productBarcodesTable.color,
        size:
          productBarcodesTable.size,
      })
      .from(
        productBarcodesTable,
      ),

    db
      .select({
        occurredAt:
          inventoryMovementsTable.occurredAt,
      })
      .from(
        inventoryMovementsTable,
      )
      .orderBy(
        asc(
          inventoryMovementsTable.occurredAt,
        ),
      )
      .limit(1),

    db
      .select({
        productId:
          inventoryMovementsTable.productId,
        movementType:
          inventoryMovementsTable.movementType,
        quantityDelta:
          inventoryMovementsTable.quantityDelta,
        color:
          inventoryMovementsTable.color,
        size:
          inventoryMovementsTable.size,
        occurredAt:
          inventoryMovementsTable.occurredAt,
      })
      .from(
        inventoryMovementsTable,
      )
      .where(
        gte(
          inventoryMovementsTable.occurredAt,
          new Date(
            `${addDays(
              cutoff90,
              -1,
            )}T00:00:00Z`,
          ),
        ),
      ),
  ]);

  const sales =
    new Map<
      number,
      ProductSales
    >();

  let earliestSaleDate:
    string | null = null;

  const noteHistoryDate = (
    saleDate: string,
  ) => {
    if (
      earliestSaleDate === null ||
      saleDate <
        earliestSaleDate
    ) {
      earliestSaleDate =
        saleDate;
    }
  };

  for (
    const row of posSaleRows
  ) {
    if (
      row.productId === null
    ) {
      continue;
    }

    const saleDate =
      dateKeyFromUnknown(
        row.soldAt,
      );

    const quantity =
      validPositiveInteger(
        row.quantity,
      );

    if (
      !saleDate ||
      quantity === null
    ) {
      continue;
    }

    recordSale(
      sales,
      {
        productId:
          row.productId,
        quantity,
        saleDate,
        cutoff30,
        cutoff90,
      },
    );

    noteHistoryDate(
      saleDate,
    );
  }

  const onlineDoneDateByOrderId =
    new Map<
      number,
      string
    >();

  for (
    const row of
      onlineDoneTransactions
  ) {
    const orderId =
      validPositiveInteger(
        row.sourceId,
      );

    const date =
      dateKeyFromUnknown(
        row.businessDate,
      );

    if (
      orderId === null ||
      !date
    ) {
      continue;
    }

    onlineDoneDateByOrderId.set(
      orderId,
      date,
    );
  }

  for (
    const order of onlineOrders
  ) {
    const saleDate =
      onlineDoneDateByOrderId.get(
        order.id,
      ) ??
      dateKeyFromUnknown(
        order.createdAt,
      );

    if (!saleDate) {
      continue;
    }

    for (
      const item of
        orderItems(
          order.items,
        )
    ) {
      recordSale(
        sales,
        {
          productId:
            item.productId,
          quantity:
            item.quantity,
          saleDate,
          cutoff30,
          cutoff90,
        },
      );

      noteHistoryDate(
        saleDate,
      );
    }
  }

  for (
    const row of
      exchangeSaleRows
  ) {
    const saleDate =
      dateKeyFromUnknown(
        row.soldAt,
      );

    const quantity =
      validPositiveInteger(
        row.quantity,
      );

    if (
      !saleDate ||
      quantity === null
    ) {
      continue;
    }

    recordSale(
      sales,
      {
        productId:
          row.productId,
        quantity,
        saleDate,
        cutoff30,
        cutoff90,
      },
    );

    noteHistoryDate(
      saleDate,
    );
  }

  const purchases =
    new Map<
      number,
      ProductPurchases
    >();

  for (
    const row of purchaseRows
  ) {
    if (
      row.productId === null
    ) {
      continue;
    }

    const purchaseDate =
      dateKeyFromUnknown(
        row.businessDate,
      );

    if (!purchaseDate) {
      continue;
    }

    recordPurchase(
      purchases,
      {
        productId:
          row.productId,
        purchaseDate,
      },
    );
  }

  const historyCoverageDays =
    earliestSaleDate
      ? daysBetween(
          earliestSaleDate,
          today,
        ) + 1
      : 0;

  const hasThirtyDayHistory =
    historyCoverageDays >=
    NEW_PRODUCT_DAYS;

  const hasNinetyDayHistory =
    historyCoverageDays >=
    DEAD_PRODUCT_DAYS;

  const movementHistoryStartDate =
    earliestMovementRows[0]
      ? dateKeyFromUnknown(
          earliestMovementRows[0]
            .occurredAt,
        )
      : null;

  const movementHistoryCoverageDays =
    movementHistoryStartDate
      ? daysBetween(
          movementHistoryStartDate,
          today,
        ) + 1
      : 0;

  const movementsByProduct =
    new Map<
      number,
      ProductInventoryMovement[]
    >();

  for (
    const movement of
      recentMovementRows
  ) {
    if (
      movement.productId === null
    ) {
      continue;
    }

    const movementDate =
      dateKeyFromUnknown(
        movement.occurredAt,
      );

    if (!movementDate) {
      continue;
    }

    const productMovements =
      movementsByProduct.get(
        movement.productId,
      ) ?? [];

    productMovements.push({
      movementType:
        movement.movementType,
      quantityDelta:
        movement.quantityDelta,
      movementDate,
      color:
        movement.color?.trim() ||
        null,
      size:
        movement.size?.trim() ||
        null,
    });

    movementsByProduct.set(
      movement.productId,
      productMovements,
    );
  }


  const variantBarcodeByKey =
    new Map<string, string>();

  for (const row of productBarcodeRows) {
    const color =
      row.color?.trim();
    const size =
      row.size?.trim();

    if (!color || !size) {
      continue;
    }

    variantBarcodeByKey.set(
      variantKey(
        row.productId,
        color,
        size,
      ),
      row.barcode,
    );
  }

  const movementsByVariant =
    new Map<
      string,
      ProductInventoryMovement[]
    >();

  for (
    const movement of
      recentMovementRows
  ) {
    if (
      movement.productId === null ||
      !movement.color?.trim() ||
      !movement.size?.trim()
    ) {
      continue;
    }

    const movementDate =
      dateKeyFromUnknown(
        movement.occurredAt,
      );

    if (!movementDate) {
      continue;
    }

    const key =
      variantKey(
        movement.productId,
        movement.color,
        movement.size,
      );

    const current =
      movementsByVariant.get(key) ??
      [];

    current.push({
      movementType:
        movement.movementType,
      quantityDelta:
        movement.quantityDelta,
      movementDate,
      color:
        movement.color.trim(),
      size:
        movement.size.trim(),
    });

    movementsByVariant.set(
      key,
      current,
    );
  }

  const reportProducts =
    products.map(
      (product) => {
        const createdDate =
          hebronDateKey(
            product.createdAt,
          );

        const purchase =
          purchases.get(
            product.id,
          );

        const inventoryStartDate =
          purchase
            ?.firstPurchaseDate ??
          createdDate;

        const ageDays =
          daysBetween(
            inventoryStartDate,
            today,
          );

        const sale =
          sales.get(
            product.id,
          ) ?? {
            sold30: 0,
            sold90: 0,
            totalSold: 0,
            lastSaleDate:
              null,
          };

        const currentQuantity =
          getProductQuantity({
            stock:
              product.stock,
            colorVariants:
              product.colorVariants,
          });

        const stockState:
          StockState =
          currentQuantity === null
            ? "untracked"
            : currentQuantity <= 0
              ? "out_of_stock"
              : "in_stock";

        const movementClass =
          movementClassFor({
            currentQuantity,
            ageDays,
            sold30:
              sale.sold30,
            sold90:
              sale.sold90,
            hasThirtyDayHistory,
            hasNinetyDayHistory,
          });

        const daysSinceLastSale =
          sale.lastSaleDate
            ? daysBetween(
                sale.lastSaleDate,
                today,
              )
            : null;

        const productMovements =
          movementsByProduct.get(
            product.id,
          ) ?? [];

        const sellThrough30 =
          calculateSellThroughWindow({
            currentQuantity,
            inventoryStartDate,
            trackingStartDate:
              movementHistoryStartDate,
            today,
            maximumDays: 30,
            movements:
              productMovements,
          });

        const sellThrough90 =
          calculateSellThroughWindow({
            currentQuantity,
            inventoryStartDate,
            trackingStartDate:
              movementHistoryStartDate,
            today,
            maximumDays: 90,
            movements:
              productMovements,
          });

        const velocityStartDate =
          movementHistoryStartDate
            ? latestDateKey(
                cutoff30,
                inventoryStartDate,
                movementHistoryStartDate,
              )
            : null;

        const velocityWindowDays =
          velocityStartDate
            ? daysBetween(
                velocityStartDate,
                today,
              ) + 1
            : 0;

        const velocityRawNetDemand =
          velocityStartDate
            ? productMovements
                .filter(
                  (movement) =>
                    movement.movementDate >=
                      velocityStartDate &&
                    movement.movementDate <=
                      today,
                )
                .reduce(
                  (
                    sum,
                    movement,
                  ) =>
                    sum +
                    netDemandContribution(
                      movement.movementType,
                      movement.quantityDelta,
                    ),
                  0,
                )
            : 0;

        const velocityNetDemand =
          Math.max(
            0,
            velocityRawNetDemand,
          );

        const velocityHistoryReliable =
          currentQuantity !== null &&
          velocityStartDate !==
            null &&
          velocityWindowDays >=
            MIN_VELOCITY_HISTORY_DAYS;

        const averageDailyNetDemand =
          velocityHistoryReliable
            ? velocityNetDemand /
              velocityWindowDays
            : null;

        let daysOfSupply:
          number | null = null;

        let coverageSignal:
          CoverageSignal;

        if (
          currentQuantity === null
        ) {
          coverageSignal =
            "untracked";
        } else if (
          !velocityHistoryReliable
        ) {
          coverageSignal =
            "insufficient_history";
        } else if (
          currentQuantity <= 0
        ) {
          daysOfSupply = 0;
          coverageSignal =
            "out_of_stock";
        } else if (
          averageDailyNetDemand ===
            null ||
          averageDailyNetDemand <= 0
        ) {
          coverageSignal =
            "no_net_demand";
        } else {
          daysOfSupply =
            roundOneDecimal(
              currentQuantity /
                averageDailyNetDemand,
            );

          coverageSignal =
            daysOfSupply <=
            LOW_COVERAGE_DAYS
              ? "low"
              : daysOfSupply <=
                  HIGH_COVERAGE_DAYS
                ? "healthy"
                : "high";
        }

        const inventoryRiskSignal =
          inventoryRiskSignalFor({
            currentQuantity,
            ageDays,
            daysSinceLastSale,
            daysOfSupply,
            coverageSignal,
            movementClass,
          });

        const actionPlan =
          calculateInventoryActionPlan({
            currentQuantity,
            averageDailyNetDemand,
            velocityHistoryReliable,
            ageDays,
          });

        const costInitialized =
          product.costProductId !==
          null;

        const accountingQuantity =
          costInitialized
            ? (
                product
                  .costQuantityOnHand ??
                0
              )
            : null;

        const inventoryValueMinor =
          costInitialized
            ? (
                product
                  .inventoryValueMinor ??
                0
              )
            : null;

        const referenceUnitCostMinor =
          costInitialized
            ? (
                product
                  .referenceUnitCostMinor ??
                0
              )
            : null;

        const costStockMatchesAccounting =
          !costInitialized ||
          currentQuantity === null ||
          accountingQuantity ===
            currentQuantity;

        const averageUnitCostMinor =
          costInitialized &&
          accountingQuantity !== null &&
          accountingQuantity > 0 &&
          inventoryValueMinor !== null
            ? inventoryValueMinor /
              accountingQuantity
            : null;

        const exactInventoryCostAvailable =
          costInitialized &&
          currentQuantity !== null &&
          accountingQuantity !== null &&
          inventoryValueMinor !== null &&
          costStockMatchesAccounting &&
          accountingQuantity ===
            currentQuantity;

        const currentInventoryValueMinor =
          exactInventoryCostAvailable
            ? inventoryValueMinor
            : null;

        const suggestedReorderBudgetMinor =
          actionPlan
            .suggestedReorderQuantity ===
          null
            ? null
            : actionPlan
                  .suggestedReorderQuantity ===
                0
              ? 0
              : referenceUnitCostMinor !==
                  null
                ? Math.round(
                    actionPlan
                      .suggestedReorderQuantity *
                      referenceUnitCostMinor,
                  )
                : null;

        const excessInventoryValueMinor =
          actionPlan.excessUnits ===
          null
            ? null
            : actionPlan.excessUnits ===
                0
              ? 0
              : exactInventoryCostAvailable &&
                  accountingQuantity !==
                    null &&
                  accountingQuantity > 0 &&
                  inventoryValueMinor !==
                    null
                ? Math.round(
                    (
                      inventoryValueMinor /
                      accountingQuantity
                    ) *
                      actionPlan
                        .excessUnits,
                  )
                : null;

        const isSlowDeadCapital =
          movementClass === "slow" ||
          movementClass === "dead";

        const slowDeadCapitalMinor =
          isSlowDeadCapital
            ? currentInventoryValueMinor
            : 0;

        return {
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
          image:
            product.image,
          category:
            product.category,
          isHidden:
            product.isHidden,

          currentQuantity,
          stockState,

          createdDate,
          inventoryStartDate,
          firstPurchaseDate:
            purchase
              ?.firstPurchaseDate ??
            null,
          lastPurchaseDate:
            purchase
              ?.lastPurchaseDate ??
            null,
          ageDays,

          lastSaleDate:
            sale.lastSaleDate,
          daysSinceLastSale,

          sold30:
            sale.sold30,
          sold90:
            sale.sold90,
          totalSold:
            sale.totalSold,

          sellThrough30Percent:
            sellThrough30.percent,
          sellThrough90Percent:
            sellThrough90.percent,
          sellThrough30Reliable:
            sellThrough30.reliable,
          sellThrough90Reliable:
            sellThrough90.reliable,
          sellThrough30WindowDays:
            sellThrough30.observationDays,
          sellThrough90WindowDays:
            sellThrough90.observationDays,
          sellThrough30NetDemand:
            sellThrough30.netDemandQuantity,
          sellThrough90NetDemand:
            sellThrough90.netDemandQuantity,
          sellThrough30AvailableUnits:
            sellThrough30.availableUnits,
          sellThrough90AvailableUnits:
            sellThrough90.availableUnits,
          velocityWindowDays,
          velocityNetDemand,
          averageDailyNetDemand,
          daysOfSupply,
          coverageSignal,
          inventoryRiskSignal,

          actionPlanReliable:
            actionPlan.reliable,
          inventoryActionSignal:
            actionPlan.signal,
          targetStockUnits:
            actionPlan.targetStockUnits,
          maxHealthyStockUnits:
            actionPlan.maxHealthyStockUnits,
          suggestedReorderQuantity:
            actionPlan.suggestedReorderQuantity,
          excessUnits:
            actionPlan.excessUnits,

          costInitialized,
          costQuality:
            costInitialized
              ? product.costQuality
              : null,
          costStockMatchesAccounting,
          accountingQuantity,
          inventoryValueMinor,
          referenceUnitCostMinor,
          averageUnitCostMinor,
          currentInventoryValueMinor,
          suggestedReorderBudgetMinor,
          excessInventoryValueMinor,
          slowDeadCapitalMinor,

          movementClass,
          neverSold:
            sale.totalSold === 0,
        };
      },
    );


  const reportVariants =
    products.flatMap(
      (product) => {
        const createdDate =
          hebronDateKey(
            product.createdAt,
          );

        const purchase =
          purchases.get(
            product.id,
          );

        const inventoryStartDate =
          purchase
            ?.firstPurchaseDate ??
          createdDate;

        const ageDays =
          daysBetween(
            inventoryStartDate,
            today,
          );

        const colorVariants =
          (
            product.colorVariants as
              | ColorVariant[]
              | null
          ) ?? [];

        return colorVariants.flatMap(
          (variant) =>
            (variant.sizes ?? []).map(
              (sizeEntry) => {
                const color =
                  variant.color.trim();
                const size =
                  sizeEntry.size.trim();
                const key =
                  variantKey(
                    product.id,
                    color,
                    size,
                  );

                const currentQuantity =
                  typeof sizeEntry.stock ===
                  "number"
                    ? sizeEntry.stock
                    : sizeEntry.outOfStock
                      ? 0
                      : null;

                const stockState:
                  StockState =
                  currentQuantity ===
                  null
                    ? "untracked"
                    : currentQuantity <=
                        0
                      ? "out_of_stock"
                      : "in_stock";

                const movements =
                  movementsByVariant.get(
                    key,
                  ) ?? [];

                const sellThrough30 =
                  calculateSellThroughWindow({
                    currentQuantity,
                    inventoryStartDate,
                    trackingStartDate:
                      movementHistoryStartDate,
                    today,
                    maximumDays: 30,
                    movements,
                  });

                const sellThrough90 =
                  calculateSellThroughWindow({
                    currentQuantity,
                    inventoryStartDate,
                    trackingStartDate:
                      movementHistoryStartDate,
                    today,
                    maximumDays: 90,
                    movements,
                  });

                const velocityStartDate =
                  movementHistoryStartDate
                    ? latestDateKey(
                        cutoff30,
                        inventoryStartDate,
                        movementHistoryStartDate,
                      )
                    : null;

                const velocityWindowDays =
                  velocityStartDate
                    ? daysBetween(
                        velocityStartDate,
                        today,
                      ) + 1
                    : 0;

                const velocityRawNetDemand =
                  velocityStartDate
                    ? movements
                        .filter(
                          (movement) =>
                            movement.movementDate >=
                              velocityStartDate &&
                            movement.movementDate <=
                              today,
                        )
                        .reduce(
                          (
                            sum,
                            movement,
                          ) =>
                            sum +
                            netDemandContribution(
                              movement.movementType,
                              movement.quantityDelta,
                            ),
                          0,
                        )
                    : 0;

                const velocityNetDemand =
                  Math.max(
                    0,
                    velocityRawNetDemand,
                  );

                const velocityHistoryReliable =
                  currentQuantity !==
                    null &&
                  velocityStartDate !==
                    null &&
                  velocityWindowDays >=
                    MIN_VELOCITY_HISTORY_DAYS;

                const averageDailyNetDemand =
                  velocityHistoryReliable
                    ? velocityNetDemand /
                      velocityWindowDays
                    : null;

                let daysOfSupply:
                  number | null = null;

                let coverageSignal:
                  CoverageSignal;

                if (
                  currentQuantity ===
                  null
                ) {
                  coverageSignal =
                    "untracked";
                } else if (
                  !velocityHistoryReliable
                ) {
                  coverageSignal =
                    "insufficient_history";
                } else if (
                  currentQuantity <= 0
                ) {
                  daysOfSupply = 0;
                  coverageSignal =
                    "out_of_stock";
                } else if (
                  averageDailyNetDemand ===
                    null ||
                  averageDailyNetDemand <= 0
                ) {
                  coverageSignal =
                    "no_net_demand";
                } else {
                  daysOfSupply =
                    roundOneDecimal(
                      currentQuantity /
                        averageDailyNetDemand,
                    );

                  coverageSignal =
                    daysOfSupply <=
                    LOW_COVERAGE_DAYS
                      ? "low"
                      : daysOfSupply <=
                          HIGH_COVERAGE_DAYS
                        ? "healthy"
                        : "high";
                }

                const movementClass =
                  movementClassFor({
                    currentQuantity,
                    ageDays,
                    sold30:
                      sellThrough30
                        .netDemandQuantity,
                    sold90:
                      sellThrough90
                        .netDemandQuantity,
                    hasThirtyDayHistory:
                      sellThrough30.reliable,
                    hasNinetyDayHistory:
                      sellThrough90.reliable,
                  });

                const lastDemandDate =
                  movements
                    .filter(
                      (movement) =>
                        netDemandContribution(
                          movement.movementType,
                          movement.quantityDelta,
                        ) > 0,
                    )
                    .map(
                      (movement) =>
                        movement.movementDate,
                    )
                    .sort()
                    .at(-1) ??
                  null;

                const daysSinceLastDemand =
                  lastDemandDate
                    ? daysBetween(
                        lastDemandDate,
                        today,
                      )
                    : null;

                const inventoryRiskSignal =
                  inventoryRiskSignalFor({
                    currentQuantity,
                    ageDays,
                    daysSinceLastSale:
                      daysSinceLastDemand,
                    daysOfSupply,
                    coverageSignal,
                    movementClass,
                  });

                const actionPlan =
                  calculateInventoryActionPlan({
                    currentQuantity,
                    averageDailyNetDemand,
                    velocityHistoryReliable,
                    ageDays,
                  });

                const referenceUnitCostMinor =
                  product.costProductId !==
                  null
                    ? (
                        product.referenceUnitCostMinor ??
                        null
                      )
                    : null;

                const suggestedReorderBudgetMinor =
                  actionPlan
                    .suggestedReorderQuantity !==
                    null &&
                  actionPlan
                    .suggestedReorderQuantity >
                    0 &&
                  referenceUnitCostMinor !==
                    null
                    ? actionPlan
                        .suggestedReorderQuantity *
                      referenceUnitCostMinor
                    : null;

                return {
                  variantKey: key,
                  productId:
                    String(
                      product.id,
                    ),
                  nameAr:
                    product.nameAr,
                  productCode:
                    product.productCode ??
                    null,
                  image:
                    variant.image ||
                    product.image,
                  category:
                    product.category,
                  color,
                  size,
                  barcode:
                    variantBarcodeByKey.get(
                      key,
                    ) ??
                    product.barcode ??
                    null,
                  currentQuantity,
                  stockState,
                  ageDays,
                  lastDemandDate,
                  daysSinceLastDemand,
                  netDemand30:
                    sellThrough30
                      .netDemandQuantity,
                  netDemand90:
                    sellThrough90
                      .netDemandQuantity,
                  sellThrough30Percent:
                    sellThrough30.percent,
                  sellThrough90Percent:
                    sellThrough90.percent,
                  sellThrough30Reliable:
                    sellThrough30.reliable,
                  sellThrough90Reliable:
                    sellThrough90.reliable,
                  velocityWindowDays,
                  velocityNetDemand,
                  averageDailyNetDemand,
                  daysOfSupply,
                  coverageSignal,
                  inventoryRiskSignal,
                  actionPlanReliable:
                    actionPlan.reliable,
                  inventoryActionSignal:
                    actionPlan.signal,
                  targetStockUnits:
                    actionPlan.targetStockUnits,
                  maxHealthyStockUnits:
                    actionPlan.maxHealthyStockUnits,
                  suggestedReorderQuantity:
                    actionPlan
                      .suggestedReorderQuantity,
                  excessUnits:
                    actionPlan.excessUnits,
                  referenceUnitCostMinor,
                  suggestedReorderBudgetMinor,
                  movementClass,
                };
              },
            ),
        );
      },
    );

  const productsWithVariants =
    new Set(
      reportVariants.map(
        (variant) =>
          Number(
            variant.productId,
          ),
      ),
    );

  const unattributedVariantDemand = (
    startDate: string,
  ) =>
    recentMovementRows.reduce(
      (sum, movement) => {
        if (
          movement.productId ===
            null ||
          !productsWithVariants.has(
            movement.productId,
          ) ||
          (
            movement.color?.trim() &&
            movement.size?.trim()
          )
        ) {
          return sum;
        }

        const movementDate =
          dateKeyFromUnknown(
            movement.occurredAt,
          );

        if (
          !movementDate ||
          movementDate < startDate ||
          movementDate > today
        ) {
          return sum;
        }

        return (
          sum +
          netDemandContribution(
            movement.movementType,
            movement.quantityDelta,
          )
        );
      },
      0,
    );

  const variantSummary = {
    totalVariants:
      reportVariants.length,
    trackedVariants:
      reportVariants.filter(
        (variant) =>
          variant.currentQuantity !==
          null,
      ).length,
    inStockVariants:
      reportVariants.filter(
        (variant) =>
          (variant.currentQuantity ??
            0) > 0,
      ).length,
    outOfStockVariants:
      reportVariants.filter(
        (variant) =>
          variant.currentQuantity ===
          0,
      ).length,
    fastVariants:
      reportVariants.filter(
        (variant) =>
          variant.movementClass ===
          "fast",
      ).length,
    slowVariants:
      reportVariants.filter(
        (variant) =>
          variant.movementClass ===
          "slow",
      ).length,
    deadVariants:
      reportVariants.filter(
        (variant) =>
          variant.movementClass ===
          "dead",
      ).length,
    stockoutNowVariants:
      reportVariants.filter(
        (variant) =>
          variant.inventoryRiskSignal ===
          "stockout_now",
      ).length,
    stockoutHighRiskVariants:
      reportVariants.filter(
        (variant) =>
          variant.inventoryRiskSignal ===
          "stockout_high",
      ).length,
    stockoutWatchVariants:
      reportVariants.filter(
        (variant) =>
          variant.inventoryRiskSignal ===
          "stockout_watch",
      ).length,
    overstockHighRiskVariants:
      reportVariants.filter(
        (variant) =>
          variant.inventoryRiskSignal ===
          "overstock_high",
      ).length,
    overstockWatchVariants:
      reportVariants.filter(
        (variant) =>
          variant.inventoryRiskSignal ===
          "overstock_watch",
      ).length,
    reorderSuggestedVariants:
      reportVariants.filter(
        (variant) =>
          variant.inventoryActionSignal ===
          "reorder",
      ).length,
    suggestedReorderUnits:
      reportVariants.reduce(
        (sum, variant) =>
          sum +
          (
            variant
              .suggestedReorderQuantity ??
            0
          ),
        0,
      ),
    excessSuggestedVariants:
      reportVariants.filter(
        (variant) =>
          variant.inventoryActionSignal ===
            "reduce" ||
          variant.inventoryActionSignal ===
            "review_no_demand",
      ).length,
    excessUnits:
      reportVariants.reduce(
        (sum, variant) =>
          sum +
          (
            variant.excessUnits ??
            0
          ),
        0,
      ),
    noDemandReviewVariants:
      reportVariants.filter(
        (variant) =>
          variant.inventoryActionSignal ===
          "review_no_demand",
      ).length,
    insufficientDataVariants:
      reportVariants.filter(
        (variant) =>
          !variant.actionPlanReliable,
      ).length,
    suggestedReorderBudgetKnownMinor:
      reportVariants.reduce(
        (sum, variant) =>
          sum +
          (
            variant
              .suggestedReorderBudgetMinor ??
            0
          ),
        0,
      ),
    reorderBudgetMissingCostVariants:
      reportVariants.filter(
        (variant) =>
          (
            variant
              .suggestedReorderQuantity ??
            0
          ) > 0 &&
          variant
            .suggestedReorderBudgetMinor ===
            null,
      ).length,
    unattributedDemand30:
      Math.max(
        0,
        unattributedVariantDemand(
          cutoff30,
        ),
      ),
    unattributedDemand90:
      Math.max(
        0,
        unattributedVariantDemand(
          cutoff90,
        ),
      ),
  };

  const aggregateSellThrough = (
    days: 30 | 90,
  ) => {
    const reliableProducts =
      reportProducts.filter(
        (product) =>
          days === 30
            ? product.sellThrough30Reliable
            : product.sellThrough90Reliable,
      );

    const netDemand =
      reliableProducts.reduce(
        (sum, product) =>
          sum +
          (
            days === 30
              ? product.sellThrough30NetDemand
              : product.sellThrough90NetDemand
          ),
        0,
      );

    const availableUnits =
      reliableProducts.reduce(
        (sum, product) =>
          sum +
          (
            (
              days === 30
                ? product.sellThrough30AvailableUnits
                : product.sellThrough90AvailableUnits
            ) ?? 0
          ),
        0,
      );

    return {
      reliableProducts:
        reliableProducts.length,
      percent:
        availableUnits > 0
          ? roundOneDecimal(
              Math.min(
                100,
                (
                  netDemand /
                  availableUnits
                ) * 100,
              ),
            )
          : null,
    };
  };

  const aggregateSellThrough30 =
    aggregateSellThrough(30);

  const aggregateSellThrough90 =
    aggregateSellThrough(90);

  const summary = {
    totalProducts:
      reportProducts.length,

    trackedProducts:
      reportProducts.filter(
        (product) =>
          product.currentQuantity !==
          null,
      ).length,

    inStockProducts:
      reportProducts.filter(
        (product) =>
          product.currentQuantity !==
            null &&
          product.currentQuantity > 0,
      ).length,

    fastMovers:
      reportProducts.filter(
        (product) =>
          product.movementClass ===
          "fast",
      ).length,

    slowMovers:
      reportProducts.filter(
        (product) =>
          product.movementClass ===
          "slow",
      ).length,

    deadMovers:
      reportProducts.filter(
        (product) =>
          product.movementClass ===
          "dead",
      ).length,

    newProducts:
      reportProducts.filter(
        (product) =>
          product.movementClass ===
          "new",
      ).length,

    neverSoldInStock:
      reportProducts.filter(
        (product) =>
          product.neverSold &&
          product.currentQuantity !==
            null &&
          product.currentQuantity > 0,
      ).length,

    fastOutOfStock:
      reportProducts.filter(
        (product) =>
          product.movementClass ===
            "fast" &&
          product.currentQuantity ===
            0,
      ).length,

    untrackedStock:
      reportProducts.filter(
        (product) =>
          product.stockState ===
          "untracked",
      ).length,

    sellThrough30Percent:
      aggregateSellThrough30.percent,

    sellThrough90Percent:
      aggregateSellThrough90.percent,

    sellThrough30ReliableProducts:
      aggregateSellThrough30
        .reliableProducts,

    sellThrough90ReliableProducts:
      aggregateSellThrough90
        .reliableProducts,

    coverUnder14Days:
      reportProducts.filter(
        (product) =>
          product.coverageSignal ===
          "low",
      ).length,

    cover15To60Days:
      reportProducts.filter(
        (product) =>
          product.coverageSignal ===
          "healthy",
      ).length,

    coverOver60Days:
      reportProducts.filter(
        (product) =>
          product.coverageSignal ===
          "high",
      ).length,

    noVelocityInStock:
      reportProducts.filter(
        (product) =>
          product.stockState ===
            "in_stock" &&
          product.coverageSignal ===
            "no_net_demand",
      ).length,

    insufficientCoverageData:
      reportProducts.filter(
        (product) =>
          product.coverageSignal ===
            "insufficient_history" ||
          product.coverageSignal ===
            "untracked",
      ).length,

    stockoutNow:
      reportProducts.filter(
        (product) =>
          product.inventoryRiskSignal ===
          "stockout_now",
      ).length,

    stockoutHighRisk:
      reportProducts.filter(
        (product) =>
          product.inventoryRiskSignal ===
          "stockout_high",
      ).length,

    stockoutWatch:
      reportProducts.filter(
        (product) =>
          product.inventoryRiskSignal ===
          "stockout_watch",
      ).length,

    overstockHighRisk:
      reportProducts.filter(
        (product) =>
          product.inventoryRiskSignal ===
          "overstock_high",
      ).length,

    overstockWatch:
      reportProducts.filter(
        (product) =>
          product.inventoryRiskSignal ===
          "overstock_watch",
      ).length,

    balancedInventoryRisk:
      reportProducts.filter(
        (product) =>
          product.inventoryRiskSignal ===
          "balanced",
      ).length,

    insufficientRiskData:
      reportProducts.filter(
        (product) =>
          product.inventoryRiskSignal ===
            "insufficient_history" ||
          product.inventoryRiskSignal ===
            "untracked",
      ).length,

    reorderSuggestedProducts:
      reportProducts.filter(
        (product) =>
          product.inventoryActionSignal ===
          "reorder",
      ).length,

    suggestedReorderUnits:
      reportProducts.reduce(
        (sum, product) =>
          sum +
          (
            product
              .suggestedReorderQuantity ??
            0
          ),
        0,
      ),

    excessSuggestedProducts:
      reportProducts.filter(
        (product) =>
          product.inventoryActionSignal ===
            "reduce" ||
          product.inventoryActionSignal ===
            "review_no_demand",
      ).length,

    excessUnits:
      reportProducts.reduce(
        (sum, product) =>
          sum +
          (
            product.excessUnits ??
            0
          ),
        0,
      ),

    noDemandReviewProducts:
      reportProducts.filter(
        (product) =>
          product.inventoryActionSignal ===
          "review_no_demand",
      ).length,

    insufficientActionData:
      reportProducts.filter(
        (product) =>
          !product.actionPlanReliable,
      ).length,

    suggestedReorderBudgetKnownMinor:
      reportProducts.reduce(
        (sum, product) =>
          sum +
          (
            product
              .suggestedReorderBudgetMinor ??
            0
          ),
        0,
      ),

    reorderBudgetMissingCostProducts:
      reportProducts.filter(
        (product) =>
          (
            product
              .suggestedReorderQuantity ??
            0
          ) > 0 &&
          product
            .suggestedReorderBudgetMinor ===
            null,
      ).length,

    excessInventoryValueKnownMinor:
      reportProducts.reduce(
        (sum, product) =>
          sum +
          (
            product
              .excessInventoryValueMinor ??
            0
          ),
        0,
      ),

    excessValueMissingCostProducts:
      reportProducts.filter(
        (product) =>
          (
            product.excessUnits ??
            0
          ) > 0 &&
          product
            .excessInventoryValueMinor ===
            null,
      ).length,

    slowDeadCapitalKnownMinor:
      reportProducts.reduce(
        (sum, product) =>
          sum +
          (
            product
              .slowDeadCapitalMinor ??
            0
          ),
        0,
      ),

    slowDeadCapitalMissingCostProducts:
      reportProducts.filter(
        (product) =>
          (
            product.movementClass ===
              "slow" ||
            product.movementClass ===
              "dead"
          ) &&
          (
            product.currentQuantity ??
            0
          ) > 0 &&
          product.slowDeadCapitalMinor ===
            null,
      ).length,

    costQuantityMismatchProducts:
      reportProducts.filter(
        (product) =>
          product.costInitialized &&
          !product
            .costStockMatchesAccounting,
      ).length,
  };

  const warnings: string[] =
    [];

  if (
    !hasThirtyDayHistory
  ) {
    warnings.push(
      `تاريخ المبيعات المسجل يغطي ${historyCoverageDays} يوم فقط، لذلك لا يتم تصنيف أي صنف كبطيء أو ميت قبل اكتمال 30 يوم من البيانات المسجلة.`,
    );
  } else if (
    !hasNinetyDayHistory
  ) {
    warnings.push(
      `تاريخ المبيعات المسجل يغطي ${historyCoverageDays} يوم؛ تصنيف البطيء متاح، لكن لا يتم تصنيف أي صنف كميت قبل اكتمال 90 يوم من البيانات المسجلة.`,
    );
  }

  if (
    movementHistoryStartDate ===
    null
  ) {
    warnings.push(
      "لا توجد حركات مخزون مسجلة يمكن الاعتماد عليها بعد؛ Sell-through وأيام التغطية ستظهر غير متاحة حتى يبدأ سجل الحركة الموثوق.",
    );
  } else if (
    movementHistoryCoverageDays <
    30
  ) {
    warnings.push(
      `سجل حركة المخزون الموثوق يبدأ من ${movementHistoryStartDate} ويغطي ${movementHistoryCoverageDays} يوم. Sell-through 30/90 يظهر فقط للصنف الذي تغطي الحركات كامل نافذته؛ أيام التغطية تستخدم نافذة متكيفة موثوقة لا تتجاوز 30 يوم.`,
    );
  } else if (
    movementHistoryCoverageDays <
    90
  ) {
    warnings.push(
      `سجل حركة المخزون يغطي ${movementHistoryCoverageDays} يوم. Sell-through 30 متاح عند اكتمال نافذة الصنف، بينما 90 يوم يبقى غير متاح للأصناف الأقدم حتى تكتمل التغطية.`,
    );
  }

  if (
    summary.reorderBudgetMissingCostProducts >
    0
  ) {
    warnings.push(
      `يوجد ${summary.reorderBudgetMissingCostProducts} صنف لديه كمية شراء مقترحة لكن تكلفة مرجعية غير متاحة؛ هذه الأصناف لا تدخل في إجمالي ميزانية الشراء.`,
    );
  }

  if (
    summary.excessValueMissingCostProducts >
    0
  ) {
    warnings.push(
      `يوجد ${summary.excessValueMissingCostProducts} صنف لديه فائض محتمل لكن قيمة تكلفته الحالية غير موثوقة أو كمية التكلفة لا تطابق المخزون؛ هذه الأصناف لا تدخل في إجمالي قيمة الفائض.`,
    );
  }

  if (
    summary.costQuantityMismatchProducts >
    0
  ) {
    warnings.push(
      `يوجد ${summary.costQuantityMismatchProducts} صنف فيه فرق بين كمية المخزون وكمية محاسبة التكلفة؛ الأثر المالي المعتمد على قيمة المخزون يعرض N/A حتى تتم مطابقة الكمية.`,
    );
  }

  if (
    variantSummary.unattributedDemand30 >
    0
  ) {
    warnings.push(
      `يوجد ${variantSummary.unattributedDemand30} وحدة طلب صافي خلال آخر 30 يوم لأصناف لديها ألوان/مقاسات لكن حركة المخزون لم تحمل لونًا ومقاسًا كاملين؛ تحليل Variant يعرض الأرقام المربوطة فقط ولا يوزع هذه الوحدات تخمينًا.`,
    );
  }

  if (
    summary.untrackedStock > 0
  ) {
    warnings.push(
      `يوجد ${summary.untrackedStock} صنف لا يمكن تحديد كميته الحالية بدقة؛ تصنيف الحركة يظهر لكن حالة المخزون غير مكتملة لهذه الأصناف.`,
    );
  }

  return json({
    generatedAt:
      new Date().toISOString(),
    asOfDate: today,

    history: {
      earliestSaleDate,
      coverageDays:
        historyCoverageDays,
      hasThirtyDayHistory,
      hasNinetyDayHistory,
      earliestInventoryMovementDate:
        movementHistoryStartDate,
      inventoryMovementCoverageDays:
        movementHistoryCoverageDays,
    },

    thresholds: {
      fast30:
        FAST_30_THRESHOLD,
      fast90:
        FAST_90_THRESHOLD,
      slow30Max:
        SLOW_30_MAX,
      slow90Max:
        SLOW_90_MAX,
      newProductDays:
        NEW_PRODUCT_DAYS,
      deadProductDays:
        DEAD_PRODUCT_DAYS,
      minimumVelocityHistoryDays:
        MIN_VELOCITY_HISTORY_DAYS,
      stockoutHighDays:
        STOCKOUT_HIGH_DAYS,
      lowCoverageDays:
        LOW_COVERAGE_DAYS,
      highCoverageDays:
        HIGH_COVERAGE_DAYS,
      targetCoverageDays:
        TARGET_COVERAGE_DAYS,
      overstockHighDays:
        OVERSTOCK_HIGH_DAYS,
      minimumOverstockAgeDays:
        MIN_OVERSTOCK_AGE_DAYS,
    },

    summary,
    warnings,

    methodology: {
      sales:
        "POS المكتمل + الطلبات الإلكترونية المكتملة + أصناف البيع في تبديلات POS المكتملة. تبديلات الأونلاين لا تُحسب مرتين لأن بيعها الجديد يظهر عبر الطلب البديل.",
      purchase:
        "المشتريات المكتملة فقط. إذا لم يوجد شراء مسجل للصنف، يبدأ عمر الصنف من تاريخ إنشائه.",
      fast:
        `سريع: بيع ${FAST_30_THRESHOLD} قطع أو أكثر خلال آخر 30 يوم، أو ${FAST_90_THRESHOLD} قطع أو أكثر خلال آخر 90 يوم.`,
      slow:
        `بطيء: عمره 30 يوم أو أكثر، لديه مخزون، وباع بحد أقصى ${SLOW_30_MAX} خلال آخر 30 يوم، وعند توفر 90 يوم من التاريخ لا يزيد عن ${SLOW_90_MAX} خلال 90 يوم.`,
      dead:
        "ميت: لديه مخزون، عمره 90 يوم أو أكثر، ولم يبع أي قطعة خلال آخر 90 يوم، ولا يُفعّل هذا التصنيف قبل توفر 90 يوم من تاريخ البيع المسجل.",
      new:
        "جديد: عمره أقل من 30 يوم ولم يصل إلى حد التصنيف السريع.",
      sellThrough:
        "Sell-through يعتمد على سجل حركة المخزون: صافي الطلب خلال النافذة ÷ الوحدات المتاحة (مخزون بداية النافذة + صافي الحركات غير البيعية مثل الشراء والتسويات). لا يظهر الرقم إلا إذا كان سجل الحركات يغطي كامل نافذة الصنف، وتُعكس المرتجعات والإلغاءات والـvoids تلقائيًا من quantityDelta.",
      daysOfSupply:
        `أيام التغطية = المخزون الحالي ÷ متوسط صافي الطلب اليومي من inventory_movements. نافذة السرعة متكيفة حتى 30 يوم وتبدأ من أحدث تاريخ بين بداية الصنف وبداية التتبع ونافذة 30 يوم، مع حد أدنى ${MIN_VELOCITY_HISTORY_DAYS} أيام موثوقة. المرتجعات والإلغاءات تقلل الطلب؛ المخزون غير المتتبع أو التاريخ الأقصر يعرض N/A بدل رقم وهمي.`,
      inventoryRisk:
        `مخاطر النفاد: نفاد فعلي مع بيع خلال آخر ${LOW_COVERAGE_DAYS} يوم، أو تغطية ≤${STOCKOUT_HIGH_DAYS} أيام (مرتفع)، أو ≤${LOW_COVERAGE_DAYS} يوم (مراقبة). مخاطر الفائض لا تبدأ قبل عمر ${MIN_OVERSTOCK_AGE_DAYS} يوم؛ مرتفعة للصنف الميت/بلا طلب صافي بعمر 90 يوم أو تغطية >${OVERSTOCK_HIGH_DAYS} يوم، وتحت المراقبة للصنف البطيء/بلا طلب صافي أو تغطية >${HIGH_COVERAGE_DAYS} يوم. البيانات غير الكافية لا تُحوّل إلى إنذار وهمي.`,
      inventoryAction:
        `خطة الكمية تستخدم متوسط صافي الطلب اليومي الموثوق. هدف إعادة الطلب هو ${TARGET_COVERAGE_DAYS} يوم: الكمية المقترحة = مخزون الهدف − المخزون الحالي، بحد أدنى صفر. الفائض المحتمل يُحسب فوق حد ${HIGH_COVERAGE_DAYS} يوم ولا يُفعّل قبل عمر ${MIN_OVERSTOCK_AGE_DAYS} يوم. إذا كان صافي الطلب صفرًا، لا يُقترح شراء؛ وبعد عمر ${MIN_OVERSTOCK_AGE_DAYS} يوم تظهر الكمية الحالية كفائض محتمل للمراجعة. التاريخ غير الكافي يعرض N/A بدل رقم وهمي.`,
      financialImpact:
        "ميزانية إعادة الطلب = الكمية المقترحة × التكلفة المرجعية الحالية للصنف، لذلك هي تقدير شراء وليست فاتورة مورد. قيمة الفائض ورأس المال في البطيء/الميت تعتمد قيمة المخزون الدفترية الحالية ولا تُحسب إلا عندما كمية محاسبة التكلفة تطابق المخزون. قد تتداخل قيمة الفائض مع رأس المال البطيء/الميت لنفس الصنف، لذلك لا يُفترض جمع المؤشرين معًا. التكلفة الناقصة أو فرق الكمية يعرض N/A ولا يدخل بصمت في الإجماليات.",
      variantIntelligence:
        `Variant Intelligence يحلل اللون + المقاس من مخزون colorVariants وحركات inventory_movements المرتبطة بنفس اللون والمقاس. يستخدم نفس حدود التغطية وخطة ${TARGET_COVERAGE_DAYS} يوم، ولا يوزع الحركات التي بلا لون/مقاس على Variants بالتخمين. تكلفة الشراء المقترحة على مستوى Variant تستخدم التكلفة المرجعية الحالية للمنتج كتقدير فقط.`,
    },

    variantSummary,
    variants:
      reportVariants,

    products:
      reportProducts,
  });
}

export async function handleInventoryIntelligenceRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path =
    new URL(
      request.url,
    ).pathname;

  if (
    request.method === "GET" &&
    path ===
      "/api/owner/reports/inventory-intelligence"
  ) {
    return handleReport(
      request,
      db,
      env,
    );
  }

  return null;
}
