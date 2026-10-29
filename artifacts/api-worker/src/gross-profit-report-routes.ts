import {
  exchangeDocumentsTable,
  exchangeReturnItemCostsTable,
  exchangeReturnItemsTable,
  exchangeSaleItemCostsTable,
  exchangeSaleItemsTable,
  financeTransactionsTable,
  orderItemCostsTable,
  ordersTable,
  posSaleItemCostsTable,
  posSaleItemsTable,
  posSaleReturnItemCostsTable,
  posSaleReturnItemsTable,
  posSaleReturnsTable,
  posSalesTable,
  productCostStateTable,
  productsTable,
} from "@workspace/db/schema";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
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
  exchangeDocuments: number;

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
  exchangeDocuments?: number;

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

    exchangeDocuments:
      input.exchangeDocuments ?? 0,

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

  type MissingCostChannel =
    | "pos"
    | "exchange"
    | "online";

  const missingCostByProduct =
    new Map<
      number,
      {
        soldQuantity: number;
        channels: Set<MissingCostChannel>;
      }
    >();

  let unresolvedMissingCostLines = 0;

  const addMissingSoldCost = (
    productId: number | null,
    quantity: number,
    channel: MissingCostChannel,
  ) => {
    if (
      productId === null ||
      !Number.isSafeInteger(productId) ||
      productId <= 0
    ) {
      unresolvedMissingCostLines += 1;
      return;
    }

    const current =
      missingCostByProduct.get(productId) ?? {
        soldQuantity: 0,
        channels: new Set<MissingCostChannel>(),
      };

    current.soldQuantity += quantity;
    current.channels.add(channel);

    missingCostByProduct.set(
      productId,
      current,
    );
  };

  // Journal-backed owner confirmations change report quality only:
  // original sale/return snapshots and monetary values remain immutable.
  // A new unverified return makes product state mixed and disables the
  // qualification until the owner reviews all outstanding sources again.
  const attestationRows = await db.select({
    productId: productCostLedgerTable.productId,
  }).from(productCostLedgerTable)
    .where(eq(productCostLedgerTable.sourceType, "owner_cost_quality_attestation"))
    .limit(5000);
  const attestedIds = [...new Set(attestationRows.map((row) => row.productId))];
  const attestedStates = attestedIds.length > 0
    ? await db.select({
        productId: productCostStateTable.productId,
        referenceCost: productCostStateTable.referenceUnitCostMinor,
      }).from(productCostStateTable)
        .where(and(inArray(productCostStateTable.productId, attestedIds),
          eq(productCostStateTable.costQuality, "confirmed")))
    : [];
  const attestedCost = new Map(attestedStates.map((row) =>
    [row.productId, row.referenceCost] as const));
  const verifiedQuality = (
    productId: number | null,
    quantity: number,
    totalMinor: number,
    originalQuality: string,
  ): string => {
    if (productId === null || originalQuality === "confirmed") return originalQuality;
    const cost = attestedCost.get(productId);
    if (cost === undefined || !Number.isSafeInteger(quantity) || quantity <= 0 ||
        BigInt(quantity) * BigInt(cost) !== BigInt(totalMinor)) {
      return originalQuality;
    }
    return "confirmed";
  };

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
            productId:
              posSaleItemsTable.productId,
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

      if (!cost) {
        addMissingSoldCost(
          item.productId,
          item.quantity,
          "pos",
        );
      }

      continue;
    }

    posTrackedSaleQuantity +=
      item.quantity;

    posQualities.push(
      verifiedQuality(item.productId, item.quantity, cost.costTotalMinor, cost.costQuality),
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

            productId:
              posSaleReturnItemsTable.productId,

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
      verifiedQuality(item.productId, item.quantity, cost.costTotalMinor, cost.costQuality),
    );
  }

  if (
    returns.length > 0 &&
    returnItems.length === 0
  ) {
    posReturnCoverageComplete =
      false;
  }

  // ==========================================================
  // POS EXCHANGES
  //
  // An exchange is economically a return plus a new sale.
  // It must affect both revenue and COGS; otherwise the cash
  // difference can appear in the drawer while gross profit
  // ignores the underlying merchandise movement.
  // ==========================================================

  const posExchanges =
    await db
      .select({
        id:
          exchangeDocumentsTable.id,
        returnNetMinor:
          exchangeDocumentsTable.returnNetMinor,
        newNetMinor:
          exchangeDocumentsTable.newNetMinor,
      })
      .from(
        exchangeDocumentsTable,
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
          gte(
            exchangeDocumentsTable.businessDate,
            from,
          ),
          lte(
            exchangeDocumentsTable.businessDate,
            to,
          ),
        ),
      );

  const posExchangeIds =
    posExchanges.map(
      (exchange) =>
        exchange.id,
    );

  const [
    exchangeReturnItems,
    exchangeSaleItems,
  ] =
    posExchangeIds.length > 0
      ? await Promise.all([
          db
            .select({
              id:
                exchangeReturnItemsTable.id,
              productId:
                exchangeReturnItemsTable.productId,
              quantity:
                exchangeReturnItemsTable.quantity,
            })
            .from(
              exchangeReturnItemsTable,
            )
            .where(
              inArray(
                exchangeReturnItemsTable.exchangeId,
                posExchangeIds,
              ),
            ),

          db
            .select({
              id:
                exchangeSaleItemsTable.id,
              productId:
                exchangeSaleItemsTable.productId,
              quantity:
                exchangeSaleItemsTable.quantity,
            })
            .from(
              exchangeSaleItemsTable,
            )
            .where(
              inArray(
                exchangeSaleItemsTable.exchangeId,
                posExchangeIds,
              ),
            ),
        ])
      : [[], []];

  const exchangeReturnItemIds =
    exchangeReturnItems.map(
      (item) => item.id,
    );

  const exchangeSaleItemIds =
    exchangeSaleItems.map(
      (item) => item.id,
    );

  const [
    exchangeReturnCosts,
    exchangeSaleCosts,
  ] =
    await Promise.all([
      exchangeReturnItemIds.length > 0
        ? db
            .select({
              returnItemId:
                exchangeReturnItemCostsTable.returnItemId,
              quantity:
                exchangeReturnItemCostsTable.quantity,
              costTotalMinor:
                exchangeReturnItemCostsTable.costTotalMinor,
              costQuality:
                exchangeReturnItemCostsTable.costQuality,
            })
            .from(
              exchangeReturnItemCostsTable,
            )
            .where(
              inArray(
                exchangeReturnItemCostsTable.returnItemId,
                exchangeReturnItemIds,
              ),
            )
        : Promise.resolve([]),

      exchangeSaleItemIds.length > 0
        ? db
            .select({
              saleItemId:
                exchangeSaleItemCostsTable.saleItemId,
              quantity:
                exchangeSaleItemCostsTable.quantity,
              costTotalMinor:
                exchangeSaleItemCostsTable.costTotalMinor,
              costQuality:
                exchangeSaleItemCostsTable.costQuality,
            })
            .from(
              exchangeSaleItemCostsTable,
            )
            .where(
              inArray(
                exchangeSaleItemCostsTable.saleItemId,
                exchangeSaleItemIds,
              ),
            )
        : Promise.resolve([]),
    ]);

  const exchangeReturnCostByItem =
    new Map(
      exchangeReturnCosts.map(
        (cost) => [
          cost.returnItemId,
          cost,
        ],
      ),
    );

  const exchangeSaleCostByItem =
    new Map(
      exchangeSaleCosts.map(
        (cost) => [
          cost.saleItemId,
          cost,
        ],
      ),
    );

  let exchangeReturnQuantity = 0;
  let exchangeTrackedReturnQuantity =
    0;
  let exchangeSaleQuantity = 0;
  let exchangeTrackedSaleQuantity =
    0;
  let exchangeCoverageComplete =
    true;

  const exchangeQualities:
    string[] = [];

  for (
    const item of
    exchangeReturnItems
  ) {
    exchangeReturnQuantity +=
      item.quantity;

    const cost =
      exchangeReturnCostByItem.get(
        item.id,
      );

    if (
      !cost ||
      cost.quantity !==
        item.quantity
    ) {
      exchangeCoverageComplete =
        false;
      continue;
    }

    exchangeTrackedReturnQuantity +=
      item.quantity;

    exchangeQualities.push(
      verifiedQuality(item.productId, item.quantity, cost.costTotalMinor, cost.costQuality),
    );
  }

  for (
    const item of
    exchangeSaleItems
  ) {
    exchangeSaleQuantity +=
      item.quantity;

    const cost =
      exchangeSaleCostByItem.get(
        item.id,
      );

    if (
      !cost ||
      cost.quantity !==
        item.quantity
    ) {
      exchangeCoverageComplete =
        false;

      if (!cost) {
        addMissingSoldCost(
          item.productId,
          item.quantity,
          "exchange",
        );
      }

      continue;
    }

    exchangeTrackedSaleQuantity +=
      item.quantity;

    exchangeQualities.push(
      verifiedQuality(item.productId, item.quantity, cost.costTotalMinor, cost.costQuality),
    );
  }

  if (
    posExchanges.length > 0 &&
    (
      exchangeReturnItems.length ===
        0 ||
      exchangeSaleItems.length ===
        0
    )
  ) {
    exchangeCoverageComplete =
      false;
  }

  const exchangeReturnedCogsMinor =
    sum(
      exchangeReturnCosts.map(
        (cost) =>
          cost.costTotalMinor,
      ),
    );

  const exchangeSaleCogsMinor =
    sum(
      exchangeSaleCosts.map(
        (cost) =>
          cost.costTotalMinor,
      ),
    );

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

      exchangeDocuments:
        posExchanges.length,

      salesMinor:
        sum(
          sales.map(
            (sale) =>
              sale.totalMinor,
          ),
        ) +
        sum(
          posExchanges.map(
            (exchange) =>
              exchange.newNetMinor,
          ),
        ),

      returnsMinor:
        sum(
          returns.map(
            (entry) =>
              entry.refundAmountMinor,
          ),
        ) +
        sum(
          posExchanges.map(
            (exchange) =>
              exchange.returnNetMinor,
          ),
        ),

      cogsKnownMinor:
        posSaleCogsMinor -
        posReturnedCogsMinor +
        exchangeSaleCogsMinor -
        exchangeReturnedCogsMinor,

      saleQuantity:
        posSaleQuantity +
        exchangeSaleQuantity,

      trackedSaleQuantity:
        posTrackedSaleQuantity +
        exchangeTrackedSaleQuantity,

      returnQuantity:
        posReturnQuantity +
        exchangeReturnQuantity,

      trackedReturnQuantity:
        posTrackedReturnQuantity +
        exchangeTrackedReturnQuantity,

      costCoverageComplete:
        posSaleCoverageComplete &&
        posReturnCoverageComplete &&
        exchangeCoverageComplete,

      costQualities: [
        ...posQualities,
        ...exchangeQualities,
      ],
    });

  // ==========================================================
  // ONLINE ORDERS
  //
  // Date basis:
  // finance transaction businessDate when order becomes "done".
  // This is intentionally NOT order.createdAt.
  // ==========================================================

  // A cancelled local-courier order still has its original posted "done"
  // journal. If its exact sale reversal is posted in this report period,
  // both entries net to zero: do not treat the cancellation as a missing
  // current order or suppress the gross profit for unrelated sales.
  // Reversals outside the selected period are deliberately not netted here;
  // cross-period return recognition needs separate accounting treatment.
  const onlineFinanceEvents =
    await db
      .select({
        sourceId:
          financeTransactionsTable.sourceId,

        sourceEvent:
          financeTransactionsTable.sourceEvent,

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
          inArray(
            financeTransactionsTable.sourceEvent,
            ["done", "local_courier_reverse_sale"],
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

  const reversedOnlineSaleIds =
    new Set(
      onlineFinanceEvents
        .filter(
          (entry) =>
            entry.sourceEvent === "local_courier_reverse_sale",
        )
        .map((entry) => entry.sourceId),
    );

  const onlineCompletions =
    onlineFinanceEvents.filter(
      (entry) =>
        entry.sourceEvent === "done" &&
        !reversedOnlineSaleIds.has(entry.sourceId),
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
        id?: unknown;
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

          if (!cost) {
            const productId =
              Number(item.id);

            addMissingSoldCost(
              Number.isSafeInteger(productId) &&
                productId > 0
                ? productId
                : null,
              quantity,
              "online",
            );
          }

          return;
        }

        onlineTrackedSaleQuantity +=
          quantity;

        onlineQualities.push(
          verifiedQuality(Number(item.id) || null, quantity, cost.costTotalMinor, cost.costQuality),
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

    exchangeDocuments:
      pos.exchangeDocuments +
      online.exchangeDocuments,

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


  // Read-only provenance evidence. Historical snapshots stay frozen, and
  // barcode matches are *candidates*, never automatically linked receipts.
  const mixedQuantityByProduct = new Map<number, number>();
  const noteMixed = (productId: number | null | undefined, quantity: number) => {
    if (typeof productId !== "number" || !Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0) return;
    mixedQuantityByProduct.set(productId, (mixedQuantityByProduct.get(productId) ?? 0) + quantity);
  };
  for (const item of saleItems) {
    if (saleCostByItem.get(item.id)?.costQuality === "mixed") noteMixed(item.productId, item.quantity);
  }
  for (const item of exchangeSaleItems) {
    if (exchangeSaleCostByItem.get(item.id)?.costQuality === "mixed") noteMixed(item.productId, item.quantity);
  }
  for (const order of onlineOrders) {
    if (!Array.isArray(order.items)) continue;
    for (const [index, entry] of order.items.entries()) {
      if (onlineCostByLine.get(`${order.id}:${index + 1}`)?.costQuality !== "mixed") continue;
      const item = entry as { id?: unknown; quantity?: unknown };
      noteMixed(Number(item.id), Number(item.quantity));
    }
  }

  const reviewIds = [...mixedQuantityByProduct.keys()].sort((a, b) => a - b).slice(0, 12);
  const [reviewProducts, exchangeSources, mobileSources, candidateSales] =
    reviewIds.length === 0
      ? [[], [], [], []] as const
      : await Promise.all([
          db.select({ id: productsTable.id, nameAr: productsTable.nameAr,
            productCode: productsTable.productCode,
            currentCostQuality: productCostStateTable.costQuality })
            .from(productsTable)
            .leftJoin(productCostStateTable, eq(productCostStateTable.productId, productsTable.id))
            .where(inArray(productsTable.id, reviewIds)),
          db.select({ productId: exchangeReturnItemsTable.productId,
            publicId: exchangeDocumentsTable.publicId, date: exchangeDocumentsTable.businessDate,
            barcode: exchangeReturnItemsTable.barcode, color: exchangeReturnItemsTable.color,
            size: exchangeReturnItemsTable.size, quantity: exchangeReturnItemsTable.quantity,
            priceMinor: exchangeReturnItemsTable.soldUnitPriceMinor,
            costMinor: exchangeReturnItemCostsTable.costTotalMinor })
            .from(exchangeReturnItemCostsTable)
            .innerJoin(exchangeReturnItemsTable, eq(exchangeReturnItemCostsTable.returnItemId, exchangeReturnItemsTable.id))
            .innerJoin(exchangeDocumentsTable, eq(exchangeReturnItemsTable.exchangeId, exchangeDocumentsTable.id))
            .where(and(inArray(exchangeReturnItemCostsTable.productId, reviewIds),
              eq(exchangeReturnItemCostsTable.costQuality, "estimated"),
              eq(exchangeDocumentsTable.status, "completed"))).limit(120),
          db.select({ productId: posSaleReturnItemsTable.productId,
            publicId: posSaleReturnsTable.publicId, date: posSaleReturnsTable.businessDate,
            barcode: posSaleReturnItemsTable.barcode, color: posSaleReturnItemsTable.color,
            size: posSaleReturnItemsTable.size, quantity: posSaleReturnItemsTable.quantity,
            priceMinor: posSaleReturnItemsTable.soldUnitPriceMinor,
            costMinor: posSaleReturnItemCostsTable.costTotalMinor })
            .from(posSaleReturnItemCostsTable)
            .innerJoin(posSaleReturnItemsTable, eq(posSaleReturnItemCostsTable.returnItemId, posSaleReturnItemsTable.id))
            .innerJoin(posSaleReturnsTable, eq(posSaleReturnItemsTable.returnId, posSaleReturnsTable.id))
            .where(and(inArray(posSaleReturnItemCostsTable.productId, reviewIds),
              eq(posSaleReturnItemCostsTable.costQuality, "estimated"),
              eq(posSaleReturnsTable.status, "completed"),
              isNull(posSaleReturnItemsTable.originalSaleItemId))).limit(120),
          db.select({ productId: posSaleItemsTable.productId, barcode: posSaleItemsTable.barcode,
            publicId: posSalesTable.publicId, date: posSalesTable.businessDate,
            quantity: posSaleItemsTable.quantity, priceMinor: posSaleItemsTable.soldUnitPriceMinor,
            costMinor: posSaleItemCostsTable.unitCostMinor, costQuality: posSaleItemCostsTable.costQuality })
            .from(posSaleItemsTable)
            .innerJoin(posSalesTable, eq(posSaleItemsTable.saleId, posSalesTable.id))
            .leftJoin(posSaleItemCostsTable, eq(posSaleItemsTable.id, posSaleItemCostsTable.saleItemId))
            .where(and(inArray(posSaleItemsTable.productId, reviewIds),
              eq(posSalesTable.status, "completed")))
            .orderBy(asc(posSalesTable.businessDate)).limit(2000),
        ]);
  const sources = [
    ...exchangeSources.map((source) => ({ ...source, kind: "exchange" as const })),
    ...mobileSources.map((source) => ({ ...source, kind: "return" as const })),
  ];
  const mixedCostReview = reviewProducts.map((product) => ({
    productId: String(product.id),
    productCode: product.productCode,
    nameAr: product.nameAr,
    soldMixedQuantity: mixedQuantityByProduct.get(product.id) ?? 0,
    currentCostQuality: product.currentCostQuality,
    sources: sources.filter((source) => source.productId === product.id).map((source) => ({
      kind: source.kind, publicId: source.publicId, date: source.date,
      barcode: source.barcode, color: source.color, size: source.size,
      quantity: source.quantity, priceMinor: source.priceMinor, costMinor: source.costMinor,
      candidates: candidateSales.filter((sale) =>
        sale.productId === product.id && sale.barcode !== null &&
        source.barcode !== null && sale.barcode === source.barcode &&
        sale.date <= source.date && sale.quantity >= source.quantity
      ).slice(0, 8).map((sale) => ({
        publicId: sale.publicId, date: sale.date, priceMinor: sale.priceMinor,
        costMinor: sale.costMinor, costQuality: sale.costQuality,
        priceMatches: sale.priceMinor === source.priceMinor,
      })),
    })),
  }));

  const missingCostProductIds =
    [...missingCostByProduct.keys()];

  const missingCostProductRows =
    missingCostProductIds.length > 0
      ? await db
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
            deletedAt:
              productsTable.deletedAt,
            costProductId:
              productCostStateTable.productId,
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
            inArray(
              productsTable.id,
              missingCostProductIds,
            ),
          )
      : [];

  const missingCostProducts =
    missingCostProductRows
      .flatMap((product) => {
        const aggregate =
          missingCostByProduct.get(
            product.id,
          );

        if (!aggregate) {
          return [];
        }

        return [
          {
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
            soldQuantity:
              aggregate.soldQuantity,
            channels:
              [...aggregate.channels],
            canSetOpeningCost:
              product.costProductId ===
                null &&
              product.deletedAt ===
                null,
          },
        ];
      })
      .sort(
        (left, right) =>
          right.soldQuantity -
            left.soldQuantity ||
          Number(left.productId) -
            Number(right.productId),
      );

  const warnings: string[] =
    [];

  if (
    !pos.costCoverageComplete
  ) {
    warnings.push(
      "بعض مبيعات أو مردودات أو تبديلات POS في الفترة لا تحتوي تكلفة تاريخية مكتملة، لذلك مجمل الربح لا يُعرض كرقم نهائي.",
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

    missingCostProducts,
    unresolvedMissingCostLines,
    mixedCostReview,
    mixedCostReviewTruncated: mixedQuantityByProduct.size > reviewIds.length,

    methodology: {
      posDateBasis:
        "POS sale/return/exchange business date",

      onlineDateBasis:
        "Finance business date when web order becomes done",

      profitDefinition:
        "Gross profit before operating expenses; POS exchanges are treated as a return plus a new sale with their historical item costs",

      deliveryDefinition:
        "Customer shipping charge minus actual delivery company cost",

      expensesIncluded:
        false,

      verifiedOwnerAttestations:
        attestedStates.length,
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
