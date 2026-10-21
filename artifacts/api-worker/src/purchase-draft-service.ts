import {
  posPurchaseItemsTable,
  posPurchasesTable,
  productsTable,
  suppliersTable,
} from "@workspace/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const MAX_MINOR = 2_000_000_000;

export class PurchaseDraftServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type AppendProductToSupplierDraftInput = {
  userId: number;
  supplierId: number;
  productId: number;
  quantity: number;
  unitCostMinor: number | null;
  entryMode: "stock_receipt" | "historical";
  historicalSourceKey?: string | null;
  historicalDocumentationOnly?: boolean;
  businessDate: string;
  warehouseKey: string;
  currencyCode: string;
};

function assertPositiveInteger(
  value: number,
  field: string,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximum
  ) {
    throw new PurchaseDraftServiceError(
      field + " غير صالح",
    );
  }
}

function assertOptionalMoneyMinor(
  value: number | null,
) {
  if (
    value !== null &&
    (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > MAX_MINOR
    )
  ) {
    throw new PurchaseDraftServiceError(
      "تكلفة الصنف غير صالحة",
    );
  }
}

export async function getPendingPurchaseQuantityForProduct(
  tx: any,
  input: {
    productId: number;
    warehouseKey?: string;
  },
) {
  assertPositiveInteger(
    input.productId,
    "رقم المنتج",
  );

  const rows = await tx
    .select({
      quantity:
        posPurchaseItemsTable.quantity,
      freeQuantity:
        posPurchaseItemsTable.freeQuantity,
      warehouseKey:
        posPurchasesTable.warehouseKey,
      entryMode:
        posPurchaseItemsTable.entryMode,
    })
    .from(posPurchaseItemsTable)
    .innerJoin(
      posPurchasesTable,
      eq(
        posPurchaseItemsTable.purchaseId,
        posPurchasesTable.id,
      ),
    )
    .where(
      and(
        eq(
          posPurchaseItemsTable.productId,
          input.productId,
        ),
        eq(
          posPurchasesTable.status,
          "draft",
        ),
      ),
    );

  let total = 0;

  for (const row of rows) {
    if (
      input.warehouseKey &&
      row.warehouseKey !==
        input.warehouseKey
    ) {
      continue;
    }

    if (
      row.entryMode !==
        "stock_receipt"
    ) {
      continue;
    }

    total +=
      row.quantity +
      row.freeQuantity;

    if (
      !Number.isSafeInteger(total) ||
      total > 99_999_999
    ) {
      throw new PurchaseDraftServiceError(
        "كمية المشتريات المفتوحة أكبر من الحد المسموح",
        409,
      );
    }
  }

  return total;
}

export async function appendProductToSupplierDraft(
  tx: any,
  input: AppendProductToSupplierDraftInput,
) {
  assertPositiveInteger(
    input.userId,
    "رقم المستخدم",
  );
  assertPositiveInteger(
    input.supplierId,
    "رقم المورد",
  );
  assertPositiveInteger(
    input.productId,
    "رقم المنتج",
  );
  assertPositiveInteger(
    input.quantity,
    "الكمية الجديدة",
    99_999,
  );
  assertOptionalMoneyMinor(
    input.unitCostMinor,
  );

  if (
    input.entryMode !== "stock_receipt" &&
    input.entryMode !== "historical"
  ) {
    throw new PurchaseDraftServiceError(
      "نوع تسجيل الشراء غير صالح",
    );
  }

  const historicalSourceKey =
    typeof input.historicalSourceKey ===
      "string" &&
    input.historicalSourceKey.trim()
      ? input.historicalSourceKey.trim()
      : null;

  if (
    historicalSourceKey !== null &&
    (
      historicalSourceKey.length < 8 ||
      historicalSourceKey.length > 160
    )
  ) {
    throw new PurchaseDraftServiceError(
      "مرجع دفعة الشراء السابق غير صالح",
    );
  }

  const historicalDocumentationOnly =
    input.historicalDocumentationOnly ===
      true;

  if (
    input.entryMode !== "historical" &&
    (
      historicalSourceKey !== null ||
      historicalDocumentationOnly
    )
  ) {
    throw new PurchaseDraftServiceError(
      "مرجع الدفعة التاريخية متاح للشراء السابق فقط",
    );
  }

  const supplierRows = await tx
    .select()
    .from(suppliersTable)
    .where(
      eq(
        suppliersTable.id,
        input.supplierId,
      ),
    )
    .for("update")
    .limit(1);

  const supplier = supplierRows[0];

  if (!supplier) {
    throw new PurchaseDraftServiceError(
      "المورد غير موجود",
      404,
    );
  }

  if (supplier.status !== "active") {
    throw new PurchaseDraftServiceError(
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
        input.productId,
      ),
    )
    .for("update")
    .limit(1);

  const product = productRows[0];

  if (!product) {
    throw new PurchaseDraftServiceError(
      "المنتج غير موجود",
      404,
    );
  }

  const draftRows = await tx
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
          input.userId,
        ),
        eq(
          posPurchasesTable.supplierId,
          input.supplierId,
        ),
        eq(
          posPurchasesTable.warehouseKey,
          input.warehouseKey,
        ),
      ),
    )
    .for("update")
    .limit(1);

  let purchase =
    draftRows[0] ?? null;

  if (!purchase) {
    const publicId =
      "DRAFT-" +
      input.businessDate.replaceAll("-", "") +
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
          input.userId +
          ":" +
          input.supplierId +
          ":" +
          input.warehouseKey,
        supplierId:
          input.supplierId,
        supplierInvoiceNumber: null,
        businessDate:
          input.businessDate,
        warehouseKey:
          input.warehouseKey,
        currencyCode:
          input.currencyCode,
        enteredByUserId:
          input.userId,
        status: "draft",
        paymentMethod:
          input.entryMode === "historical"
            ? "historical_settled"
            : "credit",
        subtotalMinor: 0,
        discountMinor: 0,
        totalMinor: 0,
        paidMinor: 0,
        dueMinor: 0,
        notes:
          "مسودة تلقائية من إدخال الأصناف",
      })
      .returning();

    purchase =
      insertedRows[0] ?? null;

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

  if (
    currentItems.some(
      (
        item: typeof posPurchaseItemsTable.$inferSelect,
      ) =>
        item.entryMode !==
        input.entryMode,
    )
  ) {
    throw new PurchaseDraftServiceError(
      "لا يمكن جمع شراء سابق واستلام جديد في نفس مسودة المورد. اعتمد أو احذف المسودة الحالية أولًا.",
      409,
    );
  }

  const historicalSourceMatch =
    historicalSourceKey === null
      ? null
      : currentItems.find(
          (
            item: typeof posPurchaseItemsTable.$inferSelect,
          ) =>
            item.historicalSourceKey ===
              historicalSourceKey,
        ) ?? null;

  const legacyHistoricalMatch =
    historicalSourceKey === null ||
    historicalSourceMatch
      ? null
      : currentItems.find(
          (
            item: typeof posPurchaseItemsTable.$inferSelect,
          ) =>
            item.productId ===
              product.id &&
            item.entryMode ===
              "historical" &&
            item.historicalSourceKey ===
              null,
        ) ?? null;

  const mergeableStockReceipt =
    input.entryMode === "stock_receipt"
      ? currentItems.find(
          (
            item: typeof posPurchaseItemsTable.$inferSelect,
          ) =>
            item.productId ===
              product.id &&
            item.entryMode ===
              "stock_receipt" &&
            item.historicalSourceKey ===
              null,
        ) ?? null
      : null;

  const existing =
    historicalSourceMatch ??
    legacyHistoricalMatch ??
    mergeableStockReceipt;

  if (
    existing &&
    input.entryMode === "historical" &&
    historicalSourceKey !== null
  ) {
    const nextLineTotalMinor =
      input.unitCostMinor === null
        ? null
        : input.unitCostMinor *
            input.quantity -
          existing.lineDiscountMinor;

    await tx
      .update(posPurchaseItemsTable)
      .set({
        quantity:
          input.quantity,
        unitCostMinor:
          input.unitCostMinor,
        lineTotalMinor:
          nextLineTotalMinor,
        historicalSourceKey,
        historicalDocumentationOnly,
      })
      .where(
        eq(
          posPurchaseItemsTable.id,
          existing.id,
        ),
      );
  } else if (existing) {
    const nextQuantity =
      existing.quantity +
      input.quantity;

    if (
      !Number.isSafeInteger(
        nextQuantity,
      ) ||
      nextQuantity > 99_999
    ) {
      throw new PurchaseDraftServiceError(
        "إجمالي كمية الصنف في المسودة أكبر من الحد المسموح",
      );
    }

    const mergedCostMinor =
      existing.unitCostMinor === null ||
      input.unitCostMinor === null
        ? null
        : existing.unitCostMinor ===
            input.unitCostMinor
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
        quantity:
          nextQuantity,
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
        (
          max: number,
          item: typeof posPurchaseItemsTable.$inferSelect,
        ) =>
          Math.max(
            max,
            item.lineNumber,
          ),
        0,
      ) + 1;

    await tx
      .insert(posPurchaseItemsTable)
      .values({
        purchaseId:
          purchase.id,
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
        quantity:
          input.quantity,
        freeQuantity: 0,
        entryMode:
          input.entryMode,
        historicalSourceKey,
        historicalDocumentationOnly,
        unitCostMinor:
          input.unitCostMinor,
        lineDiscountMinor: 0,
        lineTotalMinor:
          input.unitCostMinor === null
            ? null
            : input.unitCostMinor *
              input.quantity,
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
    if (
      item.unitCostMinor !== null
    ) {
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

  const allHistorical =
    items.length > 0 &&
    items.every(
      (
        item: typeof posPurchaseItemsTable.$inferSelect,
      ) =>
        item.entryMode ===
        "historical",
    );

  const automaticPaymentMethod =
    allHistorical
      ? "historical_settled"
      : "credit";

  const updatedRows = await tx
    .update(posPurchasesTable)
    .set({
      businessDate:
        input.businessDate,
      currencyCode:
        input.currencyCode,
      paymentMethod:
        automaticPaymentMethod,
      subtotalMinor,
      discountMinor,
      totalMinor,
      paidMinor: 0,
      dueMinor:
        automaticPaymentMethod ===
          "historical_settled"
          ? 0
          : totalMinor,
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
    throw new PurchaseDraftServiceError(
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
}
