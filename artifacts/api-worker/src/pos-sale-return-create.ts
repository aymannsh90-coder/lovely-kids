import {
  cashSessionsTable,
  posSaleItemsTable,
  posSaleReturnItemsTable,
  posSaleReturnsTable,
  posSalesTable,
  productsTable,
  type ColorVariant,
} from "@workspace/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

type PosUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

const MAX_MINOR = 2_000_000_000;
const MAX_STOCK = 2_000_000_000;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers,
  });

class PosSaleReturnError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

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

function normalizeRegisterKey(value: unknown): string | null {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "main";

  return /^[a-z0-9_-]{1,50}$/.test(key) ? key : null;
}

function normalizePublicId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const publicId = value.trim().toUpperCase();

  if (!publicId || publicId.length > 80 || !/^[A-Z0-9_-]+$/.test(publicId)) {
    return null;
  }

  return publicId;
}

function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const key = value.trim();

  if (key.length < 8 || key.length > 100 || !/^[A-Za-z0-9:_-]+$/.test(key)) {
    return null;
  }

  return key;
}

function parseRequiredText(
  value: unknown,
  minLength: number,
  maxLength: number,
  fieldName: string,
): string {
  if (typeof value !== "string") {
    throw new PosSaleReturnError(`${fieldName} غير صالح`);
  }

  const text = value.trim();

  if (text.length < minLength) {
    throw new PosSaleReturnError(`${fieldName} مطلوب`);
  }

  if (text.length > maxLength) {
    throw new PosSaleReturnError(`${fieldName} طويل جدًا`);
  }

  return text;
}

function parseOptionalText(
  value: unknown,
  maxLength: number,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new PosSaleReturnError(`${fieldName} غير صالح`);
  }

  const text = value.trim();

  if (text.length > maxLength) {
    throw new PosSaleReturnError(`${fieldName} طويل جدًا`);
  }

  return text || null;
}

interface ParsedReturnItem {
  originalSaleItemId: number;
  quantity: number;
}

function parseReturnItems(value: unknown): ParsedReturnItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new PosSaleReturnError("يجب اختيار صنف واحد على الأقل للمرتجع");
  }

  const seenIds = new Set<number>();

  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new PosSaleReturnError("بيانات أحد أصناف المرتجع غير صالحة");
    }

    const item = raw as Record<string, unknown>;

    const originalSaleItemId =
      typeof item.originalSaleItemId === "number"
        ? item.originalSaleItemId
        : typeof item.originalSaleItemId === "string" &&
            item.originalSaleItemId.trim()
          ? Number(item.originalSaleItemId)
          : Number.NaN;

    if (!Number.isSafeInteger(originalSaleItemId) || originalSaleItemId <= 0) {
      throw new PosSaleReturnError("رقم أحد أصناف الفاتورة غير صالح");
    }

    if (seenIds.has(originalSaleItemId)) {
      throw new PosSaleReturnError("لا يمكن تكرار الصنف نفسه في المرتجع");
    }

    seenIds.add(originalSaleItemId);

    const quantity =
      typeof item.quantity === "number"
        ? item.quantity
        : typeof item.quantity === "string" && item.quantity.trim()
          ? Number(item.quantity)
          : Number.NaN;

    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new PosSaleReturnError("كمية أحد أصناف المرتجع غير صالحة");
    }

    return {
      originalSaleItemId,
      quantity,
    };
  });
}

function getReturnPublicId(businessDate: string): string {
  const datePart = businessDate.replace(/-/g, "");

  const randomPart = randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();

  return `RET-${datePart}-${randomPart}`;
}

function toReturnResponse(
  saleReturn: typeof posSaleReturnsTable.$inferSelect,
  items: Array<typeof posSaleReturnItemsTable.$inferSelect>,
  alreadyCreated: boolean,
) {
  return {
    alreadyCreated,

    saleReturn: {
      id: String(saleReturn.id),
      publicId: saleReturn.publicId,

      originalSaleId: String(saleReturn.originalSaleId),

      cashSessionId: String(saleReturn.cashSessionId),
      registerKey: saleReturn.registerKey,
      businessDate: saleReturn.businessDate,

      cashierUserId: String(saleReturn.cashierUserId),

      status: saleReturn.status,
      refundMethod: saleReturn.refundMethod,

      grossAmountMinor: saleReturn.grossAmountMinor,
      grossAmount: saleReturn.grossAmountMinor / 100,

      discountAmountMinor: saleReturn.discountAmountMinor,

      discountAmount: saleReturn.discountAmountMinor / 100,

      refundAmountMinor: saleReturn.refundAmountMinor,
      refundAmount: saleReturn.refundAmountMinor / 100,

      reason: saleReturn.reason,
      notes: saleReturn.notes,

      createdAt: saleReturn.createdAt.toISOString(),
    },

    items: items.map((item) => ({
      id: String(item.id),

      originalSaleItemId: String(item.originalSaleItemId),

      productId: item.productId === null ? null : String(item.productId),

      lineNumber: item.lineNumber,

      barcode: item.barcode,
      productCode: item.productCode,
      productNameAr: item.productNameAr,

      color: item.color,
      size: item.size,

      quantity: item.quantity,

      soldUnitPriceMinor: item.soldUnitPriceMinor,
      soldUnitPrice: item.soldUnitPriceMinor / 100,

      grossAmountMinor: item.grossAmountMinor,
      grossAmount: item.grossAmountMinor / 100,

      lineDiscountMinor: item.lineDiscountMinor,
      lineDiscount: item.lineDiscountMinor / 100,

      invoiceDiscountMinor: item.invoiceDiscountMinor,
      invoiceDiscount: item.invoiceDiscountMinor / 100,

      allocatedDiscountMinor: item.allocatedDiscountMinor,

      allocatedDiscount: item.allocatedDiscountMinor / 100,

      refundAmountMinor: item.refundAmountMinor,
      refundAmount: item.refundAmountMinor / 100,

      generalStockBefore: item.generalStockBefore,
      generalStockAfter: item.generalStockAfter,

      variantStockBefore: item.variantStockBefore,
      variantStockAfter: item.variantStockAfter,
    })),
  };
}

async function getExistingReturn(db: Db, idempotencyKey: string) {
  const returnRows = await db
    .select()
    .from(posSaleReturnsTable)
    .where(eq(posSaleReturnsTable.idempotencyKey, idempotencyKey))
    .limit(1);

  const saleReturn = returnRows[0];

  if (!saleReturn) {
    return null;
  }

  const items = await db
    .select()
    .from(posSaleReturnItemsTable)
    .where(eq(posSaleReturnItemsTable.returnId, saleReturn.id))
    .orderBy(asc(posSaleReturnItemsTable.lineNumber));

  return {
    saleReturn,
    items,
  };
}

export async function handleCreatePosSaleReturn(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response> {
  const auth = await requirePosUser(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        error: "بيانات المرتجع غير صالحة",
      },
      400,
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(
      {
        error: "بيانات المرتجع غير صالحة",
      },
      400,
    );
  }

  const payload = body as Record<string, unknown>;

  try {
    const registerKey = normalizeRegisterKey(payload.registerKey);

    const publicId = normalizePublicId(payload.publicId);

    const idempotencyKey = normalizeIdempotencyKey(payload.idempotencyKey);

    if (!registerKey) {
      throw new PosSaleReturnError("معرّف نقطة البيع غير صالح");
    }

    if (!publicId) {
      throw new PosSaleReturnError("رقم الفاتورة غير صالح");
    }

    if (!idempotencyKey) {
      throw new PosSaleReturnError("معرّف عملية المرتجع غير صالح");
    }

    const reason = parseRequiredText(payload.reason, 2, 500, "سبب المرتجع");

    const notes = parseOptionalText(payload.notes, 1000, "ملاحظات المرتجع");

    const requestedItems = parseReturnItems(payload.items);

    const existing = await getExistingReturn(db, idempotencyKey);

    if (existing) {
      if (existing.saleReturn.registerKey !== registerKey) {
        throw new PosSaleReturnError(
          "معرّف عملية المرتجع مستخدم في نقطة بيع أخرى",
          409,
        );
      }

      return json(toReturnResponse(existing.saleReturn, existing.items, true));
    }

    const result = await db.transaction(async (tx) => {
      const duplicateRows = await tx
        .select()
        .from(posSaleReturnsTable)
        .where(eq(posSaleReturnsTable.idempotencyKey, idempotencyKey))
        .limit(1);

      const duplicate = duplicateRows[0];

      if (duplicate) {
        const duplicateItems = await tx
          .select()
          .from(posSaleReturnItemsTable)
          .where(eq(posSaleReturnItemsTable.returnId, duplicate.id))
          .orderBy(asc(posSaleReturnItemsTable.lineNumber));

        return {
          saleReturn: duplicate,
          items: duplicateItems,
          alreadyCreated: true,
        };
      }

      const saleRows = await tx
        .select()
        .from(posSalesTable)
        .where(eq(posSalesTable.publicId, publicId))
        .for("update");

      const sale = saleRows[0];

      if (!sale) {
        throw new PosSaleReturnError("الفاتورة غير موجودة", 404);
      }

      if (sale.status !== "completed") {
        throw new PosSaleReturnError("لا يمكن إنشاء مرتجع لهذه الفاتورة", 409);
      }

      const sessionRows = await tx
        .select()
        .from(cashSessionsTable)
        .where(
          and(
            eq(cashSessionsTable.registerKey, registerKey),
            eq(cashSessionsTable.status, "open"),
          ),
        )
        .for("update");

      const session = sessionRows[0];

      if (!session) {
        throw new PosSaleReturnError(
          "يجب فتح يوم الصندوق قبل تنفيذ المرتجع",
          409,
        );
      }

      const requestedIds = requestedItems.map(
        (item) => item.originalSaleItemId,
      );

      const originalItems = await tx
        .select()
        .from(posSaleItemsTable)
        .where(
          and(
            eq(posSaleItemsTable.saleId, sale.id),
            inArray(posSaleItemsTable.id, requestedIds),
          ),
        )
        .orderBy(asc(posSaleItemsTable.lineNumber));

      if (originalItems.length !== requestedIds.length) {
        throw new PosSaleReturnError("أحد الأصناف لا ينتمي إلى الفاتورة");
      }

      const completedReturns = await tx
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

      const completedReturnIds = completedReturns.map((row) => row.id);

      let priorReturnItems: Array<typeof posSaleReturnItemsTable.$inferSelect> =
        [];

      if (completedReturnIds.length > 0) {
        priorReturnItems = await tx
          .select()
          .from(posSaleReturnItemsTable)
          .where(inArray(posSaleReturnItemsTable.returnId, completedReturnIds));
      }

      const returnedByOriginalItem = new Map<number, number>();

      const returnedLineDiscountByOriginalItem = new Map<number, number>();

      let priorGrossMinor = 0;
      let priorLineDiscountMinor = 0;
      let priorInvoiceDiscountMinor = 0;

      for (const returnedItem of priorReturnItems) {
        // مردود الهاتف الاحتياطي غير مربوط بسطر فاتورة أصلية.
        // لا يدخل في حساب المردودات العادية للفواتير.
        if (returnedItem.originalSaleItemId === null) {
          continue;
        }

        const currentQuantity =
          returnedByOriginalItem.get(returnedItem.originalSaleItemId) ?? 0;

        const nextQuantity = currentQuantity + returnedItem.quantity;

        if (!Number.isSafeInteger(nextQuantity)) {
          throw new PosSaleReturnError(
            "بيانات المردودات السابقة غير صالحة",
            409,
          );
        }

        returnedByOriginalItem.set(
          returnedItem.originalSaleItemId,
          nextQuantity,
        );

        const currentLineDiscount =
          returnedLineDiscountByOriginalItem.get(
            returnedItem.originalSaleItemId,
          ) ?? 0;

        const nextLineDiscount =
          currentLineDiscount + returnedItem.lineDiscountMinor;

        if (!Number.isSafeInteger(nextLineDiscount)) {
          throw new PosSaleReturnError(
            "خصومات المردودات السابقة غير صالحة",
            409,
          );
        }

        returnedLineDiscountByOriginalItem.set(
          returnedItem.originalSaleItemId,
          nextLineDiscount,
        );

        priorGrossMinor += returnedItem.grossAmountMinor;
        priorLineDiscountMinor += returnedItem.lineDiscountMinor;
        priorInvoiceDiscountMinor += returnedItem.invoiceDiscountMinor;
      }

      const invoiceBaseMinor = sale.subtotalMinor - sale.itemDiscountMinor;

      if (
        !Number.isSafeInteger(priorGrossMinor) ||
        !Number.isSafeInteger(priorLineDiscountMinor) ||
        !Number.isSafeInteger(priorInvoiceDiscountMinor) ||
        !Number.isSafeInteger(invoiceBaseMinor) ||
        invoiceBaseMinor < 0 ||
        priorGrossMinor > sale.subtotalMinor ||
        priorLineDiscountMinor > sale.itemDiscountMinor ||
        priorInvoiceDiscountMinor > sale.invoiceDiscountMinor ||
        priorGrossMinor - priorLineDiscountMinor > invoiceBaseMinor ||
        priorLineDiscountMinor + priorInvoiceDiscountMinor > sale.discountMinor
      ) {
        throw new PosSaleReturnError(
          "بيانات المردودات السابقة غير متطابقة",
          409,
        );
      }

      const requestedById = new Map(
        requestedItems.map((item) => [item.originalSaleItemId, item.quantity]),
      );

      const calculatedLines = originalItems.map((originalItem, index) => {
        const quantity = requestedById.get(originalItem.id) ?? 0;

        const previouslyReturned =
          returnedByOriginalItem.get(originalItem.id) ?? 0;

        const previouslyReturnedLineDiscount =
          returnedLineDiscountByOriginalItem.get(originalItem.id) ?? 0;

        const returnableQuantity = originalItem.quantity - previouslyReturned;

        if (returnableQuantity < 0 || quantity > returnableQuantity) {
          throw new PosSaleReturnError(
            `الكمية المرتجعة من ${originalItem.productNameAr} أكبر من الكمية المتبقية`,
            409,
          );
        }

        if (quantity < 1) {
          throw new PosSaleReturnError(
            `كمية مرتجع ${originalItem.productNameAr} غير صالحة`,
          );
        }

        const grossAmountMinor = originalItem.soldUnitPriceMinor * quantity;

        if (
          !Number.isSafeInteger(grossAmountMinor) ||
          grossAmountMinor < 0 ||
          grossAmountMinor > MAX_MINOR
        ) {
          throw new PosSaleReturnError(
            "قيمة أحد أصناف المرتجع تتجاوز الحد المسموح",
          );
        }

        const returnedAfter = previouslyReturned + quantity;

        const targetLineDiscountMinor =
          returnedAfter === originalItem.quantity
            ? originalItem.lineDiscountMinor
            : Number(
                (BigInt(originalItem.lineDiscountMinor) *
                  BigInt(returnedAfter)) /
                  BigInt(originalItem.quantity),
              );

        const lineDiscountMinor =
          targetLineDiscountMinor - previouslyReturnedLineDiscount;

        if (
          !Number.isSafeInteger(targetLineDiscountMinor) ||
          !Number.isSafeInteger(lineDiscountMinor) ||
          targetLineDiscountMinor < previouslyReturnedLineDiscount ||
          targetLineDiscountMinor > originalItem.lineDiscountMinor ||
          lineDiscountMinor < 0 ||
          lineDiscountMinor > grossAmountMinor
        ) {
          throw new PosSaleReturnError(
            `تعذر احتساب خصم ${originalItem.productNameAr}`,
            409,
          );
        }

        const netBeforeInvoiceMinor = grossAmountMinor - lineDiscountMinor;

        return {
          returnLineNumber: index + 1,
          originalItem,
          quantity,
          grossAmountMinor,
          lineDiscountMinor,
          netBeforeInvoiceMinor,
          invoiceDiscountMinor: 0,
          allocatedDiscountMinor: 0,
          refundAmountMinor: 0,
        };
      });

      let runningNetBeforeInvoiceMinor =
        priorGrossMinor - priorLineDiscountMinor;

      let runningInvoiceDiscountMinor = priorInvoiceDiscountMinor;

      for (const line of calculatedLines) {
        const nextNetBeforeInvoiceMinor =
          runningNetBeforeInvoiceMinor + line.netBeforeInvoiceMinor;

        if (
          !Number.isSafeInteger(nextNetBeforeInvoiceMinor) ||
          nextNetBeforeInvoiceMinor > invoiceBaseMinor
        ) {
          throw new PosSaleReturnError(
            "صافي المرتجع أكبر من صافي الفاتورة",
            409,
          );
        }

        let targetInvoiceDiscountMinor = 0;

        if (invoiceBaseMinor > 0) {
          targetInvoiceDiscountMinor =
            nextNetBeforeInvoiceMinor === invoiceBaseMinor
              ? sale.invoiceDiscountMinor
              : Number(
                  (BigInt(sale.invoiceDiscountMinor) *
                    BigInt(nextNetBeforeInvoiceMinor)) /
                    BigInt(invoiceBaseMinor),
                );
        }

        const invoiceDiscountMinor =
          targetInvoiceDiscountMinor - runningInvoiceDiscountMinor;

        if (
          !Number.isSafeInteger(invoiceDiscountMinor) ||
          invoiceDiscountMinor < 0 ||
          invoiceDiscountMinor > line.netBeforeInvoiceMinor
        ) {
          throw new PosSaleReturnError(
            "تعذر توزيع خصم الفاتورة على المرتجع",
            409,
          );
        }

        line.invoiceDiscountMinor = invoiceDiscountMinor;

        line.allocatedDiscountMinor =
          line.lineDiscountMinor + line.invoiceDiscountMinor;

        line.refundAmountMinor =
          line.grossAmountMinor - line.allocatedDiscountMinor;

        runningNetBeforeInvoiceMinor = nextNetBeforeInvoiceMinor;

        runningInvoiceDiscountMinor = targetInvoiceDiscountMinor;
      }

      const grossAmountMinor = calculatedLines.reduce(
        (total, line) => total + line.grossAmountMinor,
        0,
      );

      const lineDiscountAmountMinor = calculatedLines.reduce(
        (total, line) => total + line.lineDiscountMinor,
        0,
      );

      const invoiceDiscountAmountMinor = calculatedLines.reduce(
        (total, line) => total + line.invoiceDiscountMinor,
        0,
      );

      const discountAmountMinor =
        lineDiscountAmountMinor + invoiceDiscountAmountMinor;

      const refundAmountMinor = calculatedLines.reduce(
        (total, line) => total + line.refundAmountMinor,
        0,
      );

      if (
        !Number.isSafeInteger(grossAmountMinor) ||
        !Number.isSafeInteger(lineDiscountAmountMinor) ||
        !Number.isSafeInteger(invoiceDiscountAmountMinor) ||
        !Number.isSafeInteger(discountAmountMinor) ||
        !Number.isSafeInteger(refundAmountMinor) ||
        grossAmountMinor > MAX_MINOR ||
        lineDiscountAmountMinor > MAX_MINOR ||
        invoiceDiscountAmountMinor > MAX_MINOR ||
        discountAmountMinor > MAX_MINOR ||
        refundAmountMinor > MAX_MINOR ||
        refundAmountMinor !== grossAmountMinor - discountAmountMinor
      ) {
        throw new PosSaleReturnError("قيمة المرتجع تتجاوز الحد المسموح");
      }

      const expectedBefore =
        session.expectedBalanceMinor ?? session.openingBalanceMinor;

      if (expectedBefore < refundAmountMinor) {
        throw new PosSaleReturnError(
          "رصيد الصندوق لا يكفي لتنفيذ مبلغ المرتجع",
          409,
        );
      }

      const expectedAfter = expectedBefore - refundAmountMinor;

      const returnLines: Array<typeof posSaleReturnItemsTable.$inferInsert> =
        [];

      const stockOrderedLines = [...calculatedLines].sort((left, right) => {
        const leftProductId = left.originalItem.productId ?? 0;

        const rightProductId = right.originalItem.productId ?? 0;

        return (
          leftProductId - rightProductId ||
          left.originalItem.lineNumber - right.originalItem.lineNumber
        );
      });

      for (const line of stockOrderedLines) {
        const originalItem = line.originalItem;

        if (originalItem.productId === null) {
          throw new PosSaleReturnError(
            `المنتج ${originalItem.productNameAr} لم يعد موجودًا ولا يمكن إعادة مخزونه`,
            409,
          );
        }

        const productRows = await tx
          .select()
          .from(productsTable)
          .where(eq(productsTable.id, originalItem.productId))
          .for("update");

        const product = productRows[0];

        if (!product) {
          throw new PosSaleReturnError(
            `المنتج ${originalItem.productNameAr} لم يعد موجودًا`,
            409,
          );
        }

        const updates: {
          stock?: number;
          colorVariants?: ColorVariant[];
        } = {};

        let generalStockBefore: number | null = null;
        let generalStockAfter: number | null = null;

        const trackedGeneralStock =
          originalItem.generalStockBefore !== null ||
          originalItem.generalStockAfter !== null;

        if (trackedGeneralStock) {
          if (product.stock === null || product.stock === undefined) {
            throw new PosSaleReturnError(
              `المخزون العام للمنتج ${originalItem.productNameAr} لم يعد قابلًا للتتبع`,
              409,
            );
          }

          generalStockBefore = product.stock;
          generalStockAfter = product.stock + line.quantity;

          if (
            !Number.isSafeInteger(generalStockAfter) ||
            generalStockAfter > MAX_STOCK
          ) {
            throw new PosSaleReturnError(
              `مخزون ${originalItem.productNameAr} يتجاوز الحد المسموح`,
            );
          }

          updates.stock = generalStockAfter;
        }

        let variantStockBefore: number | null = null;
        let variantStockAfter: number | null = null;

        const trackedVariantStock =
          originalItem.variantStockBefore !== null ||
          originalItem.variantStockAfter !== null;

        if (trackedVariantStock) {
          if (!originalItem.color || !originalItem.size) {
            throw new PosSaleReturnError(
              `بيانات لون أو مقاس ${originalItem.productNameAr} غير مكتملة`,
              409,
            );
          }

          const colorVariants =
            (product.colorVariants as ColorVariant[] | null) ?? [];

          const variantIndex = colorVariants.findIndex(
            (variant) => variant.color === originalItem.color,
          );

          if (variantIndex < 0) {
            throw new PosSaleReturnError(
              `لون ${originalItem.productNameAr} لم يعد موجودًا`,
              409,
            );
          }

          const variant = colorVariants[variantIndex];

          const variantSizes = Array.isArray(variant.sizes)
            ? variant.sizes
            : [];

          const sizeIndex = variantSizes.findIndex(
            (entry) => entry.size === originalItem.size,
          );

          if (sizeIndex < 0) {
            throw new PosSaleReturnError(
              `مقاس ${originalItem.productNameAr} لم يعد موجودًا`,
              409,
            );
          }

          const selectedSize = variantSizes[sizeIndex];

          if (selectedSize.stock === null || selectedSize.stock === undefined) {
            throw new PosSaleReturnError(
              `مخزون لون ومقاس ${originalItem.productNameAr} لم يعد قابلًا للتتبع`,
              409,
            );
          }

          variantStockBefore = selectedSize.stock;

          variantStockAfter = selectedSize.stock + line.quantity;

          if (
            !Number.isSafeInteger(variantStockAfter) ||
            variantStockAfter > MAX_STOCK
          ) {
            throw new PosSaleReturnError(
              `مخزون لون ومقاس ${originalItem.productNameAr} يتجاوز الحد المسموح`,
            );
          }

          const nextSizes = variantSizes.map((entry, index) =>
            index === sizeIndex
              ? {
                  ...entry,
                  stock: variantStockAfter,
                  outOfStock: false,
                }
              : entry,
          );

          updates.colorVariants = colorVariants.map((entry, index) =>
            index === variantIndex
              ? {
                  ...entry,
                  sizes: nextSizes,
                }
              : entry,
          );
        }

        if (Object.keys(updates).length > 0) {
          await tx
            .update(productsTable)
            .set(updates)
            .where(eq(productsTable.id, product.id));
        }

        returnLines.push({
          returnId: 0,

          originalSaleItemId: originalItem.id,

          lineNumber: line.returnLineNumber,

          productId: product.id,

          barcode: originalItem.barcode,
          productCode: originalItem.productCode,
          productNameAr: originalItem.productNameAr,

          color: originalItem.color,
          size: originalItem.size,

          quantity: line.quantity,

          soldUnitPriceMinor: originalItem.soldUnitPriceMinor,

          grossAmountMinor: line.grossAmountMinor,

          lineDiscountMinor: line.lineDiscountMinor,

          invoiceDiscountMinor: line.invoiceDiscountMinor,

          allocatedDiscountMinor: line.allocatedDiscountMinor,

          refundAmountMinor: line.refundAmountMinor,

          generalStockBefore,
          generalStockAfter,

          variantStockBefore,
          variantStockAfter,
        });
      }

      const insertedReturnRows = await tx
        .insert(posSaleReturnsTable)
        .values({
          publicId: getReturnPublicId(session.businessDate),

          idempotencyKey,

          originalSaleId: sale.id,

          cashSessionId: session.id,
          registerKey,
          businessDate: session.businessDate,

          cashierUserId: auth.user.id,

          status: "completed",
          refundMethod: "cash",

          grossAmountMinor,
          discountAmountMinor,
          refundAmountMinor,

          reason,
          notes,
        })
        .returning();

      const saleReturn = insertedReturnRows[0];

      if (!saleReturn) {
        throw new Error("POS_SALE_RETURN_INSERT_FAILED");
      }

      const insertedItems = await tx
        .insert(posSaleReturnItemsTable)
        .values(
          returnLines
            .sort((left, right) => left.lineNumber - right.lineNumber)
            .map((line) => ({
              ...line,
              returnId: saleReturn.id,
            })),
        )
        .returning();

      const updatedSessionRows = await tx
        .update(cashSessionsTable)
        .set({
          expectedBalanceMinor: expectedAfter,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(cashSessionsTable.id, session.id),
            eq(cashSessionsTable.status, "open"),
          ),
        )
        .returning({
          id: cashSessionsTable.id,
        });

      if (!updatedSessionRows[0]) {
        throw new PosSaleReturnError("تم إغلاق الصندوق قبل إتمام المرتجع", 409);
      }

      return {
        saleReturn,
        items: insertedItems.sort(
          (left, right) => left.lineNumber - right.lineNumber,
        ),
        alreadyCreated: false,
      };
    });

    return json(
      toReturnResponse(result.saleReturn, result.items, result.alreadyCreated),
      result.alreadyCreated ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof PosSaleReturnError) {
      return json(
        {
          error: error.message,
        },
        error.status,
      );
    }

    const code = (error as { code?: string }).code;

    if (code === "23505") {
      const idempotencyKey = normalizeIdempotencyKey(payload.idempotencyKey);

      const registerKey = normalizeRegisterKey(payload.registerKey);

      if (idempotencyKey && registerKey) {
        const existing = await getExistingReturn(db, idempotencyKey);

        if (existing && existing.saleReturn.registerKey === registerKey) {
          return json(
            toReturnResponse(existing.saleReturn, existing.items, true),
          );
        }
      }
    }

    console.error("POS_SALE_RETURN_CREATE_FAILED", error);

    return json(
      {
        error: "تعذر إتمام عملية المرتجع",
      },
      500,
    );
  }
}
