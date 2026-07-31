import {
  posSaleItemsTable,
  posSaleReturnItemsTable,
  posSaleReturnsTable,
  posSalesTable,
} from "@workspace/db/schema";
import { and, asc, desc, eq, gt, inArray, lt, or } from "drizzle-orm";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";
import { handleCreatePosSaleReturn } from "./pos-sale-return-create";

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
          or(
            lt(posSalesTable.createdAt, sale.createdAt),
            and(
              eq(posSalesTable.createdAt, sale.createdAt),
              lt(posSalesTable.id, sale.id),
            ),
          ),
        ),
      )
      .orderBy(desc(posSalesTable.createdAt), desc(posSalesTable.id))
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
          or(
            gt(posSalesTable.createdAt, sale.createdAt),
            and(
              eq(posSalesTable.createdAt, sale.createdAt),
              gt(posSalesTable.id, sale.id),
            ),
          ),
        ),
      )
      .orderBy(asc(posSalesTable.createdAt), asc(posSalesTable.id))
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

  const returnedByOriginalItem = new Map<number, number>();

  for (const returnedItem of completedReturnItems) {
    const current =
      returnedByOriginalItem.get(returnedItem.originalSaleItemId) ?? 0;

    returnedByOriginalItem.set(
      returnedItem.originalSaleItemId,
      current + returnedItem.quantity,
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
      productImage: item.productImage,

      color: item.color,
      size: item.size,

      soldQuantity: item.quantity,
      returnedQuantity,
      returnableQuantity,

      soldUnitPriceMinor: item.soldUnitPriceMinor,
      soldUnitPrice: item.soldUnitPriceMinor / 100,

      originalLineTotalMinor: item.lineTotalMinor,
      originalLineTotal: item.lineTotalMinor / 100,

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

      customerName: sale.customerName,
      customerPhone: sale.customerPhone,

      subtotalMinor: sale.subtotalMinor,
      subtotal: sale.subtotalMinor / 100,

      discountMinor: sale.discountMinor,
      discount: sale.discountMinor / 100,

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

export async function handlePosSaleReturnRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (request.method === "GET" && path === "/api/pos/sales/returns/preview") {
    return handleReturnPreview(request, db, env);
  }

  if (request.method === "POST" && path === "/api/pos/sales/returns") {
    return handleCreatePosSaleReturn(request, db, env);
  }

  return null;
}
