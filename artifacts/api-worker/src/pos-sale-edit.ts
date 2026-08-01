import {
  cashSessionsTable,
  posSaleItemsTable,
  posSaleRevisionsTable,
  posSaleReturnsTable,
  posSalesTable,
  productBarcodesTable,
  productsTable,
  type ColorVariant,
  type PosSaleRevisionSnapshot,
} from "@workspace/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

type PosUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

const MAX_MINOR = 2_000_000_000;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers,
  });

class PosSaleEditError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface ParsedEditItem {
  lineNumber: number;
  barcode: string;
  quantity: number;
  soldUnitPriceMinor: number;
  lineDiscountMinor: number;
  color: string | null;
  size: string | null;
}

interface ResolvedEditItem extends ParsedEditItem {
  productId: number;
  mappedColor: string | null;
  mappedSize: string | null;
}

interface MutableProductState {
  row: typeof productsTable.$inferSelect;
  stock: number | null;
  colorVariants: ColorVariant[];
  changed: boolean;
}

function normalizeRegisterKey(value: unknown): string | null {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "main";

  return /^[a-z0-9_-]{1,50}$/.test(key) ? key : null;
}

function normalizeBarcode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const barcode = value.trim();

  if (barcode.length < 1 || barcode.length > 128) {
    return null;
  }

  return barcode;
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

function normalizeExpectedUpdatedAt(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value.trim());

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function parseMoneyToMinor(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }

  const normalized =
    typeof value === "string" ? value.trim().replace(",", ".") : value;

  const amount =
    typeof normalized === "number" ? normalized : Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  const minor = Math.round(amount * 100);

  if (
    Math.abs(minor / 100 - amount) > 0.000001 ||
    !Number.isSafeInteger(minor) ||
    minor > MAX_MINOR
  ) {
    return null;
  }

  return minor;
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
    throw new PosSaleEditError(`${fieldName} غير صالح`);
  }

  const text = value.trim();

  if (text.length > maxLength) {
    throw new PosSaleEditError(`${fieldName} طويل جدًا`);
  }

  return text || null;
}

function parseItems(value: unknown): ParsedEditItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new PosSaleEditError("يجب إضافة صنف واحد على الأقل");
  }

  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new PosSaleEditError("بيانات أحد الأصناف غير صالحة");
    }

    const item = raw as Record<string, unknown>;

    const barcode = normalizeBarcode(item.barcode);

    if (!barcode) {
      throw new PosSaleEditError("باركود أحد الأصناف غير صالح");
    }

    const quantity =
      typeof item.quantity === "number"
        ? item.quantity
        : typeof item.quantity === "string" && item.quantity.trim()
          ? Number(item.quantity)
          : Number.NaN;

    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new PosSaleEditError("كمية أحد الأصناف غير صالحة");
    }

    const soldUnitPriceMinor = parseMoneyToMinor(item.soldUnitPrice);

    if (soldUnitPriceMinor === null) {
      throw new PosSaleEditError("سعر بيع أحد الأصناف غير صالح");
    }

    const lineDiscountMinor =
      item.lineDiscount === undefined
        ? 0
        : parseMoneyToMinor(item.lineDiscount);

    if (lineDiscountMinor === null) {
      throw new PosSaleEditError("خصم أحد الأصناف غير صالح");
    }

    const lineGrossMinor = soldUnitPriceMinor * quantity;

    if (
      !Number.isSafeInteger(lineGrossMinor) ||
      lineGrossMinor > MAX_MINOR ||
      lineDiscountMinor > lineGrossMinor
    ) {
      throw new PosSaleEditError("خصم أحد الأصناف أكبر من قيمة الصنف");
    }

    return {
      lineNumber: index + 1,
      barcode,
      quantity,
      soldUnitPriceMinor,
      lineDiscountMinor,
      color: parseOptionalText(item.color, 100, "اللون"),
      size: parseOptionalText(item.size, 100, "المقاس"),
    };
  });
}

function cloneColorVariants(value: unknown): ColorVariant[] {
  const variants = (value as ColorVariant[] | null) ?? [];

  return variants.map((variant) => ({
    ...variant,
    sizes: Array.isArray(variant.sizes)
      ? variant.sizes.map((size) => ({
          ...size,
        }))
      : [],
  }));
}

function makeSnapshot(
  sale: typeof posSalesTable.$inferSelect,
  items: Array<typeof posSaleItemsTable.$inferSelect>,
): PosSaleRevisionSnapshot {
  return JSON.parse(
    JSON.stringify({
      sale,
      items,
    }),
  ) as PosSaleRevisionSnapshot;
}

function toSaleResponse(
  sale: typeof posSalesTable.$inferSelect,
  items: Array<typeof posSaleItemsTable.$inferSelect>,
  revisionNumber: number,
  alreadyUpdated: boolean,
) {
  return {
    alreadyCreated: false,
    alreadyUpdated,
    revisionNumber,

    sale: {
      id: String(sale.id),
      publicId: sale.publicId,
      cashSessionId: String(sale.cashSessionId),
      registerKey: sale.registerKey,
      businessDate: sale.businessDate,
      cashierUserId: String(sale.cashierUserId),
      status: sale.status,
      paymentMethod: sale.paymentMethod,

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

      paidMinor: sale.paidMinor,
      paid: sale.paidMinor / 100,

      changeMinor: sale.changeMinor,
      change: sale.changeMinor / 100,

      customerName: sale.customerName,
      customerPhone: sale.customerPhone,
      notes: sale.notes,

      voidedAt: sale.voidedAt?.toISOString() ?? null,

      voidedByUserId:
        sale.voidedByUserId === null ? null : String(sale.voidedByUserId),

      voidReason: sale.voidReason,

      createdAt: sale.createdAt.toISOString(),

      updatedAt: sale.updatedAt.toISOString(),
    },

    items: items.map((item) => ({
      id: String(item.id),

      productId: item.productId === null ? null : String(item.productId),

      lineNumber: item.lineNumber,
      barcode: item.barcode,
      productCode: item.productCode,
      productNameAr: item.productNameAr,
      productImage: item.productImage,

      color: item.color,
      size: item.size,
      quantity: item.quantity,

      websiteUnitPriceMinor: item.websiteUnitPriceMinor,

      websiteUnitPrice: item.websiteUnitPriceMinor / 100,

      soldUnitPriceMinor: item.soldUnitPriceMinor,

      soldUnitPrice: item.soldUnitPriceMinor / 100,

      lineDiscountMinor: item.lineDiscountMinor,

      lineDiscount: item.lineDiscountMinor / 100,

      lineTotalMinor: item.lineTotalMinor,

      lineTotal: item.lineTotalMinor / 100,

      generalStockBefore: item.generalStockBefore,

      generalStockAfter: item.generalStockAfter,

      variantStockBefore: item.variantStockBefore,

      variantStockAfter: item.variantStockAfter,
    })),
  };
}

async function getExistingRevision(db: Db, idempotencyKey: string) {
  const revisionRows = await db
    .select()
    .from(posSaleRevisionsTable)
    .where(eq(posSaleRevisionsTable.idempotencyKey, idempotencyKey))
    .limit(1);

  const revision = revisionRows[0];

  if (!revision) {
    return null;
  }

  const saleRows = await db
    .select()
    .from(posSalesTable)
    .where(eq(posSalesTable.id, revision.saleId))
    .limit(1);

  const sale = saleRows[0];

  if (!sale) {
    throw new Error("POS_SALE_REVISION_SALE_MISSING");
  }

  const items = await db
    .select()
    .from(posSaleItemsTable)
    .where(eq(posSaleItemsTable.saleId, sale.id))
    .orderBy(asc(posSaleItemsTable.lineNumber));

  return {
    revision,
    sale,
    items,
  };
}

function restoreOldItemStock(
  state: MutableProductState,
  item: typeof posSaleItemsTable.$inferSelect,
) {
  if (item.generalStockAfter !== null) {
    if (state.stock === null) {
      throw new PosSaleEditError(
        `تعذر إعادة المخزون العام للصنف ${item.productNameAr}`,
        409,
      );
    }

    const nextStock = state.stock + item.quantity;

    if (!Number.isSafeInteger(nextStock) || nextStock < 0) {
      throw new PosSaleEditError(`تعذر إعادة مخزون ${item.productNameAr}`, 409);
    }

    state.stock = nextStock;
    state.changed = true;
  }

  if (item.variantStockAfter === null) {
    return;
  }

  if (!item.color || !item.size) {
    throw new PosSaleEditError(
      `لون أو مقاس ${item.productNameAr} غير محفوظ`,
      409,
    );
  }

  const variantIndex = state.colorVariants.findIndex(
    (variant) => variant.color === item.color,
  );

  if (variantIndex < 0) {
    throw new PosSaleEditError(`لون ${item.productNameAr} لم يعد موجودًا`, 409);
  }

  const variant = state.colorVariants[variantIndex];

  const sizeIndex = variant.sizes.findIndex(
    (entry) => entry.size === item.size,
  );

  if (sizeIndex < 0) {
    throw new PosSaleEditError(
      `مقاس ${item.productNameAr} لم يعد موجودًا`,
      409,
    );
  }

  const selectedSize = variant.sizes[sizeIndex];

  if (selectedSize.stock === null || selectedSize.stock === undefined) {
    throw new PosSaleEditError(
      `تعذر إعادة مخزون متغير ${item.productNameAr}`,
      409,
    );
  }

  const nextStock = selectedSize.stock + item.quantity;

  if (!Number.isSafeInteger(nextStock) || nextStock < 0) {
    throw new PosSaleEditError(`تعذر إعادة مخزون ${item.productNameAr}`, 409);
  }

  variant.sizes[sizeIndex] = {
    ...selectedSize,
    stock: nextStock,
    outOfStock: nextStock <= 0,
  };

  state.changed = true;
}

function applyNewItemStock(state: MutableProductState, item: ResolvedEditItem) {
  const product = state.row;

  if (!Number.isSafeInteger(product.price) || product.price < 0) {
    throw new PosSaleEditError(`سعر المنتج ${product.nameAr} غير صالح`);
  }

  if (item.mappedColor && item.color && item.mappedColor !== item.color) {
    throw new PosSaleEditError(`لون باركود ${item.barcode} غير مطابق`);
  }

  if (item.mappedSize && item.size && item.mappedSize !== item.size) {
    throw new PosSaleEditError(`مقاس باركود ${item.barcode} غير مطابق`);
  }

  const color = item.mappedColor ?? item.color;

  const size = item.mappedSize ?? item.size;

  const generalSizes = (product.sizes as string[] | null) ?? [];

  let variantStockBefore: number | null = null;

  let variantStockAfter: number | null = null;

  if (state.colorVariants.length > 0) {
    if (!color) {
      throw new PosSaleEditError(`يجب تحديد لون ${product.nameAr}`);
    }

    const variantIndex = state.colorVariants.findIndex(
      (variant) => variant.color === color,
    );

    if (variantIndex < 0) {
      throw new PosSaleEditError(`لون ${product.nameAr} غير متوفر`);
    }

    const variant = state.colorVariants[variantIndex];

    if (variant.sizes.length > 0) {
      if (!size) {
        throw new PosSaleEditError(`يجب تحديد مقاس ${product.nameAr}`);
      }

      const sizeIndex = variant.sizes.findIndex((entry) => entry.size === size);

      if (sizeIndex < 0) {
        throw new PosSaleEditError(`مقاس ${product.nameAr} غير متوفر`);
      }

      const selectedSize = variant.sizes[sizeIndex];

      variantStockBefore = selectedSize.stock ?? null;

      if (
        selectedSize.outOfStock ||
        (selectedSize.stock !== null &&
          selectedSize.stock !== undefined &&
          selectedSize.stock < item.quantity)
      ) {
        throw new PosSaleEditError(
          `الكمية المطلوبة من ${product.nameAr} غير متوفرة`,
          409,
        );
      }

      if (selectedSize.stock !== null && selectedSize.stock !== undefined) {
        variantStockAfter = selectedSize.stock - item.quantity;

        variant.sizes[sizeIndex] = {
          ...selectedSize,
          stock: variantStockAfter,
          outOfStock: variantStockAfter <= 0,
        };

        state.changed = true;
      }
    } else if (size) {
      throw new PosSaleEditError(`المقاس غير صالح للمنتج ${product.nameAr}`);
    }
  } else {
    if (color) {
      throw new PosSaleEditError(`اللون غير صالح للمنتج ${product.nameAr}`);
    }

    if (generalSizes.length > 0) {
      if (!size || !generalSizes.includes(size)) {
        throw new PosSaleEditError(`مقاس ${product.nameAr} غير متوفر`);
      }
    } else if (size) {
      throw new PosSaleEditError(`المقاس غير صالح للمنتج ${product.nameAr}`);
    }
  }

  const generalStockBefore = state.stock;

  let generalStockAfter: number | null = null;

  if (state.stock !== null) {
    if (state.stock < item.quantity) {
      throw new PosSaleEditError(
        `الكمية المطلوبة من ${product.nameAr} غير متوفرة`,
        409,
      );
    }

    generalStockAfter = state.stock - item.quantity;

    state.stock = generalStockAfter;
    state.changed = true;
  }

  const websiteUnitPriceMinor = product.price * 100;

  const lineGrossMinor = item.soldUnitPriceMinor * item.quantity;

  const lineTotalMinor = lineGrossMinor - item.lineDiscountMinor;

  if (
    !Number.isSafeInteger(websiteUnitPriceMinor) ||
    websiteUnitPriceMinor > MAX_MINOR ||
    !Number.isSafeInteger(lineGrossMinor) ||
    lineGrossMinor > MAX_MINOR ||
    !Number.isSafeInteger(lineTotalMinor) ||
    lineTotalMinor < 0 ||
    lineTotalMinor > MAX_MINOR
  ) {
    throw new PosSaleEditError("قيمة الفاتورة تتجاوز الحد المسموح");
  }

  return {
    saleLine: {
      saleId: 0,
      lineNumber: item.lineNumber,
      productId: product.id,
      barcode: item.barcode,
      productCode: product.productCode ?? null,
      productNameAr: product.nameAr,
      productImage: product.image,
      color,
      size,
      quantity: item.quantity,
      websiteUnitPriceMinor,
      soldUnitPriceMinor: item.soldUnitPriceMinor,
      lineDiscountMinor: item.lineDiscountMinor,
      lineTotalMinor,
      generalStockBefore,
      generalStockAfter,
      variantStockBefore,
      variantStockAfter,
    } satisfies typeof posSaleItemsTable.$inferInsert,

    lineGrossMinor,
    lineDiscountMinor: item.lineDiscountMinor,
  };
}

async function requirePosUser(
  request: Request,
  db: Db,
  env: Env,
): Promise<PosUser | Response> {
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return json(
      {
        error: "يجب تسجيل الدخول",
      },
      401,
    );
  }

  if (!user.isAdmin && !user.isOwner) {
    return json(
      {
        error: "غير مصرح باستخدام نقطة البيع",
      },
      403,
    );
  }

  return user;
}

export async function handleUpdatePosSale(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response> {
  const auth = await requirePosUser(request, db, env);

  if (auth instanceof Response) {
    return auth;
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(
      {
        error: "بيانات تعديل الفاتورة غير صالحة",
      },
      400,
    );
  }

  const payload = body as Record<string, unknown>;

  try {
    const publicId = normalizePublicId(payload.publicId);

    if (!publicId) {
      throw new PosSaleEditError("رقم الفاتورة غير صالح");
    }

    const registerKey = normalizeRegisterKey(payload.registerKey ?? "main");

    if (!registerKey) {
      throw new PosSaleEditError("معرف صندوق غير صالح");
    }

    const idempotencyKey = normalizeIdempotencyKey(payload.idempotencyKey);

    if (!idempotencyKey) {
      throw new PosSaleEditError("مفتاح منع تكرار التعديل غير صالح");
    }
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
      payload.expectedUpdatedAt,
    );

    if (!expectedUpdatedAt) {
      throw new PosSaleEditError("نسخة الفاتورة المتوقعة غير صالحة");
    }

    const reason = parseOptionalText(payload.reason, 500, "سبب التعديل");

    if (!reason) {
      throw new PosSaleEditError("يجب إدخال سبب تعديل الفاتورة");
    }

    if (
      payload.paymentMethod !== undefined &&
      payload.paymentMethod !== "cash"
    ) {
      throw new PosSaleEditError("الدفع النقدي فقط متاح حاليًا");
    }

    const items = parseItems(payload.items);

    const invoiceDiscountMinor =
      payload.discountAmount === undefined
        ? 0
        : parseMoneyToMinor(payload.discountAmount);

    if (invoiceDiscountMinor === null) {
      throw new PosSaleEditError("خصم الفاتورة غير صالح");
    }

    const paidMinor = parseMoneyToMinor(payload.paidAmount);

    if (paidMinor === null) {
      throw new PosSaleEditError("المبلغ المدفوع غير صالح");
    }

    const customerName = parseOptionalText(
      payload.customerName,
      150,
      "اسم العميل",
    );

    const customerPhone = parseOptionalText(
      payload.customerPhone,
      50,
      "هاتف العميل",
    );

    const notes = parseOptionalText(payload.notes, 1000, "الملاحظات");

    const existingBefore = await getExistingRevision(db, idempotencyKey);

    if (existingBefore) {
      if (existingBefore.sale.publicId !== publicId) {
        throw new PosSaleEditError("مفتاح التعديل مستخدم لفاتورة أخرى", 409);
      }

      return json(
        toSaleResponse(
          existingBefore.sale,
          existingBefore.items,
          existingBefore.revision.revisionNumber,
          true,
        ),
      );
    }

    const result = await db.transaction(async (tx) => {
      const duplicateRows = await tx
        .select()
        .from(posSaleRevisionsTable)
        .where(eq(posSaleRevisionsTable.idempotencyKey, idempotencyKey))
        .limit(1);

      const duplicate = duplicateRows[0];

      if (duplicate) {
        const duplicateSaleRows = await tx
          .select()
          .from(posSalesTable)
          .where(eq(posSalesTable.id, duplicate.saleId))
          .limit(1);

        const duplicateSale = duplicateSaleRows[0];

        if (!duplicateSale || duplicateSale.publicId !== publicId) {
          throw new PosSaleEditError("مفتاح التعديل مستخدم لفاتورة أخرى", 409);
        }

        const duplicateItems = await tx
          .select()
          .from(posSaleItemsTable)
          .where(eq(posSaleItemsTable.saleId, duplicateSale.id))
          .orderBy(asc(posSaleItemsTable.lineNumber));

        return {
          sale: duplicateSale,
          items: duplicateItems,
          revisionNumber: duplicate.revisionNumber,
          alreadyUpdated: true,
        };
      }

      const saleRows = await tx
        .select()
        .from(posSalesTable)
        .where(eq(posSalesTable.publicId, publicId))
        .for("update");

      const sale = saleRows[0];

      if (!sale) {
        throw new PosSaleEditError("الفاتورة غير موجودة", 404);
      }

      if (sale.updatedAt.toISOString() !== expectedUpdatedAt) {
        throw new PosSaleEditError(
          "تم تعديل الفاتورة بواسطة مستخدم آخر. أعد تحميلها قبل المتابعة",
          409,
        );
      }

      if (sale.registerKey !== registerKey) {
        throw new PosSaleEditError("الفاتورة تابعة لصندوق آخر", 409);
      }

      if (sale.status !== "completed") {
        throw new PosSaleEditError("لا يمكن تعديل فاتورة ملغاة", 409);
      }

      const completedReturnRows = await tx
        .select({
          id: posSaleReturnsTable.id,
        })
        .from(posSaleReturnsTable)
        .where(
          and(
            eq(posSaleReturnsTable.originalSaleId, sale.id),
            eq(posSaleReturnsTable.status, "completed"),
          ),
        )
        .limit(1);

      if (completedReturnRows[0]) {
        throw new PosSaleEditError(
          "لا يمكن تعديل فاتورة تحتوي على مردودات",
          409,
        );
      }

      const sessionRows = await tx
        .select()
        .from(cashSessionsTable)
        .where(
          and(
            eq(cashSessionsTable.id, sale.cashSessionId),
            eq(cashSessionsTable.status, "open"),
          ),
        )
        .for("update");

      const session = sessionRows[0];

      if (!session) {
        throw new PosSaleEditError(
          "لا يمكن تعديل الفاتورة بعد إغلاق يوم الصندوق",
          409,
        );
      }

      const oldItems = await tx
        .select()
        .from(posSaleItemsTable)
        .where(eq(posSaleItemsTable.saleId, sale.id))
        .orderBy(asc(posSaleItemsTable.lineNumber));

      const beforeSnapshot = makeSnapshot(sale, oldItems);

      const resolvedItems: ResolvedEditItem[] = [];

      for (const item of items) {
        const mappingRows = await tx
          .select()
          .from(productBarcodesTable)
          .where(eq(productBarcodesTable.barcode, item.barcode))
          .limit(1);

        const mapping = mappingRows[0];

        if (mapping) {
          resolvedItems.push({
            ...item,
            productId: mapping.productId,
            mappedColor: mapping.color ?? null,
            mappedSize: mapping.size ?? null,
          });

          continue;
        }

        const productRows = await tx
          .select({
            id: productsTable.id,
          })
          .from(productsTable)
          .where(eq(productsTable.barcode, item.barcode))
          .limit(1);

        const product = productRows[0];

        if (!product) {
          throw new PosSaleEditError(`الباركود ${item.barcode} غير موجود`, 404);
        }

        resolvedItems.push({
          ...item,
          productId: product.id,
          mappedColor: null,
          mappedSize: null,
        });
      }

      const productIds = [
        ...new Set([
          ...oldItems.map((item) => {
            if (item.productId === null) {
              throw new PosSaleEditError(
                `المنتج ${item.productNameAr} لم يعد موجودًا`,
                409,
              );
            }

            return item.productId;
          }),
          ...resolvedItems.map((item) => item.productId),
        ]),
      ].sort((left, right) => left - right);

      const productRows =
        productIds.length > 0
          ? await tx
              .select()
              .from(productsTable)
              .where(inArray(productsTable.id, productIds))
              .orderBy(asc(productsTable.id))
              .for("update")
          : [];

      if (productRows.length !== productIds.length) {
        throw new PosSaleEditError("أحد المنتجات لم يعد موجودًا", 409);
      }

      const productStates = new Map<number, MutableProductState>();

      for (const product of productRows) {
        productStates.set(product.id, {
          row: product,
          stock: product.stock ?? null,
          colorVariants: cloneColorVariants(product.colorVariants),
          changed: false,
        });
      }

      for (const oldItem of oldItems) {
        const state =
          oldItem.productId === null
            ? null
            : productStates.get(oldItem.productId);

        if (!state) {
          throw new PosSaleEditError(
            `المنتج ${oldItem.productNameAr} لم يعد موجودًا`,
            409,
          );
        }

        restoreOldItemStock(state, oldItem);
      }

      const newSaleLines: Array<typeof posSaleItemsTable.$inferInsert> = [];

      let subtotalMinor = 0;
      let itemDiscountMinor = 0;

      const orderedNewItems = [...resolvedItems].sort(
        (left, right) =>
          left.productId - right.productId ||
          left.lineNumber - right.lineNumber,
      );

      for (const newItem of orderedNewItems) {
        const state = productStates.get(newItem.productId);

        if (!state) {
          throw new PosSaleEditError("أحد المنتجات لم يعد موجودًا", 409);
        }

        const applied = applyNewItemStock(state, newItem);

        newSaleLines.push(applied.saleLine);

        subtotalMinor += applied.lineGrossMinor;

        itemDiscountMinor += applied.lineDiscountMinor;

        if (
          !Number.isSafeInteger(subtotalMinor) ||
          subtotalMinor > MAX_MINOR ||
          !Number.isSafeInteger(itemDiscountMinor) ||
          itemDiscountMinor > MAX_MINOR
        ) {
          throw new PosSaleEditError("إجمالي الفاتورة يتجاوز الحد المسموح");
        }
      }

      const itemsNetMinor = subtotalMinor - itemDiscountMinor;

      if (invoiceDiscountMinor > itemsNetMinor) {
        throw new PosSaleEditError("خصم الفاتورة أكبر من صافي قيمة الأصناف");
      }

      const discountMinor = itemDiscountMinor + invoiceDiscountMinor;

      const totalMinor = subtotalMinor - discountMinor;

      if (paidMinor < totalMinor) {
        throw new PosSaleEditError("المبلغ المدفوع أقل من قيمة الفاتورة");
      }

      const changeMinor = paidMinor - totalMinor;

      const expectedBefore =
        session.expectedBalanceMinor ?? session.openingBalanceMinor;

      const balanceDifference = totalMinor - sale.totalMinor;

      const expectedAfter = expectedBefore + balanceDifference;

      if (
        !Number.isSafeInteger(expectedAfter) ||
        expectedAfter < 0 ||
        expectedAfter > MAX_MINOR
      ) {
        throw new PosSaleEditError(
          "فرق قيمة الفاتورة غير متوافق مع رصيد الصندوق",
          409,
        );
      }

      for (const state of [...productStates.values()].sort(
        (left, right) => left.row.id - right.row.id,
      )) {
        if (!state.changed) {
          continue;
        }

        await tx
          .update(productsTable)
          .set({
            stock: state.stock,
            colorVariants: state.colorVariants,
          })
          .where(eq(productsTable.id, state.row.id));
      }

      await tx
        .delete(posSaleItemsTable)
        .where(eq(posSaleItemsTable.saleId, sale.id));

      const insertedItems = await tx
        .insert(posSaleItemsTable)
        .values(
          newSaleLines
            .sort((left, right) => left.lineNumber - right.lineNumber)
            .map((line) => ({
              ...line,
              saleId: sale.id,
            })),
        )
        .returning();

      const updatedSaleRows = await tx
        .update(posSalesTable)
        .set({
          paymentMethod: "cash",
          subtotalMinor,
          discountMinor,
          itemDiscountMinor,
          invoiceDiscountMinor,
          totalMinor,
          paidMinor,
          changeMinor,
          customerName,
          customerPhone,
          notes,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(posSalesTable.id, sale.id),
            eq(posSalesTable.status, "completed"),
          ),
        )
        .returning();

      const updatedSale = updatedSaleRows[0];

      if (!updatedSale) {
        throw new PosSaleEditError(
          "تم تغيير حالة الفاتورة قبل حفظ التعديل",
          409,
        );
      }

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
        throw new PosSaleEditError(
          "تم إغلاق الصندوق قبل حفظ تعديل الفاتورة",
          409,
        );
      }

      const lastRevisionRows = await tx
        .select({
          revisionNumber: posSaleRevisionsTable.revisionNumber,
        })
        .from(posSaleRevisionsTable)
        .where(eq(posSaleRevisionsTable.saleId, sale.id))
        .orderBy(desc(posSaleRevisionsTable.revisionNumber))
        .limit(1);

      const revisionNumber = (lastRevisionRows[0]?.revisionNumber ?? 0) + 1;

      const sortedInsertedItems = [...insertedItems].sort(
        (left, right) => left.lineNumber - right.lineNumber,
      );

      const afterSnapshot = makeSnapshot(updatedSale, sortedInsertedItems);

      await tx.insert(posSaleRevisionsTable).values({
        saleId: sale.id,
        idempotencyKey,
        revisionNumber,
        editedByUserId: auth.id,
        reason,
        beforeSnapshot,
        afterSnapshot,
      });

      return {
        sale: updatedSale,
        items: sortedInsertedItems,
        revisionNumber,
        alreadyUpdated: false,
      };
    });

    return json(
      toSaleResponse(
        result.sale,
        result.items,
        result.revisionNumber,
        result.alreadyUpdated,
      ),
    );
  } catch (error) {
    if (error instanceof PosSaleEditError) {
      return json(
        {
          error: error.message,
        },
        error.status,
      );
    }

    const code = (
      error as {
        code?: string;
      }
    ).code;

    if (code === "23505") {
      const idempotencyKey = normalizeIdempotencyKey(payload.idempotencyKey);

      const publicId = normalizePublicId(payload.publicId);

      if (idempotencyKey && publicId) {
        const existing = await getExistingRevision(db, idempotencyKey);

        if (existing && existing.sale.publicId === publicId) {
          return json(
            toSaleResponse(
              existing.sale,
              existing.items,
              existing.revision.revisionNumber,
              true,
            ),
          );
        }
      }

      return json(
        {
          error: "حدث تعارض أثناء حفظ تعديل الفاتورة",
        },
        409,
      );
    }

    console.error("POS_SALE_EDIT_FAILED", error);

    return json(
      {
        error: "تعذر حفظ تعديل الفاتورة",
      },
      500,
    );
  }
}
