import {
  exchangeDocumentsTable,
  exchangeReturnItemsTable,
  posSaleItemsTable,
  posSaleReturnItemsTable,
  posSaleReturnsTable,
  posSalesTable,
} from "@workspace/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

type PosUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers,
  });

type PosAuthResult =
  | {
      ok: true;
      user: PosUser;
    }
  | {
      ok: false;
      response: Response;
    };

async function requirePosUser(
  request: Request,
  db: Db,
  env: Env,
): Promise<PosAuthResult> {
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return {
      ok: false,
      response: json({ error: "يجب تسجيل الدخول" }, 401),
    };
  }

  if (!user.isAdmin && !user.isOwner) {
    return {
      ok: false,
      response: json(
        {
          error: "غير مصرح باستخدام نقطة البيع",
        },
        403,
      ),
    };
  }

  return {
    ok: true,
    user,
  };
}

function normalizePublicId(value: string | null): string | null {
  const publicId = (value ?? "").trim().toUpperCase();

  if (!publicId || publicId.length > 80 || !/^[A-Z0-9_-]+$/.test(publicId)) {
    return null;
  }

  return publicId;
}

function normalizeOptionalBarcode(
  value: string | null,
): string | null | undefined {
  if (value === null) {
    return undefined;
  }

  const barcode = value.trim();

  if (!barcode || barcode.length > 128) {
    return null;
  }

  return barcode;
}

async function handleExchangePreview(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requirePosUser(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);

  const publicId = normalizePublicId(
    url.searchParams.get("publicId"),
  );

  if (!publicId) {
    return json(
      {
        error: "رقم الفاتورة غير صالح",
      },
      400,
    );
  }

  const barcode = normalizeOptionalBarcode(
    url.searchParams.get("barcode"),
  );

  if (barcode === null) {
    return json(
      {
        error: "باركود الصنف غير صالح",
      },
      400,
    );
  }

  const saleRows = await db
    .select()
    .from(posSalesTable)
    .where(eq(posSalesTable.publicId, publicId))
    .limit(1);

  const sale = saleRows[0];

  if (!sale) {
    return json(
      {
        error: "الفاتورة غير موجودة",
      },
      404,
    );
  }

  if (sale.status !== "completed") {
    return json(
      {
        error: "لا يمكن إنشاء فاتورة تبديل لهذه الفاتورة",
      },
      409,
    );
  }

  const saleItems = await db
    .select()
    .from(posSaleItemsTable)
    .where(eq(posSaleItemsTable.saleId, sale.id))
    .orderBy(asc(posSaleItemsTable.lineNumber));

  const completedReturns = await db
    .select({
      id: posSaleReturnsTable.id,
    })
    .from(posSaleReturnsTable)
    .where(
      and(
        eq(posSaleReturnsTable.originalSaleId, sale.id),
        eq(posSaleReturnsTable.status, "completed"),
      ),
    );

  const completedReturnIds =
    completedReturns.map((row) => row.id);

  let priorReturnItems:
    Array<typeof posSaleReturnItemsTable.$inferSelect> = [];

  if (completedReturnIds.length > 0) {
    priorReturnItems = await db
      .select()
      .from(posSaleReturnItemsTable)
      .where(
        inArray(
          posSaleReturnItemsTable.returnId,
          completedReturnIds,
        ),
      );
  }

  const completedExchanges = await db
    .select({
      id: exchangeDocumentsTable.id,
    })
    .from(exchangeDocumentsTable)
    .where(
      and(
        eq(exchangeDocumentsTable.sourceType, "pos_sale"),
        eq(exchangeDocumentsTable.originalPosSaleId, sale.id),
        eq(exchangeDocumentsTable.status, "completed"),
      ),
    );

  const completedExchangeIds =
    completedExchanges.map((row) => row.id);

  let priorExchangeItems:
    Array<typeof exchangeReturnItemsTable.$inferSelect> = [];

  if (completedExchangeIds.length > 0) {
    priorExchangeItems = await db
      .select()
      .from(exchangeReturnItemsTable)
      .where(
        inArray(
          exchangeReturnItemsTable.exchangeId,
          completedExchangeIds,
        ),
      );
  }

  const returnedByOriginalItem = new Map<number, number>();
  const exchangedByOriginalItem = new Map<number, number>();

  const consumedLineDiscountByOriginalItem =
    new Map<number, number>();

  let priorReturnNetMinor = 0;
  let priorExchangeNetMinor = 0;
  let priorInvoiceDiscountMinor = 0;

  for (const item of priorReturnItems) {
    if (item.originalSaleItemId === null) {
      continue;
    }

    returnedByOriginalItem.set(
      item.originalSaleItemId,
      (returnedByOriginalItem.get(item.originalSaleItemId) ?? 0) +
        item.quantity,
    );

    consumedLineDiscountByOriginalItem.set(
      item.originalSaleItemId,
      (
        consumedLineDiscountByOriginalItem.get(
          item.originalSaleItemId,
        ) ?? 0
      ) + item.lineDiscountMinor,
    );

    priorReturnNetMinor += item.refundAmountMinor;
    priorInvoiceDiscountMinor += item.invoiceDiscountMinor;
  }

  for (const item of priorExchangeItems) {
    if (item.originalPosSaleItemId === null) {
      continue;
    }

    exchangedByOriginalItem.set(
      item.originalPosSaleItemId,
      (
        exchangedByOriginalItem.get(
          item.originalPosSaleItemId,
        ) ?? 0
      ) + item.quantity,
    );

    consumedLineDiscountByOriginalItem.set(
      item.originalPosSaleItemId,
      (
        consumedLineDiscountByOriginalItem.get(
          item.originalPosSaleItemId,
        ) ?? 0
      ) + item.lineDiscountMinor,
    );

    priorExchangeNetMinor += item.returnNetMinor;
    priorInvoiceDiscountMinor += item.invoiceDiscountMinor;
  }

  if (
    !Number.isSafeInteger(priorReturnNetMinor) ||
    !Number.isSafeInteger(priorExchangeNetMinor) ||
    !Number.isSafeInteger(priorInvoiceDiscountMinor) ||
    priorReturnNetMinor < 0 ||
    priorExchangeNetMinor < 0 ||
    priorInvoiceDiscountMinor < 0 ||
    priorInvoiceDiscountMinor > sale.invoiceDiscountMinor
  ) {
    return json(
      {
        error: "بيانات المرتجعات أو التبديلات السابقة غير متطابقة",
      },
      409,
    );
  }

  const allItems = saleItems.map((item) => {
    const returnedQuantity =
      returnedByOriginalItem.get(item.id) ?? 0;

    const exchangedQuantity =
      exchangedByOriginalItem.get(item.id) ?? 0;

    const consumedQuantity =
      returnedQuantity + exchangedQuantity;

    if (
      !Number.isSafeInteger(consumedQuantity) ||
      consumedQuantity < 0 ||
      consumedQuantity > item.quantity
    ) {
      throw new Error(
        `Invalid consumed quantity for sale item ${item.id}`,
      );
    }

    const consumedLineDiscountMinor =
      consumedLineDiscountByOriginalItem.get(item.id) ?? 0;

    if (
      consumedLineDiscountMinor < 0 ||
      consumedLineDiscountMinor > item.lineDiscountMinor
    ) {
      throw new Error(
        `Invalid consumed discount for sale item ${item.id}`,
      );
    }

    const returnableQuantity =
      item.quantity - consumedQuantity;

    return {
      id: String(item.id),

      productId:
        item.productId === null
          ? null
          : String(item.productId),

      lineNumber: item.lineNumber,

      barcode: item.barcode,
      productCode: item.productCode,
      productNameAr: item.productNameAr,
      productImage: item.productImage,

      color: item.color,
      size: item.size,

      soldQuantity: item.quantity,
      returnedQuantity,
      exchangedQuantity,
      consumedQuantity,
      returnableQuantity,

      soldUnitPriceMinor: item.soldUnitPriceMinor,
      soldUnitPrice: item.soldUnitPriceMinor / 100,

      lineDiscountMinor: item.lineDiscountMinor,
      lineDiscount: item.lineDiscountMinor / 100,

      consumedLineDiscountMinor,
      remainingLineDiscountMinor:
        item.lineDiscountMinor -
        consumedLineDiscountMinor,

      originalLineTotalMinor: item.lineTotalMinor,
      originalLineTotal: item.lineTotalMinor / 100,
    };
  });

  const visibleItems =
    barcode === undefined
      ? allItems
      : allItems.filter(
          (item) => item.barcode === barcode,
        );

  if (
    barcode !== undefined &&
    visibleItems.length === 0
  ) {
    return json(
      {
        error: "هذا الباركود غير موجود في الفاتورة",
      },
      404,
    );
  }

  const soldQuantity = allItems.reduce(
    (total, item) => total + item.soldQuantity,
    0,
  );

  const returnedQuantity = allItems.reduce(
    (total, item) => total + item.returnedQuantity,
    0,
  );

  const exchangedQuantity = allItems.reduce(
    (total, item) => total + item.exchangedQuantity,
    0,
  );

  const returnableQuantity = allItems.reduce(
    (total, item) => total + item.returnableQuantity,
    0,
  );

  const previouslyCreditedNetMinor =
    priorReturnNetMinor + priorExchangeNetMinor;

  const returnableNetMinor =
    sale.totalMinor - previouslyCreditedNetMinor;

  if (
    !Number.isSafeInteger(returnableNetMinor) ||
    returnableNetMinor < 0 ||
    previouslyCreditedNetMinor > sale.totalMinor
  ) {
    return json(
      {
        error: "القيمة المتبقية للفاتورة غير متطابقة",
      },
      409,
    );
  }

  return json({
    sale: {
      id: String(sale.id),
      publicId: sale.publicId,

      status: sale.status,
      registerKey: sale.registerKey,
      businessDate: sale.businessDate,

      customerName: sale.customerName,
      customerPhone: sale.customerPhone,

      subtotalMinor: sale.subtotalMinor,
      subtotal: sale.subtotalMinor / 100,

      discountMinor: sale.discountMinor,
      discount: sale.discountMinor / 100,

      itemDiscountMinor: sale.itemDiscountMinor,
      itemDiscount: sale.itemDiscountMinor / 100,

      invoiceDiscountMinor: sale.invoiceDiscountMinor,
      invoiceDiscount: sale.invoiceDiscountMinor / 100,

      totalMinor: sale.totalMinor,
      total: sale.totalMinor / 100,

      createdAt: sale.createdAt.toISOString(),
    },

    filter: {
      barcode: barcode ?? null,
    },

    summary: {
      soldQuantity,
      returnedQuantity,
      exchangedQuantity,
      returnableQuantity,

      priorReturnNetMinor,
      priorExchangeNetMinor,
      previouslyCreditedNetMinor,

      returnableNetMinor,
      returnableNet: returnableNetMinor / 100,

      fullyConsumed: returnableQuantity === 0,
    },

    items: visibleItems,
  });
}

export async function handlePosExchangeRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "GET" &&
    path === "/api/pos/exchanges/preview"
  ) {
    return handleExchangePreview(
      request,
      db,
      env,
    );
  }

  return null;
}
