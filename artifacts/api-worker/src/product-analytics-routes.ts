import {
  financeTransactionsTable,
  ordersTable,
  productDailyAnalyticsTable,
  productsTable,
} from "@workspace/db/schema";
import {
  and,
  asc,
  countDistinct,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";

import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";

type Db =
  Awaited<ReturnType<typeof openDb>>["db"];

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

function palestineDateParts() {
  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Hebron",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    );

  const parts =
    formatter.formatToParts(
      new Date(),
    );

  const year =
    Number(
      parts.find(
        (part) =>
          part.type === "year",
      )?.value,
    );

  const month =
    Number(
      parts.find(
        (part) =>
          part.type === "month",
      )?.value,
    );

  const day =
    Number(
      parts.find(
        (part) =>
          part.type === "day",
      )?.value,
    );

  return {
    year,
    month,
    day,
  };
}

function currentPalestineDate() {
  const {
    year,
    month,
    day,
  } =
    palestineDateParts();

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function validDate(
  value: string | null,
): value is string {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    return false;
  }

  const date =
    new Date(
      `${value}T00:00:00Z`,
    );

  return (
    !Number.isNaN(
      date.getTime(),
    ) &&
    date
      .toISOString()
      .slice(0, 10) ===
      value
  );
}

function isLikelyAutomatedRequest(
  request: Request,
) {
  const userAgent =
    request.headers
      .get("user-agent")
      ?.trim() ?? "";

  const purpose = [
    request.headers.get(
      "purpose",
    ),
    request.headers.get(
      "sec-purpose",
    ),
    request.headers.get(
      "x-purpose",
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    purpose.includes(
      "prefetch",
    ) ||
    purpose.includes(
      "preview",
    )
  ) {
    return true;
  }

  if (!userAgent) {
    return false;
  }

  return /(?:facebookexternalhit|facebot|meta-externalagent|meta-externalfetcher|googlebot|google-inspectiontool|bingbot|bingpreview|yandexbot|baiduspider|duckduckbot|slurp|petalbot|applebot|bytespider|crawler|spider|headlesschrome|lighthouse|pagespeed|\bbot\b|curl\/|wget\/|python-requests|postmanruntime|insomnia|node-fetch|undici)/i.test(
    userAgent,
  );
}

function parseProductId(
  value: unknown,
) {
  const numeric =
    typeof value ===
      "number"
      ? value
      : typeof value ===
          "string"
        ? Number(value)
        : NaN;

  return Number.isSafeInteger(
    numeric,
  ) &&
    numeric > 0
    ? numeric
    : null;
}

function parseEventType(
  value: unknown,
):
  | "view"
  | "add_to_cart"
  | null {
  return value === "view" ||
    value === "add_to_cart"
    ? value
    : null;
}

function validVisitorId(
  value: unknown,
): value is string {
  if (
    typeof value !==
    "string"
  ) {
    return false;
  }

  const trimmed =
    value.trim();

  return (
    trimmed.length >= 12 &&
    trimmed.length <= 100 &&
    /^[A-Za-z0-9_-]+$/.test(
      trimmed,
    )
  );
}

async function recordProductEvent(
  request: Request,
  db: Db,
) {
  if (
    isLikelyAutomatedRequest(
      request,
    )
  ) {
    return json({
      ok: true,
      ignored:
        "automated",
    });
  }

  const body =
    await request
      .json()
      .catch(() => null);

  if (
    !body ||
    typeof body !==
      "object" ||
    Array.isArray(body)
  ) {
    return json(
      {
        error:
          "Invalid analytics event",
      },
      400,
    );
  }

  const payload =
    body as Record<
      string,
      unknown
    >;

  const visitorId =
    typeof payload.visitorId ===
      "string"
      ? payload.visitorId.trim()
      : "";

  if (
    !validVisitorId(
      visitorId,
    )
  ) {
    return json(
      {
        error:
          "Invalid visitor id",
      },
      400,
    );
  }

  const productId =
    parseProductId(
      payload.productId,
    );

  if (
    productId === null
  ) {
    return json(
      {
        error:
          "Invalid product id",
      },
      400,
    );
  }

  const eventType =
    parseEventType(
      payload.eventType,
    );

  if (!eventType) {
    return json(
      {
        error:
          "Invalid event type",
      },
      400,
    );
  }

  const eventDate =
    currentPalestineDate();

  await db
    .insert(
      productDailyAnalyticsTable,
    )
    .values({
      visitorId,
      productId,
      eventDate,
      eventType,
      eventCount: 1,
    })
    .onConflictDoUpdate({
      target: [
        productDailyAnalyticsTable.visitorId,
        productDailyAnalyticsTable.productId,
        productDailyAnalyticsTable.eventDate,
        productDailyAnalyticsTable.eventType,
      ],
      set: {
        eventCount:
          sql`${productDailyAnalyticsTable.eventCount} + 1`,
        updatedAt:
          new Date(),
      },
    });

  return json({
    ok: true,
  });
}

type ProductActivity = {
  productId: number;
  views: number;
  viewers: number;
  addToCart: number;
  cartUsers: number;
};

type ProductSales = {
  orderIds: Set<number>;
  units: number;
  revenueMinor: number;
};

function safePositiveInteger(
  value: unknown,
) {
  const numeric =
    typeof value ===
      "number"
      ? value
      : typeof value ===
          "string"
        ? Number(value)
        : NaN;

  return Number.isSafeInteger(
    numeric,
  ) &&
    numeric > 0
    ? numeric
    : null;
}

async function getProductAnalyticsReport(
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
    new URL(
      request.url,
    );

  const from =
    url.searchParams.get(
      "from",
    );

  const to =
    url.searchParams.get(
      "to",
    );

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

  const [
    activityRows,
    uniqueViewerRows,
    trackingRows,
    productRows,
    onlineCompletions,
  ] =
    await Promise.all([
      db
        .select({
          productId:
            productDailyAnalyticsTable.productId,

          eventType:
            productDailyAnalyticsTable.eventType,

          eventCount:
            sql<number>`sum(${productDailyAnalyticsTable.eventCount})`,

          visitors:
            countDistinct(
              productDailyAnalyticsTable.visitorId,
            ),
        })
        .from(
          productDailyAnalyticsTable,
        )
        .where(
          and(
            gte(
              productDailyAnalyticsTable.eventDate,
              from,
            ),
            lte(
              productDailyAnalyticsTable.eventDate,
              to,
            ),
          ),
        )
        .groupBy(
          productDailyAnalyticsTable.productId,
          productDailyAnalyticsTable.eventType,
        ),

      db
        .select({
          value:
            countDistinct(
              productDailyAnalyticsTable.visitorId,
            ),
        })
        .from(
          productDailyAnalyticsTable,
        )
        .where(
          and(
            eq(
              productDailyAnalyticsTable.eventType,
              "view",
            ),
            gte(
              productDailyAnalyticsTable.eventDate,
              from,
            ),
            lte(
              productDailyAnalyticsTable.eventDate,
              to,
            ),
          ),
        ),

      db
        .select({
          firstDate:
            sql<string | null>`min(${productDailyAnalyticsTable.eventDate})`,
        })
        .from(
          productDailyAnalyticsTable,
        ),

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
          price:
            productsTable.price,
          image:
            productsTable.image,
          isHidden:
            productsTable.isHidden,
          createdAt:
            productsTable.createdAt,
        })
        .from(
          productsTable,
        )
        .where(
          isNull(
            productsTable.deletedAt,
          ),
        )
        .orderBy(
          asc(
            productsTable.id,
          ),
        ),

      db
        .select({
          sourceId:
            financeTransactionsTable.sourceId,
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
        ),
    ]);

  const activityByProduct =
    new Map<
      number,
      ProductActivity
    >();

  for (
    const row of
      activityRows
  ) {
    const current =
      activityByProduct.get(
        row.productId,
      ) ?? {
        productId:
          row.productId,
        views: 0,
        viewers: 0,
        addToCart: 0,
        cartUsers: 0,
      };

    if (
      row.eventType ===
      "view"
    ) {
      current.views =
        Number(
          row.eventCount ??
            0,
        );

      current.viewers =
        Number(
          row.visitors ??
            0,
        );
    }

    if (
      row.eventType ===
      "add_to_cart"
    ) {
      current.addToCart =
        Number(
          row.eventCount ??
            0,
        );

      current.cartUsers =
        Number(
          row.visitors ??
            0,
        );
    }

    activityByProduct.set(
      row.productId,
      current,
    );
  }

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
    onlineOrderIds.length >
    0
      ? await db
          .select({
            id:
              ordersTable.id,
            status:
              ordersTable.status,
            items:
              ordersTable.items,
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

  const salesByProduct =
    new Map<
      number,
      ProductSales
    >();

  let skippedOrderItems =
    0;

  for (
    const order of
      onlineOrders
  ) {
    if (
      !Array.isArray(
        order.items,
      )
    ) {
      skippedOrderItems +=
        1;
      continue;
    }

    for (
      const rawItem of
        order.items
    ) {
      if (
        !rawItem ||
        typeof rawItem !==
          "object" ||
        Array.isArray(
          rawItem,
        )
      ) {
        skippedOrderItems +=
          1;
        continue;
      }

      const item =
        rawItem as Record<
          string,
          unknown
        >;

      const productId =
        safePositiveInteger(
          item.id,
        );

      const quantity =
        safePositiveInteger(
          item.quantity,
        );

      const price =
        typeof item.price ===
          "number"
          ? item.price
          : typeof item.price ===
              "string"
            ? Number(
                item.price,
              )
            : NaN;

      if (
        productId === null ||
        quantity === null ||
        !Number.isSafeInteger(
          price,
        ) ||
        price < 0
      ) {
        skippedOrderItems +=
          1;
        continue;
      }

      const revenueMinor =
        price *
        quantity *
        100;

      if (
        !Number.isSafeInteger(
          revenueMinor,
        ) ||
        revenueMinor < 0
      ) {
        skippedOrderItems +=
          1;
        continue;
      }

      const current =
        salesByProduct.get(
          productId,
        ) ?? {
          orderIds:
            new Set<number>(),
          units: 0,
          revenueMinor: 0,
        };

      current.orderIds.add(
        order.id,
      );

      current.units +=
        quantity;

      current.revenueMinor +=
        revenueMinor;

      salesByProduct.set(
        productId,
        current,
      );
    }
  }

  const rows =
    productRows.map(
      (product) => {
        const activity =
          activityByProduct.get(
            product.id,
          );

        const sales =
          salesByProduct.get(
            product.id,
          );

        const views =
          activity?.views ?? 0;

        const viewers =
          activity?.viewers ?? 0;

        const addToCart =
          activity?.addToCart ??
          0;

        const cartUsers =
          activity?.cartUsers ??
          0;

        const orders =
          sales?.orderIds.size ??
          0;

        const units =
          sales?.units ?? 0;

        const revenueMinor =
          sales?.revenueMinor ??
          0;

        const interestScore =
          views +
          addToCart * 3;

        return {
          productId:
            String(
              product.id,
            ),
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
          price:
            product.price,
          image:
            product.image,
          isHidden:
            product.isHidden,
          createdAt:
            product.createdAt.toISOString(),

          views,
          viewers,
          addToCart,
          cartUsers,

          orders,
          units,
          revenueMinor,

          interestScore,

          hasInterestWithoutSales:
            interestScore > 0 &&
            orders === 0,
        };
      },
    );

  const totals =
    rows.reduce(
      (
        acc,
        row,
      ) => {
        acc.views +=
          row.views;
        acc.addToCart +=
          row.addToCart;
        acc.orders +=
          row.orders;
        acc.units +=
          row.units;
        acc.revenueMinor +=
          row.revenueMinor;

        if (
          row.hasInterestWithoutSales
        ) {
          acc.interestWithoutSales +=
            1;
        }

        return acc;
      },
      {
        views: 0,
        addToCart: 0,
        orders: 0,
        units: 0,
        revenueMinor: 0,
        interestWithoutSales: 0,
      },
    );

  const warnings:
    string[] = [];

  const firstTrackedDate =
    trackingRows[0]
      ?.firstDate ??
    null;

  if (
    !firstTrackedDate
  ) {
    warnings.push(
      "لم تبدأ بيانات مشاهدة المنتجات والإضافة للسلة بعد. المبيعات الإلكترونية التاريخية متوفرة، لكن بيانات التفاعل ستبدأ من أول حدث يتم تسجيله بعد تشغيل التتبع.",
    );
  } else if (
    from <
    firstTrackedDate
  ) {
    warnings.push(
      `بيانات المشاهدة والإضافة للسلة تبدأ من ${firstTrackedDate} فقط، لذلك الفترة المختارة تحتوي جزءاً تاريخياً لا توجد له بيانات تفاعل.`,
    );
  }

  if (
    skippedOrderItems > 0
  ) {
    warnings.push(
      `تم تجاهل ${skippedOrderItems} بند طلب إلكتروني لعدم اكتمال بيانات المنتج أو الكمية أو السعر.`,
    );
  }

  return json({
    range: {
      from,
      to,
    },

    generatedAt:
      new Date().toISOString(),

    tracking: {
      firstTrackedDate,
      engagementHistorical:
        false,
      salesHistorical:
        true,
    },

    summary: {
      ...totals,
      orders:
        onlineOrders.length,
      uniqueViewers:
        Number(
          uniqueViewerRows[0]
            ?.value ??
            0,
        ),
      completedOnlineOrders:
        onlineOrders.length,
    },

    products:
      rows,

    warnings,

    methodology: {
      views:
        "Product detail page views recorded by Lovely Kids analytics; automated requests are ignored.",

      addToCart:
        "Successful add-to-cart actions recorded by Lovely Kids analytics.",

      sales:
        "Completed web orders based on the posted finance business date when the order becomes done.",

      revenue:
        "Product item price multiplied by completed quantity; delivery charge is excluded.",

      interestScore:
        "views + (add_to_cart × 3)",
    },
  });
}

export async function handleProductAnalyticsRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const url =
    new URL(
      request.url,
    );

  if (
    request.method ===
      "POST" &&
    url.pathname ===
      "/api/analytics/product-event"
  ) {
    return recordProductEvent(
      request,
      db,
    );
  }

  if (
    request.method ===
      "GET" &&
    url.pathname ===
      "/api/owner/reports/product-analytics"
  ) {
    return getProductAnalyticsReport(
      request,
      db,
      env,
    );
  }

  return null;
}
