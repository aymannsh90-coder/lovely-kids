import {
  cashSessionsTable,
  exchangeDocumentsTable,
  exchangeReturnItemsTable,
  inventoryMovementsTable,
  posSaleItemsTable,
  posSaleReturnItemsTable,
  posSaleReturnsTable,
  posSalesTable,
  productBarcodesTable,
  productsTable,
  type ColorVariant,
} from "@workspace/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

const MAX_MINOR = 2_000_000_000;
const MAX_STOCK = 2_000_000_000;

export class PosExchangeError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface ParsedExchangeReturnItem {
  originalSaleItemId: number;
  quantity: number;
}

export interface ParsedExchangeSaleItem {
  lineNumber: number;
  productId: number | null;
  barcode: string | null;
  quantity: number;
  soldUnitPriceMinor: number;
  lineDiscountMinor: number;
  color: string | null;
  size: string | null;
}

export type ExchangeSettlementType =
  | "cash"
  | "card";

export interface ParsedPosExchangePayload {
  registerKey: string;
  idempotencyKey: string;
  originalSalePublicId: string;
  settlementType: ExchangeSettlementType;
  returnItems: ParsedExchangeReturnItem[];
  newItems: ParsedExchangeSaleItem[];
  newInvoiceDiscountMinor: number;
  reason: string | null;
  notes: string | null;
}

function normalizeRegisterKey(value: unknown): string | null {
  const key =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : "main";

  return /^[a-z0-9_-]{1,50}$/.test(key)
    ? key
    : null;
}

function normalizePublicId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const publicId =
    value.trim().toUpperCase();

  if (
    !publicId ||
    publicId.length > 80 ||
    !/^[A-Z0-9_-]+$/.test(publicId)
  ) {
    return null;
  }

  return publicId;
}

function normalizeIdempotencyKey(
  value: unknown,
): string | null {
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
  if (typeof value !== "string") {
    return null;
  }

  const barcode = value.trim();

  if (
    barcode.length < 1 ||
    barcode.length > 128
  ) {
    return null;
  }

  return barcode;
}

function parseMoneyToMinor(
  value: unknown,
): number | null {
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

  const amount =
    typeof normalized === "number"
      ? normalized
      : Number(normalized);

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    return null;
  }

  const minor =
    Math.round(amount * 100);

  if (
    Math.abs(minor / 100 - amount) >
      0.000001 ||
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
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  if (typeof value !== "string") {
    throw new PosExchangeError(
      `${fieldName} غير صالح`,
    );
  }

  const text = value.trim();

  if (text.length > maxLength) {
    throw new PosExchangeError(
      `${fieldName} طويل جدًا`,
    );
  }

  return text || null;
}

function parseReturnItems(
  value: unknown,
): ParsedExchangeReturnItem[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 100
  ) {
    throw new PosExchangeError(
      "يجب اختيار صنف واحد على الأقل للتبديل",
    );
  }

  const seenIds = new Set<number>();

  return value.map((raw) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      throw new PosExchangeError(
        "بيانات أحد الأصناف المرتجعة غير صالحة",
      );
    }

    const item =
      raw as Record<string, unknown>;

    const originalSaleItemId =
      typeof item.originalSaleItemId === "number"
        ? item.originalSaleItemId
        : typeof item.originalSaleItemId === "string" &&
            item.originalSaleItemId.trim()
          ? Number(item.originalSaleItemId)
          : Number.NaN;

    if (
      !Number.isSafeInteger(originalSaleItemId) ||
      originalSaleItemId <= 0
    ) {
      throw new PosExchangeError(
        "رقم أحد أصناف الفاتورة غير صالح",
      );
    }

    if (seenIds.has(originalSaleItemId)) {
      throw new PosExchangeError(
        "لا يمكن تكرار نفس الصنف المرتجع",
      );
    }

    seenIds.add(originalSaleItemId);

    const quantity =
      typeof item.quantity === "number"
        ? item.quantity
        : typeof item.quantity === "string" &&
            item.quantity.trim()
          ? Number(item.quantity)
          : Number.NaN;

    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 99
    ) {
      throw new PosExchangeError(
        "كمية أحد الأصناف المرتجعة غير صالحة",
      );
    }

    return {
      originalSaleItemId,
      quantity,
    };
  });
}

function parseNewItems(
  value: unknown,
): ParsedExchangeSaleItem[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 100
  ) {
    throw new PosExchangeError(
      "يجب إضافة صنف جديد واحد على الأقل",
    );
  }

  return value.map((raw, index) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      throw new PosExchangeError(
        "بيانات أحد الأصناف الجديدة غير صالحة",
      );
    }

    const item =
      raw as Record<string, unknown>;

    const rawProductId =
      item.productId;

    const productId =
      typeof rawProductId === "number"
        ? rawProductId
        : typeof rawProductId === "string" &&
            rawProductId.trim()
          ? Number(rawProductId)
          : null;

    if (
      productId !== null &&
      (
        !Number.isSafeInteger(productId) ||
        productId < 1
      )
    ) {
      throw new PosExchangeError(
        "رقم أحد المنتجات الجديدة غير صالح",
      );
    }

    const hasBarcodeInput =
      item.barcode !== undefined &&
      item.barcode !== null &&
      item.barcode !== "";

    const barcode =
      hasBarcodeInput
        ? normalizeBarcode(item.barcode)
        : null;

    if (
      hasBarcodeInput &&
      !barcode
    ) {
      throw new PosExchangeError(
        "باركود أحد الأصناف الجديدة غير صالح",
      );
    }

    if (
      productId === null &&
      !barcode
    ) {
      throw new PosExchangeError(
        "يجب تحديد المنتج الجديد أو باركوده",
      );
    }

    const quantity =
      typeof item.quantity === "number"
        ? item.quantity
        : typeof item.quantity === "string" &&
            item.quantity.trim()
          ? Number(item.quantity)
          : Number.NaN;

    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 99
    ) {
      throw new PosExchangeError(
        "كمية أحد الأصناف الجديدة غير صالحة",
      );
    }

    const soldUnitPriceMinor =
      parseMoneyToMinor(
        item.soldUnitPrice,
      );

    if (soldUnitPriceMinor === null) {
      throw new PosExchangeError(
        "سعر بيع أحد الأصناف الجديدة غير صالح",
      );
    }

    const lineDiscountMinor =
      item.lineDiscount === undefined
        ? 0
        : parseMoneyToMinor(
            item.lineDiscount,
          );

    if (lineDiscountMinor === null) {
      throw new PosExchangeError(
        "خصم أحد الأصناف الجديدة غير صالح",
      );
    }

    const grossMinor =
      soldUnitPriceMinor * quantity;

    if (
      !Number.isSafeInteger(grossMinor) ||
      grossMinor > MAX_MINOR ||
      lineDiscountMinor > grossMinor
    ) {
      throw new PosExchangeError(
        "خصم أحد الأصناف الجديدة أكبر من قيمته",
      );
    }

    return {
      lineNumber: index + 1,
      productId,
      barcode,
      quantity,
      soldUnitPriceMinor,
      lineDiscountMinor,
      color: parseOptionalText(
        item.color,
        100,
        "اللون",
      ),
      size: parseOptionalText(
        item.size,
        100,
        "المقاس",
      ),
    };
  });
}

export function parsePosExchangePayload(
  body: unknown,
): ParsedPosExchangePayload {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    throw new PosExchangeError(
      "بيانات فاتورة التبديل غير صالحة",
    );
  }

  const payload =
    body as Record<string, unknown>;

  const registerKey =
    normalizeRegisterKey(
      payload.registerKey ?? "main",
    );

  if (!registerKey) {
    throw new PosExchangeError(
      "معرف صندوق غير صالح",
    );
  }

  const idempotencyKey =
    normalizeIdempotencyKey(
      payload.idempotencyKey,
    );

  if (!idempotencyKey) {
    throw new PosExchangeError(
      "مفتاح منع تكرار فاتورة التبديل غير صالح",
    );
  }

  const originalSalePublicId =
    normalizePublicId(
      payload.originalSalePublicId,
    );

  if (!originalSalePublicId) {
    throw new PosExchangeError(
      "رقم الفاتورة الأصلية غير صالح",
    );
  }

  const settlementType =
    payload.settlementType === undefined
      ? "cash"
      : payload.settlementType;

  if (
    settlementType !== "cash" &&
    settlementType !== "card"
  ) {
    throw new PosExchangeError(
      "طريقة تسوية فاتورة التبديل غير صالحة",
    );
  }

  const newInvoiceDiscountMinor =
    payload.newInvoiceDiscount === undefined
      ? 0
      : parseMoneyToMinor(
          payload.newInvoiceDiscount,
        );

  if (
    newInvoiceDiscountMinor === null
  ) {
    throw new PosExchangeError(
      "خصم الأصناف الجديدة غير صالح",
    );
  }

  return {
    registerKey,
    idempotencyKey,
    originalSalePublicId,
    settlementType,
    returnItems:
      parseReturnItems(
        payload.returnItems,
      ),
    newItems:
      parseNewItems(
        payload.newItems,
      ),
    newInvoiceDiscountMinor,
    reason:
      parseOptionalText(
        payload.reason,
        500,
        "سبب التبديل",
      ),
    notes:
      parseOptionalText(
        payload.notes,
        1000,
        "الملاحظات",
      ),
  };
}

export type {
  ColorVariant,
};


const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });

function getExchangePublicId(
  businessDate: string,
): string {
  const datePart =
    businessDate.replace(/-/g, "");

  const randomPart =
    randomUUID()
      .replace(/-/g, "")
      .slice(0, 12)
      .toUpperCase();

  return `EXC-${datePart}-${randomPart}`;
}

export async function handleCreatePosExchange(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response> {
  const user =
    await getCurrentUser(
      db,
      request,
      env,
    );

  if (!user) {
    return json(
      { error: "يجب تسجيل الدخول" },
      401,
    );
  }

  if (
    !user.isAdmin &&
    !user.isOwner
  ) {
    return json(
      {
        error:
          "غير مصرح باستخدام نقطة البيع",
      },
      403,
    );
  }

  const body =
    await request
      .json()
      .catch(() => null);

  let payload:
    ParsedPosExchangePayload;

  try {
    payload =
      parsePosExchangePayload(body);
  } catch (error) {
    if (
      error instanceof
      PosExchangeError
    ) {
      return json(
        { error: error.message },
        error.status,
      );
    }

    throw error;
  }

  try {
    const result =
      await db.transaction(
        async (tx) => {
          const existingRows =
            await tx
              .select()
              .from(
                exchangeDocumentsTable,
              )
              .where(
                eq(
                  exchangeDocumentsTable.idempotencyKey,
                  payload.idempotencyKey,
                ),
              )
              .limit(1);

          const existing =
            existingRows[0];

          if (existing) {
            if (
              existing.registerKey !==
              payload.registerKey
            ) {
              throw new PosExchangeError(
                "مفتاح فاتورة التبديل مستخدم لصندوق آخر",
                409,
              );
            }

            const existingItems =
              await tx
                .select()
                .from(
                  exchangeReturnItemsTable,
                )
                .where(
                  eq(
                    exchangeReturnItemsTable.exchangeId,
                    existing.id,
                  ),
                )
                .orderBy(
                  asc(
                    exchangeReturnItemsTable.lineNumber,
                  ),
                );

            return {
              exchange: existing,
              returnItems:
                existingItems,
              alreadyCreated: true,
            };
          }

          const saleRows =
            await tx
              .select()
              .from(
                posSalesTable,
              )
              .where(
                eq(
                  posSalesTable.publicId,
                  payload.originalSalePublicId,
                ),
              )
              .limit(1);

          const sale =
            saleRows[0];

          if (!sale) {
            throw new PosExchangeError(
              "الفاتورة الأصلية غير موجودة",
              404,
            );
          }

          if (
            sale.status !==
            "completed"
          ) {
            throw new PosExchangeError(
              "لا يمكن التبديل من فاتورة غير مكتملة",
              409,
            );
          }

          const sessionRows =
            await tx
              .select()
              .from(
                cashSessionsTable,
              )
              .where(
                and(
                  eq(
                    cashSessionsTable.registerKey,
                    payload.registerKey,
                  ),
                  eq(
                    cashSessionsTable.status,
                    "open",
                  ),
                ),
              )
              .for("update");

          const session =
            sessionRows[0];

          if (!session) {
            throw new PosExchangeError(
              "يجب فتح يوم الصندوق قبل تنفيذ التبديل",
              409,
            );
          }

          const requestedIds =
            payload.returnItems.map(
              (item) =>
                item.originalSaleItemId,
            );

          const originalItems =
            await tx
              .select()
              .from(
                posSaleItemsTable,
              )
              .where(
                and(
                  eq(
                    posSaleItemsTable.saleId,
                    sale.id,
                  ),
                  inArray(
                    posSaleItemsTable.id,
                    requestedIds,
                  ),
                ),
              )
              .orderBy(
                asc(
                  posSaleItemsTable.lineNumber,
                ),
              );

          if (
            originalItems.length !==
            requestedIds.length
          ) {
            throw new PosExchangeError(
              "أحد الأصناف المرتجعة لا ينتمي إلى الفاتورة الأصلية",
              409,
            );
          }

          const completedReturns =
            await tx
              .select({
                id: posSaleReturnsTable.id,
              })
              .from(posSaleReturnsTable)
              .where(
                and(
                  eq(
                    posSaleReturnsTable.originalSaleId,
                    sale.id,
                  ),
                  eq(
                    posSaleReturnsTable.status,
                    "completed",
                  ),
                ),
              );

          const completedReturnIds =
            completedReturns.map(
              (row) => row.id,
            );

          let priorReturnItems:
            Array<
              typeof posSaleReturnItemsTable.$inferSelect
            > = [];

          if (
            completedReturnIds.length > 0
          ) {
            priorReturnItems =
              await tx
                .select()
                .from(
                  posSaleReturnItemsTable,
                )
                .where(
                  inArray(
                    posSaleReturnItemsTable.returnId,
                    completedReturnIds,
                  ),
                );
          }

          const completedExchanges =
            await tx
              .select({
                id:
                  exchangeDocumentsTable.id,
              })
              .from(
                exchangeDocumentsTable,
              )
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
            completedExchanges.map(
              (row) => row.id,
            );

          let priorExchangeItems:
            Array<
              typeof exchangeReturnItemsTable.$inferSelect
            > = [];

          if (
            completedExchangeIds.length > 0
          ) {
            priorExchangeItems =
              await tx
                .select()
                .from(
                  exchangeReturnItemsTable,
                )
                .where(
                  inArray(
                    exchangeReturnItemsTable.exchangeId,
                    completedExchangeIds,
                  ),
                );
          }

          const consumedByOriginalItem =
            new Map<number, number>();

          const consumedLineDiscountByOriginalItem =
            new Map<number, number>();

          let priorGrossMinor = 0;
          let priorLineDiscountMinor = 0;
          let priorInvoiceDiscountMinor = 0;

          for (
            const item of
            priorReturnItems
          ) {
            if (
              item.originalSaleItemId ===
              null
            ) {
              continue;
            }

            const id =
              item.originalSaleItemId;

            consumedByOriginalItem.set(
              id,
              (
                consumedByOriginalItem.get(
                  id,
                ) ?? 0
              ) + item.quantity,
            );

            consumedLineDiscountByOriginalItem.set(
              id,
              (
                consumedLineDiscountByOriginalItem.get(
                  id,
                ) ?? 0
              ) +
                item.lineDiscountMinor,
            );

            priorGrossMinor +=
              item.grossAmountMinor;

            priorLineDiscountMinor +=
              item.lineDiscountMinor;

            priorInvoiceDiscountMinor +=
              item.invoiceDiscountMinor;
          }

          for (
            const item of
            priorExchangeItems
          ) {
            if (
              item.originalPosSaleItemId ===
              null
            ) {
              continue;
            }

            const id =
              item.originalPosSaleItemId;

            consumedByOriginalItem.set(
              id,
              (
                consumedByOriginalItem.get(
                  id,
                ) ?? 0
              ) + item.quantity,
            );

            consumedLineDiscountByOriginalItem.set(
              id,
              (
                consumedLineDiscountByOriginalItem.get(
                  id,
                ) ?? 0
              ) +
                item.lineDiscountMinor,
            );

            priorGrossMinor +=
              item.grossAmountMinor;

            priorLineDiscountMinor +=
              item.lineDiscountMinor;

            priorInvoiceDiscountMinor +=
              item.invoiceDiscountMinor;
          }

          const invoiceBaseMinor =
            sale.subtotalMinor -
            sale.itemDiscountMinor;

          if (
            !Number.isSafeInteger(
              priorGrossMinor,
            ) ||
            !Number.isSafeInteger(
              priorLineDiscountMinor,
            ) ||
            !Number.isSafeInteger(
              priorInvoiceDiscountMinor,
            ) ||
            !Number.isSafeInteger(
              invoiceBaseMinor,
            ) ||
            invoiceBaseMinor < 0 ||
            priorGrossMinor >
              sale.subtotalMinor ||
            priorLineDiscountMinor >
              sale.itemDiscountMinor ||
            priorInvoiceDiscountMinor >
              sale.invoiceDiscountMinor ||
            priorGrossMinor -
                priorLineDiscountMinor >
              invoiceBaseMinor ||
            priorLineDiscountMinor +
                priorInvoiceDiscountMinor >
              sale.discountMinor
          ) {
            throw new PosExchangeError(
              "بيانات المرتجعات أو التبديلات السابقة غير متطابقة",
              409,
            );
          }

          const requestedById =
            new Map(
              payload.returnItems.map(
                (item) => [
                  item.originalSaleItemId,
                  item.quantity,
                ],
              ),
            );

          const calculatedReturnLines =
            originalItems.map(
              (originalItem, index) => {
                const quantity =
                  requestedById.get(
                    originalItem.id,
                  ) ?? 0;

                const previouslyConsumed =
                  consumedByOriginalItem.get(
                    originalItem.id,
                  ) ?? 0;

                const previouslyConsumedLineDiscount =
                  consumedLineDiscountByOriginalItem.get(
                    originalItem.id,
                  ) ?? 0;

                const returnableQuantity =
                  originalItem.quantity -
                  previouslyConsumed;

                if (
                  returnableQuantity < 0 ||
                  quantity >
                    returnableQuantity
                ) {
                  throw new PosExchangeError(
                    `الكمية المطلوبة من ${originalItem.productNameAr} أكبر من الكمية المتبقية للتبديل`,
                    409,
                  );
                }

                if (quantity < 1) {
                  throw new PosExchangeError(
                    `كمية ${originalItem.productNameAr} غير صالحة`,
                  );
                }

                const grossAmountMinor =
                  originalItem.soldUnitPriceMinor *
                  quantity;

                if (
                  !Number.isSafeInteger(
                    grossAmountMinor,
                  ) ||
                  grossAmountMinor < 0 ||
                  grossAmountMinor >
                    MAX_MINOR
                ) {
                  throw new PosExchangeError(
                    "قيمة أحد الأصناف المرتجعة تتجاوز الحد المسموح",
                  );
                }

                const consumedAfter =
                  previouslyConsumed +
                  quantity;

                const targetLineDiscountMinor =
                  consumedAfter ===
                  originalItem.quantity
                    ? originalItem.lineDiscountMinor
                    : Number(
                        (
                          BigInt(
                            originalItem.lineDiscountMinor,
                          ) *
                          BigInt(
                            consumedAfter,
                          )
                        ) /
                          BigInt(
                            originalItem.quantity,
                          ),
                      );

                const lineDiscountMinor =
                  targetLineDiscountMinor -
                  previouslyConsumedLineDiscount;

                if (
                  !Number.isSafeInteger(
                    targetLineDiscountMinor,
                  ) ||
                  !Number.isSafeInteger(
                    lineDiscountMinor,
                  ) ||
                  targetLineDiscountMinor <
                    previouslyConsumedLineDiscount ||
                  targetLineDiscountMinor >
                    originalItem.lineDiscountMinor ||
                  lineDiscountMinor < 0 ||
                  lineDiscountMinor >
                    grossAmountMinor
                ) {
                  throw new PosExchangeError(
                    `تعذر احتساب خصم ${originalItem.productNameAr}`,
                    409,
                  );
                }

                return {
                  lineNumber:
                    index + 1,

                  originalItem,
                  quantity,

                  grossAmountMinor,

                  lineDiscountMinor,

                  netBeforeInvoiceMinor:
                    grossAmountMinor -
                    lineDiscountMinor,

                  invoiceDiscountMinor:
                    0,

                  allocatedDiscountMinor:
                    0,

                  returnNetMinor:
                    0,
                };
              },
            );

          let runningNetBeforeInvoiceMinor =
            priorGrossMinor -
            priorLineDiscountMinor;

          let runningInvoiceDiscountMinor =
            priorInvoiceDiscountMinor;

          for (
            const line of
            calculatedReturnLines
          ) {
            const nextNetBeforeInvoiceMinor =
              runningNetBeforeInvoiceMinor +
              line.netBeforeInvoiceMinor;

            if (
              !Number.isSafeInteger(
                nextNetBeforeInvoiceMinor,
              ) ||
              nextNetBeforeInvoiceMinor >
                invoiceBaseMinor
            ) {
              throw new PosExchangeError(
                "صافي الأصناف المرتجعة أكبر من صافي الفاتورة الأصلية",
                409,
              );
            }

            let targetInvoiceDiscountMinor =
              0;

            if (
              invoiceBaseMinor > 0
            ) {
              targetInvoiceDiscountMinor =
                nextNetBeforeInvoiceMinor ===
                invoiceBaseMinor
                  ? sale.invoiceDiscountMinor
                  : Number(
                      (
                        BigInt(
                          sale.invoiceDiscountMinor,
                        ) *
                        BigInt(
                          nextNetBeforeInvoiceMinor,
                        )
                      ) /
                        BigInt(
                          invoiceBaseMinor,
                        ),
                    );
            }

            const invoiceDiscountMinor =
              targetInvoiceDiscountMinor -
              runningInvoiceDiscountMinor;

            if (
              !Number.isSafeInteger(
                invoiceDiscountMinor,
              ) ||
              invoiceDiscountMinor < 0 ||
              invoiceDiscountMinor >
                line.netBeforeInvoiceMinor
            ) {
              throw new PosExchangeError(
                "تعذر توزيع خصم الفاتورة الأصلية على التبديل",
                409,
              );
            }

            line.invoiceDiscountMinor =
              invoiceDiscountMinor;

            line.allocatedDiscountMinor =
              line.lineDiscountMinor +
              line.invoiceDiscountMinor;

            line.returnNetMinor =
              line.grossAmountMinor -
              line.allocatedDiscountMinor;

            runningNetBeforeInvoiceMinor =
              nextNetBeforeInvoiceMinor;

            runningInvoiceDiscountMinor =
              targetInvoiceDiscountMinor;
          }

          for (const line of calculatedReturnLines) {
            if (line.originalItem.productId === null) {
              throw new PosExchangeError(
                `المنتج ${line.originalItem.productNameAr} لم يعد مرتبطًا بسجل المنتج`,
                409,
              );
            }
          }

          const resolvedNewItems: Array<
            ParsedExchangeSaleItem & {
              productId: number;
              mappedColor: string | null;
              mappedSize: string | null;
            }
          > = [];

          for (const item of payload.newItems) {
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
                  throw new PosExchangeError(
                    "الباركود لا يطابق المنتج المحدد",
                    409,
                  );
                }

                resolvedNewItems.push({
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
                  eq(
                    productsTable.barcode,
                    item.barcode,
                  ),
                )
                .limit(1);

              const primary = primaryRows[0];

              if (!primary) {
                throw new PosExchangeError(
                  `الباركود ${item.barcode} غير موجود`,
                  404,
                );
              }

              if (
                item.productId !== null &&
                item.productId !== primary.id
              ) {
                throw new PosExchangeError(
                  "الباركود لا يطابق المنتج المحدد",
                  409,
                );
              }

              resolvedNewItems.push({
                ...item,
                productId: primary.id,
                mappedColor: null,
                mappedSize: null,
              });

              continue;
            }

            if (item.productId === null) {
              throw new PosExchangeError(
                "تعذر تحديد أحد المنتجات الجديدة",
              );
            }

            resolvedNewItems.push({
              ...item,
              productId: item.productId,
              mappedColor: null,
              mappedSize: null,
            });
          }

          resolvedNewItems.sort(
            (left, right) =>
              left.productId - right.productId ||
              left.lineNumber - right.lineNumber,
          );

          const returnProductIds = Array.from(
            new Set(
              calculatedReturnLines.map(
                (line) =>
                  line.originalItem.productId as number,
              ),
            ),
          ).sort((a, b) => a - b);

          const newProductIds = Array.from(
            new Set(
              resolvedNewItems.map(
                (item) => item.productId,
              ),
            ),
          );

          const allExchangeProductIds = Array.from(
            new Set([
              ...returnProductIds,
              ...newProductIds,
            ]),
          ).sort((a, b) => a - b);

          const lockedExchangeProducts =
            await tx
              .select()
              .from(productsTable)
              .where(
                inArray(
                  productsTable.id,
                  allExchangeProductIds,
                ),
              )
              .orderBy(
                asc(productsTable.id),
              )
              .for("update");

          if (
            lockedExchangeProducts.length !==
            allExchangeProductIds.length
          ) {
            throw new PosExchangeError(
              "أحد منتجات التبديل لم يعد موجودًا",
              409,
            );
          }

          const productStockStates =
            new Map<
              number,
              {
                product:
                  typeof productsTable.$inferSelect;
                generalStock:
                  number | null;
                colorVariants:
                  ColorVariant[];
              }
            >();

          for (
            const product of
            lockedExchangeProducts
          ) {
            productStockStates.set(
              product.id,
              {
                product,

                generalStock:
                  product.stock ?? null,

                colorVariants:
                  (
                    product.colorVariants as
                      | ColorVariant[]
                      | null
                  ) ?? [],
              },
            );
          }

          const returnStockPlans = [];

          for (
            const line of
            calculatedReturnLines
          ) {
            const originalItem =
              line.originalItem;

            const productId =
              originalItem.productId as number;

            const stockState =
              productStockStates.get(
                productId,
              );

            if (!stockState) {
              throw new PosExchangeError(
                `تعذر قفل مخزون ${originalItem.productNameAr}`,
                409,
              );
            }

            const product =
              stockState.product;

            let generalStockBefore:
              number | null = null;

            let generalStockAfter:
              number | null = null;

            const trackedGeneralStock =
              originalItem.generalStockBefore !== null ||
              originalItem.generalStockAfter !== null;

            if (trackedGeneralStock) {
              if (
                stockState.generalStock === null
              ) {
                throw new PosExchangeError(
                  `المخزون العام للمنتج ${originalItem.productNameAr} لم يعد قابلًا للتتبع`,
                  409,
                );
              }

              generalStockBefore =
                stockState.generalStock;

              generalStockAfter =
                generalStockBefore +
                line.quantity;

              if (
                !Number.isSafeInteger(
                  generalStockAfter,
                ) ||
                generalStockAfter >
                  MAX_STOCK
              ) {
                throw new PosExchangeError(
                  `مخزون ${originalItem.productNameAr} يتجاوز الحد المسموح`,
                  409,
                );
              }

              stockState.generalStock =
                generalStockAfter;
            }

            let variantStockBefore:
              number | null = null;

            let variantStockAfter:
              number | null = null;

            let nextColorVariants:
              ColorVariant[] | null = null;

            const trackedVariantStock =
              originalItem.variantStockBefore !== null ||
              originalItem.variantStockAfter !== null;

            if (trackedVariantStock) {
              if (
                !originalItem.color ||
                !originalItem.size
              ) {
                throw new PosExchangeError(
                  `بيانات لون أو مقاس ${originalItem.productNameAr} غير مكتملة`,
                  409,
                );
              }

              const colorVariants =
                stockState.colorVariants;

              const variantIndex =
                colorVariants.findIndex(
                  (variant) =>
                    variant.color ===
                    originalItem.color,
                );

              if (variantIndex < 0) {
                throw new PosExchangeError(
                  `لون ${originalItem.productNameAr} لم يعد موجودًا`,
                  409,
                );
              }

              const variant =
                colorVariants[variantIndex];

              const variantSizes =
                Array.isArray(
                  variant.sizes,
                )
                  ? variant.sizes
                  : [];

              const sizeIndex =
                variantSizes.findIndex(
                  (entry) =>
                    entry.size ===
                    originalItem.size,
                );

              if (sizeIndex < 0) {
                throw new PosExchangeError(
                  `مقاس ${originalItem.productNameAr} لم يعد موجودًا`,
                  409,
                );
              }

              const selectedSize =
                variantSizes[sizeIndex];

              if (
                selectedSize.stock === null ||
                selectedSize.stock ===
                  undefined
              ) {
                throw new PosExchangeError(
                  `مخزون لون ومقاس ${originalItem.productNameAr} لم يعد قابلًا للتتبع`,
                  409,
                );
              }

              variantStockBefore =
                selectedSize.stock;

              variantStockAfter =
                variantStockBefore +
                line.quantity;

              if (
                !Number.isSafeInteger(
                  variantStockAfter,
                ) ||
                variantStockAfter >
                  MAX_STOCK
              ) {
                throw new PosExchangeError(
                  `مخزون لون ومقاس ${originalItem.productNameAr} يتجاوز الحد المسموح`,
                  409,
                );
              }

              const nextSizes =
                variantSizes.map(
                  (entry, index) =>
                    index === sizeIndex
                      ? {
                          ...entry,
                          stock:
                            variantStockAfter,
                          outOfStock:
                            false,
                        }
                      : entry,
                );

              nextColorVariants =
                colorVariants.map(
                  (entry, index) =>
                    index === variantIndex
                      ? {
                          ...entry,
                          sizes:
                            nextSizes,
                        }
                      : entry,
                );

              stockState.colorVariants =
                nextColorVariants;
            }

            returnStockPlans.push({
              lineNumber:
                line.lineNumber,

              originalSaleItemId:
                originalItem.id,

              productId:
                product.id,

              barcode:
                originalItem.barcode,

              productCode:
                originalItem.productCode,

              productNameAr:
                originalItem.productNameAr,

              productImage:
                originalItem.productImage,

              color:
                originalItem.color,

              size:
                originalItem.size,

              quantity:
                line.quantity,

              soldUnitPriceMinor:
                originalItem.soldUnitPriceMinor,

              grossAmountMinor:
                line.grossAmountMinor,

              lineDiscountMinor:
                line.lineDiscountMinor,

              invoiceDiscountMinor:
                line.invoiceDiscountMinor,

              allocatedDiscountMinor:
                line.allocatedDiscountMinor,

              returnNetMinor:
                line.returnNetMinor,

              generalStockBefore,
              generalStockAfter,

              variantStockBefore,
              variantStockAfter,

              nextColorVariants,
            });
          }

          const newStockPlans = [];

          let newSubtotalMinor = 0;
          let newItemDiscountMinor = 0;

          for (const item of resolvedNewItems) {
            const stockState =
              productStockStates.get(
                item.productId,
              );

            if (!stockState) {
              throw new PosExchangeError(
                "تعذر قفل مخزون أحد المنتجات الجديدة",
                409,
              );
            }

            const product =
              stockState.product;

            if (
              !Number.isSafeInteger(
                product.price,
              ) ||
              product.price < 0
            ) {
              throw new PosExchangeError(
                `سعر المنتج ${product.nameAr} غير صالح`,
              );
            }

            if (
              item.mappedColor &&
              item.color &&
              item.mappedColor !==
                item.color
            ) {
              throw new PosExchangeError(
                `لون باركود ${item.barcode} غير مطابق`,
              );
            }

            if (
              item.mappedSize &&
              item.size &&
              item.mappedSize !==
                item.size
            ) {
              throw new PosExchangeError(
                `مقاس باركود ${item.barcode} غير مطابق`,
              );
            }

            const color =
              item.mappedColor ??
              item.color;

            const size =
              item.mappedSize ??
              item.size;

            const colorVariants =
              stockState.colorVariants;

            const generalSizes =
              (
                product.sizes as
                  | string[]
                  | null
              ) ?? [];

            let nextColorVariants:
              ColorVariant[] | null = null;

            let variantStockBefore:
              number | null = null;

            let variantStockAfter:
              number | null = null;

            if (colorVariants.length > 0) {
              if (!color) {
                throw new PosExchangeError(
                  `يجب تحديد لون ${product.nameAr}`,
                );
              }

              const variantIndex =
                colorVariants.findIndex(
                  (variant) =>
                    variant.color ===
                    color,
                );

              if (variantIndex < 0) {
                throw new PosExchangeError(
                  `لون ${product.nameAr} غير متوفر`,
                );
              }

              const variant =
                colorVariants[variantIndex];

              const variantSizes =
                Array.isArray(
                  variant.sizes,
                )
                  ? variant.sizes
                  : [];

              if (variantSizes.length > 0) {
                if (!size) {
                  throw new PosExchangeError(
                    `يجب تحديد مقاس ${product.nameAr}`,
                  );
                }

                const sizeIndex =
                  variantSizes.findIndex(
                    (entry) =>
                      entry.size === size,
                  );

                if (sizeIndex < 0) {
                  throw new PosExchangeError(
                    `مقاس ${product.nameAr} غير متوفر`,
                  );
                }

                const selectedSize =
                  variantSizes[sizeIndex];

                variantStockBefore =
                  selectedSize.stock ??
                  null;

                if (
                  selectedSize.outOfStock ||
                  (
                    selectedSize.stock !==
                      null &&
                    selectedSize.stock !==
                      undefined &&
                    selectedSize.stock <
                      item.quantity
                  )
                ) {
                  throw new PosExchangeError(
                    `الكمية المطلوبة من ${product.nameAr} غير متوفرة`,
                    409,
                  );
                }

                if (
                  selectedSize.stock !==
                    null &&
                  selectedSize.stock !==
                    undefined
                ) {
                  variantStockAfter =
                    selectedSize.stock -
                    item.quantity;

                  if (
                    !Number.isSafeInteger(
                      variantStockAfter,
                    ) ||
                    variantStockAfter < 0
                  ) {
                    throw new PosExchangeError(
                      `مخزون ${product.nameAr} غير صالح`,
                      409,
                    );
                  }

                  const nextSizes =
                    variantSizes.map(
                      (entry, index) =>
                        index === sizeIndex
                          ? {
                              ...entry,
                              stock:
                                variantStockAfter,
                              outOfStock:
                                variantStockAfter! <= 0,
                            }
                          : entry,
                    );

                  nextColorVariants =
                    colorVariants.map(
                      (entry, index) =>
                        index === variantIndex
                          ? {
                              ...entry,
                              sizes:
                                nextSizes,
                            }
                          : entry,
                    );

                  stockState.colorVariants =
                    nextColorVariants;
                }
              } else if (size) {
                throw new PosExchangeError(
                  `المقاس غير صالح للمنتج ${product.nameAr}`,
                );
              }
            } else {
              if (color) {
                throw new PosExchangeError(
                  `اللون غير صالح للمنتج ${product.nameAr}`,
                );
              }

              if (generalSizes.length > 0) {
                if (
                  !size ||
                  !generalSizes.includes(
                    size,
                  )
                ) {
                  throw new PosExchangeError(
                    `مقاس ${product.nameAr} غير متوفر`,
                  );
                }
              } else if (size) {
                throw new PosExchangeError(
                  `المقاس غير صالح للمنتج ${product.nameAr}`,
                );
              }
            }

            const generalStockBefore =
              stockState.generalStock;

            let generalStockAfter:
              number | null = null;

            if (
              generalStockBefore !== null
            ) {
              if (
                generalStockBefore <
                item.quantity
              ) {
                throw new PosExchangeError(
                  `الكمية المطلوبة من ${product.nameAr} غير متوفرة`,
                  409,
                );
              }

              generalStockAfter =
                generalStockBefore -
                item.quantity;

              if (
                !Number.isSafeInteger(
                  generalStockAfter,
                ) ||
                generalStockAfter < 0
              ) {
                throw new PosExchangeError(
                  `مخزون ${product.nameAr} غير صالح`,
                  409,
                );
              }

              stockState.generalStock =
                generalStockAfter;
            }

            const websiteUnitPriceMinor =
              product.price * 100;

            const lineGrossMinor =
              item.soldUnitPriceMinor *
              item.quantity;

            const lineDiscountMinor =
              item.lineDiscountMinor;

            const lineTotalMinor =
              lineGrossMinor -
              lineDiscountMinor;

            if (
              !Number.isSafeInteger(
                websiteUnitPriceMinor,
              ) ||
              websiteUnitPriceMinor >
                MAX_MINOR ||
              !Number.isSafeInteger(
                lineGrossMinor,
              ) ||
              lineGrossMinor >
                MAX_MINOR ||
              !Number.isSafeInteger(
                lineDiscountMinor,
              ) ||
              lineDiscountMinor < 0 ||
              lineDiscountMinor >
                lineGrossMinor ||
              !Number.isSafeInteger(
                lineTotalMinor,
              ) ||
              lineTotalMinor < 0 ||
              lineTotalMinor >
                MAX_MINOR
            ) {
              throw new PosExchangeError(
                "قيمة الأصناف الجديدة تتجاوز الحد المسموح",
              );
            }

            newSubtotalMinor +=
              lineGrossMinor;

            newItemDiscountMinor +=
              lineDiscountMinor;

            if (
              !Number.isSafeInteger(
                newSubtotalMinor,
              ) ||
              newSubtotalMinor >
                MAX_MINOR ||
              !Number.isSafeInteger(
                newItemDiscountMinor,
              ) ||
              newItemDiscountMinor >
                MAX_MINOR
            ) {
              throw new PosExchangeError(
                "إجمالي الأصناف الجديدة يتجاوز الحد المسموح",
              );
            }

            newStockPlans.push({
              lineNumber:
                item.lineNumber,

              productId:
                product.id,

              barcode:
                item.barcode,

              productCode:
                product.productCode ??
                null,

              productNameAr:
                product.nameAr,

              productImage:
                product.image,

              color,
              size,

              quantity:
                item.quantity,

              websiteUnitPriceMinor,

              soldUnitPriceMinor:
                item.soldUnitPriceMinor,

              lineDiscountMinor,

              lineTotalMinor,

              generalStockBefore,
              generalStockAfter,

              variantStockBefore,
              variantStockAfter,

              nextColorVariants,
            });
          }

          const newItemsNetMinor =
            newSubtotalMinor -
            newItemDiscountMinor;

          if (
            payload.newInvoiceDiscountMinor >
            newItemsNetMinor
          ) {
            throw new PosExchangeError(
              "خصم فاتورة الأصناف الجديدة أكبر من صافي قيمتها",
            );
          }

          const newDiscountMinor =
            newItemDiscountMinor +
            payload.newInvoiceDiscountMinor;

          const newNetMinor =
            newSubtotalMinor -
            newDiscountMinor;

          if (
            !Number.isSafeInteger(
              newDiscountMinor,
            ) ||
            newDiscountMinor >
              newSubtotalMinor ||
            !Number.isSafeInteger(
              newNetMinor,
            ) ||
            newNetMinor < 0 ||
            newNetMinor >
              MAX_MINOR ||
            newStockPlans.length !==
              resolvedNewItems.length
          ) {
            throw new PosExchangeError(
              "إجمالي الأصناف الجديدة غير صالح",
            );
          }

          return {
            exchange: {
              id: 0,
              publicId:
                getExchangePublicId(
                  session.businessDate,
                ),
              originalPosSaleId:
                sale.id,
              cashSessionId:
                session.id,
              registerKey:
                payload.registerKey,
              businessDate:
                session.businessDate,
            },
            returnItems:
              returnStockPlans.map(
                ({
                  nextColorVariants: _nextColorVariants,
                  ...line
                }) => line,
              ),
            alreadyCreated: false,
          };
        },
      );

    return json(
      {
        ok: true,
        validationOnly: true,
        alreadyCreated:
          result.alreadyCreated,
        exchange:
          result.exchange,
        returnItems:
          result.returnItems,
      },
      200,
    );
  } catch (error) {
    if (
      error instanceof
      PosExchangeError
    ) {
      return json(
        { error: error.message },
        error.status,
      );
    }

    console.error(
      "POS_EXCHANGE_VALIDATE_FAILED",
      error,
    );

    return json(
      {
        error:
          "تعذر التحقق من فاتورة التبديل",
      },
      500,
    );
  }
}
