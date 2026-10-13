import {
  exchangeDocumentsTable,
  exchangeSaleItemsTable,
  financeTransactionsTable,
  ordersTable,
  posPurchaseItemsTable,
  posPurchasesTable,
  posSaleItemsTable,
  posSalesTable,
  productsTable,
} from "@workspace/db/schema";
import {
  and,
  eq,
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

const FAST_30_THRESHOLD = 4;
const FAST_90_THRESHOLD = 10;
const SLOW_30_MAX = 1;
const SLOW_90_MAX = 3;
const NEW_PRODUCT_DAYS = 30;
const DEAD_PRODUCT_DAYS = 90;

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
    input.sold90 <=
      SLOW_90_MAX
  ) {
    return "slow";
  }

  return "normal";
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
      })
      .from(productsTable)
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

          movementClass,
          neverSold:
            sale.totalSold === 0,
        };
      },
    );

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
        `بطيء: عمره 30 يوم أو أكثر، لديه مخزون، وباع بحد أقصى ${SLOW_30_MAX} خلال 30 يوم و${SLOW_90_MAX} خلال 90 يوم.`,
      dead:
        "ميت: لديه مخزون، عمره 90 يوم أو أكثر، ولم يبع أي قطعة خلال آخر 90 يوم، ولا يُفعّل هذا التصنيف قبل توفر 90 يوم من تاريخ البيع المسجل.",
      new:
        "جديد: عمره أقل من 30 يوم ولم يصل إلى حد التصنيف السريع.",
    },

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
