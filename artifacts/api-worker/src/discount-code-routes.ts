import {
  appSettingsTable,
  discountCodesTable,
  orderItemCostsTable,
  ordersTable,
} from "@workspace/db/schema";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
} from "drizzle-orm";

import {
  getCurrentUser,
} from "./auth";
import type {
  Env,
  openDb,
} from "./db";
import {
  discountCodesEnabled,
  findActiveDiscountCode,
  normalizeDiscountCode,
} from "./discount-code-service";

type Db = Awaited<
  ReturnType<typeof openDb>
>["db"];

const headers = {
  "Content-Type":
    "application/json",
  "Access-Control-Allow-Origin":
    "*",
};

const json = (
  data: unknown,
  status = 200,
) =>
  new Response(
    JSON.stringify(data),
    {
      status,
      headers,
    },
  );

async function requireAdmin(
  request: Request,
  db: Db,
  env: Env,
) {
  const user =
    await getCurrentUser(
      db,
      request,
      env,
    );

  if (!user) {
    return {
      ok: false as const,
      response: json(
        {
          error:
            "يجب تسجيل الدخول",
        },
        401,
      ),
    };
  }

  if (!user.isAdmin) {
    return {
      ok: false as const,
      response: json(
        {
          error:
            "غير مصرح",
        },
        403,
      ),
    };
  }

  return {
    ok: true as const,
    user,
  };
}

function parseDateOnly(
  value: unknown,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    return undefined;
  }

  const [
    year,
    month,
    day,
  ] =
    value
      .split("-")
      .map(Number);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
      ),
    );

  if (
    date.getUTCFullYear() !==
      year ||
    date.getUTCMonth() !==
      month - 1 ||
    date.getUTCDate() !==
      day
  ) {
    return undefined;
  }

  return value;
}

function parseCodeInput(
  raw: unknown,
) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return {
      ok: false as const,
      error:
        "بيانات كود الخصم غير صالحة",
    };
  }

  const body =
    raw as Record<
      string,
      unknown
    >;

  const campaignName =
    typeof body.campaignName ===
      "string"
      ? body.campaignName
          .trim()
      : "";

  const code =
    typeof body.code ===
      "string"
      ? body.code.trim()
      : "";

  const normalizedCode =
    normalizeDiscountCode(
      code,
    );

  const percent =
    Number(
      body.discountPercent,
    );

  const startDate =
    parseDateOnly(
      body.startDate,
    );

  const endDate =
    parseDateOnly(
      body.endDate,
    );

  if (
    !campaignName ||
    campaignName.length > 100
  ) {
    return {
      ok: false as const,
      error:
        "اسم الحملة مطلوب وبحد أقصى 100 حرف",
    };
  }

  if (
    !/^[A-Z0-9_-]{3,40}$/.test(
      normalizedCode,
    )
  ) {
    return {
      ok: false as const,
      error:
        "الكود يجب أن يكون من 3 إلى 40 حرفًا أو رقمًا ويمكن استخدام - و _",
    };
  }

  if (
    !Number.isSafeInteger(
      percent,
    ) ||
    percent < 1 ||
    percent > 100
  ) {
    return {
      ok: false as const,
      error:
        "نسبة الخصم يجب أن تكون رقمًا صحيحًا من 1 إلى 100",
    };
  }

  if (
    startDate === undefined ||
    endDate === undefined
  ) {
    return {
      ok: false as const,
      error:
        "تاريخ بداية أو نهاية الكود غير صالح",
    };
  }

  if (
    startDate &&
    endDate &&
    endDate < startDate
  ) {
    return {
      ok: false as const,
      error:
        "تاريخ نهاية الكود يجب ألا يسبق تاريخ البداية",
    };
  }

  return {
    ok: true as const,
    data: {
      campaignName,
      code:
        normalizedCode,
      normalizedCode,
      discountPercent:
        percent,
      isActive:
        body.isActive !==
        false,
      stackWithShippingPromotion:
        body.stackWithShippingPromotion ===
        true,
      startDate,
      endDate,
    },
  };
}

async function handleValidate(
  request: Request,
  db: Db,
) {
  const body =
    await request
      .json()
      .catch(
        () => null,
      ) as
        | {
            code?: unknown;
          }
        | null;

  const rawCode =
    typeof body?.code ===
      "string"
      ? body.code
      : "";

  if (!rawCode.trim()) {
    return json({
      valid: false,
      error:
        "أدخل كود الخصم",
    });
  }

  const settingsRows =
    await db
      .select({
        data:
          appSettingsTable.data,
      })
      .from(
        appSettingsTable,
      )
      .where(
        eq(
          appSettingsTable.id,
          1,
        ),
      )
      .limit(1);

  const settingsData =
    settingsRows[0]?.data;

  if (
    !discountCodesEnabled(
      settingsData,
    )
  ) {
    return json({
      valid: false,
      error:
        "أكواد الخصم غير مفعلة حاليًا",
    });
  }

  const code =
    await findActiveDiscountCode(
      db,
      settingsData,
      rawCode,
    );

  if (!code) {
    return json({
      valid: false,
      error:
        "كود الخصم غير صالح أو غير فعال",
    });
  }

  return json({
    valid: true,
    code: code.code,
    campaignName:
      code.campaignName,
    discountPercent:
      code.discountPercent,
    stackWithShippingPromotion:
      code.stackWithShippingPromotion,
  });
}

async function handleList(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requireAdmin(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const canSeeProfit =
    auth.user.isOwner === true;

  const rows =
    await db
      .select()
      .from(
        discountCodesTable,
      )
      .orderBy(
        desc(
          discountCodesTable.createdAt,
        ),
      );

  const orderRows =
    await db
      .select({
        id:
          ordersTable.id,
        discountCodeId:
          ordersTable.discountCodeId,
        status:
          ordersTable.status,
        totalPrice:
          ordersTable.totalPrice,
        shippingCost:
          ordersTable.shippingCost,
        deliveryCompanyCost:
          ordersTable.deliveryCompanyCost,
        discountCodeAmount:
          ordersTable.discountCodeAmount,
        items:
          ordersTable.items,
      })
      .from(
        ordersTable,
      )
      .where(
        isNotNull(
          ordersTable.discountCodeId,
        ),
      );

  const orderIds =
    orderRows.map(
      (order) =>
        order.id,
    );

  const costRows =
    canSeeProfit &&
    orderIds.length > 0
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
              orderIds,
            ),
          )
      : [];

  const costsByOrder =
    new Map<
      number,
      typeof costRows
    >();

  for (const cost of costRows) {
    const list =
      costsByOrder.get(
        cost.orderId,
      ) ?? [];

    list.push(cost);

    costsByOrder.set(
      cost.orderId,
      list,
    );
  }

  type Stats = {
    usageCount: number;
    activeOrdersCount: number;
    completedOrdersCount: number;
    cancelledOrdersCount: number;

    activeOrderValue: number;
    completedOrderValue: number;

    activeProductsNetSales: number;
    completedProductsNetSales: number;

    totalDiscountAmount: number;
    completedDiscountAmount: number;

    completedShippingCharged: number;
    completedDeliveryCost: number;

    completedCogsKnownMinor: number;
    completedSaleQuantity: number;
    completedTrackedQuantity: number;
    completedCostCoverageComplete: boolean;
    completedCostQualities: string[];
  };

  const statsByCode =
    new Map<
      number,
      Stats
    >();

  function getStats(
    codeId: number,
  ) {
    const current =
      statsByCode.get(
        codeId,
      );

    if (current) {
      return current;
    }

    const initial: Stats = {
      usageCount: 0,
      activeOrdersCount: 0,
      completedOrdersCount: 0,
      cancelledOrdersCount: 0,

      activeOrderValue: 0,
      completedOrderValue: 0,

      activeProductsNetSales: 0,
      completedProductsNetSales: 0,

      totalDiscountAmount: 0,
      completedDiscountAmount: 0,

      completedShippingCharged: 0,
      completedDeliveryCost: 0,

      completedCogsKnownMinor: 0,
      completedSaleQuantity: 0,
      completedTrackedQuantity: 0,
      completedCostCoverageComplete: true,
      completedCostQualities: [],
    };

    statsByCode.set(
      codeId,
      initial,
    );

    return initial;
  }

  for (const order of orderRows) {
    const codeId =
      order.discountCodeId;

    if (
      codeId === null
    ) {
      continue;
    }

    const stats =
      getStats(
        codeId,
      );

    stats.usageCount += 1;

    if (
      order.status ===
        "cancelled"
    ) {
      stats.cancelledOrdersCount +=
        1;
      continue;
    }

    stats.activeOrdersCount +=
      1;

    if (
      Number.isSafeInteger(
        order.totalPrice,
      ) &&
      order.totalPrice >= 0
    ) {
      stats.activeOrderValue +=
        order.totalPrice;
    }

    const shippingCost =
      order.shippingCost ?? 0;

    if (
      Number.isSafeInteger(
        shippingCost,
      ) &&
      shippingCost >= 0 &&
      shippingCost <=
        order.totalPrice
    ) {
      stats.activeProductsNetSales +=
        order.totalPrice -
        shippingCost;
    }

    if (
      Number.isSafeInteger(
        order.discountCodeAmount,
      ) &&
      order.discountCodeAmount !==
        null &&
      order.discountCodeAmount >= 0
    ) {
      stats.totalDiscountAmount +=
        order.discountCodeAmount;
    }

    if (
      order.status !==
        "done"
    ) {
      continue;
    }

    stats.completedOrdersCount +=
      1;

    if (
      Number.isSafeInteger(
        order.totalPrice,
      ) &&
      order.totalPrice >= 0
    ) {
      stats.completedOrderValue +=
        order.totalPrice;
    } else {
      stats.completedCostCoverageComplete =
        false;
    }

    if (
      Number.isSafeInteger(
        shippingCost,
      ) &&
      shippingCost >= 0 &&
      shippingCost <=
        order.totalPrice
    ) {
      stats.completedProductsNetSales +=
        order.totalPrice -
        shippingCost;

      stats.completedShippingCharged +=
        shippingCost;
    } else {
      stats.completedCostCoverageComplete =
        false;
    }

    if (
      Number.isSafeInteger(
        order.discountCodeAmount,
      ) &&
      order.discountCodeAmount !==
        null &&
      order.discountCodeAmount >= 0
    ) {
      stats.completedDiscountAmount +=
        order.discountCodeAmount;
    }

    const deliveryCost =
      order.deliveryCompanyCost;

    if (
      Number.isSafeInteger(
        deliveryCost,
      ) &&
      deliveryCost !== null &&
      deliveryCost >= 0
    ) {
      stats.completedDeliveryCost +=
        deliveryCost;
    } else {
      stats.completedCostCoverageComplete =
        false;
    }

    if (
      !Array.isArray(
        order.items,
      )
    ) {
      stats.completedCostCoverageComplete =
        false;
      continue;
    }

    const items =
      order.items as Array<{
        quantity?: unknown;
      }>;

    const orderCosts =
      costsByOrder.get(
        order.id,
      ) ?? [];

    const costByLine =
      new Map(
        orderCosts.map(
          (cost) => [
            cost.lineNumber,
            cost,
          ],
        ),
      );

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
          stats.completedCostCoverageComplete =
            false;
          return;
        }

        stats.completedSaleQuantity +=
          quantity;

        const cost =
          costByLine.get(
            index + 1,
          );

        if (
          !cost ||
          cost.quantity !==
            quantity
        ) {
          stats.completedCostCoverageComplete =
            false;
          return;
        }

        stats.completedTrackedQuantity +=
          quantity;

        stats.completedCogsKnownMinor +=
          cost.costTotalMinor;

        stats.completedCostQualities.push(
          cost.costQuality,
        );
      },
    );
  }

  return json(
    rows.map(
      (row) => {
        const stats =
          statsByCode.get(
            row.id,
          ) ?? {
            usageCount: 0,
            activeOrdersCount: 0,
            completedOrdersCount: 0,
            cancelledOrdersCount: 0,
            activeOrderValue: 0,
            completedOrderValue: 0,
            activeProductsNetSales: 0,
            completedProductsNetSales: 0,
            totalDiscountAmount: 0,
            completedDiscountAmount: 0,
            completedShippingCharged: 0,
            completedDeliveryCost: 0,
            completedCogsKnownMinor: 0,
            completedSaleQuantity: 0,
            completedTrackedQuantity: 0,
            completedCostCoverageComplete:
              true,
            completedCostQualities: [],
          };

        const coveragePercent =
          !canSeeProfit
            ? null
            : stats.completedSaleQuantity <=
                0
              ? 100
              : Math.round(
                (
                  stats.completedTrackedQuantity /
                  stats.completedSaleQuantity
                  ) *
                    10000,
                ) /
                100;

        const costQualityComplete =
          canSeeProfit &&
          stats.completedCostCoverageComplete &&
          stats.completedCostQualities.every(
            (quality) =>
              quality ===
              "confirmed",
          );

        const grossProfitMinor =
          costQualityComplete
            ? stats.completedProductsNetSales *
                100 -
              stats.completedCogsKnownMinor
            : null;

        const deliveryImpactMinor =
          (
            stats.completedShippingCharged -
            stats.completedDeliveryCost
          ) *
          100;

        const profitAfterDeliveryMinor =
          grossProfitMinor ===
          null
            ? null
            : grossProfitMinor +
              deliveryImpactMinor;

        return {
          ...row,
          stats: {
            usageCount:
              stats.usageCount,
            activeOrdersCount:
              stats.activeOrdersCount,
            completedOrdersCount:
              stats.completedOrdersCount,
            cancelledOrdersCount:
              stats.cancelledOrdersCount,

            activeOrderValue:
              stats.activeOrderValue,
            completedOrderValue:
              stats.completedOrderValue,

            activeProductsNetSales:
              stats.activeProductsNetSales,
            completedProductsNetSales:
              stats.completedProductsNetSales,

            totalDiscountAmount:
              stats.totalDiscountAmount,
            completedDiscountAmount:
              stats.completedDiscountAmount,

            completedCogsKnownMinor:
              canSeeProfit
                ? stats.completedCogsKnownMinor
                : null,
            grossProfitMinor:
              canSeeProfit
                ? grossProfitMinor
                : null,
            deliveryImpactMinor:
              canSeeProfit
                ? deliveryImpactMinor
                : null,
            profitAfterDeliveryMinor:
              canSeeProfit
                ? profitAfterDeliveryMinor
                : null,

            costCoveragePercent:
              coveragePercent,
            costCoverageComplete:
              canSeeProfit
                ? costQualityComplete
                : null,
          },
        };
      },
    ),
  );
}

async function handleCreate(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requireAdmin(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const parsed =
    parseCodeInput(
      await request
        .json()
        .catch(
          () => null,
        ),
    );

  if (!parsed.ok) {
    return json(
      {
        error:
          parsed.error,
      },
      400,
    );
  }

  const duplicate =
    await db
      .select({
        id:
          discountCodesTable.id,
      })
      .from(
        discountCodesTable,
      )
      .where(
        eq(
          discountCodesTable.normalizedCode,
          parsed.data.normalizedCode,
        ),
      )
      .limit(1);

  if (duplicate[0]) {
    return json(
      {
        error:
          "هذا الكود موجود مسبقًا",
      },
      409,
    );
  }

  const rows =
    await db
      .insert(
        discountCodesTable,
      )
      .values(
        parsed.data,
      )
      .returning();

  return json(
    rows[0],
    201,
  );
}

async function handleUpdate(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const auth =
    await requireAdmin(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const currentRows =
    await db
      .select()
      .from(
        discountCodesTable,
      )
      .where(
        eq(
          discountCodesTable.id,
          id,
        ),
      )
      .limit(1);

  const current =
    currentRows[0];

  if (!current) {
    return json(
      {
        error:
          "كود الخصم غير موجود",
      },
      404,
    );
  }

  const raw =
    await request
      .json()
      .catch(
        () => null,
      );

  const body =
    raw &&
    typeof raw ===
      "object" &&
    !Array.isArray(raw)
      ? raw as Record<
          string,
          unknown
        >
      : {};

  const parsed =
    parseCodeInput({
      campaignName:
        body.campaignName ??
        current.campaignName,
      code:
        body.code ??
        current.code,
      discountPercent:
        body.discountPercent ??
        current.discountPercent,
      isActive:
        body.isActive ??
        current.isActive,
      stackWithShippingPromotion:
        body.stackWithShippingPromotion ??
        current.stackWithShippingPromotion,
      startDate:
        body.startDate ===
        undefined
          ? current.startDate
          : body.startDate,
      endDate:
        body.endDate ===
        undefined
          ? current.endDate
          : body.endDate,
    });

  if (!parsed.ok) {
    return json(
      {
        error:
          parsed.error,
      },
      400,
    );
  }

  const duplicate =
    await db
      .select({
        id:
          discountCodesTable.id,
      })
      .from(
        discountCodesTable,
      )
      .where(
        and(
          eq(
            discountCodesTable.normalizedCode,
            parsed.data.normalizedCode,
          ),
          ne(
            discountCodesTable.id,
            id,
          ),
        ),
      )
      .limit(1);

  if (duplicate[0]) {
    return json(
      {
        error:
          "هذا الكود موجود مسبقًا",
      },
      409,
    );
  }

  const rows =
    await db
      .update(
        discountCodesTable,
      )
      .set({
        ...parsed.data,
        updatedAt:
          new Date(),
      })
      .where(
        eq(
          discountCodesTable.id,
          id,
        ),
      )
      .returning();

  return json(
    rows[0],
  );
}

export async function handleDiscountCodeRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path =
    new URL(
      request.url,
    ).pathname;

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/discount-codes/validate"
  ) {
    return handleValidate(
      request,
      db,
    );
  }

  if (
    request.method ===
      "GET" &&
    path ===
      "/api/admin/discount-codes"
  ) {
    return handleList(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/admin/discount-codes"
  ) {
    return handleCreate(
      request,
      db,
      env,
    );
  }

  const updateMatch =
    path.match(
      /^\/api\/admin\/discount-codes\/(\d+)$/,
    );

  if (
    request.method ===
      "PATCH" &&
    updateMatch
  ) {
    return handleUpdate(
      request,
      db,
      env,
      Number(
        updateMatch[1],
      ),
    );
  }

  return null;
}
