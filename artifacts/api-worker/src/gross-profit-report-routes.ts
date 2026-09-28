import {
  financeTransactionsTable,
  orderItemCostsTable,
  ordersTable,
  posSaleItemCostsTable,
  posSaleItemsTable,
  posSaleReturnItemCostsTable,
  posSaleReturnItemsTable,
  posSaleReturnsTable,
  posSalesTable,
} from "@workspace/db/schema";
import {
  and,
  eq,
  gte,
  inArray,
  lte,
} from "drizzle-orm";

import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";

type Db =
  Awaited<ReturnType<typeof openDb>>["db"];

type CostQualitySummary =
  | "confirmed"
  | "mixed"
  | "incomplete"
  | "not_applicable";

type ChannelSummary = {
  documents: number;
  returnDocuments: number;

  salesMinor: number;
  returnsMinor: number;
  netSalesMinor: number;

  cogsKnownMinor: number;

  grossProfitMinor: number | null;
  grossMarginPercent: number | null;

  shippingChargedMinor: number;
  deliveryCompanyCostMinor: number;
  deliveryImpactMinor: number;

  profitAfterDeliveryMinor:
    | number
    | null;

  saleQuantity: number;
  trackedSaleQuantity: number;

  returnQuantity: number;
  trackedReturnQuantity: number;

  costCoveragePercent: number;
  costCoverageComplete: boolean;
  costQuality: CostQualitySummary;
};

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

function validDate(
  value: string | null,
): value is string {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date =
    new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date
      .toISOString()
      .slice(0, 10) === value
  );
}

function sum(
  values: number[],
) {
  return values.reduce(
    (total, value) =>
      total + value,
    0,
  );
}

function coveragePercent(
  tracked: number,
  total: number,
) {
  if (total <= 0) {
    return 100;
  }

  return Math.round(
    (tracked / total) *
      10000,
  ) / 100;
}

function summarizeQuality(
  qualities: string[],
  totalQuantity: number,
  complete: boolean,
): CostQualitySummary {
  if (totalQuantity === 0) {
    return "not_applicable";
  }

  if (!complete) {
    return "incomplete";
  }

  return qualities.every(
    (quality) =>
      quality === "confirmed",
  )
    ? "confirmed"
    : "mixed";
}

function buildChannel(input: {
  documents: number;
  returnDocuments?: number;

  salesMinor: number;
  returnsMinor?: number;

  cogsKnownMinor: number;

  shippingChargedMinor?: number;
  deliveryCompanyCostMinor?: number;

  saleQuantity: number;
  trackedSaleQuantity: number;

  returnQuantity?: number;
  trackedReturnQuantity?: number;

  costCoverageComplete: boolean;
  costQualities: string[];
}): ChannelSummary {
  const returnsMinor =
    input.returnsMinor ?? 0;

  const returnQuantity =
    input.returnQuantity ?? 0;

  const trackedReturnQuantity =
    input.trackedReturnQuantity ??
    0;

  const shippingChargedMinor =
    input.shippingChargedMinor ??
    0;

  const deliveryCompanyCostMinor =
    input.deliveryCompanyCostMinor ??
    0;

  const netSalesMinor =
    input.salesMinor -
    returnsMinor;

  const grossProfitMinor =
    input.costCoverageComplete
      ? netSalesMinor -
        input.cogsKnownMinor
      : null;

  const grossMarginPercent =
    grossProfitMinor !== null &&
    netSalesMinor > 0
      ? Math.round(
          (
            grossProfitMinor /
            netSalesMinor
          ) *
            10000,
        ) / 100
      : null;

  const deliveryImpactMinor =
    shippingChargedMinor -
    deliveryCompanyCostMinor;

  const profitAfterDeliveryMinor =
    grossProfitMinor === null
      ? null
      : grossProfitMinor +
        deliveryImpactMinor;

  const totalCostQuantity =
    input.saleQuantity +
    returnQuantity;

  const trackedCostQuantity =
    input.trackedSaleQuantity +
    trackedReturnQuantity;

  return {
    documents:
      input.documents,

    returnDocuments:
      input.returnDocuments ?? 0,

    salesMinor:
      input.salesMinor,

    returnsMinor,

    netSalesMinor,

    cogsKnownMinor:
      input.cogsKnownMinor,

    grossProfitMinor,
    grossMarginPercent,

    shippingChargedMinor,
    deliveryCompanyCostMinor,
    deliveryImpactMinor,
    profitAfterDeliveryMinor,

    saleQuantity:
      input.saleQuantity,

    trackedSaleQuantity:
      input.trackedSaleQuantity,

    returnQuantity,
    trackedReturnQuantity,

    costCoveragePercent:
      coveragePercent(
        trackedCostQuantity,
        totalCostQuantity,
      ),

    costCoverageComplete:
      input.costCoverageComplete,

    costQuality:
      summarizeQuality(
        input.costQualities,
        totalCostQuantity,
        input.costCoverageComplete,
      ),
  };
}

async function handleGrossProfit(
  request: Request,
  db: Db,
  env: Env,
) {
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
          "هذه البيانات متاحة للمالك فقط",
      },
      403,
    );
  }

  const url =
    new URL(request.url);

  const from =
    url.searchParams.get("from");

  const to =
    url.searchParams.get("to");

  if (
    !validDate(from) ||
    !validDate(to)
  ) {
    return json(
      {
        error:
          "يجب تحديد تاريخ بداية ونهاية صالحين",
      },
      400,
    );
  }

  if (from > to) {
    return json(
      {
        error:
          "تاريخ البداية يجب أن يسبق تاريخ النهاية",
      },
      400,
    );
  }

  // ==========================================================
  // POS SALES
  // ==========================================================

  const sales =
    await db
      .select({
        id: posSalesTable.id,
        totalMinor:
          posSalesTable.totalMinor,
      })
      .from(posSalesTable)
      .where(
        and(
          eq(
            posSalesTable.status,
            "completed",
          ),
          gte(
            posSalesTable.businessDate,
            from,
          ),
          lte(
            posSalesTable.businessDate,
            to,
          ),
        ),
      );

  const saleIds =
    sales.map(
      (sale) => sale.id,
    );

  const saleItems =
    saleIds.length > 0
      ? await db
          .select({
            id:
              posSaleItemsTable.id,
            quantity:
              posSaleItemsTable.quantity,
          })
          .from(
            posSaleItemsTable,
          )
          .where(
            inArray(
              posSaleItemsTable.saleId,
              saleIds,
            ),
          )
      : [];

  const saleItemIds =
    saleItems.map(
      (item) => item.id,
    );

  const saleCosts =
    saleItemIds.length > 0
      ? await db
          .select({
            saleItemId:
              posSaleItemCostsTable.saleItemId,

            quantity:
              posSaleItemCostsTable.quantity,

            costTotalMinor:
              posSaleItemCostsTable.costTotalMinor,

            costQuality:
              posSaleItemCostsTable.costQuality,
          })
          .from(
            posSaleItemCostsTable,
          )
          .where(
            inArray(
              posSaleItemCostsTable.saleItemId,
              saleItemIds,
            ),
          )
      : [];

  const saleCostByItem =
    new Map(
      saleCosts.map(
        (cost) => [
          cost.saleItemId,
          cost,
        ],
      ),
    );

  let posSaleQuantity = 0;
  let posTrackedSaleQuantity = 0;
  let posSaleCoverageComplete =
    true;

  const posQualities:
    string[] = [];

  for (
    const item of saleItems
  ) {
    posSaleQuantity +=
      item.quantity;

    const cost =
      saleCostByItem.get(
        item.id,
      );

    if (
      !cost ||
      cost.quantity !==
        item.quantity
    ) {
      posSaleCoverageComplete =
        false;
      continue;
    }

    posTrackedSaleQuantity +=
      item.quantity;

    posQualities.push(
      cost.costQuality,
    );
  }

  if (
    sales.length > 0 &&
    saleItems.length === 0
  ) {
    posSaleCoverageComplete =
      false;
  }

  // ==========================================================
  // POS RETURNS
  // ==========================================================

  const returns =
    await db
      .select({
        id:
          posSaleReturnsTable.id,

        refundAmountMinor:
          posSaleReturnsTable.refundAmountMinor,
      })
      .from(
        posSaleReturnsTable,
      )
      .where(
        and(
          eq(
            posSaleReturnsTable.status,
            "completed",
          ),
          gte(
            posSaleReturnsTable.businessDate,
            from,
          ),
          lte(
            posSaleReturnsTable.businessDate,
            to,
          ),
        ),
      );

  const returnIds =
    returns.map(
      (entry) => entry.id,
    );

  const returnItems =
    returnIds.length > 0
      ? await db
          .select({
            id:
              posSaleReturnItemsTable.id,

            quantity:
              posSaleReturnItemsTable.quantity,
          })
          .from(
            posSaleReturnItemsTable,
          )
          .where(
            inArray(
              posSaleReturnItemsTable.returnId,
              returnIds,
            ),
          )
      : [];

  const returnItemIds =
    returnItems.map(
      (item) => item.id,
    );

  const returnCosts =
    returnItemIds.length > 0
      ? await db
          .select({
            returnItemId:
              posSaleReturnItemCostsTable.returnItemId,

            quantity:
              posSaleReturnItemCostsTable.quantity,

            costTotalMinor:
              posSaleReturnItemCostsTable.costTotalMinor,

            costQuality:
              posSaleReturnItemCostsTable.costQuality,
          })
          .from(
            posSaleReturnItemCostsTable,
          )
          .where(
            inArray(
              posSaleReturnItemCostsTable.returnItemId,
              returnItemIds,
            ),
          )
      : [];

  const returnCostByItem =
    new Map(
      returnCosts.map(
        (cost) => [
          cost.returnItemId,
          cost,
        ],
      ),
    );

  let posReturnQuantity = 0;
  let posTrackedReturnQuantity =
    0;

  let posReturnCoverageComplete =
    true;

  for (
    const item of returnItems
  ) {
    posReturnQuantity +=
      item.quantity;

    const cost =
      returnCostByItem.get(
        item.id,
      );

    if (
      !cost ||
      cost.quantity !==
        item.quantity
    ) {
      posReturnCoverageComplete =
        false;
      continue;
    }

    posTrackedReturnQuantity +=
      item.quantity;

    posQualities.push(
      cost.costQuality,
    );
  }

  if (
    returns.length > 0 &&
    returnItems.length === 0
  ) {
    posReturnCoverageComplete =
      false;
  }

  const posSaleCogsMinor =
    sum(
      saleCosts.map(
        (cost) =>
          cost.costTotalMinor,
      ),
    );

  const posReturnedCogsMinor =
    sum(
      returnCosts.map(
        (cost) =>
          cost.costTotalMinor,
      ),
    );

  const pos =
    buildChannel({
      documents:
        sales.length,

      returnDocuments:
        returns.length,

      salesMinor:
        sum(
          sales.map(
            (sale) =>
              sale.totalMinor,
          ),
        ),

      returnsMinor:
        sum(
          returns.map(
            (entry) =>
              entry.refundAmountMinor,
          ),
        ),

      cogsKnownMinor:
        posSaleCogsMinor -
        posReturnedCogsMinor,

      saleQuantity:
        posSaleQuantity,

      trackedSaleQuantity:
        posTrackedSaleQuantity,

      returnQuantity:
        posReturnQuantity,

      trackedReturnQuantity:
        posTrackedReturnQuantity,

      costCoverageComplete:
        posSaleCoverageComplete &&
        posReturnCoverageComplete,

      costQualities:
        posQualities,
    });

  // ==========================================================
  // ONLINE ORDERS
  //
  // Date basis:
  // finance transaction businessDate when order becomes "done".
  // This is intentionally NOT order.createdAt.
  // ==========================================================

  const onlineCompletions =
    await db
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
          gte(
            financeTransactionsTable.businessDate,
            from,
          ),
          lte(
            financeTransactionsTable.businessDate,
            to,
          ),
        ),
      );

  const onlineOrderIds =
    [
      ...new Set(
        onlineCompletions
          .map(
            (entry) =>
              Number(
                entry.sourceId,
              ),
          )
          .filter(
            (value) =>
              Number.isSafeInteger(
                value,
              ) &&
              value > 0,
          ),
      ),
    ];

  const onlineOrders =
    onlineOrderIds.length > 0
      ? await db
          .select({
            id:
              ordersTable.id,

            status:
              ordersTable.status,

            items:
              ordersTable.items,

            totalPrice:
              ordersTable.totalPrice,

            shippingCost:
              ordersTable.shippingCost,

            fulfillmentMethod:
              ordersTable.fulfillmentMethod,

            deliveryCompanyCost:
              ordersTable.deliveryCompanyCost,
          })
          .from(
            ordersTable,
          )
          .where(
            and(
              inArray(
                ordersTable.id,
                onlineOrderIds,
              ),
              eq(
                ordersTable.status,
                "done",
              ),
            ),
          )
      : [];

  const currentOnlineOrderIds =
    onlineOrders.map(
      (order) => order.id,
    );

  const onlineCosts =
    currentOnlineOrderIds.length > 0
      ? await db
          .select({
            orderId:
              orderItemCostsTable.orderId,

            lineNumber:
              orderItemCostsTable.lineNumber,

            quantity:
              orderItemCostsTable.quantity,

            costTotalMinor:
              orderItemCostsTable.costTotalMinor,

            costQuality:
              orderItemCostsTable.costQuality,
          })
          .from(
            orderItemCostsTable,
          )
          .where(
            inArray(
              orderItemCostsTable.orderId,
              currentOnlineOrderIds,
            ),
          )
      : [];

  const onlineCostByLine =
    new Map(
      onlineCosts.map(
        (cost) => [
          `${cost.orderId}:${cost.lineNumber}`,
          cost,
        ],
      ),
    );

  let onlineSalesMinor = 0;
  let onlineShippingMinor = 0;
  let onlineDeliveryMinor = 0;

  let onlineSaleQuantity = 0;
  let onlineTrackedSaleQuantity =
    0;

  let onlineCoverageComplete =
    onlineOrderIds.length ===
    onlineOrders.length;

  const onlineQualities:
    string[] = [];

  for (
    const order of onlineOrders
  ) {
    const shippingCost =
      order.shippingCost;

    const deliveryCost =
      order.deliveryCompanyCost;

    if (
      !Number.isSafeInteger(
        order.totalPrice,
      ) ||
      order.totalPrice < 0 ||
      !Number.isSafeInteger(
        shippingCost,
      ) ||
      shippingCost === null ||
      shippingCost < 0 ||
      !Number.isSafeInteger(
        deliveryCost,
      ) ||
      deliveryCost === null ||
      deliveryCost < 0 ||
      shippingCost >
        order.totalPrice
    ) {
      onlineCoverageComplete =
        false;
    } else {
      onlineSalesMinor +=
        (
          order.totalPrice -
          shippingCost
        ) * 100;

      onlineShippingMinor +=
        shippingCost * 100;

      onlineDeliveryMinor +=
        deliveryCost * 100;
    }

    if (
      !Array.isArray(
        order.items,
      )
    ) {
      onlineCoverageComplete =
        false;
      continue;
    }

    const items =
      order.items as Array<{
        quantity?: unknown;
      }>;

    if (
      items.length === 0
    ) {
      onlineCoverageComplete =
        false;
      continue;
    }

    items.forEach(
      (item, index) => {
        const quantity =
          Number(
            item.quantity,
          );

        if (
          !Number.isSafeInteger(
            quantity,
          ) ||
          quantity <= 0
        ) {
          onlineCoverageComplete =
            false;
          return;
        }

        onlineSaleQuantity +=
          quantity;

        const cost =
          onlineCostByLine.get(
            `${order.id}:${index + 1}`,
          );

        if (
          !cost ||
          cost.quantity !==
            quantity
        ) {
          onlineCoverageComplete =
            false;
          return;
        }

        onlineTrackedSaleQuantity +=
          quantity;

        onlineQualities.push(
          cost.costQuality,
        );
      },
    );
  }

  const online =
    buildChannel({
      documents:
        onlineOrders.length,

      salesMinor:
        onlineSalesMinor,

      cogsKnownMinor:
        sum(
          onlineCosts.map(
            (cost) =>
              cost.costTotalMinor,
          ),
        ),

      shippingChargedMinor:
        onlineShippingMinor,

      deliveryCompanyCostMinor:
        onlineDeliveryMinor,

      saleQuantity:
        onlineSaleQuantity,

      trackedSaleQuantity:
        onlineTrackedSaleQuantity,

      costCoverageComplete:
        onlineCoverageComplete,

      costQualities:
        onlineQualities,
    });

  // ==========================================================
  // COMBINED
  // ==========================================================

  const totalCostQuantity =
    pos.saleQuantity +
    pos.returnQuantity +
    online.saleQuantity;

  const totalTrackedQuantity =
    pos.trackedSaleQuantity +
    pos.trackedReturnQuantity +
    online.trackedSaleQuantity;

  const totalCoverageComplete =
    pos.costCoverageComplete &&
    online.costCoverageComplete;

  const totalNetSalesMinor =
    pos.netSalesMinor +
    online.netSalesMinor;

  const totalCogsMinor =
    pos.cogsKnownMinor +
    online.cogsKnownMinor;

  const totalGrossProfitMinor =
    totalCoverageComplete
      ? totalNetSalesMinor -
        totalCogsMinor
      : null;

  const totalDeliveryImpact =
    online.deliveryImpactMinor;

  const total: ChannelSummary = {
    documents:
      pos.documents +
      online.documents,

    returnDocuments:
      pos.returnDocuments,

    salesMinor:
      pos.salesMinor +
      online.salesMinor,

    returnsMinor:
      pos.returnsMinor,

    netSalesMinor:
      totalNetSalesMinor,

    cogsKnownMinor:
      totalCogsMinor,

    grossProfitMinor:
      totalGrossProfitMinor,

    grossMarginPercent:
      totalGrossProfitMinor !==
        null &&
      totalNetSalesMinor > 0
        ? Math.round(
            (
              totalGrossProfitMinor /
              totalNetSalesMinor
            ) *
              10000,
          ) / 100
        : null,

    shippingChargedMinor:
      online.shippingChargedMinor,

    deliveryCompanyCostMinor:
      online.deliveryCompanyCostMinor,

    deliveryImpactMinor:
      totalDeliveryImpact,

    profitAfterDeliveryMinor:
      totalGrossProfitMinor ===
      null
        ? null
        : totalGrossProfitMinor +
          totalDeliveryImpact,

    saleQuantity:
      pos.saleQuantity +
      online.saleQuantity,

    trackedSaleQuantity:
      pos.trackedSaleQuantity +
      online.trackedSaleQuantity,

    returnQuantity:
      pos.returnQuantity,

    trackedReturnQuantity:
      pos.trackedReturnQuantity,

    costCoveragePercent:
      coveragePercent(
        totalTrackedQuantity,
        totalCostQuantity,
      ),

    costCoverageComplete:
      totalCoverageComplete,

    costQuality:
      summarizeQuality(
        [
          ...posQualities,
          ...onlineQualities,
        ],
        totalCostQuantity,
        totalCoverageComplete,
      ),
  };

  const warnings: string[] =
    [];

  if (
    !pos.costCoverageComplete
  ) {
    warnings.push(
      "بعض مبيعات أو مردودات POS في الفترة لا تحتوي تكلفة تاريخية مكتملة، لذلك مجمل الربح لا يُعرض كرقم نهائي.",
    );
  }

  if (
    !online.costCoverageComplete
  ) {
    warnings.push(
      "بعض الطلبات الإلكترونية المكتملة لا تحتوي تكلفة أو بيانات توصيل مكتملة، لذلك مجمل الربح لا يُعرض كرقم نهائي.",
    );
  }

  const orphanedOnlineCompletions =
    Math.max(
      0,
      onlineOrderIds.length -
        onlineOrders.length,
    );

  if (
    orphanedOnlineCompletions >
    0
  ) {
    warnings.push(
      `يوجد ${orphanedOnlineCompletions} قيد إكمال إلكتروني ضمن الفترة بدون سجل طلب حالي.`,
    );
  }

  if (
    total.costQuality ===
      "mixed"
  ) {
    warnings.push(
      "يتضمن التقرير تكاليف تقديرية أو مختلطة بالإضافة إلى التكاليف المؤكدة.",
    );
  }

  return json({
    range: {
      from,
      to,
    },

    generatedAt:
      new Date().toISOString(),

    channels: {
      total,
      pos,
      online,
    },

    warnings,

    methodology: {
      posDateBasis:
        "POS business date",

      onlineDateBasis:
        "Finance business date when web order becomes done",

      profitDefinition:
        "Gross profit before operating expenses",

      deliveryDefinition:
        "Customer shipping charge minus actual delivery company cost",

      expensesIncluded:
        false,
    },
  });
}

export async function handleOwnerReportRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const url =
    new URL(request.url);

  if (
    request.method === "GET" &&
    url.pathname ===
      "/api/owner/reports/gross-profit"
  ) {
    return handleGrossProfit(
      request,
      db,
      env,
    );
  }

  return null;
}
