import {
  exchangeDocumentsTable,
  customersTable,
  exchangeReturnItemsTable,
  posSaleItemsTable,
  posSaleReturnItemsTable,
  posSaleReturnsTable,
  posSalesTable,
} from "@workspace/db/schema";
import { and, asc, desc, eq, gt, inArray, lt, or } from "drizzle-orm";

import { getCurrentUser } from "./auth";
import {
  getCurrentProductImageMap,
  resolveCurrentProductImage,
} from "./current-product-image";
import { openDb, type Env } from "./db";
import { handleCreatePosSaleReturn } from "./pos-sale-return-create";
import { handleCreateMobileEmergencyReturn } from "./pos-mobile-return-create";
import { handleVoidPosSaleReturn } from "./pos-sale-return-void";
import { handleCorrectReturnCashToCustomer } from "./pos-return-correction";
import {
  allocateReturnDiscountMinor,
} from "./promotion-return-requalification";

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

async function getSaleNavigation(
  db: Db,
  sale: typeof posSalesTable.$inferSelect,
) {
  const [previousRows, nextRows] = await Promise.all([
    db
      .select({
        publicId: posSalesTable.publicId,
      })
      .from(posSalesTable)
      .where(
        and(
          eq(posSalesTable.registerKey, sale.registerKey),
          eq(posSalesTable.status, "completed"),
          lt(posSalesTable.id, sale.id),
        ),
      )
      .orderBy(desc(posSalesTable.id))
      .limit(1),

    db
      .select({
        publicId: posSalesTable.publicId,
      })
      .from(posSalesTable)
      .where(
        and(
          eq(posSalesTable.registerKey, sale.registerKey),
          eq(posSalesTable.status, "completed"),
          gt(posSalesTable.id, sale.id),
        ),
      )
      .orderBy(asc(posSalesTable.id))
      .limit(1),
  ]);

  return {
    previousPublicId: previousRows[0]?.publicId ?? null,
    nextPublicId: nextRows[0]?.publicId ?? null,
  };
}

async function handleReturnPreview(request: Request, db: Db, env: Env) {
  const auth = await requirePosUser(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);

  const publicId = normalizePublicId(url.searchParams.get("publicId"));

  if (!publicId) {
    return json(
      {
        error: "رقم الفاتورة غير صالح",
      },
      400,
    );
  }

  const barcode = normalizeOptionalBarcode(url.searchParams.get("barcode"));

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
        error: "لا يمكن إنشاء مرتجع لهذه الفاتورة",
      },
      409,
    );
  }

  const saleItems = await db
    .select()
    .from(posSaleItemsTable)
    .where(eq(posSaleItemsTable.saleId, sale.id))
    .orderBy(asc(posSaleItemsTable.lineNumber));

  const invoiceDiscountAllocations =
    allocateReturnDiscountMinor(
      sale.invoiceDiscountMinor,
      saleItems.map((item) => {
        const grossAmountMinor =
          item.soldUnitPriceMinor *
          item.quantity;

        return {
          grossAmountMinor,
          alreadyAllocatedMinor:
            item.lineDiscountMinor +
            item.promotionDiscountMinor,
          weightMinor:
            Math.max(
              0,
              item.lineTotalMinor,
            ),
        };
      }),
    );

  const invoiceDiscountByItemId =
    new Map(
      saleItems.map(
        (item, index) => [
          item.id,
          invoiceDiscountAllocations[
            index
          ] ?? 0,
        ],
      ),
    );

  const currentProductImages =
    await getCurrentProductImageMap(
      db,
      saleItems.map((item) => item.productId),
    );

  const completedReturnRows = await db
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

  const completedReturnIds = completedReturnRows.map((row) => row.id);

  let completedReturnItems: Array<typeof posSaleReturnItemsTable.$inferSelect> =
    [];

  if (completedReturnIds.length > 0) {
    completedReturnItems = await db
      .select()
      .from(posSaleReturnItemsTable)
      .where(inArray(posSaleReturnItemsTable.returnId, completedReturnIds));
  }

  const completedExchangeRows =
    await db
      .select({
        id: exchangeDocumentsTable.id,
      })
      .from(exchangeDocumentsTable)
      .where(
        and(
          eq(
            exchangeDocumentsTable.sourceType,
            "pos_sale",
          ),
          eq(
            exchangeDocumentsTable.originalPosSaleId,
            sale.id,
          ),
          eq(
            exchangeDocumentsTable.status,
            "completed",
          ),
        ),
      );

  const completedExchangeIds =
    completedExchangeRows.map(
      (row) => row.id,
    );

  const completedExchangeItems =
    completedExchangeIds.length > 0
      ? await db
          .select()
          .from(
            exchangeReturnItemsTable,
          )
          .where(
            inArray(
              exchangeReturnItemsTable.exchangeId,
              completedExchangeIds,
            ),
          )
      : [];

  const returnedByOriginalItem = new Map<number, number>();

  for (const returnedItem of completedReturnItems) {
    // مردود الهاتف الاحتياطي ليس مرتبطًا بسطر فاتورة أصلية.
    if (returnedItem.originalSaleItemId === null) {
      continue;
    }

    const current =
      returnedByOriginalItem.get(returnedItem.originalSaleItemId) ?? 0;

    returnedByOriginalItem.set(
      returnedItem.originalSaleItemId,
      current + returnedItem.quantity,
    );
  }

  for (const exchangedItem of completedExchangeItems) {
    if (
      exchangedItem.originalPosSaleItemId ===
      null
    ) {
      continue;
    }

    const current =
      returnedByOriginalItem.get(
        exchangedItem.originalPosSaleItemId,
      ) ?? 0;

    returnedByOriginalItem.set(
      exchangedItem.originalPosSaleItemId,
      current +
        exchangedItem.quantity,
    );
  }

  const allItems = saleItems.map((item) => {
    const returnedQuantity = returnedByOriginalItem.get(item.id) ?? 0;

    const returnableQuantity = Math.max(0, item.quantity - returnedQuantity);

    return {
      id: String(item.id),
      productId: item.productId === null ? null : String(item.productId),

      lineNumber: item.lineNumber,

      barcode: item.barcode,
      productCode: item.productCode,
      productNameAr: item.productNameAr,
      productImage: resolveCurrentProductImage(
        currentProductImages,
        item.productId,
      ),

      color: item.color,
      size: item.size,

      soldQuantity: item.quantity,
      returnedQuantity,
      returnableQuantity,

      soldUnitPriceMinor: item.soldUnitPriceMinor,
      soldUnitPrice: item.soldUnitPriceMinor / 100,

      lineDiscountMinor: item.lineDiscountMinor,
      lineDiscount: item.lineDiscountMinor / 100,

      promotionDiscountMinor:
        item.promotionDiscountMinor,
      promotionDiscount:
        item.promotionDiscountMinor /
        100,

      invoiceDiscountAllocatedMinor:
        invoiceDiscountByItemId.get(
          item.id,
        ) ?? 0,
      invoiceDiscountAllocated:
        (
          invoiceDiscountByItemId.get(
            item.id,
          ) ?? 0
        ) / 100,

      originalLineTotalMinor: item.lineTotalMinor,
      originalLineTotal: item.lineTotalMinor / 100,

      historicalNetMinor:
        item.lineTotalMinor -
        (
          invoiceDiscountByItemId.get(
            item.id,
          ) ?? 0
        ),
      historicalNet:
        (
          item.lineTotalMinor -
          (
            invoiceDiscountByItemId.get(
              item.id,
            ) ?? 0
          )
        ) / 100,

      returnableGrossMinor: item.soldUnitPriceMinor * returnableQuantity,

      returnableGross: (item.soldUnitPriceMinor * returnableQuantity) / 100,
    };
  });

  const visibleItems =
    barcode === undefined
      ? allItems
      : allItems.filter((item) => item.barcode === barcode);

  if (barcode !== undefined && visibleItems.length === 0) {
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

  const returnableQuantity = allItems.reduce(
    (total, item) => total + item.returnableQuantity,
    0,
  );

  const navigation = await getSaleNavigation(db, sale);

  return json({
    sale: {
      id: String(sale.id),
      publicId: sale.publicId,

      status: sale.status,
      registerKey: sale.registerKey,
      businessDate: sale.businessDate,

      customerId: sale.customerId,
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

    navigation,

    filter: {
      barcode: barcode ?? null,
    },

    summary: {
      soldQuantity,
      returnedQuantity,
      returnableQuantity,
      fullyReturned: returnableQuantity === 0,
    },

    items: visibleItems,
  });
}



/**
 * Read-only recent returns plus a selected historic return with previous/next
 * navigation. Selection is independent from the original sale invoice.
 */
async function handleReturnHistory(request: Request, db: Db, env: Env) {
  const auth = await requirePosUser(request, db, env);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const registerKey = (url.searchParams.get("register") || "main").trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,50}$/.test(registerKey)) {
    return json({ error: "معرّف الصندوق غير صالح" }, 400);
  }
  const requestedId = (url.searchParams.get("publicId") || "").trim().toUpperCase();
  if (requestedId && (requestedId.length > 80 || !/^[A-Z0-9_-]+$/.test(requestedId))) {
    return json({ error: "رقم المردود غير صالح" }, 400);
  }

  const recent = await db.select().from(posSaleReturnsTable)
    .where(eq(posSaleReturnsTable.registerKey, registerKey))
    .orderBy(desc(posSaleReturnsTable.id)).limit(50);

  const chosen = requestedId
    ? (await db.select().from(posSaleReturnsTable)
        .where(and(
          eq(posSaleReturnsTable.publicId, requestedId),
          eq(posSaleReturnsTable.registerKey, registerKey),
        )).limit(1))[0] ?? null
    : recent[0] ?? null;

  if (requestedId && !chosen) return json({ error: "المردود غير موجود" }, 404);

  const [items, previous, next, customer] = chosen
    ? await Promise.all([
        db.select().from(posSaleReturnItemsTable)
          .where(eq(posSaleReturnItemsTable.returnId, chosen.id))
          .orderBy(asc(posSaleReturnItemsTable.lineNumber)),
        db.select({ publicId: posSaleReturnsTable.publicId })
          .from(posSaleReturnsTable)
          .where(and(eq(posSaleReturnsTable.registerKey, registerKey),
            lt(posSaleReturnsTable.id, chosen.id)))
          .orderBy(desc(posSaleReturnsTable.id)).limit(1),
        db.select({ publicId: posSaleReturnsTable.publicId })
          .from(posSaleReturnsTable)
          .where(and(eq(posSaleReturnsTable.registerKey, registerKey),
            gt(posSaleReturnsTable.id, chosen.id)))
          .orderBy(asc(posSaleReturnsTable.id)).limit(1),
        chosen.customerId !== null
          ? db.select({ name: customersTable.name }).from(customersTable)
              .where(eq(customersTable.id, chosen.customerId)).limit(1)
          : Promise.resolve([] as Array<{ name: string }>),
      ])
    : [[], [], [], []];

  const summary = (saleReturn: typeof posSaleReturnsTable.$inferSelect) => ({
    id: String(saleReturn.id),
    publicId: saleReturn.publicId,
    status: saleReturn.status,
    originalSaleId: saleReturn.originalSaleId === null
      ? null : String(saleReturn.originalSaleId),
    customerId: saleReturn.customerId,
    refundMethod: saleReturn.refundMethod,
    refundAmountMinor: saleReturn.refundAmountMinor,
    createdAt: saleReturn.createdAt.toISOString(),
    reason: saleReturn.reason,
  });

  return json({
    recent: recent.map(summary),
    selected: chosen ? {
      ...summary(chosen),
      customerName: customer[0]?.name ?? null,
      cashSessionId: String(chosen.cashSessionId),
      businessDate: chosen.businessDate,
      notes: chosen.notes,
      previousPublicId: previous[0]?.publicId ?? null,
      nextPublicId: next[0]?.publicId ?? null,
      items: items.map((item) => ({
        id: String(item.id),
        barcode: item.barcode,
        productNameAr: item.productNameAr,
        color: item.color,
        size: item.size,
        quantity: item.quantity,
        refundAmountMinor: item.refundAmountMinor,
      })),
    } : null,
  });
}

export async function handlePosSaleReturnRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (request.method === "GET" && path === "/api/pos/sales/returns/history") {
    return handleReturnHistory(request, db, env);
  }

  if (request.method === "POST" && path === "/api/pos/sales/returns/correct-cash-to-customer") {
    return handleCorrectReturnCashToCustomer(request, db, env);
  }

  if (request.method === "GET" && path === "/api/pos/sales/returns/preview") {
    return handleReturnPreview(request, db, env);
  }

  if (
    request.method === "POST" &&
    path === "/api/pos/sales/returns/mobile"
  ) {
    return handleCreateMobileEmergencyReturn(
      request,
      db,
      env,
    );
  }

  if (
    request.method === "POST" &&
    path === "/api/pos/sales/returns/void"
  ) {
    return handleVoidPosSaleReturn(request, db, env);
  }

  if (request.method === "POST" && path === "/api/pos/sales/returns") {
    return handleCreatePosSaleReturn(request, db, env);
  }

  return null;
}
