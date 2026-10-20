import {
  inventoryMovementsTable,
  cashSessionsTable,
  financeAccountsTable,
  financeTransactionLinesTable,
  financeTransactionsTable,
  posPurchaseItemCostsTable,
  posPurchaseItemsTable,
  posPurchasesTable,
  productCostStateTable,
  productBarcodesTable,
  productsTable,
  suppliersTable,
  type ColorVariant,
} from "@workspace/db/schema";
import { and, asc, desc, eq, gt, lt, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";
import {
  ensureSupplierPayableControlAccount,
} from "./finance-supplier-ledger";
import {
  postFinanceTransaction,
  type FinancePostingLineInput,
} from "./finance-posting";
import {
  isPurchaseWriteEnabled,
  purchaseWritesDisabledResponse,
} from "./purchase-feature";
import {
  addExactProductCostOrInitialize,
  allocateProportionalCostMinor,
  deriveUnitCostMinor,
  InventoryCostError,
} from "./inventory-cost-engine";
import {
  getPendingPurchaseQuantityForProduct,
} from "./purchase-draft-service";
import {
  backfillHistoricalPurchaseCosts,
  HistoricalPurchaseCostBackfillError,
} from "./historical-purchase-cost-backfill";
import {
  getProductQuantity,
} from "./product-quantity";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

type PosUser = NonNullable<
  Awaited<ReturnType<typeof getCurrentUser>>
>;

const MAX_MINOR = 2_000_000_000;

function normalizeRegisterKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return /^[a-z0-9_-]{1,50}$/.test(normalized)
    ? normalized
    : null;
}

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
  entryMode: "stock_receipt" | "historical";
  unitCostMinor: number;
  lineDiscountMinor: number;
  lineTotalMinor: number;
}

function allocateApprovedPurchaseCosts(
  items: Array<typeof posPurchaseItemsTable.$inferSelect>,
  invoiceDiscountMinor: number,
) {
  const ordered = [...items].sort(
    (left, right) =>
      left.lineNumber - right.lineNumber ||
      left.id - right.id,
  );

  let totalBeforeInvoiceDiscount = 0;

  for (const item of ordered) {
    if (item.lineTotalMinor === null) {
      throw new PurchaseError(
        "لا يمكن اعتماد فاتورة تحتوي تكلفة غير مدخلة",
        409,
      );
    }

    totalBeforeInvoiceDiscount +=
      item.lineTotalMinor;

    if (
      !Number.isSafeInteger(
        totalBeforeInvoiceDiscount,
      ) ||
      totalBeforeInvoiceDiscount >
        MAX_MINOR
    ) {
      throw new PurchaseError(
        "قيمة تكلفة المشتريات تتجاوز الحد المسموح",
      );
    }
  }

  if (
    invoiceDiscountMinor < 0 ||
    invoiceDiscountMinor >
      totalBeforeInvoiceDiscount
  ) {
    throw new PurchaseError(
      "خصم الفاتورة غير صالح لتوزيع تكلفة المخزون",
      409,
    );
  }

  let cumulativeLineNet = 0;
  let allocatedSoFar = 0;

  const allocations = ordered.map(
    (item) => {
      const lineNet =
        item.lineTotalMinor as number;

      cumulativeLineNet +=
        lineNet;

      const targetAllocated =
        totalBeforeInvoiceDiscount === 0
          ? 0
          : Number(
              (
                BigInt(
                  cumulativeLineNet,
                ) *
                BigInt(
                  invoiceDiscountMinor,
                )
              ) /
                BigInt(
                  totalBeforeInvoiceDiscount,
                ),
            );

      const lineInvoiceDiscount =
        targetAllocated -
        allocatedSoFar;

      allocatedSoFar =
        targetAllocated;

      const costTotalMinor =
        lineNet -
        lineInvoiceDiscount;

      const receivedQuantity =
        item.quantity +
        item.freeQuantity;

      if (
        !Number.isSafeInteger(
          receivedQuantity,
        ) ||
        receivedQuantity <= 0
      ) {
        throw new PurchaseError(
          "كمية الاستلام لأحد المنتجات غير صالحة",
          409,
        );
      }

      if (
        !Number.isSafeInteger(
          costTotalMinor,
        ) ||
        costTotalMinor < 0
      ) {
        throw new PurchaseError(
          "تكلفة أحد المنتجات بعد الخصومات غير صالحة",
          409,
        );
      }

      return {
        item,
        receivedQuantity,
        invoiceDiscountAllocatedMinor:
          lineInvoiceDiscount,
        costTotalMinor,
      };
    },
  );

  const allocatedTotal =
    allocations.reduce(
      (sum, entry) =>
        sum +
        entry.costTotalMinor,
      0,
    );

  if (
    allocatedTotal !==
    totalBeforeInvoiceDiscount -
      invoiceDiscountMinor
  ) {
    throw new PurchaseError(
      "تعذر توزيع خصم الفاتورة على تكلفة الأصناف بدقة",
      409,
    );
  }

  return allocations;
}
async function requirePurchaseOwner(
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

    const entryMode =
      item.entryMode === undefined
        ? "stock_receipt"
        : item.entryMode;

    if (
      entryMode !== "stock_receipt" &&
      entryMode !== "historical"
    ) {
      throw new PurchaseError(
        "نوع تسجيل أحد أصناف المشتريات غير صالح",
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
      entryMode,
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
  navigation: {
    previousPublicId: string | null;
    nextPublicId: string | null;
  } = {
    previousPublicId: null,
    nextPublicId: null,
  },
) {
  return {
    alreadyCreated,
    navigation,
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
        entryMode: item.entryMode,
        unitCostMinor: item.unitCostMinor,
        unitCost:
          item.unitCostMinor === null
            ? null
            : item.unitCostMinor / 100,
        lineDiscountMinor: item.lineDiscountMinor,
        lineDiscount: item.lineDiscountMinor / 100,
        lineTotalMinor: item.lineTotalMinor,
        lineTotal:
          item.lineTotalMinor === null
            ? null
            : item.lineTotalMinor / 100,
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


async function getPurchaseNavigation(
  db: Db,
  purchase: typeof posPurchasesTable.$inferSelect,
) {
  const [previousRows, nextRows] = await Promise.all([
    db
      .select({ publicId: posPurchasesTable.publicId })
      .from(posPurchasesTable)
      .where(
        and(
          eq(posPurchasesTable.warehouseKey, purchase.warehouseKey),
          ne(posPurchasesTable.status, "draft"),
          lt(posPurchasesTable.id, purchase.id),
        ),
      )
      .orderBy(desc(posPurchasesTable.id))
      .limit(1),

    db
      .select({ publicId: posPurchasesTable.publicId })
      .from(posPurchasesTable)
      .where(
        and(
          eq(posPurchasesTable.warehouseKey, purchase.warehouseKey),
          ne(posPurchasesTable.status, "draft"),
          gt(posPurchasesTable.id, purchase.id),
        ),
      )
      .orderBy(asc(posPurchasesTable.id))
      .limit(1),
  ]);

  return {
    previousPublicId: previousRows[0]?.publicId ?? null,
    nextPublicId: nextRows[0]?.publicId ?? null,
  };
}

async function handleLatestPurchase(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requirePurchaseOwner(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const warehouseKey =
    (url.searchParams.get("warehouseKey") ?? "main").trim();

  if (
    !warehouseKey ||
    warehouseKey.length > 80 ||
    !/^[A-Za-z0-9_-]+$/.test(warehouseKey)
  ) {
    return json({ error: "المستودع غير صالح" }, 400);
  }

  const purchaseRows = await db
    .select()
    .from(posPurchasesTable)
    .where(
      and(
        eq(posPurchasesTable.warehouseKey, warehouseKey),
        ne(posPurchasesTable.status, "draft"),
      ),
    )
    .orderBy(desc(posPurchasesTable.id))
    .limit(1);

  const purchase = purchaseRows[0];

  if (!purchase) {
    return json({ error: "لا توجد فواتير مشتريات محفوظة" }, 404);
  }

  const [items, supplierRows, navigation] = await Promise.all([
    db
      .select()
      .from(posPurchaseItemsTable)
      .where(eq(posPurchaseItemsTable.purchaseId, purchase.id))
      .orderBy(asc(posPurchaseItemsTable.lineNumber)),

    db
      .select()
      .from(suppliersTable)
      .where(eq(suppliersTable.id, purchase.supplierId))
      .limit(1),

    getPurchaseNavigation(db, purchase),
  ]);

  const supplier = supplierRows[0];

  if (!supplier) {
    return json({ error: "بيانات مورد الفاتورة غير موجودة" }, 500);
  }

  return json(
    toPurchaseResponse(
      purchase,
      items,
      supplier,
      false,
      navigation,
    ),
  );
}

async function handlePurchaseByPublicId(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requirePurchaseOwner(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const publicId = (url.searchParams.get("publicId") ?? "")
    .trim()
    .toUpperCase();

  if (
    !publicId ||
    publicId.length > 80 ||
    !/^[A-Z0-9_-]+$/.test(publicId)
  ) {
    return json({ error: "رقم فاتورة المشتريات غير صالح" }, 400);
  }

  const purchaseRows = await db
    .select()
    .from(posPurchasesTable)
    .where(eq(posPurchasesTable.publicId, publicId))
    .limit(1);

  const purchase = purchaseRows[0];

  if (!purchase) {
    return json({ error: "فاتورة المشتريات غير موجودة" }, 404);
  }

  const [items, supplierRows, navigation] = await Promise.all([
    db
      .select()
      .from(posPurchaseItemsTable)
      .where(eq(posPurchaseItemsTable.purchaseId, purchase.id))
      .orderBy(asc(posPurchaseItemsTable.lineNumber)),

    db
      .select()
      .from(suppliersTable)
      .where(eq(suppliersTable.id, purchase.supplierId))
      .limit(1),

    getPurchaseNavigation(db, purchase),
  ]);

  const supplier = supplierRows[0];

  if (!supplier) {
    return json({ error: "بيانات مورد الفاتورة غير موجودة" }, 500);
  }

  return json(
    toPurchaseResponse(
      purchase,
      items,
      supplier,
      false,
      navigation,
    ),
  );
}

async function handleVoidPurchase(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requirePurchaseOwner(request, db, env);

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

      const hasLegacyStockAffectingItems =
        purchaseItems.some(
          (item) =>
            item.generalStockBefore !== null ||
            item.generalStockAfter !== null ||
            item.variantStockBefore !== null ||
            item.variantStockAfter !== null,
        );

      if (!hasLegacyStockAffectingItems) {
        throw new PurchaseError(
          "لا يمكن إلغاء فاتورة مشتريات معتمدة حديثة مباشرة لأنها مرتبطة بتكلفة المخزون. استخدم مردود المشتريات لعكسها بشكل صحيح.",
          409,
        );
      }

      const stockCardVoidOccurredAt = new Date();

      const orderedItems = [...purchaseItems].sort((left, right) => {
        const leftId = left.productId ?? Number.MAX_SAFE_INTEGER;
        const rightId = right.productId ?? Number.MAX_SAFE_INTEGER;

        return leftId - rightId || left.lineNumber - right.lineNumber;
      });

      for (const item of orderedItems) {
        const legacyStockAffecting =
          item.generalStockBefore !== null ||
          item.generalStockAfter !== null ||
          item.variantStockBefore !== null ||
          item.variantStockAfter !== null;

        // New purchase invoices are accounting-only and therefore
        // must not touch product stock or the inventory movement ledger
        // when voided. The code below remains only for legacy invoices
        // that actually changed stock before this behavior was introduced.
        if (!legacyStockAffecting) {
          continue;
        }

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

        let stockCardGeneralBefore: number | null = null;
        let stockCardGeneralAfter: number | null = null;
        let stockCardVariantBefore: number | null = null;
        let stockCardVariantAfter: number | null = null;

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

          stockCardGeneralBefore = product.stock;

          const nextStock = product.stock - receivedQuantity;

          if (!Number.isSafeInteger(nextStock) || nextStock < 0) {
            throw new PurchaseError(
              `لا يمكن حذف الفاتورة لأن مخزون ${item.productNameAr} لا يكفي`,
              409,
            );
          }

          stockCardGeneralAfter = nextStock;
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

          stockCardVariantBefore = selectedSize.stock;

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

          stockCardVariantAfter = nextVariantStock;

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

        // stock-card:pos-purchase:voided
        await tx
          .insert(inventoryMovementsTable)
          .values({
            productId: product.id,
            barcode: item.barcode,
            productCode: item.productCode,
            productNameAr: item.productNameAr,
            color: item.color,
            size: item.size,

            movementType: "purchase_void",
            quantityDelta: -receivedQuantity,

            generalStockBefore: stockCardGeneralBefore,
            generalStockAfter: stockCardGeneralAfter,

            variantStockBefore: stockCardVariantBefore,
            variantStockAfter: stockCardVariantAfter,

            sourceType: "pos_purchase",
            sourceId: purchase.id,
            sourceItemId: item.id,
            sourcePublicId: purchase.publicId,

            eventKey:
              `pos-purchase:${purchase.id}:item:${item.id}:voided`,

            occurredAt: stockCardVoidOccurredAt,
          });
      }

      const originalFinanceRows = await tx
        .select()
        .from(financeTransactionsTable)
        .where(
          and(
            eq(financeTransactionsTable.sourceType, "pos_purchase"),
            eq(financeTransactionsTable.sourceId, String(purchase.id)),
            eq(financeTransactionsTable.sourceEvent, "completed"),
            eq(financeTransactionsTable.status, "posted"),
          ),
        )
        .limit(1)
        .for("update");

      const originalFinance = originalFinanceRows[0] ?? null;

      if (originalFinance) {
        const originalFinanceLines = await tx
          .select()
          .from(financeTransactionLinesTable)
          .where(
            eq(
              financeTransactionLinesTable.transactionId,
              originalFinance.id,
            ),
          )
          .orderBy(
            asc(financeTransactionLinesTable.lineNumber),
          );

        if (originalFinanceLines.length === 0) {
          throw new PurchaseError(
            "الحركة المالية الأصلية للفاتورة غير مكتملة",
            409,
          );
        }

        let reversalCashSession:
          | typeof cashSessionsTable.$inferSelect
          | null = null;

        let reversalExpectedCashAfter: number | null = null;

        if (purchase.paidMinor > 0) {
          if (originalFinance.cashSessionId === null) {
            throw new PurchaseError(
              "لا يمكن عكس الدفعة النقدية لعدم وجود جلسة صندوق مرتبطة",
              409,
            );
          }

          const reversalSessionRows = await tx
            .select()
            .from(cashSessionsTable)
            .where(
              and(
                eq(
                  cashSessionsTable.id,
                  originalFinance.cashSessionId,
                ),
                eq(cashSessionsTable.status, "open"),
              ),
            )
            .for("update");

          reversalCashSession =
            reversalSessionRows[0] ?? null;

          if (!reversalCashSession) {
            throw new PurchaseError(
              "لا يمكن حذف فاتورة مشتريات نقدية بعد إغلاق جلسة الصندوق التي سُجلت عليها",
              409,
            );
          }

          const expectedBefore =
            reversalCashSession.expectedBalanceMinor ??
            reversalCashSession.openingBalanceMinor;

          reversalExpectedCashAfter =
            expectedBefore + purchase.paidMinor;

          if (
            !Number.isSafeInteger(reversalExpectedCashAfter) ||
            reversalExpectedCashAfter > MAX_MINOR
          ) {
            throw new PurchaseError(
              "رصيد الصندوق بعد عكس الفاتورة غير صالح",
              409,
            );
          }
        }

        await postFinanceTransaction(
          tx,
          {
            publicId:
              `FIN-${purchase.businessDate.replaceAll("-", "")}-` +
              randomUUID().slice(0, 8).toUpperCase(),
            idempotencyKey:
              `purchase:${purchase.id}:voided`,
            businessDate:
              purchase.businessDate,
            transactionType:
              "reversal",
            sourceType:
              "pos_purchase",
            sourceId:
              String(purchase.id),
            sourceEvent:
              "voided",
            cashSessionId:
              reversalCashSession?.id ??
              originalFinance.cashSessionId ??
              null,
            notes:
              `عكس فاتورة المشتريات ${purchase.publicId}: ${reason}`,
            createdByUserId:
              auth.user.id,
            lines:
              originalFinanceLines.map(
                (line) => ({
                  accountId:
                    line.accountId,
                  customerId:
                    line.customerId,
                  employeeId:
                    line.employeeId,
                  supplierId:
                    line.supplierId,
                  debitMinor:
                    line.creditMinor,
                  creditMinor:
                    line.debitMinor,
                  memo:
                    `عكس: ${line.memo ?? purchase.publicId}`,
                }),
              ),
          },
        );

        const reversedOriginalRows = await tx
          .update(financeTransactionsTable)
          .set({
            status: "reversed",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(financeTransactionsTable.id, originalFinance.id),
              eq(financeTransactionsTable.status, "posted"),
            ),
          )
          .returning({
            id: financeTransactionsTable.id,
          });

        if (!reversedOriginalRows[0]) {
          throw new PurchaseError(
            "تم تغيير الحركة المالية قبل إلغاء الفاتورة",
            409,
          );
        }

        if (
          reversalCashSession &&
          reversalExpectedCashAfter !== null
        ) {
          const restoredSessionRows = await tx
            .update(cashSessionsTable)
            .set({
              expectedBalanceMinor: reversalExpectedCashAfter,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(
                  cashSessionsTable.id,
                  reversalCashSession.id,
                ),
                eq(cashSessionsTable.status, "open"),
              ),
            )
            .returning({
              id: cashSessionsTable.id,
            });

          if (!restoredSessionRows[0]) {
            throw new PurchaseError(
              "تم إغلاق الصندوق قبل عكس فاتورة المشتريات",
              409,
            );
          }
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
  const auth = await requirePurchaseOwner(request, db, env);

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

    const draftPublicId = optionalText(
      payload.draftPublicId,
      "رقم المسودة",
      80,
    );

    const draftUpdatedAt = optionalText(
      payload.draftUpdatedAt,
      "إصدار المسودة",
      80,
    );

    let draftUpdatedAtMs: number | null = null;

    if (draftUpdatedAt) {
      draftUpdatedAtMs =
        Date.parse(draftUpdatedAt);

      if (
        !Number.isFinite(
          draftUpdatedAtMs,
        )
      ) {
        throw new PurchaseError(
          "إصدار المسودة غير صالح",
        );
      }
    }

    if (
      draftPublicId &&
      draftUpdatedAtMs === null
    ) {
      throw new PurchaseError(
        "يجب إرسال إصدار المسودة عند اعتماد فاتورة مفتوحة",
      );
    }

    if (!draftPublicId) {
      throw new PurchaseError(
        "اعتماد فاتورة المشتريات يجب أن يتم من مسودة المورد المفتوحة",
        409,
      );
    }

    const businessDate = normalizeBusinessDate(
      payload.businessDate,
    );

    const warehouseKey = normalizeWarehouseKey(
      payload.warehouseKey,
    );

    const currencyCode = normalizeCurrencyCode(
      payload.currencyCode,
    );

    const registerKey = normalizeRegisterKey(
      payload.registerKey ?? "main",
    );

    if (!registerKey) {
      throw new PurchaseError("معرف صندوق غير صالح");
    }

    const paymentMethod =
      typeof payload.paymentMethod === "string"
        ? payload.paymentMethod.trim().toLowerCase()
        : "credit";

    if (
      paymentMethod !== "cash" &&
      paymentMethod !== "credit" &&
      paymentMethod !== "mixed" &&
      paymentMethod !== "historical_settled"
    ) {
      throw new PurchaseError("طريقة الدفع غير صالحة");
    }

    const notes = optionalText(
      payload.notes,
      "الملاحظات",
      2000,
    );

    const items = parseItems(payload.items);

    if (
      paymentMethod === "historical_settled" &&
      items.some(
        (item) =>
          item.entryMode !==
          "historical",
      )
    ) {
      throw new PurchaseError(
        "خيار مدفوع سابقًا متاح فقط لفاتورة شراء سابق بالكامل",
      );
    }

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

    if (
      paymentMethod ===
        "historical_settled" &&
      paidMinor !== 0
    ) {
      throw new PurchaseError(
        "الشراء المدفوع سابقًا لا يسجل دفعة على صندوق اليوم",
      );
    }

    const dueMinor =
      paymentMethod ===
        "historical_settled"
        ? 0
        : totalMinor -
          paidMinor;

    const result = await db.transaction(async (tx) => {
      let lockedDraftItems: Array<
        typeof posPurchaseItemsTable.$inferSelect
      > = [];

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

      if (draftPublicId) {
        const draftRows = await tx
          .select()
          .from(posPurchasesTable)
          .where(
            and(
              eq(
                posPurchasesTable.publicId,
                draftPublicId,
              ),
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

        const lockedDraft =
          draftRows[0];

        if (!lockedDraft) {
          throw new PurchaseError(
            "فاتورة المشتريات المفتوحة لم تعد موجودة. أعد تحميل الصفحة قبل الاعتماد.",
            409,
          );
        }

        if (
          draftUpdatedAtMs !== null &&
          lockedDraft.updatedAt.getTime() !==
            draftUpdatedAtMs
        ) {
          throw new PurchaseError(
            "تم تحديث مسودة هذا المورد من مكان آخر. أعد تحميل المسودة قبل الاعتماد حتى لا تضيع أصناف جديدة.",
            409,
          );
        }

        if (
          lockedDraft.supplierInvoiceNumber !==
            supplierInvoiceNumber ||
          lockedDraft.businessDate !==
            businessDate ||
          lockedDraft.currencyCode !==
            currencyCode ||
          lockedDraft.paymentMethod !==
            paymentMethod ||
          lockedDraft.subtotalMinor !==
            subtotalMinor ||
          lockedDraft.discountMinor !==
            discountMinor ||
          lockedDraft.totalMinor !==
            totalMinor ||
          lockedDraft.paidMinor !==
            paidMinor ||
          lockedDraft.dueMinor !==
            dueMinor ||
          lockedDraft.notes !==
            notes
        ) {
          throw new PurchaseError(
            "تم تعديل بيانات الفاتورة بعد آخر حفظ للمسودة. احفظ المسودة ثم أعد الاعتماد.",
            409,
          );
        }

        lockedDraftItems = await tx
          .select()
          .from(posPurchaseItemsTable)
          .where(
            eq(
              posPurchaseItemsTable.purchaseId,
              lockedDraft.id,
            ),
          )
          .orderBy(
            asc(
              posPurchaseItemsTable.lineNumber,
            ),
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
              eq(
                posPurchasesTable.status,
                "completed",
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

      let cashSession:
        | typeof cashSessionsTable.$inferSelect
        | null = null;

      let expectedCashAfter: number | null = null;

      if (paidMinor > 0) {
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

        cashSession = sessionRows[0] ?? null;

        if (!cashSession) {
          throw new PurchaseError(
            "يجب فتح يوم الصندوق قبل حفظ فاتورة مشتريات مدفوعة",
            409,
          );
        }

        const expectedBefore =
          cashSession.expectedBalanceMinor ??
          cashSession.openingBalanceMinor;

        if (paidMinor > expectedBefore) {
          throw new PurchaseError(
            "رصيد الصندوق لا يكفي لتسجيل الدفعة للمورد",
            409,
          );
        }

        expectedCashAfter = expectedBefore - paidMinor;

        if (
          !Number.isSafeInteger(expectedCashAfter) ||
          expectedCashAfter < 0
        ) {
          throw new PurchaseError(
            "رصيد الصندوق بعد الدفع غير صالح",
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

      const comparableDraftItems =
        [...lockedDraftItems].sort(
          (left, right) =>
            (left.productId ?? Number.MAX_SAFE_INTEGER) -
              (right.productId ?? Number.MAX_SAFE_INTEGER) ||
            left.lineNumber - right.lineNumber,
        );

      if (
        comparableDraftItems.length !==
        resolvedItems.length
      ) {
        throw new PurchaseError(
          "أصناف الفاتورة تغيرت بعد آخر حفظ للمسودة. احفظ المسودة ثم أعد الاعتماد.",
          409,
        );
      }

      for (
        let index = 0;
        index < resolvedItems.length;
        index += 1
      ) {
        const current =
          resolvedItems[index];
        const saved =
          comparableDraftItems[index];

        if (
          !current ||
          !saved ||
          saved.productId !==
            current.productId ||
          saved.quantity !==
            current.quantity ||
          saved.freeQuantity !==
            current.freeQuantity ||
          saved.entryMode !==
            current.entryMode ||
          saved.unitCostMinor !==
            current.unitCostMinor ||
          saved.lineDiscountMinor !==
            current.lineDiscountMinor
        ) {
          throw new PurchaseError(
            "تفاصيل الأصناف تغيرت بعد آخر حفظ للمسودة. احفظ المسودة ثم أعد الاعتماد.",
            409,
          );
        }
      }

      const purchaseLines: Array<
        typeof posPurchaseItemsTable.$inferInsert
      > = [];

      const lockedProductsById =
        new Map<
          number,
          typeof productsTable.$inferSelect
        >();

      for (const item of resolvedItems) {
        let product =
          lockedProductsById.get(
            item.productId,
          );

        if (!product) {
          const productRows = await tx
            .select()
            .from(productsTable)
            .where(
              eq(
                productsTable.id,
                item.productId,
              ),
            )
            .for("update")
            .limit(1);

          product = productRows[0];

          if (product) {
            lockedProductsById.set(
              product.id,
              product,
            );
          }
        }

        if (!product) {
          throw new PurchaseError(
            "أحد المنتجات لم يعد موجودًا",
            404,
          );
        }

        // Purchase invoices intentionally work at product/model level.
        // Barcode variant metadata may help locate the product, but purchase
        // accounting must not require or mutate color/size inventory.
        const color = null;
        const size = null;

        // Purchase invoices are accounting-only.
        // Physical inventory is managed manually from the store
        // product inventory and must NEVER be changed here.
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
          entryMode: item.entryMode,
          unitCostMinor: item.unitCostMinor,
          lineDiscountMinor: item.lineDiscountMinor,
          lineTotalMinor: item.lineTotalMinor,

          // Kept nullable for backward compatibility with older
          // purchase invoices that used to mutate physical stock.
          generalStockBefore: null,
          generalStockAfter: null,
          variantStockBefore: null,
          variantStockAfter: null,
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

      // Purchase approval does NOT mutate physical stock.
      // The physical quantity was already entered from the product screen.
      // Here we only bring Inventory Cost Engine up to the same quantity/value.
      const costAllocations =
        allocateApprovedPurchaseCosts(
          insertedItems,
          invoiceDiscountMinor,
        );

      const allocatedPurchaseValue =
        costAllocations.reduce(
          (sum, entry) =>
            sum +
            entry.costTotalMinor,
          0,
        );

      if (
        allocatedPurchaseValue !==
        totalMinor
      ) {
        throw new PurchaseError(
          "صافي تكلفة المخزون لا يطابق إجمالي فاتورة المشتريات",
          409,
        );
      }

      const historicalLineCounts =
        new Map<number, number>();

      const entryModesByProduct =
        new Map<
          number,
          Set<
            "stock_receipt" |
            "historical"
          >
        >();

      for (
        const allocation
        of costAllocations
      ) {
        const productId =
          allocation.item.productId;

        if (productId === null) {
          continue;
        }

        const modes =
          entryModesByProduct.get(
            productId,
          ) ??
          new Set<
            "stock_receipt" |
            "historical"
          >();

        modes.add(
          allocation.item.entryMode,
        );

        entryModesByProduct.set(
          productId,
          modes,
        );

        if (
          allocation.item.entryMode ===
          "historical"
        ) {
          historicalLineCounts.set(
            productId,
            (
              historicalLineCounts.get(
                productId,
              ) ?? 0
            ) + 1,
          );
        }
      }

      const invoiceHasHistorical =
        costAllocations.some(
          (allocation) =>
            allocation.item.entryMode ===
            "historical",
        );

      const invoiceHasStockReceipt =
        costAllocations.some(
          (allocation) =>
            allocation.item.entryMode ===
            "stock_receipt",
        );

      if (
        invoiceHasHistorical &&
        invoiceHasStockReceipt
      ) {
        throw new PurchaseError(
          "لا يمكن جمع شراء سابق واستلام جديد في فاتورة واحدة. اعتمد كل نوع بفاتورة مستقلة حتى تبقى حركة الصندوق والذمم والتكلفة واضحة.",
          409,
        );
      }

      for (
        const [
          productId,
          modes,
        ]
        of entryModesByProduct
      ) {
        const product =
          lockedProductsById.get(
            productId,
          );

        if (modes.size > 1) {
          throw new PurchaseError(
            `لا يمكن جمع استلام جديد وشراء سابق لنفس الصنف ${product?.nameAr ?? productId} في نفس الفاتورة. افصل الحركتين.`,
            409,
          );
        }

        if (
          (
            historicalLineCounts.get(
              productId,
            ) ?? 0
          ) > 1
        ) {
          throw new PurchaseError(
            `الصنف ${product?.nameAr ?? productId} مكرر بأكثر من سطر شراء سابق. اجمع الكمية في سطر واحد قبل الاعتماد.`,
            409,
          );
        }
      }

      const approvedProductIds = [
        ...new Set(
          costAllocations.map(
            (entry) => {
              if (
                entry.item.productId ===
                null
              ) {
                throw new PurchaseError(
                  "تعذر تحديد منتج أحد سطور المشتريات",
                  409,
                );
              }

              return entry.item.productId;
            },
          ),
        ),
      ].sort(
        (left, right) =>
          left - right,
      );

      const historicalGapByProduct =
        new Map<number, number>();

      for (
        const productId
        of approvedProductIds
      ) {
        const product =
          lockedProductsById.get(
            productId,
          );

        if (!product) {
          throw new PurchaseError(
            "تعذر قفل أحد المنتجات قبل اعتماد تكلفة المشتريات",
            409,
          );
        }

        const physicalQuantity =
          getProductQuantity(
            product,
          );

        if (
          physicalQuantity === null
        ) {
          throw new PurchaseError(
            "تعذر حساب كمية المخزون الفعلية لأحد أصناف المشتريات",
            409,
          );
        }

        const pendingStockReceiptQuantity =
          await getPendingPurchaseQuantityForProduct(
            tx,
            {
              productId,
              warehouseKey,
            },
          );

        const costStateRows =
          await tx
            .select({
              quantityOnHand:
                productCostStateTable.quantityOnHand,
            })
            .from(productCostStateTable)
            .where(
              eq(
                productCostStateTable.productId,
                productId,
              ),
            )
            .for("update")
            .limit(1);

        const currentCostQuantity =
          costStateRows[0]
            ?.quantityOnHand ??
          0;

        const explainedPhysicalQuantity =
          currentCostQuantity +
          pendingStockReceiptQuantity;

        if (
          explainedPhysicalQuantity >
          physicalQuantity
        ) {
          throw new PurchaseError(
            `مخزون الصنف ${product.nameAr} أقل من الكمية الممثلة في محرك التكلفة ومسودات الاستلام الجديدة. راجع المخزون قبل الاعتماد.`,
            409,
          );
        }

        const historicalGap =
          physicalQuantity -
          explainedPhysicalQuantity;

        const historicalPurchaseQuantity =
          costAllocations
            .filter(
              (entry) =>
                entry.item.productId ===
                  productId &&
                entry.item.entryMode ===
                  "historical",
            )
            .reduce(
              (sum, entry) =>
                sum +
                entry.receivedQuantity,
              0,
            );

        if (
          historicalGap > 0 &&
          historicalPurchaseQuantity <
            historicalGap
        ) {
          throw new PurchaseError(
            `الشراء السابق للصنف ${product.nameAr} لا يغطي كامل المخزون القديم غير الممثل محاسبيًا. الكمية المطلوبة لتسوية المخزون الحالي: ${historicalGap}.`,
            409,
          );
        }

        if (
          historicalGap > 0 &&
          historicalPurchaseQuantity === 0
        ) {
          throw new PurchaseError(
            `الصنف ${product.nameAr} لديه مخزون سابق غير ممثل في محرك التكلفة. سجله كشراء سابق أو أدخل تكلفة أول المدة قبل اعتماد الفاتورة.`,
            409,
          );
        }

        historicalGapByProduct.set(
          productId,
          historicalGap,
        );
      }

      let inventoryPurchaseValueMinor = 0;
      let historicalSoldValueMinor = 0;

      for (
        const allocation
        of costAllocations
      ) {
        const productId =
          allocation.item.productId;

        if (productId === null) {
          throw new PurchaseError(
            "تعذر تحديد منتج أحد سطور المشتريات",
            409,
          );
        }

        let stockQuantityApplied =
          allocation.receivedQuantity;

        if (
          allocation.item.entryMode ===
          "historical"
        ) {
          const remainingGap =
            historicalGapByProduct.get(
              productId,
            ) ?? 0;

          stockQuantityApplied =
            Math.min(
              allocation.receivedQuantity,
              remainingGap,
            );

          historicalGapByProduct.set(
            productId,
            remainingGap -
              stockQuantityApplied,
          );
        }

        const historicalSoldQuantity =
          allocation.receivedQuantity -
          stockQuantityApplied;

        const stockCostTotalMinor =
          stockQuantityApplied <= 0
            ? 0
            : stockQuantityApplied ===
                allocation.receivedQuantity
              ? allocation.costTotalMinor
              : allocateProportionalCostMinor(
                  allocation.costTotalMinor,
                  stockQuantityApplied,
                  allocation.receivedQuantity,
                );

        const historicalSoldCostTotalMinor =
          allocation.costTotalMinor -
          stockCostTotalMinor;

        let costQuality:
          | "confirmed"
          | "estimated"
          | "mixed" =
          "confirmed";

        if (
          allocation.item.entryMode ===
          "historical"
        ) {
          const product =
            lockedProductsById.get(
              productId,
            );

          if (!product) {
            throw new PurchaseError(
              "تعذر تحديد المنتج لتسوية التكلفة التاريخية",
              409,
            );
          }

          try {
            await backfillHistoricalPurchaseCosts(
              tx,
              {
                productId,
                productName:
                  product.nameAr,
                productCreatedAt:
                  product.createdAt,
                purchasePublicId:
                  purchase.publicId,
                receivedQuantity:
                  allocation.receivedQuantity,
                purchaseCostTotalMinor:
                  allocation.costTotalMinor,
                historicalSoldQuantity,
                historicalSoldCostTotalMinor,
                createdByUserId:
                  auth.user.id,
              },
            );
          } catch (error) {
            if (
              error instanceof
              HistoricalPurchaseCostBackfillError
            ) {
              throw new PurchaseError(
                error.message,
                409,
              );
            }

            throw error;
          }
        }

        if (
          stockQuantityApplied > 0
        ) {
          try {
            const costResult =
              await addExactProductCostOrInitialize(
                tx,
                {
                  productId,

                  quantity:
                    stockQuantityApplied,

                  costTotalMinor:
                    stockCostTotalMinor,

                  costQuality:
                    "confirmed",

                  eventType:
                    "purchase",

                  sourceType:
                    "pos_purchase",

                  sourceRef:
                    String(
                      purchase.id,
                    ),

                  sourceItemRef:
                    String(
                      allocation.item.id,
                    ),

                  businessDate,

                  note:
                    allocation.item.entryMode ===
                      "historical"
                      ? `Approved historical purchase ${purchase.publicId}`
                      : `Approved purchase ${purchase.publicId}`,

                  createdByUserId:
                    auth.user.id,
                },
              );

            costQuality =
              costResult.costQuality;
          } catch (error) {
            if (
              error instanceof
              InventoryCostError
            ) {
              throw new PurchaseError(
                "تعذر تحديث تكلفة المخزون لفاتورة المشتريات",
                409,
              );
            }

            throw error;
          }
        }

        inventoryPurchaseValueMinor +=
          stockCostTotalMinor;

        historicalSoldValueMinor +=
          historicalSoldCostTotalMinor;

        if (
          !Number.isSafeInteger(
            inventoryPurchaseValueMinor,
          ) ||
          !Number.isSafeInteger(
            historicalSoldValueMinor,
          ) ||
          inventoryPurchaseValueMinor >
            MAX_MINOR ||
          historicalSoldValueMinor >
            MAX_MINOR
        ) {
          throw new PurchaseError(
            "قيمة توزيع المشتريات تتجاوز الحد المسموح",
            409,
          );
        }

        await tx
          .insert(
            posPurchaseItemCostsTable,
          )
          .values({
            purchaseItemId:
              allocation.item.id,

            productId,

            receivedQuantity:
              allocation.receivedQuantity,

            unitCostMinor:
              deriveUnitCostMinor(
                allocation.costTotalMinor,
                allocation.receivedQuantity,
              ),

            costTotalMinor:
              allocation.costTotalMinor,

            stockQuantityApplied,

            historicalSoldQuantity,

            stockCostTotalMinor,

            historicalSoldCostTotalMinor,

            invoiceDiscountAllocatedMinor:
              allocation.invoiceDiscountAllocatedMinor,

            costQuality,
          });
      }

      for (
        const [
          productId,
          remainingGap,
        ]
        of historicalGapByProduct
      ) {
        if (remainingGap > 0) {
          const product =
            lockedProductsById.get(
              productId,
            );

          throw new PurchaseError(
            `بقي فرق مخزون قديم غير مسوى للصنف ${product?.nameAr ?? productId}. راجع كمية الشراء السابق.`,
            409,
          );
        }
      }

      if (
        inventoryPurchaseValueMinor +
          historicalSoldValueMinor !==
        totalMinor
      ) {
        throw new PurchaseError(
          "توزيع تكلفة فاتورة المشتريات لا يطابق إجمالي الفاتورة",
          409,
        );
      }

      if (totalMinor > 0) {
        const ensureAccount = async (input: {
          code: string;
          name: string;
          accountType: "asset" | "liability" | "income" | "expense" | "equity";
          linkedEntityType?: string;
          linkedEntityId?: number;
        }) => {
          const existingRows = await tx
            .select()
            .from(financeAccountsTable)
            .where(eq(financeAccountsTable.code, input.code))
            .limit(1);

          if (existingRows[0]) {
            return existingRows[0];
          }

          const insertedRows = await tx
            .insert(financeAccountsTable)
            .values({
              code: input.code,
              name: input.name,
              accountType: input.accountType,
              linkedEntityType: input.linkedEntityType ?? null,
              linkedEntityId: input.linkedEntityId ?? null,
              currencyCode,
              status: "active",
            })
            .onConflictDoNothing()
            .returning();

          if (insertedRows[0]) {
            return insertedRows[0];
          }

          const retryRows = await tx
            .select()
            .from(financeAccountsTable)
            .where(eq(financeAccountsTable.code, input.code))
            .limit(1);

          if (!retryRows[0]) {
            throw new Error("FINANCE_ACCOUNT_CREATE_FAILED");
          }

          return retryRows[0];
        };

        const purchaseAccount =
          inventoryPurchaseValueMinor > 0
            ? await ensureAccount({
                code: "PURCHASE_INVENTORY",
                name: "المشتريات / المخزون",
                accountType: "asset",
              })
            : null;

        // Gross profit / COGS is sourced from frozen cost snapshots,
        // not from GL expense accounts. Historical sold cost therefore uses
        // an equity bridge so the trial balance stays balanced without
        // double-counting COGS in the income statement.
        const historicalCostBridgeAccount =
          historicalSoldValueMinor > 0
            ? await ensureAccount({
                code:
                  "HISTORICAL_PURCHASE_COST_BRIDGE",
                name:
                  "تسوية تكلفة مبيعات سابقة — جسر القوائم",
                accountType:
                  "equity",
              })
            : null;

        const cashAccount =
          paidMinor > 0
            ? await ensureAccount({
                code: `CASH_${registerKey.toUpperCase()}`,
                name:
                  registerKey === "main"
                    ? "الصندوق الرئيسي"
                    : `الصندوق ${registerKey}`,
                accountType: "asset",
              })
            : null;

        const supplierAccount =
          dueMinor > 0
            ? await ensureSupplierPayableControlAccount(
                tx,
              )
            : null;

        const historicalSettlementAccount =
          paymentMethod ===
            "historical_settled"
            ? await ensureAccount({
                code:
                  "HISTORICAL_PURCHASE_OPENING_CLEARING",
                name:
                  "تسوية افتتاحية — مشتريات مدفوعة سابقًا",
                accountType:
                  "equity",
              })
            : null;

        const financeLines:
          FinancePostingLineInput[] = [];

        if (
          inventoryPurchaseValueMinor > 0 &&
          purchaseAccount
        ) {
          financeLines.push({
            accountId:
              purchaseAccount.id,
            debitMinor:
              inventoryPurchaseValueMinor,
            creditMinor: 0,
            memo:
              `مخزون من فاتورة مشتريات ${purchase.publicId}`,
          });
        }

        if (
          historicalSoldValueMinor > 0 &&
          historicalCostBridgeAccount
        ) {
          financeLines.push({
            accountId:
              historicalCostBridgeAccount.id,
            debitMinor:
              historicalSoldValueMinor,
            creditMinor: 0,
            memo:
              `جسر تكلفة مبيعات سابقة من فاتورة ${purchase.publicId} — COGS محسوب من نظام التكلفة`,
          });
        }

        if (paidMinor > 0 && cashAccount) {
          financeLines.push({
            accountId:
              cashAccount.id,
            debitMinor: 0,
            creditMinor:
              paidMinor,
            memo:
              "دفعة نقدية للمورد",
          });
        }

        if (dueMinor > 0 && supplierAccount) {
          financeLines.push({
            accountId: supplierAccount.id,
            supplierId:
              supplier.id,
            debitMinor: 0,
            creditMinor: dueMinor,
            memo: `ذمة المورد ${supplier.name}`,
          });
        }

        if (
          paymentMethod ===
            "historical_settled" &&
          historicalSettlementAccount
        ) {
          financeLines.push({
            accountId:
              historicalSettlementAccount.id,
            debitMinor: 0,
            creditMinor:
              totalMinor,
            memo:
              "تسوية شراء سابق مدفوع قبل النظام — بدون حركة صندوق أو ذمة مورد",
          });
        }

        await postFinanceTransaction(
          tx,
          {
            publicId:
              `FIN-${businessDate.replaceAll("-", "")}-` +
              randomUUID().slice(0, 8).toUpperCase(),
            idempotencyKey:
              `purchase:${purchase.id}:completed`,
            businessDate,
            transactionType: "purchase",
            sourceType: "pos_purchase",
            sourceId:
              String(purchase.id),
            sourceEvent: "completed",
            cashSessionId:
              cashSession?.id ?? null,
            notes:
              paymentMethod ===
                "historical_settled"
                ? supplierInvoiceNumber
                  ? `فاتورة مورد سابقة مدفوعة ${supplierInvoiceNumber}`
                  : `شراء سابق مدفوع ${purchase.publicId}`
                : supplierInvoiceNumber
                  ? `فاتورة مورد ${supplierInvoiceNumber}`
                  : `فاتورة مشتريات ${purchase.publicId}`,
            createdByUserId:
              auth.user.id,
            lines: financeLines,
          },
        );
      }

      if (
        paidMinor > 0 &&
        cashSession &&
        expectedCashAfter !== null
      ) {
        const updatedSessionRows = await tx
          .update(cashSessionsTable)
          .set({
            expectedBalanceMinor: expectedCashAfter,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(cashSessionsTable.id, cashSession.id),
              eq(cashSessionsTable.status, "open"),
            ),
          )
          .returning({
            id: cashSessionsTable.id,
          });

        if (!updatedSessionRows[0]) {
          throw new PurchaseError(
            "تم إغلاق الصندوق قبل إتمام فاتورة المشتريات",
            409,
          );
        }
      }

      if (draftPublicId) {
        await tx
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
              eq(
                posPurchasesTable.publicId,
                draftPublicId,
              ),
            ),
          );
      }

      return {
        purchase,
        items: insertedItems,
        supplier,
        alreadyCreated: false,
      };
    });

    const navigation = await getPurchaseNavigation(
      db,
      result.purchase,
    );

    return json(
      toPurchaseResponse(
        result.purchase,
        result.items,
        result.supplier,
        result.alreadyCreated,
        navigation,
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
    request.method === "GET" &&
    path === "/api/pos/purchases/latest"
  ) {
    return handleLatestPurchase(request, db, env);
  }

  if (
    request.method === "GET" &&
    path === "/api/pos/purchases/by-public-id"
  ) {
    return handlePurchaseByPublicId(request, db, env);
  }

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
