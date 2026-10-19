import {
  posPurchaseItemsTable,
  posPurchasesTable,
  productBarcodesTable,
  productsTable,
  suppliersTable,
} from "@workspace/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";
import {
  isPurchaseApiEnabled,
  isPurchaseWriteEnabled,
  purchaseFeatureDisabledResponse,
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

class PurchaseDraftError extends Error {
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

async function requireOwner(
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

  if (!user.isOwner) {
    return {
      ok: false,
      response: json(
        { error: "هذه البيانات متاحة للمالك فقط" },
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
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (typeof value !== "string") {
    throw new PurchaseDraftError(field + " غير صالح");
  }

  const text = value.trim();

  if (!text) {
    return null;
  }

  if (text.length > maxLength) {
    throw new PurchaseDraftError(field + " طويل جدًا");
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
    throw new PurchaseDraftError(field + " غير صالح");
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
    throw new PurchaseDraftError(field + " غير صالح");
  }

  return numberValue;
}

function parseMoneyToMinor(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    typeof value !== "string"
  ) {
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

function normalizeBarcode(value: unknown): string | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (typeof value !== "string") {
    throw new PurchaseDraftError("الباركود غير صالح");
  }

  const barcode = value.trim();

  if (!barcode || barcode.length > 128) {
    throw new PurchaseDraftError("الباركود غير صالح");
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
    throw new PurchaseDraftError("تاريخ الفاتورة غير صالح");
  }

  const parsed = new Date(dateValue + "T00:00:00.000Z");

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== dateValue
  ) {
    throw new PurchaseDraftError("تاريخ الفاتورة غير صالح");
  }

  return dateValue;
}

function normalizeWarehouseKey(value: unknown): string {
  const key =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : "main";

  if (!/^[a-z0-9_-]{1,50}$/.test(key)) {
    throw new PurchaseDraftError("المستودع غير صالح");
  }

  return key;
}

function normalizeCurrencyCode(value: unknown): string {
  const code =
    typeof value === "string"
      ? value.trim().toUpperCase()
      : "ILS";

  if (!/^[A-Z]{3}$/.test(code)) {
    throw new PurchaseDraftError("رمز العملة غير صالح");
  }

  return code;
}

type DraftItem = {
  lineNumber: number;
  productId: number | null;
  barcode: string | null;
  quantity: number;
  freeQuantity: number;
  unitCostMinor: number | null;
  lineDiscountMinor: number;
  lineTotalMinor: number | null;
};

function parseItems(value: unknown): DraftItem[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new PurchaseDraftError("يجب إضافة صنف واحد على الأقل");
  }

  if (value.length > 500) {
    throw new PurchaseDraftError("عدد أصناف الفاتورة كبير جدًا");
  }

  return value.map((raw, index) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      throw new PurchaseDraftError(
        "بيانات أحد الأصناف غير صالحة",
      );
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
      throw new PurchaseDraftError(
        "إجمالي كمية أحد الأصناف أكبر من الحد المسموح",
      );
    }

    const rawUnitCost =
      item.unitCost ?? item.cost;

    let unitCostMinor: number | null = null;

    if (
      rawUnitCost !== undefined &&
      rawUnitCost !== null &&
      rawUnitCost !== ""
    ) {
      unitCostMinor =
        parseMoneyToMinor(rawUnitCost);

      if (unitCostMinor === null) {
        throw new PurchaseDraftError(
          "تكلفة أحد الأصناف غير صالحة",
        );
      }
    }

    const lineDiscountMinor = parseMoneyToMinor(
      item.lineDiscount ?? item.discount ?? 0,
    );

    if (lineDiscountMinor === null) {
      throw new PurchaseDraftError(
        "خصم أحد الأصناف غير صالح",
      );
    }

    if (
      unitCostMinor === null &&
      lineDiscountMinor !== 0
    ) {
      throw new PurchaseDraftError(
        "لا يمكن إدخال خصم لصنف تكلفته غير مدخلة",
      );
    }

    const grossMinor =
      unitCostMinor === null
        ? null
        : unitCostMinor * quantity;

    if (
      grossMinor !== null &&
      (
        !Number.isSafeInteger(grossMinor) ||
        grossMinor > MAX_MINOR
      )
    ) {
      throw new PurchaseDraftError(
        "قيمة أحد الأصناف تتجاوز الحد المسموح",
      );
    }

    if (
      grossMinor !== null &&
      lineDiscountMinor > grossMinor
    ) {
      throw new PurchaseDraftError(
        "خصم أحد الأصناف أكبر من قيمته",
      );
    }

    return {
      lineNumber: index + 1,
      productId,
      barcode: normalizeBarcode(item.barcode),
      quantity,
      freeQuantity,
      unitCostMinor,
      lineDiscountMinor,
      lineTotalMinor:
        grossMinor === null
          ? null
          : grossMinor - lineDiscountMinor,
    };
  });
}

function parseFinancials(
  payload: Record<string, unknown>,
  items: DraftItem[],
) {
  const paymentMethod =
    typeof payload.paymentMethod === "string"
      ? payload.paymentMethod.trim().toLowerCase()
      : "credit";

  if (
    paymentMethod !== "cash" &&
    paymentMethod !== "credit" &&
    paymentMethod !== "mixed"
  ) {
    throw new PurchaseDraftError("طريقة الدفع غير صالحة");
  }

  let subtotalMinor = 0;
  let itemDiscountMinor = 0;

  const hasUnknownCost =
    items.some(
      (item) => item.unitCostMinor === null,
    );

  for (const item of items) {
    if (item.unitCostMinor !== null) {
      subtotalMinor +=
        item.unitCostMinor * item.quantity;
      itemDiscountMinor +=
        item.lineDiscountMinor;
    }

    if (
      !Number.isSafeInteger(subtotalMinor) ||
      !Number.isSafeInteger(itemDiscountMinor) ||
      subtotalMinor > MAX_MINOR ||
      itemDiscountMinor > MAX_MINOR
    ) {
      throw new PurchaseDraftError(
        "قيمة الفاتورة تتجاوز الحد المسموح",
      );
    }
  }

  const invoiceDiscountMinor = parseMoneyToMinor(
    payload.invoiceDiscount ?? payload.discount ?? 0,
  );

  if (invoiceDiscountMinor === null) {
    throw new PurchaseDraftError(
      "خصم الفاتورة غير صالح",
    );
  }

  if (
    hasUnknownCost &&
    invoiceDiscountMinor !== 0
  ) {
    throw new PurchaseDraftError(
      "أكمل تكاليف الأصناف قبل إدخال خصم على الفاتورة",
    );
  }

  if (
    invoiceDiscountMinor >
    subtotalMinor - itemDiscountMinor
  ) {
    throw new PurchaseDraftError(
      "خصم الفاتورة أكبر من صافي الأصناف",
    );
  }

  const discountMinor =
    itemDiscountMinor + invoiceDiscountMinor;
  const totalMinor =
    subtotalMinor - discountMinor;

  let paidMinor: number;

  if (
    payload.paid === undefined ||
    payload.paid === null
  ) {
    paidMinor =
      paymentMethod === "cash"
        ? totalMinor
        : 0;
  } else {
    const parsedPaid =
      parseMoneyToMinor(payload.paid);

    if (parsedPaid === null) {
      throw new PurchaseDraftError(
        "المبلغ المدفوع غير صالح",
      );
    }

    paidMinor = parsedPaid;
  }

  if (
    hasUnknownCost &&
    (
      paymentMethod !== "credit" ||
      paidMinor !== 0
    )
  ) {
    throw new PurchaseDraftError(
      "المسودة التي تحتوي تكلفة غير مدخلة تحفظ آجل بدون دفعة حتى اكتمال التكلفة",
    );
  }

  if (paidMinor > totalMinor) {
    throw new PurchaseDraftError(
      "المبلغ المدفوع أكبر من قيمة الفاتورة",
    );
  }

  if (
    paymentMethod === "cash" &&
    paidMinor !== totalMinor
  ) {
    throw new PurchaseDraftError(
      "الفاتورة النقدية يجب دفعها كاملة",
    );
  }

  if (
    paymentMethod === "credit" &&
    paidMinor !== 0
  ) {
    throw new PurchaseDraftError(
      "الفاتورة الآجلة لا تحتوي دفعة نقدية",
    );
  }

  if (
    paymentMethod === "mixed" &&
    (paidMinor <= 0 || paidMinor >= totalMinor)
  ) {
    throw new PurchaseDraftError(
      "الدفع المختلط يحتاج دفعة جزئية",
    );
  }

  return {
    paymentMethod,
    subtotalMinor,
    discountMinor,
    totalMinor,
    paidMinor,
    dueMinor: totalMinor - paidMinor,
  } as const;
}

function toResponse(
  purchase: typeof posPurchasesTable.$inferSelect,
  items: Array<typeof posPurchaseItemsTable.$inferSelect>,
  supplier: typeof suppliersTable.$inferSelect,
) {
  return {
    alreadyCreated: false,
    hasUnknownCost:
      items.some(
        (item) => item.unitCostMinor === null,
      ),
    navigation: {
      previousPublicId: null,
      nextPublicId: null,
    },
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
      enteredByUserId:
        String(purchase.enteredByUserId),
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
      voidedAt:
        purchase.voidedAt?.toISOString() ?? null,
      voidedByUserId:
        purchase.voidedByUserId === null
          ? null
          : String(purchase.voidedByUserId),
      voidReason: purchase.voidReason,
      createdAt:
        purchase.createdAt.toISOString(),
      updatedAt:
        purchase.updatedAt.toISOString(),
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
        unitCost:
          item.unitCostMinor === null
            ? null
            : item.unitCostMinor / 100,
        lineDiscountMinor:
          item.lineDiscountMinor,
        lineDiscount:
          item.lineDiscountMinor / 100,
        lineTotalMinor: item.lineTotalMinor,
        lineTotal:
          item.lineTotalMinor === null
            ? null
            : item.lineTotalMinor / 100,
        generalStockBefore:
          item.generalStockBefore,
        generalStockAfter:
          item.generalStockAfter,
        variantStockBefore:
          item.variantStockBefore,
        variantStockAfter:
          item.variantStockAfter,
      })),
    },
  };
}

async function resolveLines(
  tx: any,
  items: DraftItem[],
) {
  const lines: Array<
    typeof posPurchaseItemsTable.$inferInsert
  > = [];

  for (const item of items) {
    let productId = item.productId;

    if (!productId && item.barcode) {
      const mappingRows = await tx
        .select({
          productId:
            productBarcodesTable.productId,
        })
        .from(productBarcodesTable)
        .where(
          eq(
            productBarcodesTable.barcode,
            item.barcode,
          ),
        )
        .limit(1);

      productId =
        mappingRows[0]?.productId ?? null;

      if (!productId) {
        const primaryRows = await tx
          .select({
            id: productsTable.id,
          })
          .from(productsTable)
          .where(
            eq(productsTable.barcode, item.barcode),
          )
          .limit(1);

        productId =
          primaryRows[0]?.id ?? null;
      }
    }

    if (!productId) {
      throw new PurchaseDraftError(
        "تعذر تحديد أحد المنتجات",
      );
    }

    const productRows = await tx
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, productId))
      .limit(1);

    const product = productRows[0];

    if (!product) {
      throw new PurchaseDraftError(
        "أحد المنتجات لم يعد موجودًا",
        404,
      );
    }

    lines.push({
      purchaseId: 0,
      lineNumber: item.lineNumber,
      productId: product.id,
      barcode: item.barcode,
      productCode: product.productCode,
      productNameAr: product.nameAr,
      productImage: product.image,

      // Supplier purchase accounting is product/model level.
      // It must not require or mutate color/size stock.
      color: null,
      size: null,

      quantity: item.quantity,
      freeQuantity: item.freeQuantity,
      unitCostMinor: item.unitCostMinor,
      lineDiscountMinor:
        item.lineDiscountMinor,
      lineTotalMinor: item.lineTotalMinor,

      generalStockBefore: null,
      generalStockAfter: null,
      variantStockBefore: null,
      variantStockAfter: null,
    });
  }

  return lines;
}

async function getDraft(
  db: Db,
  userId: number,
  supplierId: number,
  warehouseKey: string,
) {
  const rows = await db
    .select()
    .from(posPurchasesTable)
    .where(
      and(
        eq(posPurchasesTable.status, "draft"),
        eq(
          posPurchasesTable.enteredByUserId,
          userId,
        ),
        eq(
          posPurchasesTable.supplierId,
          supplierId,
        ),
        eq(
          posPurchasesTable.warehouseKey,
          warehouseKey,
        ),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function handleGetDraft(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requireOwner(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const supplierId = parsePositiveInteger(
    url.searchParams.get("supplierId"),
    "رقم المورد",
  );
  const warehouseKey = normalizeWarehouseKey(
    url.searchParams.get("warehouseKey") ??
      "main",
  );

  const purchase = await getDraft(
    db,
    auth.user.id,
    supplierId,
    warehouseKey,
  );

  if (!purchase) {
    return json({ purchase: null });
  }

  const [items, supplierRows] =
    await Promise.all([
      db
        .select()
        .from(posPurchaseItemsTable)
        .where(
          eq(
            posPurchaseItemsTable.purchaseId,
            purchase.id,
          ),
        )
        .orderBy(
          asc(
            posPurchaseItemsTable.lineNumber,
          ),
        ),
      db
        .select()
        .from(suppliersTable)
        .where(
          eq(
            suppliersTable.id,
            purchase.supplierId,
          ),
        )
        .limit(1),
    ]);

  const supplier = supplierRows[0];

  if (!supplier) {
    return json(
      { error: "مورد المسودة غير موجود" },
      409,
    );
  }

  return json(
    toResponse(
      purchase,
      items,
      supplier,
    ),
  );
}

async function handleSaveDraft(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requireOwner(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const body =
    await request.json().catch(() => null);

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return json(
      { error: "بيانات المسودة غير صالحة" },
      400,
    );
  }

  const payload =
    body as Record<string, unknown>;

  try {
    const supplierId = parsePositiveInteger(
      payload.supplierId,
      "رقم المورد",
    );

    const supplierInvoiceNumber =
      optionalText(
        payload.supplierInvoiceNumber,
        "رقم فاتورة المورد",
        100,
      );

    const businessDate =
      normalizeBusinessDate(
        payload.businessDate,
      );

    const warehouseKey =
      normalizeWarehouseKey(
        payload.warehouseKey,
      );

    const currencyCode =
      normalizeCurrencyCode(
        payload.currencyCode,
      );

    const notes = optionalText(
      payload.notes,
      "الملاحظات",
      2000,
    );

    const items = parseItems(payload.items);
    const financials =
      parseFinancials(payload, items);

    const result =
      await db.transaction(async (tx) => {
        const supplierRows = await tx
          .select()
          .from(suppliersTable)
          .where(
            eq(
              suppliersTable.id,
              supplierId,
            ),
          )
          .for("update");

        const supplier = supplierRows[0];

        if (!supplier) {
          throw new PurchaseDraftError(
            "المورد غير موجود",
            404,
          );
        }

        if (supplier.status !== "active") {
          throw new PurchaseDraftError(
            "لا يمكن التسجيل على مورد غير فعال",
            409,
          );
        }

        if (supplierInvoiceNumber) {
          const duplicateRows = await tx
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
                eq(
                  posPurchasesTable.status,
                  "completed",
                ),
              ),
            )
            .limit(1);

          if (duplicateRows[0]) {
            throw new PurchaseDraftError(
              "رقم فاتورة المورد مسجل مسبقًا",
              409,
            );
          }
        }

        const existingRows = await tx
          .select()
          .from(posPurchasesTable)
          .where(
            and(
              eq(
                posPurchasesTable.status,
                "draft",
              ),
              eq(
                posPurchasesTable.enteredByUserId,
                auth.user.id,
              ),
              eq(
                posPurchasesTable.supplierId,
                supplierId,
              ),
              eq(
                posPurchasesTable.warehouseKey,
                warehouseKey,
              ),
            ),
          )
          .for("update")
          .limit(1);

        const existing =
          existingRows[0] ?? null;

        const resolvedLines =
          await resolveLines(tx, items);

        let purchase:
          typeof posPurchasesTable.$inferSelect;

        if (existing) {
          const updatedRows = await tx
            .update(posPurchasesTable)
            .set({
              supplierId,
              supplierInvoiceNumber,
              businessDate,
              currencyCode,
              paymentMethod:
                financials.paymentMethod,
              subtotalMinor:
                financials.subtotalMinor,
              discountMinor:
                financials.discountMinor,
              totalMinor:
                financials.totalMinor,
              paidMinor:
                financials.paidMinor,
              dueMinor:
                financials.dueMinor,
              notes,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(
                  posPurchasesTable.id,
                  existing.id,
                ),
                eq(
                  posPurchasesTable.status,
                  "draft",
                ),
              ),
            )
            .returning();

          if (!updatedRows[0]) {
            throw new PurchaseDraftError(
              "تعذر تحديث فاتورة المشتريات المفتوحة",
              409,
            );
          }

          purchase = updatedRows[0];

          await tx
            .delete(posPurchaseItemsTable)
            .where(
              eq(
                posPurchaseItemsTable.purchaseId,
                purchase.id,
              ),
            );
        } else {
          const publicId =
            "DRAFT-" +
            businessDate.replaceAll("-", "") +
            "-" +
            randomUUID()
              .slice(0, 8)
              .toUpperCase();

          const insertedRows = await tx
            .insert(posPurchasesTable)
            .values({
              publicId,
              idempotencyKey:
                "purchase-draft:" +
                auth.user.id +
                ":" +
                supplierId +
                ":" +
                warehouseKey,
              supplierId,
              supplierInvoiceNumber,
              businessDate,
              warehouseKey,
              currencyCode,
              enteredByUserId:
                auth.user.id,
              status: "draft",
              paymentMethod:
                financials.paymentMethod,
              subtotalMinor:
                financials.subtotalMinor,
              discountMinor:
                financials.discountMinor,
              totalMinor:
                financials.totalMinor,
              paidMinor:
                financials.paidMinor,
              dueMinor:
                financials.dueMinor,
              notes,
            })
            .returning();

          if (!insertedRows[0]) {
            throw new Error(
              "PURCHASE_DRAFT_INSERT_FAILED",
            );
          }

          purchase = insertedRows[0];
        }

        const insertedItems = await tx
          .insert(posPurchaseItemsTable)
          .values(
            resolvedLines.map((line) => ({
              ...line,
              purchaseId: purchase.id,
            })),
          )
          .returning();

        return {
          purchase,
          items: insertedItems,
          supplier,
        };
      });

    return json(
      toResponse(
        result.purchase,
        result.items,
        result.supplier,
      ),
    );
  } catch (error) {
    if (error instanceof PurchaseDraftError) {
      return json(
        { error: error.message },
        error.status,
      );
    }

    console.error(
      "POS_PURCHASE_DRAFT_SAVE_FAILED",
      error,
    );

    return json(
      {
        error:
          "تعذر حفظ فاتورة المشتريات المفتوحة",
      },
      500,
    );
  }
}


async function handleAppendDraftItem(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requireOwner(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const body =
    await request.json().catch(() => null);

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return json(
      { error: "بيانات الصنف غير صالحة" },
      400,
    );
  }

  const payload =
    body as Record<string, unknown>;

  try {
    const supplierId = parsePositiveInteger(
      payload.supplierId,
      "رقم المورد",
    );

    const productId = parsePositiveInteger(
      payload.productId,
      "رقم المنتج",
    );

    const quantity = parsePositiveInteger(
      payload.quantity,
      "الكمية الجديدة",
      99_999,
    );

    const businessDate =
      normalizeBusinessDate(
        payload.businessDate,
      );

    const warehouseKey =
      normalizeWarehouseKey(
        payload.warehouseKey,
      );

    const currencyCode =
      normalizeCurrencyCode(
        payload.currencyCode,
      );

    const rawUnitCost =
      payload.unitCost ??
      payload.unitCostMinor;

    let unitCostMinor: number | null = null;

    if (
      rawUnitCost !== undefined &&
      rawUnitCost !== null &&
      rawUnitCost !== ""
    ) {
      if (
        payload.unitCostMinor !== undefined &&
        payload.unitCost === undefined
      ) {
        const parsedMinor =
          typeof rawUnitCost === "string"
            ? Number(rawUnitCost)
            : rawUnitCost;

        if (
          typeof parsedMinor !== "number" ||
          !Number.isSafeInteger(parsedMinor) ||
          parsedMinor < 0 ||
          parsedMinor > MAX_MINOR
        ) {
          throw new PurchaseDraftError(
            "تكلفة الصنف غير صالحة",
          );
        }

        unitCostMinor = parsedMinor;
      } else {
        unitCostMinor =
          parseMoneyToMinor(rawUnitCost);

        if (unitCostMinor === null) {
          throw new PurchaseDraftError(
            "تكلفة الصنف غير صالحة",
          );
        }
      }
    }

    const result =
      await db.transaction(async (tx) => {
        const supplierRows = await tx
          .select()
          .from(suppliersTable)
          .where(
            eq(
              suppliersTable.id,
              supplierId,
            ),
          )
          .for("update")
          .limit(1);

        const supplier = supplierRows[0];

        if (!supplier) {
          throw new PurchaseDraftError(
            "المورد غير موجود",
            404,
          );
        }

        if (supplier.status !== "active") {
          throw new PurchaseDraftError(
            "لا يمكن الإضافة إلى مورد غير فعال",
            409,
          );
        }

        const productRows = await tx
          .select()
          .from(productsTable)
          .where(
            eq(
              productsTable.id,
              productId,
            ),
          )
          .limit(1);

        const product = productRows[0];

        if (!product) {
          throw new PurchaseDraftError(
            "المنتج غير موجود",
            404,
          );
        }

        let purchase = await getDraft(
          tx,
          auth.user.id,
          supplierId,
          warehouseKey,
        );

        if (!purchase) {
          const publicId =
            "DRAFT-" +
            businessDate.replaceAll("-", "") +
            "-" +
            randomUUID()
              .slice(0, 8)
              .toUpperCase();

          const insertedRows = await tx
            .insert(posPurchasesTable)
            .values({
              publicId,
              idempotencyKey:
                "purchase-draft:" +
                auth.user.id +
                ":" +
                supplierId +
                ":" +
                warehouseKey,
              supplierId,
              supplierInvoiceNumber: null,
              businessDate,
              warehouseKey,
              currencyCode,
              enteredByUserId:
                auth.user.id,
              status: "draft",
              paymentMethod: "credit",
              subtotalMinor: 0,
              discountMinor: 0,
              totalMinor: 0,
              paidMinor: 0,
              dueMinor: 0,
              notes:
                "مسودة تلقائية من إدخال الأصناف",
            })
            .returning();

          purchase = insertedRows[0] ?? null;

          if (!purchase) {
            throw new Error(
              "PURCHASE_DRAFT_INSERT_FAILED",
            );
          }
        }

        const currentItems = await tx
          .select()
          .from(posPurchaseItemsTable)
          .where(
            eq(
              posPurchaseItemsTable.purchaseId,
              purchase.id,
            ),
          )
          .orderBy(
            asc(
              posPurchaseItemsTable.lineNumber,
            ),
          );

        const existing =
          currentItems.find(
            (item) =>
              item.productId === product.id,
          ) ?? null;

        if (existing) {
          const nextQuantity =
            existing.quantity + quantity;

          if (
            !Number.isSafeInteger(nextQuantity) ||
            nextQuantity > 99_999
          ) {
            throw new PurchaseDraftError(
              "إجمالي كمية الصنف في المسودة أكبر من الحد المسموح",
            );
          }

          const mergedCostMinor =
            existing.unitCostMinor === null ||
            unitCostMinor === null
              ? null
              : existing.unitCostMinor ===
                  unitCostMinor
                ? existing.unitCostMinor
                : null;

          const nextLineTotalMinor =
            mergedCostMinor === null
              ? null
              : mergedCostMinor *
                  nextQuantity -
                existing.lineDiscountMinor;

          await tx
            .update(posPurchaseItemsTable)
            .set({
              quantity: nextQuantity,
              unitCostMinor:
                mergedCostMinor,
              lineTotalMinor:
                nextLineTotalMinor,
            })
            .where(
              eq(
                posPurchaseItemsTable.id,
                existing.id,
              ),
            );
        } else {
          const nextLineNumber =
            currentItems.reduce(
              (max, item) =>
                Math.max(
                  max,
                  item.lineNumber,
                ),
              0,
            ) + 1;

          await tx
            .insert(posPurchaseItemsTable)
            .values({
              purchaseId: purchase.id,
              lineNumber:
                nextLineNumber,
              productId:
                product.id,
              barcode:
                product.barcode,
              productCode:
                product.productCode,
              productNameAr:
                product.nameAr,
              productImage:
                product.image,
              color: null,
              size: null,
              quantity,
              freeQuantity: 0,
              unitCostMinor,
              lineDiscountMinor: 0,
              lineTotalMinor:
                unitCostMinor === null
                  ? null
                  : unitCostMinor *
                    quantity,
              generalStockBefore: null,
              generalStockAfter: null,
              variantStockBefore: null,
              variantStockAfter: null,
            });
        }

        const items = await tx
          .select()
          .from(posPurchaseItemsTable)
          .where(
            eq(
              posPurchaseItemsTable.purchaseId,
              purchase.id,
            ),
          )
          .orderBy(
            asc(
              posPurchaseItemsTable.lineNumber,
            ),
          );

        let subtotalMinor = 0;
        let discountMinor = 0;

        for (const item of items) {
          if (item.unitCostMinor !== null) {
            subtotalMinor +=
              item.unitCostMinor *
              item.quantity;

            discountMinor +=
              item.lineDiscountMinor;
          }
        }

        const totalMinor =
          subtotalMinor -
          discountMinor;

        const updatedRows = await tx
          .update(posPurchasesTable)
          .set({
            businessDate,
            currencyCode,
            paymentMethod: "credit",
            subtotalMinor,
            discountMinor,
            totalMinor,
            paidMinor: 0,
            dueMinor:
              totalMinor,
            updatedAt:
              new Date(),
          })
          .where(
            and(
              eq(
                posPurchasesTable.id,
                purchase.id,
              ),
              eq(
                posPurchasesTable.status,
                "draft",
              ),
            ),
          )
          .returning();

        const updatedPurchase =
          updatedRows[0];

        if (!updatedPurchase) {
          throw new PurchaseDraftError(
            "تعذر تحديث مسودة المشتريات",
            409,
          );
        }

        return {
          purchase:
            updatedPurchase,
          items,
          supplier,
        };
      });

    return json(
      toResponse(
        result.purchase,
        result.items,
        result.supplier,
      ),
    );
  } catch (error) {
    if (
      error instanceof PurchaseDraftError
    ) {
      return json(
        { error: error.message },
        error.status,
      );
    }

    console.error(
      "POS_PURCHASE_DRAFT_APPEND_FAILED",
      error,
    );

    return json(
      {
        error:
          "تعذر إضافة الصنف إلى مسودة المورد",
      },
      500,
    );
  }
}

async function handleDiscardDraft(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requireOwner(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const supplierId = parsePositiveInteger(
    url.searchParams.get("supplierId"),
    "رقم المورد",
  );
  const warehouseKey = normalizeWarehouseKey(
    url.searchParams.get("warehouseKey") ??
      "main",
  );

  await db
    .delete(posPurchasesTable)
    .where(
      and(
        eq(posPurchasesTable.status, "draft"),
        eq(
          posPurchasesTable.enteredByUserId,
          auth.user.id,
        ),
        eq(
          posPurchasesTable.supplierId,
          supplierId,
        ),
        eq(
          posPurchasesTable.warehouseKey,
          warehouseKey,
        ),
      ),
    );

  return json({ ok: true });
}

export async function handlePurchaseDraftRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path =
    new URL(request.url).pathname;

  const isDraftPath =
    path === "/api/pos/purchases/draft";

  const isAppendItemPath =
    path === "/api/pos/purchases/draft/append-item";

  if (
    !isDraftPath &&
    !isAppendItemPath
  ) {
    return null;
  }

  if (!isPurchaseApiEnabled(env)) {
    return purchaseFeatureDisabledResponse();
  }

  if (
    isDraftPath &&
    request.method === "GET"
  ) {
    return handleGetDraft(
      request,
      db,
      env,
    );
  }

  if (
    isAppendItemPath &&
    request.method === "POST"
  ) {
    if (!isPurchaseWriteEnabled(env)) {
      return purchaseWritesDisabledResponse();
    }

    return handleAppendDraftItem(
      request,
      db,
      env,
    );
  }

  if (
    isDraftPath &&
    request.method === "POST"
  ) {
    if (!isPurchaseWriteEnabled(env)) {
      return purchaseWritesDisabledResponse();
    }

    return handleSaveDraft(
      request,
      db,
      env,
    );
  }

  if (
    isDraftPath &&
    request.method === "DELETE"
  ) {
    if (!isPurchaseWriteEnabled(env)) {
      return purchaseWritesDisabledResponse();
    }

    return handleDiscardDraft(
      request,
      db,
      env,
    );
  }

  return null;
}
