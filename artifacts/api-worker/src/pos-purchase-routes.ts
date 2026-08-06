import {
  posPurchaseItemsTable,
  posPurchasesTable,
  productBarcodesTable,
  productsTable,
  suppliersTable,
  type ColorVariant,
} from "@workspace/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";
import {
  isPurchaseWriteEnabled,
  purchaseWritesDisabledResponse,
} from "./purchase-feature";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

type PosUser = NonNullable<
  Awaited<ReturnType<typeof getCurrentUser>>
>;

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

class PurchaseError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type AuthResult =
  | {
      ok: true;
      user: PosUser;
    }
  | {
      ok: false;
      response: Response;
    };

interface ParsedPurchaseItem {
  lineNumber: number;
  productId: number | null;
  barcode: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  freeQuantity: number;
  unitCostMinor: number;
  lineDiscountMinor: number;
  lineTotalMinor: number;
}

async function requirePosUser(
  request: Request,
  db: Db,
  env: Env,
): Promise<AuthResult> {
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
        { error: "غير مصرح بإدارة المشتريات" },
        403,
      ),
    };
  }

  return {
    ok: true,
    user,
  };
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new PurchaseError(`${field} غير صالح`);
  }

  const text = value.trim();

  if (!text) {
    return null;
  }

  if (text.length > maxLength) {
    throw new PurchaseError(`${field} طويل جدًا`);
  }

  return text;
}

function parsePositiveInteger(
  value: unknown,
  field: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const numberValue =
    typeof value === "string" && value.trim()
      ? Number(value)
      : value;

  if (
    typeof numberValue !== "number" ||
    !Number.isSafeInteger(numberValue) ||
    numberValue <= 0 ||
    numberValue > maximum
  ) {
    throw new PurchaseError(`${field} غير صالح`);
  }

  return numberValue;
}

function parseNonnegativeInteger(
  value: unknown,
  field: string,
  maximum: number,
): number {
  const numberValue =
    typeof value === "string" && value.trim()
      ? Number(value)
      : value;

  if (
    typeof numberValue !== "number" ||
    !Number.isSafeInteger(numberValue) ||
    numberValue < 0 ||
    numberValue > maximum
  ) {
    throw new PurchaseError(`${field} غير صالح`);
  }

  return numberValue;
}

function parseMoneyToMinor(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }

  const normalized =
    typeof value === "string"
      ? value.trim().replace(",", ".")
      : value;

  if (normalized === "") {
    return null;
  }

  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  const minor = Math.round(amount * 100);

  if (
    !Number.isSafeInteger(minor) ||
    minor < 0 ||
    minor > MAX_MINOR
  ) {
    return null;
  }

  return minor;
}

function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const key = value.trim();

  if (
    key.length < 8 ||
    key.length > 100 ||
    !/^[A-Za-z0-9:_-]+$/.test(key)
  ) {
    return null;
  }

  return key;
}

function normalizeBarcode(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new PurchaseError("الباركود غير صالح");
  }

  const barcode = value.trim();

  if (!barcode || barcode.length > 128) {
    throw new PurchaseError("الباركود غير صالح");
  }

  return barcode;
}

function normalizeBusinessDate(value: unknown): string {
  const dateValue =
    value === undefined
      ? new Date().toISOString().slice(0, 10)
      : value;

  if (
    typeof dateValue !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)
  ) {
    throw new PurchaseError("تاريخ الفاتورة غير صالح");
  }

  const parsed = new Date(`${dateValue}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== dateValue
  ) {
    throw new PurchaseError("تاريخ الفاتورة غير صالح");
  }

  return dateValue;
}

function normalizeWarehouseKey(value: unknown): string {
  const key =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : "main";

  if (!/^[a-z0-9_-]{1,50}$/.test(key)) {
    throw new PurchaseError("المستودع غير صالح");
  }

  return key;
}

function normalizeCurrencyCode(value: unknown): string {
  const code =
    typeof value === "string"
      ? value.trim().toUpperCase()
      : "ILS";

  if (!/^[A-Z]{3}$/.test(code)) {
    throw new PurchaseError("رمز العملة غير صالح");
  }

  return code;
}

function parseItems(value: unknown): ParsedPurchaseItem[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new PurchaseError("يجب إضافة صنف واحد على الأقل");
  }

  if (value.length > 500) {
    throw new PurchaseError("عدد أصناف الفاتورة كبير جدًا");
  }

  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new PurchaseError("بيانات أحد الأصناف غير صالحة");
    }

    const item = raw as Record<string, unknown>;

    let productId: number | null = null;

    if (
      item.productId !== undefined &&
      item.productId !== null &&
      item.productId !== ""
    ) {
      productId = parsePositiveInteger(
        item.productId,
        "رقم المنتج",
      );
    }

    const quantity = parsePositiveInteger(
      item.quantity,
      "كمية الصنف",
      99_999,
    );

    const freeQuantity = parseNonnegativeInteger(
      item.freeQuantity ?? 0,
      "الكمية المجانية",
      99_999,
    );

    if (quantity + freeQuantity > 99_999) {
      throw new PurchaseError(
        "إجمالي كمية أحد الأصناف أكبر من الحد المسموح",
      );
    }

    const unitCostMinor = parseMoneyToMinor(
      item.unitCost ?? item.cost,
    );

    if (unitCostMinor === null) {
      throw new PurchaseError("تكلفة أحد الأصناف غير صالحة");
    }

    const lineDiscountMinor = parseMoneyToMinor(
      item.lineDiscount ?? item.discount ?? 0,
    );

    if (lineDiscountMinor === null) {
      throw new PurchaseError("خصم أحد الأصناف غير صالح");
    }

    const grossMinor = unitCostMinor * quantity;

    if (
      !Number.isSafeInteger(grossMinor) ||
      grossMinor > MAX_MINOR
    ) {
      throw new PurchaseError(
        "قيمة أحد الأصناف تتجاوز الحد المسموح",
      );
    }

    if (lineDiscountMinor > grossMinor) {
      throw new PurchaseError(
        "خصم أحد الأصناف أكبر من قيمته",
      );
    }

    return {
      lineNumber: index + 1,
      productId,
      barcode: normalizeBarcode(item.barcode),
      color: optionalText(item.color, "اللون", 100),
      size: optionalText(item.size, "المقاس", 100),
      quantity,
      freeQuantity,
      unitCostMinor,
      lineDiscountMinor,
      lineTotalMinor: grossMinor - lineDiscountMinor,
    };
  });
}

function toPurchaseResponse(
  purchase: typeof posPurchasesTable.$inferSelect,
  items: Array<typeof posPurchaseItemsTable.$inferSelect>,
  supplier: typeof suppliersTable.$inferSelect,
  alreadyCreated: boolean,
) {
  return {
    alreadyCreated,
    purchase: {
      id: String(purchase.id),
      publicId: purchase.publicId,
      supplierId: String(purchase.supplierId),
      supplier: {
        id: String(supplier.id),
        code: supplier.code,
        name: supplier.name,
      },
      supplierInvoiceNumber:
        purchase.supplierInvoiceNumber,
      businessDate: purchase.businessDate,
      warehouseKey: purchase.warehouseKey,
      currencyCode: purchase.currencyCode,
      enteredByUserId: String(purchase.enteredByUserId),
      status: purchase.status,
      paymentMethod: purchase.paymentMethod,
      subtotalMinor: purchase.subtotalMinor,
      subtotal: purchase.subtotalMinor / 100,
      discountMinor: purchase.discountMinor,
      discount: purchase.discountMinor / 100,
      totalMinor: purchase.totalMinor,
      total: purchase.totalMinor / 100,
      paidMinor: purchase.paidMinor,
      paid: purchase.paidMinor / 100,
      dueMinor: purchase.dueMinor,
      due: purchase.dueMinor / 100,
      notes: purchase.notes,
      voidedAt: purchase.voidedAt?.toISOString() ?? null,
      voidedByUserId:
        purchase.voidedByUserId === null
          ? null
          : String(purchase.voidedByUserId),
      voidReason: purchase.voidReason,
      createdAt: purchase.createdAt.toISOString(),
      updatedAt: purchase.updatedAt.toISOString(),
      items: items.map((item) => ({
        id: String(item.id),
        lineNumber: item.lineNumber,
        productId:
          item.productId === null
            ? null
            : String(item.productId),
        barcode: item.barcode,
        productCode: item.productCode,
        productNameAr: item.productNameAr,
        productImage: item.productImage,
        color: item.color,
        size: item.size,
        quantity: item.quantity,
        freeQuantity: item.freeQuantity,
        unitCostMinor: item.unitCostMinor,
        unitCost: item.unitCostMinor / 100,
        lineDiscountMinor: item.lineDiscountMinor,
        lineDiscount: item.lineDiscountMinor / 100,
        lineTotalMinor: item.lineTotalMinor,
        lineTotal: item.lineTotalMinor / 100,
        generalStockBefore: item.generalStockBefore,
        generalStockAfter: item.generalStockAfter,
        variantStockBefore: item.variantStockBefore,
        variantStockAfter: item.variantStockAfter,
      })),
    },
  };
}

async function getExistingPurchase(
  db: Db,
  idempotencyKey: string,
) {
  const purchaseRows = await db
    .select()
    .from(posPurchasesTable)
    .where(
      eq(
        posPurchasesTable.idempotencyKey,
        idempotencyKey,
      ),
    )
    .limit(1);

  const purchase = purchaseRows[0];

  if (!purchase) {
    return null;
  }

  const items = await db
    .select()
    .from(posPurchaseItemsTable)
    .where(
      eq(posPurchaseItemsTable.purchaseId, purchase.id),
    )
    .orderBy(asc(posPurchaseItemsTable.lineNumber));

  const supplierRows = await db
    .select()
    .from(suppliersTable)
    .where(eq(suppliersTable.id, purchase.supplierId))
    .limit(1);

  const supplier = supplierRows[0];

  if (!supplier) {
    throw new Error("PURCHASE_SUPPLIER_MISSING");
  }

  return {
    purchase,
    items,
    supplier,
  };
}


async function handleVoidPurchase(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requirePosUser(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "بيانات إلغاء الفاتورة غير صالحة" }, 400);
  }

  const payload = body as Record<string, unknown>;

  try {
    const publicId = optionalText(
      payload.publicId,
      "رقم الفاتورة",
      100,
    );

    const reason = optionalText(
      payload.reason,
      "سبب الإلغاء",
      500,
    );

    if (!publicId) {
      throw new PurchaseError("رقم الفاتورة مطلوب");
    }

    if (!reason) {
      throw new PurchaseError("يجب إدخال سبب حذف الفاتورة");
    }

    const result = await db.transaction(async (tx) => {
      const purchaseRows = await tx
        .select()
        .from(posPurchasesTable)
        .where(eq(posPurchasesTable.publicId, publicId))
        .for("update");

      const purchase = purchaseRows[0];

      if (!purchase) {
        throw new PurchaseError("فاتورة المشتريات غير موجودة", 404);
      }

      const purchaseItems = await tx
        .select()
        .from(posPurchaseItemsTable)
        .where(eq(posPurchaseItemsTable.purchaseId, purchase.id))
        .orderBy(asc(posPurchaseItemsTable.lineNumber));

      const supplierRows = await tx
        .select()
        .from(suppliersTable)
        .where(eq(suppliersTable.id, purchase.supplierId))
        .limit(1);

      const supplier = supplierRows[0];

      if (!supplier) {
        throw new PurchaseError("مورد الفاتورة غير موجود", 409);
      }

      if (purchase.status === "voided") {
        return {
          purchase,
          items: purchaseItems,
          supplier,
        };
      }

      if (purchase.status !== "completed") {
        throw new PurchaseError("لا يمكن حذف هذه الفاتورة", 409);
      }

      const orderedItems = [...purchaseItems].sort((left, right) => {
        const leftId = left.productId ?? Number.MAX_SAFE_INTEGER;
        const rightId = right.productId ?? Number.MAX_SAFE_INTEGER;

        return leftId - rightId || left.lineNumber - right.lineNumber;
      });

      for (const item of orderedItems) {
        if (item.productId === null) {
          throw new PurchaseError(
            `المنتج ${item.productNameAr} لم يعد موجودًا`,
            409,
          );
        }

        const productRows = await tx
          .select()
          .from(productsTable)
          .where(eq(productsTable.id, item.productId))
          .for("update");

        const product = productRows[0];

        if (!product) {
          throw new PurchaseError(
            `المنتج ${item.productNameAr} لم يعد موجودًا`,
            409,
          );
        }

        const receivedQuantity =
          item.quantity + item.freeQuantity;

        const updates: {
          stock?: number;
          colorVariants?: ColorVariant[];
        } = {};

        if (
          item.generalStockBefore !== null &&
          item.generalStockAfter !== null
        ) {
          if (product.stock === null || product.stock === undefined) {
            throw new PurchaseError(
              `تعذر التحقق من مخزون ${item.productNameAr}`,
              409,
            );
          }

          const nextStock = product.stock - receivedQuantity;

          if (!Number.isSafeInteger(nextStock) || nextStock < 0) {
            throw new PurchaseError(
              `لا يمكن حذف الفاتورة لأن مخزون ${item.productNameAr} لا يكفي`,
              409,
            );
          }

          updates.stock = nextStock;
        }

        if (
          item.variantStockBefore !== null &&
          item.variantStockAfter !== null
        ) {
          if (!item.color || !item.size) {
            throw new PurchaseError(
              `بيانات اللون أو المقاس ناقصة للمنتج ${item.productNameAr}`,
              409,
            );
          }

          const colorVariants =
            (product.colorVariants as ColorVariant[] | null) ?? [];

          const variantIndex = colorVariants.findIndex(
            (entry) => entry.color === item.color,
          );

          if (variantIndex < 0) {
            throw new PurchaseError(
              `لون ${item.productNameAr} لم يعد موجودًا`,
              409,
            );
          }

          const variant = colorVariants[variantIndex];
          const sizes = Array.isArray(variant.sizes)
            ? variant.sizes
            : [];

          const sizeIndex = sizes.findIndex(
            (entry) => entry.size === item.size,
          );

          if (sizeIndex < 0) {
            throw new PurchaseError(
              `مقاس ${item.productNameAr} لم يعد موجودًا`,
              409,
            );
          }

          const selectedSize = sizes[sizeIndex];

          if (
            selectedSize.stock === null ||
            selectedSize.stock === undefined
          ) {
            throw new PurchaseError(
              `تعذر التحقق من مخزون ${item.productNameAr}`,
              409,
            );
          }

          const nextVariantStock =
            selectedSize.stock - receivedQuantity;

          if (
            !Number.isSafeInteger(nextVariantStock) ||
            nextVariantStock < 0
          ) {
            throw new PurchaseError(
              `لا يمكن حذف الفاتورة لأن مخزون ${item.productNameAr} بالمقاس المحدد لا يكفي`,
              409,
            );
          }

          const nextSizes = sizes.map((entry, index) =>
            index === sizeIndex
              ? {
                  ...entry,
                  stock: nextVariantStock,
                  outOfStock: nextVariantStock <= 0,
                }
              : entry,
          );

          updates.colorVariants = colorVariants.map(
            (entry, index) =>
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
      }

      const updatedPurchaseRows = await tx
        .update(posPurchasesTable)
        .set({
          status: "voided",
          voidedAt: new Date(),
          voidedByUserId: auth.user.id,
          voidReason: reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(posPurchasesTable.id, purchase.id),
            eq(posPurchasesTable.status, "completed"),
          ),
        )
        .returning();

      const updatedPurchase = updatedPurchaseRows[0];

      if (!updatedPurchase) {
        throw new PurchaseError(
          "تم تغيير حالة الفاتورة قبل حذفها",
          409,
        );
      }

      return {
        purchase: updatedPurchase,
        items: purchaseItems,
        supplier,
      };
    });

    return json(
      toPurchaseResponse(
        result.purchase,
        result.items,
        result.supplier,
        false,
      ),
    );
  } catch (error) {
    if (error instanceof PurchaseError) {
      return json({ error: error.message }, error.status);
    }

    console.error("POS_PURCHASE_VOID_FAILED", error);

    return json(
      { error: "تعذر حذف فاتورة المشتريات" },
      500,
    );
  }
}

async function handleCreatePurchase(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requirePosUser(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "بيانات الفاتورة غير صالحة" }, 400);
  }

  const payload = body as Record<string, unknown>;

  try {
    const supplierId = parsePositiveInteger(
      payload.supplierId,
      "رقم المورد",
    );

    const idempotencyKey = normalizeIdempotencyKey(
      payload.idempotencyKey,
    );

    if (!idempotencyKey) {
      throw new PurchaseError(
        "مفتاح منع تكرار الفاتورة غير صالح",
      );
    }

    const supplierInvoiceNumber = optionalText(
      payload.supplierInvoiceNumber,
      "رقم فاتورة المورد",
      100,
    );

    const businessDate = normalizeBusinessDate(
      payload.businessDate,
    );

    const warehouseKey = normalizeWarehouseKey(
      payload.warehouseKey,
    );

    const currencyCode = normalizeCurrencyCode(
      payload.currencyCode,
    );

    const paymentMethod =
      typeof payload.paymentMethod === "string"
        ? payload.paymentMethod.trim().toLowerCase()
        : "credit";

    if (
      paymentMethod !== "cash" &&
      paymentMethod !== "credit" &&
      paymentMethod !== "mixed"
    ) {
      throw new PurchaseError("طريقة الدفع غير صالحة");
    }

    const notes = optionalText(
      payload.notes,
      "الملاحظات",
      2000,
    );

    const items = parseItems(payload.items);

    let subtotalMinor = 0;
    let itemDiscountMinor = 0;

    for (const item of items) {
      const gross = item.unitCostMinor * item.quantity;

      subtotalMinor += gross;
      itemDiscountMinor += item.lineDiscountMinor;

      if (
        !Number.isSafeInteger(subtotalMinor) ||
        !Number.isSafeInteger(itemDiscountMinor) ||
        subtotalMinor > MAX_MINOR ||
        itemDiscountMinor > MAX_MINOR
      ) {
        throw new PurchaseError(
          "قيمة الفاتورة تتجاوز الحد المسموح",
        );
      }
    }

    const invoiceDiscountMinor = parseMoneyToMinor(
      payload.invoiceDiscount ?? payload.discount ?? 0,
    );

    if (invoiceDiscountMinor === null) {
      throw new PurchaseError("خصم الفاتورة غير صالح");
    }

    if (
      invoiceDiscountMinor >
      subtotalMinor - itemDiscountMinor
    ) {
      throw new PurchaseError(
        "خصم الفاتورة أكبر من صافي الأصناف",
      );
    }

    const discountMinor =
      itemDiscountMinor + invoiceDiscountMinor;

    const totalMinor = subtotalMinor - discountMinor;

    let paidMinor: number;

    if (payload.paid === undefined || payload.paid === null) {
      paidMinor =
        paymentMethod === "cash"
          ? totalMinor
          : 0;
    } else {
      const parsedPaid = parseMoneyToMinor(payload.paid);

      if (parsedPaid === null) {
        throw new PurchaseError("المبلغ المدفوع غير صالح");
      }

      paidMinor = parsedPaid;
    }

    if (paidMinor > totalMinor) {
      throw new PurchaseError(
        "المبلغ المدفوع أكبر من قيمة الفاتورة",
      );
    }

    if (paymentMethod === "cash" && paidMinor !== totalMinor) {
      throw new PurchaseError(
        "الفاتورة النقدية يجب دفعها كاملة",
      );
    }

    if (paymentMethod === "credit" && paidMinor !== 0) {
      throw new PurchaseError(
        "الفاتورة الآجلة لا تحتوي دفعة نقدية",
      );
    }

    if (
      paymentMethod === "mixed" &&
      (paidMinor <= 0 || paidMinor >= totalMinor)
    ) {
      throw new PurchaseError(
        "الدفع المختلط يحتاج دفعة جزئية",
      );
    }

    const dueMinor = totalMinor - paidMinor;

    const result = await db.transaction(async (tx) => {
      const duplicateRows = await tx
        .select()
        .from(posPurchasesTable)
        .where(
          eq(
            posPurchasesTable.idempotencyKey,
            idempotencyKey,
          ),
        )
        .limit(1);

      const duplicate = duplicateRows[0];

      if (duplicate) {
        const duplicateItems = await tx
          .select()
          .from(posPurchaseItemsTable)
          .where(
            eq(
              posPurchaseItemsTable.purchaseId,
              duplicate.id,
            ),
          )
          .orderBy(
            asc(posPurchaseItemsTable.lineNumber),
          );

        const duplicateSupplierRows = await tx
          .select()
          .from(suppliersTable)
          .where(
            eq(suppliersTable.id, duplicate.supplierId),
          )
          .limit(1);

        const duplicateSupplier =
          duplicateSupplierRows[0];

        if (!duplicateSupplier) {
          throw new Error(
            "PURCHASE_SUPPLIER_MISSING",
          );
        }

        return {
          purchase: duplicate,
          items: duplicateItems,
          supplier: duplicateSupplier,
          alreadyCreated: true,
        };
      }

      const supplierRows = await tx
        .select()
        .from(suppliersTable)
        .where(eq(suppliersTable.id, supplierId))
        .for("update");

      const supplier = supplierRows[0];

      if (!supplier) {
        throw new PurchaseError(
          "المورد غير موجود",
          404,
        );
      }

      if (supplier.status !== "active") {
        throw new PurchaseError(
          "لا يمكن التسجيل على مورد غير فعال",
          409,
        );
      }

      if (supplierInvoiceNumber) {
        const sameInvoiceRows = await tx
          .select({
            id: posPurchasesTable.id,
          })
          .from(posPurchasesTable)
          .where(
            and(
              eq(
                posPurchasesTable.supplierId,
                supplierId,
              ),
              eq(
                posPurchasesTable.supplierInvoiceNumber,
                supplierInvoiceNumber,
              ),
            ),
          )
          .limit(1);

        if (sameInvoiceRows[0]) {
          throw new PurchaseError(
            "رقم فاتورة المورد مسجل مسبقًا",
            409,
          );
        }
      }

      const resolvedItems: Array<
        ParsedPurchaseItem & {
          productId: number;
          mappedColor: string | null;
          mappedSize: string | null;
        }
      > = [];

      for (const item of items) {
        if (item.barcode) {
          const mappingRows = await tx
            .select()
            .from(productBarcodesTable)
            .where(
              eq(
                productBarcodesTable.barcode,
                item.barcode,
              ),
            )
            .limit(1);

          const mapping = mappingRows[0];

          if (mapping) {
            if (
              item.productId !== null &&
              item.productId !== mapping.productId
            ) {
              throw new PurchaseError(
                "الباركود لا يطابق المنتج المحدد",
                409,
              );
            }

            resolvedItems.push({
              ...item,
              productId: mapping.productId,
              mappedColor: mapping.color ?? null,
              mappedSize: mapping.size ?? null,
            });

            continue;
          }

          const primaryRows = await tx
            .select({
              id: productsTable.id,
            })
            .from(productsTable)
            .where(
              eq(productsTable.barcode, item.barcode),
            )
            .limit(1);

          const primary = primaryRows[0];

          if (!primary) {
            throw new PurchaseError(
              `الباركود ${item.barcode} غير موجود`,
              404,
            );
          }

          if (
            item.productId !== null &&
            item.productId !== primary.id
          ) {
            throw new PurchaseError(
              "الباركود لا يطابق المنتج المحدد",
              409,
            );
          }

          resolvedItems.push({
            ...item,
            productId: primary.id,
            mappedColor: null,
            mappedSize: null,
          });

          continue;
        }

        if (item.productId === null) {
          throw new PurchaseError(
            "تعذر تحديد أحد المنتجات",
          );
        }

        resolvedItems.push({
          ...item,
          productId: item.productId,
          mappedColor: null,
          mappedSize: null,
        });
      }

      resolvedItems.sort(
        (left, right) =>
          left.productId - right.productId ||
          left.lineNumber - right.lineNumber,
      );

      const purchaseLines: Array<
        typeof posPurchaseItemsTable.$inferInsert
      > = [];

      for (const item of resolvedItems) {
        const productRows = await tx
          .select()
          .from(productsTable)
          .where(eq(productsTable.id, item.productId))
          .for("update");

        const product = productRows[0];

        if (!product) {
          throw new PurchaseError(
            "أحد المنتجات لم يعد موجودًا",
            404,
          );
        }

        if (
          item.mappedColor &&
          item.color &&
          item.mappedColor !== item.color
        ) {
          throw new PurchaseError(
            `لون باركود ${item.barcode} غير مطابق`,
          );
        }

        if (
          item.mappedSize &&
          item.size &&
          item.mappedSize !== item.size
        ) {
          throw new PurchaseError(
            `مقاس باركود ${item.barcode} غير مطابق`,
          );
        }

        const color = item.mappedColor ?? item.color;
        const size = item.mappedSize ?? item.size;

        const receivedQuantity =
          item.quantity + item.freeQuantity;

        const colorVariants =
          (product.colorVariants as
            | ColorVariant[]
            | null) ?? [];

        const generalSizes =
          (product.sizes as string[] | null) ?? [];

        let nextColorVariants:
          | ColorVariant[]
          | undefined;

        let variantStockBefore: number | null = null;
        let variantStockAfter: number | null = null;

        if (colorVariants.length > 0) {
          if (!color) {
            throw new PurchaseError(
              `يجب تحديد لون ${product.nameAr}`,
            );
          }

          const variantIndex = colorVariants.findIndex(
            (variant) => variant.color === color,
          );

          if (variantIndex < 0) {
            throw new PurchaseError(
              `لون ${product.nameAr} غير موجود`,
            );
          }

          const variant = colorVariants[variantIndex];

          const variantSizes = Array.isArray(variant.sizes)
            ? variant.sizes
            : [];

          if (variantSizes.length > 0) {
            if (!size) {
              throw new PurchaseError(
                `يجب تحديد مقاس ${product.nameAr}`,
              );
            }

            const sizeIndex = variantSizes.findIndex(
              (entry) => entry.size === size,
            );

            if (sizeIndex < 0) {
              throw new PurchaseError(
                `مقاس ${product.nameAr} غير موجود`,
              );
            }

            const selectedSize = variantSizes[sizeIndex];

            variantStockBefore =
              selectedSize.stock ?? null;

            if (
              selectedSize.stock !== null &&
              selectedSize.stock !== undefined
            ) {
              variantStockAfter =
                selectedSize.stock + receivedQuantity;

              if (
                !Number.isSafeInteger(variantStockAfter) ||
                variantStockAfter > MAX_MINOR
              ) {
                throw new PurchaseError(
                  `مخزون ${product.nameAr} يتجاوز الحد المسموح`,
                );
              }
            }

            const nextSizes = variantSizes.map(
              (entry, index) =>
                index === sizeIndex
                  ? {
                      ...entry,
                      stock:
                        variantStockAfter ??
                        entry.stock ??
                        null,
                      outOfStock: false,
                    }
                  : entry,
            );

            nextColorVariants = colorVariants.map(
              (entry, index) =>
                index === variantIndex
                  ? {
                      ...entry,
                      sizes: nextSizes,
                    }
                  : entry,
            );
          } else if (size) {
            throw new PurchaseError(
              `المقاس غير صالح للمنتج ${product.nameAr}`,
            );
          }
        } else {
          if (color) {
            throw new PurchaseError(
              `اللون غير صالح للمنتج ${product.nameAr}`,
            );
          }

          if (
            generalSizes.length > 0 &&
            (!size || !generalSizes.includes(size))
          ) {
            throw new PurchaseError(
              `مقاس ${product.nameAr} غير موجود`,
            );
          }

          if (generalSizes.length === 0 && size) {
            throw new PurchaseError(
              `المقاس غير صالح للمنتج ${product.nameAr}`,
            );
          }
        }

        const generalStockBefore =
          product.stock ?? null;

        let generalStockAfter: number | null = null;

        if (
          product.stock !== null &&
          product.stock !== undefined
        ) {
          generalStockAfter =
            product.stock + receivedQuantity;

          if (
            !Number.isSafeInteger(generalStockAfter) ||
            generalStockAfter > MAX_MINOR
          ) {
            throw new PurchaseError(
              `مخزون ${product.nameAr} يتجاوز الحد المسموح`,
            );
          }
        }

        const updates: {
          stock?: number;
          colorVariants?: ColorVariant[];
        } = {};

        if (generalStockAfter !== null) {
          updates.stock = generalStockAfter;
        }

        if (nextColorVariants !== undefined) {
          updates.colorVariants = nextColorVariants;
        }

        if (Object.keys(updates).length > 0) {
          await tx
            .update(productsTable)
            .set(updates)
            .where(eq(productsTable.id, product.id));
        }

        purchaseLines.push({
          purchaseId: 0,
          lineNumber: item.lineNumber,
          productId: product.id,
          barcode: item.barcode,
          productCode: product.productCode,
          productNameAr: product.nameAr,
          productImage: product.image,
          color,
          size,
          quantity: item.quantity,
          freeQuantity: item.freeQuantity,
          unitCostMinor: item.unitCostMinor,
          lineDiscountMinor: item.lineDiscountMinor,
          lineTotalMinor: item.lineTotalMinor,
          generalStockBefore,
          generalStockAfter,
          variantStockBefore,
          variantStockAfter,
        });
      }

      const publicId =
        `PUR-${businessDate.replaceAll("-", "")}-` +
        randomUUID().slice(0, 8).toUpperCase();

      const insertedPurchases = await tx
        .insert(posPurchasesTable)
        .values({
          publicId,
          idempotencyKey,
          supplierId,
          supplierInvoiceNumber,
          businessDate,
          warehouseKey,
          currencyCode,
          enteredByUserId: auth.user.id,
          status: "completed",
          paymentMethod,
          subtotalMinor,
          discountMinor,
          totalMinor,
          paidMinor,
          dueMinor,
          notes,
        })
        .returning();

      const purchase = insertedPurchases[0];

      if (!purchase) {
        throw new Error("PURCHASE_INSERT_FAILED");
      }

      const linesWithPurchase = purchaseLines.map(
        (line) => ({
          ...line,
          purchaseId: purchase.id,
        }),
      );

      const insertedItems = await tx
        .insert(posPurchaseItemsTable)
        .values(linesWithPurchase)
        .returning();

      return {
        purchase,
        items: insertedItems,
        supplier,
        alreadyCreated: false,
      };
    });

    return json(
      toPurchaseResponse(
        result.purchase,
        result.items,
        result.supplier,
        result.alreadyCreated,
      ),
      result.alreadyCreated ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof PurchaseError) {
      return json({ error: error.message }, error.status);
    }

    const pgError = error as {
      code?: string;
      constraint?: string;
    };

    if (
      pgError.constraint ===
      "pos_purchases_supplier_invoice_unique_idx"
    ) {
      return json(
        { error: "رقم فاتورة المورد مسجل مسبقًا" },
        409,
      );
    }

    if (
      pgError.code === "23505" ||
      pgError.constraint ===
        "pos_purchases_idempotency_key_idx"
    ) {
      const key = normalizeIdempotencyKey(
        payload.idempotencyKey,
      );

      if (key) {
        const existing = await getExistingPurchase(db, key);

        if (existing) {
          return json(
            toPurchaseResponse(
              existing.purchase,
              existing.items,
              existing.supplier,
              true,
            ),
          );
        }
      }
    }

    console.error("POS_PURCHASE_CREATE_FAILED", error);

    return json(
      { error: "تعذر حفظ فاتورة المشتريات" },
      500,
    );
  }
}

export async function handlePosPurchaseRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "POST" &&
    path === "/api/pos/purchases/void"
  ) {
    if (!isPurchaseWriteEnabled(env)) {
      return purchaseWritesDisabledResponse();
    }

    return handleVoidPurchase(request, db, env);
  }

  if (
    request.method === "POST" &&
    path === "/api/pos/purchases"
  ) {
    if (!isPurchaseWriteEnabled(env)) {
      return purchaseWritesDisabledResponse();
    }

    return handleCreatePurchase(request, db, env);
  }

  return null;
}
