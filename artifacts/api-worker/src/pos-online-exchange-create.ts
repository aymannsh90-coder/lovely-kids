import {
  appSettingsTable,
  exchangeDocumentsTable,
  exchangeReturnItemsTable,
  ordersTable,
} from "@workspace/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import {
  resolveShippingCost,
  resolveShippingZone,
  STORE_PICKUP_LABEL,
} from "./order-service";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
type OrderRow = typeof ordersTable.$inferSelect;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers,
  });

class OnlineExchangeError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface StoredOnlineOrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  size?: string;
  color?: string;
  invoiceDiscountMinor?: unknown;
}

interface ParsedReturnItem {
  originalOrderLineNumber: number;
  quantity: number;
}

type DeliveryDiscountMode =
  | "none"
  | "half"
  | "full"
  | "manual";

interface ParsedPayload {
  idempotencyKey: string;
  originalOrderId: number;
  replacementOrderId: number | null;

  deliveryDiscountMode: DeliveryDiscountMode;
  manualDeliveryDiscountMinor: number;
  returnItems: ParsedReturnItem[];
  notes: string | null;
}

function getBusinessDate(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());

    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );

    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

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

function parsePositiveInteger(
  value: unknown,
  field: string,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" &&
          value.trim() !== ""
        ? Number(value)
        : NaN;

  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0
  ) {
    throw new OnlineExchangeError(
      `${field} غير صالح`,
    );
  }

  return parsed;
}

function parsePayload(
  raw: unknown,
): ParsedPayload {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    throw new OnlineExchangeError(
      "بيانات التبديل غير صالحة",
    );
  }

  const body =
    raw as Record<string, unknown>;

  const idempotencyKey =
    typeof body.idempotencyKey === "string"
      ? body.idempotencyKey.trim()
      : "";

  if (
    !idempotencyKey ||
    idempotencyKey.length > 160
  ) {
    throw new OnlineExchangeError(
      "معرّف العملية غير صالح",
    );
  }

  const originalOrderId =
    parsePositiveInteger(
      body.originalOrderId,
      "رقم الطلب القديم",
    );

  const replacementOrderId =
    body.replacementOrderId === undefined ||
    body.replacementOrderId === null ||
    body.replacementOrderId === ""
      ? null
      : parsePositiveInteger(
          body.replacementOrderId,
          "رقم الطلب البديل",
        );

  if (
    replacementOrderId !== null &&
    replacementOrderId === originalOrderId
  ) {
    throw new OnlineExchangeError(
      "الطلب البديل يجب أن يختلف عن الطلب القديم",
    );
  }

  if (
    !Array.isArray(body.returnItems) ||
    body.returnItems.length === 0 ||
    body.returnItems.length > 100
  ) {
    throw new OnlineExchangeError(
      "يجب اختيار أصناف للتبديل",
    );
  }

  const seenLines =
    new Set<number>();

  const returnItems =
    body.returnItems.map(
      (rawItem) => {
        if (
          !rawItem ||
          typeof rawItem !== "object" ||
          Array.isArray(rawItem)
        ) {
          throw new OnlineExchangeError(
            "أحد أصناف التبديل غير صالح",
          );
        }

        const item =
          rawItem as Record<string, unknown>;

        const originalOrderLineNumber =
          parsePositiveInteger(
            item.originalOrderLineNumber,
            "رقم سطر الطلب",
          );

        const quantity =
          parsePositiveInteger(
            item.quantity,
            "كمية التبديل",
          );

        if (quantity > 99) {
          throw new OnlineExchangeError(
            "كمية أحد أصناف التبديل أكبر من الحد المسموح",
          );
        }

        if (
          seenLines.has(
            originalOrderLineNumber,
          )
        ) {
          throw new OnlineExchangeError(
            "لا يمكن تكرار نفس سطر الطلب في التبديل",
          );
        }

        seenLines.add(
          originalOrderLineNumber,
        );

        return {
          originalOrderLineNumber,
          quantity,
        };
      },
    );


  const rawDeliveryDiscountMode =
    body.deliveryDiscountMode;

  const deliveryDiscountMode: DeliveryDiscountMode =
    rawDeliveryDiscountMode === "half" ||
    rawDeliveryDiscountMode === "full" ||
    rawDeliveryDiscountMode === "manual"
      ? rawDeliveryDiscountMode
      : "none";

  const manualDeliveryDiscountMinor =
    body.manualDeliveryDiscountMinor == null ||
    body.manualDeliveryDiscountMinor === ""
      ? 0
      : Number(body.manualDeliveryDiscountMinor);

  if (
    !Number.isSafeInteger(manualDeliveryDiscountMinor) ||
    manualDeliveryDiscountMinor < 0 ||
    manualDeliveryDiscountMinor % 100 !== 0
  ) {
    throw new OnlineExchangeError(
      "خصم التوصيل اليدوي يجب أن يكون بمبلغ شيكل كامل",
    );
  }

  const notes =
    body.notes === undefined ||
    body.notes === null
      ? null
      : typeof body.notes === "string"
        ? body.notes.trim() || null
        : (() => {
            throw new OnlineExchangeError(
              "الملاحظات غير صالحة",
            );
          })();

  if (
    notes !== null &&
    notes.length > 1000
  ) {
    throw new OnlineExchangeError(
      "الملاحظات طويلة جدًا",
    );
  }

  return {
    idempotencyKey,
    originalOrderId,
    replacementOrderId,
    deliveryDiscountMode,
    manualDeliveryDiscountMinor,
    returnItems,
    notes,
  };
}

function resolveDeliveryDiscountMinor(
  mode: DeliveryDiscountMode,
  baseMinor: number,
  manualMinor: number,
) {
  const discountMinor =
    mode === "full"
      ? baseMinor
      : mode === "half"
        ? baseMinor / 2
        : mode === "manual"
          ? manualMinor
          : 0;

  if (
    !Number.isSafeInteger(discountMinor) ||
    discountMinor < 0 ||
    discountMinor > baseMinor
  ) {
    throw new OnlineExchangeError(
      "خصم التوصيل غير صالح لسعر المنطقة",
      409,
    );
  }

  return discountMinor;
}

function toMinor(
  value: number | null | undefined,
  field: string,
): number {
  const amount = value ?? 0;

  if (
    !Number.isSafeInteger(amount) ||
    amount < 0
  ) {
    throw new OnlineExchangeError(
      `${field} غير صالح`,
      409,
    );
  }

  const minor =
    amount * 100;

  if (
    !Number.isSafeInteger(minor)
  ) {
    throw new OnlineExchangeError(
      `${field} أكبر من الحد المسموح`,
      409,
    );
  }

  return minor;
}

function parseStoredItems(
  order: OrderRow,
): StoredOnlineOrderItem[] {
  if (!Array.isArray(order.items)) {
    throw new OnlineExchangeError(
      `بيانات أصناف الطلب #${order.id} غير صالحة`,
      409,
    );
  }

  return order.items as StoredOnlineOrderItem[];
}

function getOriginalLineDiscountMinor(
  item: StoredOnlineOrderItem,
  grossLineMinor: number,
): number {
  const raw =
    item.invoiceDiscountMinor;

  if (raw === undefined) {
    return 0;
  }

  if (
    !Number.isSafeInteger(raw) ||
    Number(raw) < 0 ||
    Number(raw) > grossLineMinor
  ) {
    throw new OnlineExchangeError(
      "بيانات خصم الطلب القديم غير صالحة",
      409,
    );
  }

  return Number(raw);
}

function calculateReplacementSnapshot(
  order: OrderRow,
  settingsData: unknown,
) {
  const items =
    parseStoredItems(order);

  let grossMinor = 0;

  for (const [index, item] of items.entries()) {
    const quantity =
      Number(item.quantity);

    const price =
      Number(item.price);

    if (
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      !Number.isSafeInteger(price) ||
      price < 0
    ) {
      throw new OnlineExchangeError(
        `بيانات صنف الطلب البديل في السطر ${index + 1} غير صالحة`,
        409,
      );
    }

    const lineMinor =
      price * quantity * 100;

    if (
      !Number.isSafeInteger(lineMinor) ||
      lineMinor < 0
    ) {
      throw new OnlineExchangeError(
        "قيمة الطلب البديل أكبر من الحد المسموح",
        409,
      );
    }

    grossMinor += lineMinor;

    if (!Number.isSafeInteger(grossMinor)) {
      throw new OnlineExchangeError(
        "قيمة الطلب البديل أكبر من الحد المسموح",
        409,
      );
    }
  }

  if (
    !order.shippingZone ||
    order.shippingZone ===
      STORE_PICKUP_LABEL
  ) {
    throw new OnlineExchangeError(
      "تبديل طلبات الأونلاين يحتاج طلب توصيل وليس استلامًا من المحل",
      409,
    );
  }

  const shipping =
    resolveShippingZone(
      settingsData,
      order.shippingZone,
    );

  const baseChargeMinor =
    toMinor(
      shipping.cost,
      "سعر التوصيل الأساسي",
    );

  const deliveryChargeMinor =
    toMinor(
      order.shippingCost,
      "رسوم التوصيل على الزبون",
    );

  if (
    deliveryChargeMinor >
    baseChargeMinor
  ) {
    throw new OnlineExchangeError(
      "رسوم توصيل الطلب البديل أكبر من السعر الأساسي للمنطقة",
      409,
    );
  }

  const totalMinor =
    toMinor(
      order.totalPrice,
      "إجمالي الطلب البديل",
    );

  if (
    deliveryChargeMinor >
    totalMinor
  ) {
    throw new OnlineExchangeError(
      "رسوم التوصيل أكبر من إجمالي الطلب البديل",
      409,
    );
  }

  const netMinor =
    totalMinor -
    deliveryChargeMinor;

  const discountMinor =
    grossMinor -
    netMinor;

  if (
    !Number.isSafeInteger(netMinor) ||
    netMinor < 0 ||
    !Number.isSafeInteger(
      discountMinor,
    ) ||
    discountMinor < 0 ||
    discountMinor > grossMinor
  ) {
    throw new OnlineExchangeError(
      "خصم الطلب البديل غير متطابق مع إجمالي الطلب",
      409,
    );
  }

  return {
    grossMinor,
    discountMinor,
    netMinor,
    baseChargeMinor,
    deliveryDiscountMinor:
      baseChargeMinor -
      deliveryChargeMinor,
    deliveryChargeMinor,
  };
}

async function buildResponse(
  tx: Parameters<
    Parameters<Db["transaction"]>[0]
  >[0],
  exchange:
    typeof exchangeDocumentsTable.$inferSelect,
  replayed: boolean,
) {
  const returnItems =
    await tx
      .select()
      .from(
        exchangeReturnItemsTable,
      )
      .where(
        eq(
          exchangeReturnItemsTable.exchangeId,
          exchange.id,
        ),
      )
      .orderBy(
        asc(
          exchangeReturnItemsTable.lineNumber,
        ),
      );

  const replacementRows =
    exchange.replacementOrderId === null
      ? []
      : await tx
          .select()
          .from(ordersTable)
          .where(
            eq(
              ordersTable.id,
              exchange.replacementOrderId,
            ),
          )
          .limit(1);

  const replacement =
    replacementRows[0] ?? null;

  return {
    replayed,

    exchange: {
      id: String(exchange.id),
      publicId: exchange.publicId,
      sourceType: exchange.sourceType,
      originalOrderId:
        exchange.originalOrderId === null
          ? null
          : String(
              exchange.originalOrderId,
            ),
      replacementOrderId:
        exchange.replacementOrderId === null
          ? null
          : String(
              exchange.replacementOrderId,
            ),
      replacementOrderOrigin:
        exchange.replacementOrderOrigin,
      businessDate:
        exchange.businessDate,
      status:
        exchange.status,

      returnGrossMinor:
        exchange.returnGrossMinor,
      returnDiscountMinor:
        exchange.returnDiscountMinor,
      returnNetMinor:
        exchange.returnNetMinor,

      newGrossMinor:
        exchange.newGrossMinor,
      newDiscountMinor:
        exchange.newDiscountMinor,
      newNetMinor:
        exchange.newNetMinor,

      differenceMinor:
        exchange.differenceMinor,

      deliveryBaseChargeMinor:
        exchange.deliveryBaseChargeMinor,
      deliveryDiscountMinor:
        exchange.deliveryDiscountMinor,
      deliveryDiscountMode:
        exchange.deliveryDiscountMode,
      deliveryChargeMinor:
        exchange.deliveryChargeMinor,

      settlementAmountMinor:
        exchange.settlementAmountMinor,

      financialCompletedAt:
        exchange.financialCompletedAt?.toISOString() ??
        null,

      returnReceivedAt:
        exchange.returnReceivedAt?.toISOString() ??
        null,
    },

    replacementOrder:
      replacement === null
        ? null
        : {
            id: String(
              replacement.id,
            ),
            status:
              replacement.status,
            customerName:
              replacement.customerName,
            customerPhone:
              replacement.customerPhone,
            shippingZone:
              replacement.shippingZone,
            shippingCost:
              replacement.shippingCost,
            totalPrice:
              replacement.totalPrice,
          },

    returnItems:
      returnItems.map(
        (item) => ({
          id:
            String(item.id),
          originalOrderLineNumber:
            item.originalOrderLineNumber,
          productId:
            item.productId === null
              ? null
              : String(
                  item.productId,
                ),
          productNameAr:
            item.productNameAr,
          color:
            item.color,
          size:
            item.size,
          quantity:
            item.quantity,
          soldUnitPriceMinor:
            item.soldUnitPriceMinor,
          grossAmountMinor:
            item.grossAmountMinor,
          allocatedDiscountMinor:
            item.allocatedDiscountMinor,
          returnNetMinor:
            item.returnNetMinor,
        }),
      ),
  };
}

export async function handleGetOnlineOrderExchangeStatus(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response> {
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  if (!user.isAdmin && !user.isOwner) {
    return json({ error: "غير مصرح باستخدام نقطة البيع" }, 403);
  }

  const publicId =
    (new URL(request.url).searchParams.get("publicId") ?? "")
      .trim()
      .toUpperCase();

  if (!publicId) {
    return json({ error: "رقم عملية التبديل مطلوب" }, 400);
  }

  const rows = await db
    .select()
    .from(exchangeDocumentsTable)
    .where(eq(exchangeDocumentsTable.publicId, publicId))
    .limit(1);

  const exchange = rows[0];

  if (!exchange) {
    return json({ error: "عملية التبديل غير موجودة" }, 404);
  }

  if (exchange.sourceType !== "online_order") {
    return json({ error: "هذه العملية ليست تبديل طلب أونلاين" }, 409);
  }

  const result = await db.transaction(
    async (tx) => buildResponse(tx, exchange, false),
  );

  return json(result);
}

export async function handleCreateOnlineOrderExchange(
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

  let payload: ParsedPayload;

  try {
    payload =
      parsePayload(
        await request
          .json()
          .catch(() => null),
      );
  } catch (error) {
    if (
      error instanceof OnlineExchangeError
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
          // Locking the immutable original order serializes
          // concurrent exchange reservations for this order.
          const originalRows =
            await tx
              .select()
              .from(
                ordersTable,
              )
              .where(
                eq(
                  ordersTable.id,
                  payload.originalOrderId,
                ),
              )
              .for("update");

          const originalOrder =
            originalRows[0];

          if (!originalOrder) {
            throw new OnlineExchangeError(
              "طلب المتجر القديم غير موجود",
              404,
            );
          }

          if (
            originalOrder.status !==
            "done"
          ) {
            throw new OnlineExchangeError(
              "يمكن تبديل طلبات المتجر التي تم تسليمها فقط",
              409,
            );
          }

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
              existing.sourceType !==
                "online_order" ||
              existing.originalOrderId !==
                originalOrder.id
            ) {
              throw new OnlineExchangeError(
                "معرّف العملية مستخدم لعملية أخرى",
                409,
              );
            }

            return buildResponse(
              tx,
              existing,
              true,
            );
          }

          const storedItems =
            parseStoredItems(
              originalOrder,
            );

          if (
            storedItems.length === 0
          ) {
            throw new OnlineExchangeError(
              "الطلب القديم لا يحتوي على أصناف قابلة للتبديل",
              409,
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
                    "online_order",
                  ),
                  eq(
                    exchangeDocumentsTable.originalOrderId,
                    originalOrder.id,
                  ),
                  eq(
                    exchangeDocumentsTable.status,
                    "completed",
                  ),
                ),
              );

          const completedIds =
            completedExchanges.map(
              (row) => row.id,
            );

          const priorItems =
            completedIds.length === 0
              ? []
              : await tx
                  .select()
                  .from(
                    exchangeReturnItemsTable,
                  )
                  .where(
                    inArray(
                      exchangeReturnItemsTable.exchangeId,
                      completedIds,
                    ),
                  );

          const priorQuantityByLine =
            new Map<number, number>();

          const priorDiscountByLine =
            new Map<number, number>();

          for (
            const item of priorItems
          ) {
            const lineNumber =
              item.originalOrderLineNumber;

            if (
              lineNumber === null
            ) {
              continue;
            }

            const nextQuantity =
              (
                priorQuantityByLine.get(
                  lineNumber,
                ) ?? 0
              ) +
              item.quantity;

            const nextDiscount =
              (
                priorDiscountByLine.get(
                  lineNumber,
                ) ?? 0
              ) +
              item.invoiceDiscountMinor;

            if (
              !Number.isSafeInteger(
                nextQuantity,
              ) ||
              !Number.isSafeInteger(
                nextDiscount,
              ) ||
              nextQuantity < 0 ||
              nextDiscount < 0
            ) {
              throw new OnlineExchangeError(
                "بيانات التبديلات السابقة غير صالحة",
                409,
              );
            }

            priorQuantityByLine.set(
              lineNumber,
              nextQuantity,
            );

            priorDiscountByLine.set(
              lineNumber,
              nextDiscount,
            );
          }

          const requested =
            [...payload.returnItems]
              .sort(
                (left, right) =>
                  left.originalOrderLineNumber -
                  right.originalOrderLineNumber,
              );

          const returnLines:
            Array<
              typeof exchangeReturnItemsTable.$inferInsert
            > = [];

          for (
            const [
              index,
              requestedItem,
            ] of requested.entries()
          ) {
            const lineIndex =
              requestedItem.originalOrderLineNumber -
              1;

            const originalItem =
              storedItems[
                lineIndex
              ];

            if (!originalItem) {
              throw new OnlineExchangeError(
                `سطر الطلب ${requestedItem.originalOrderLineNumber} غير موجود`,
                409,
              );
            }

            const productId =
              Number(
                originalItem.id,
              );

            const soldQuantity =
              Number(
                originalItem.quantity,
              );

            const price =
              Number(
                originalItem.price,
              );

            if (
              !Number.isSafeInteger(
                productId,
              ) ||
              productId <= 0 ||
              !Number.isSafeInteger(
                soldQuantity,
              ) ||
              soldQuantity <= 0 ||
              !Number.isSafeInteger(
                price,
              ) ||
              price < 0
            ) {
              throw new OnlineExchangeError(
                `بيانات السطر ${requestedItem.originalOrderLineNumber} في الطلب القديم غير صالحة`,
                409,
              );
            }

            const soldUnitPriceMinor =
              price * 100;

            const originalGrossMinor =
              soldUnitPriceMinor *
              soldQuantity;

            if (
              !Number.isSafeInteger(
                soldUnitPriceMinor,
              ) ||
              !Number.isSafeInteger(
                originalGrossMinor,
              ) ||
              soldUnitPriceMinor < 0 ||
              originalGrossMinor < 0
            ) {
              throw new OnlineExchangeError(
                "قيمة أحد أصناف الطلب القديم غير صالحة",
                409,
              );
            }

            const originalDiscountMinor =
              getOriginalLineDiscountMinor(
                originalItem,
                originalGrossMinor,
              );

            const previouslyReserved =
              priorQuantityByLine.get(
                requestedItem.originalOrderLineNumber,
              ) ?? 0;

            const previouslyAllocatedDiscount =
              priorDiscountByLine.get(
                requestedItem.originalOrderLineNumber,
              ) ?? 0;

            const reservedAfter =
              previouslyReserved +
              requestedItem.quantity;

            if (
              !Number.isSafeInteger(
                reservedAfter,
              ) ||
              previouslyReserved < 0 ||
              reservedAfter >
                soldQuantity
            ) {
              throw new OnlineExchangeError(
                `الكمية المطلوبة من ${String(originalItem.name ?? "").trim() || `السطر ${requestedItem.originalOrderLineNumber}`} أكبر من الكمية المتبقية`,
                409,
              );
            }

            const targetDiscountMinor =
              reservedAfter ===
              soldQuantity
                ? originalDiscountMinor
                : Number(
                    (
                      BigInt(
                        originalDiscountMinor,
                      ) *
                      BigInt(
                        reservedAfter,
                      )
                    ) /
                      BigInt(
                        soldQuantity,
                      ),
                  );

            const invoiceDiscountMinor =
              targetDiscountMinor -
              previouslyAllocatedDiscount;

            const grossAmountMinor =
              soldUnitPriceMinor *
              requestedItem.quantity;

            if (
              !Number.isSafeInteger(
                targetDiscountMinor,
              ) ||
              !Number.isSafeInteger(
                invoiceDiscountMinor,
              ) ||
              !Number.isSafeInteger(
                grossAmountMinor,
              ) ||
              invoiceDiscountMinor < 0 ||
              invoiceDiscountMinor >
                grossAmountMinor ||
              targetDiscountMinor >
                originalDiscountMinor
            ) {
              throw new OnlineExchangeError(
                "تعذر احتساب خصم الصنف المرتجع",
                409,
              );
            }

            const returnNetMinor =
              grossAmountMinor -
              invoiceDiscountMinor;

            returnLines.push({
              exchangeId: 0,
              lineNumber:
                index + 1,

              originalPosSaleItemId:
                null,

              originalOrderLineNumber:
                requestedItem.originalOrderLineNumber,

              productId,

              barcode:
                null,

              productCode:
                null,

              productNameAr:
                String(
                  originalItem.name ?? "",
                ).trim() ||
                `صنف ${requestedItem.originalOrderLineNumber}`,

              productImage:
                typeof originalItem.image ===
                "string"
                  ? originalItem.image
                  : null,

              color:
                typeof originalItem.color ===
                "string"
                  ? originalItem.color
                  : null,

              size:
                typeof originalItem.size ===
                "string"
                  ? originalItem.size
                  : null,

              quantity:
                requestedItem.quantity,

              catalogUnitPriceMinor:
                null,

              soldUnitPriceMinor,

              grossAmountMinor,

              lineDiscountMinor:
                0,

              invoiceDiscountMinor,

              allocatedDiscountMinor:
                invoiceDiscountMinor,

              returnNetMinor,

              // No stock is restored while the parcel
              // is still with the customer/courier.
              generalStockBefore:
                null,
              generalStockAfter:
                null,
              variantStockBefore:
                null,
              variantStockAfter:
                null,
            });
          }

          const returnGrossMinor =
            returnLines.reduce(
              (sum, line) =>
                sum +
                line.grossAmountMinor,
              0,
            );

          const returnDiscountMinor =
            returnLines.reduce(
              (sum, line) =>
                sum +
                line.allocatedDiscountMinor,
              0,
            );

          const returnNetMinor =
            returnLines.reduce(
              (sum, line) =>
                sum +
                line.returnNetMinor,
              0,
            );

          if (
            !Number.isSafeInteger(
              returnGrossMinor,
            ) ||
            !Number.isSafeInteger(
              returnDiscountMinor,
            ) ||
            !Number.isSafeInteger(
              returnNetMinor,
            ) ||
            returnNetMinor !==
              returnGrossMinor -
                returnDiscountMinor
          ) {
            throw new OnlineExchangeError(
              "قيمة الأصناف المرتجعة غير صالحة",
              409,
            );
          }

          const settingsRows =
            await tx
              .select({
                data:
                  appSettingsTable.data,
              })
              .from(
                appSettingsTable,
              )
              .where(
                eq(
                  appSettingsTable.id,
                  1,
                ),
              )
              .limit(1);

          const settingsData =
            settingsRows[0]?.data;

          let replacementOrder:
            OrderRow;

          let replacementOrigin:
            "existing_order" |
            "system_created";

          if (
            payload.replacementOrderId !==
            null
          ) {
            const replacementRows =
              await tx
                .select()
                .from(
                  ordersTable,
                )
                .where(
                  eq(
                    ordersTable.id,
                    payload.replacementOrderId,
                  ),
                )
                .for("update");

            const replacement =
              replacementRows[0];

            if (!replacement) {
              throw new OnlineExchangeError(
                "الطلب البديل غير موجود",
                404,
              );
            }

            if (
              replacement.id ===
              originalOrder.id
            ) {
              throw new OnlineExchangeError(
                "الطلب البديل يجب أن يختلف عن الطلب القديم",
                409,
              );
            }

            if (
              replacement.status !==
                "new" &&
              replacement.status !==
                "confirmed"
            ) {
              throw new OnlineExchangeError(
                "يمكن ربط طلب بديل جديد أو مؤكد فقط",
                409,
              );
            }

            if (
              replacement.paymentMethod !==
              "cod"
            ) {
              throw new OnlineExchangeError(
                "الطلب البديل يجب أن يكون دفع عند الاستلام لأن تسوية التبديل تتم مع شركة التوصيل",
                409,
              );
            }

            const linkedRows =
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
                      exchangeDocumentsTable.replacementOrderId,
                      replacement.id,
                    ),
                    eq(
                      exchangeDocumentsTable.status,
                      "completed",
                    ),
                  ),
                )
                .limit(1);

            if (linkedRows[0]) {
              throw new OnlineExchangeError(
                "الطلب البديل مرتبط بتبديل آخر",
                409,
              );
            }

            replacementOrder =
              replacement;

            replacementOrigin =
              "existing_order";
          } else {
            if (
              !originalOrder.shippingZone ||
              originalOrder.shippingZone ===
                STORE_PICKUP_LABEL
            ) {
              throw new OnlineExchangeError(
                "لا يمكن إنشاء طلب تبديل توصيل من طلب استلام من المحل",
                409,
              );
            }

            const shipping =
              resolveShippingZone(
                settingsData,
                originalOrder.shippingZone,
              );

            const shippingCost =
              resolveShippingCost(
                settingsData,
                shipping,
                0,
              );

            if (
              !originalOrder.customerName.trim() ||
              !originalOrder.customerPhone.trim() ||
              !originalOrder.customerAddress.trim()
            ) {
              throw new OnlineExchangeError(
                "بيانات الزبون في الطلب القديم غير مكتملة",
                409,
              );
            }

            const draftRows =
              await tx
                .insert(
                  ordersTable,
                )
                .values({
                  userId:
                    originalOrder.userId,

                  customerName:
                    originalOrder.customerName,

                  customerPhone:
                    originalOrder.customerPhone,

                  customerAddress:
                    originalOrder.customerAddress,

                  items: [],

                  totalPrice:
                    shippingCost,

                  shippingZone:
                    shipping.label,

                  shippingCost,

                  fulfillmentMethod:
                    null,

                  deliveryCompanyId:
                    null,

                  deliveryCompanyCost:
                    null,

                  status:
                    "new",

                  notes:
                    `طلب تبديل — بدل الطلب #${originalOrder.id}`,

                  paymentMethod:
                    "cod",

                  paymentStatus:
                    "pending",

                  paymentProof:
                    null,
                })
                .returning();

            const draft =
              draftRows[0];

            if (!draft) {
              throw new Error(
                "ONLINE_EXCHANGE_REPLACEMENT_ORDER_INSERT_FAILED",
              );
            }

            replacementOrder =
              draft;

            replacementOrigin =
              "system_created";
          }

          if (
            !replacementOrder.shippingZone ||
            replacementOrder.shippingZone === STORE_PICKUP_LABEL
          ) {
            throw new OnlineExchangeError(
              "طلب التبديل البديل يجب أن يكون طلب توصيل",
              409,
            );
          }

          const exchangeShipping =
            resolveShippingZone(
              settingsData,
              replacementOrder.shippingZone,
            );

          const requestedBaseChargeMinor =
            toMinor(
              exchangeShipping.cost,
              "سعر التوصيل الأساسي",
            );

          const requestedDeliveryDiscountMinor =
            resolveDeliveryDiscountMinor(
              payload.deliveryDiscountMode,
              requestedBaseChargeMinor,
              payload.manualDeliveryDiscountMinor,
            );

          const requestedDeliveryChargeMinor =
            requestedBaseChargeMinor -
            requestedDeliveryDiscountMinor;

          if (requestedDeliveryChargeMinor % 100 !== 0) {
            throw new OnlineExchangeError(
              "رسوم التوصيل بعد الخصم يجب أن تكون بمبلغ شيكل كامل",
              409,
            );
          }

          const oldDeliveryChargeMinor =
            toMinor(
              replacementOrder.shippingCost,
              "رسوم التوصيل الحالية",
            );

          if (
            oldDeliveryChargeMinor !==
            requestedDeliveryChargeMinor
          ) {
            const oldTotalMinor =
              toMinor(
                replacementOrder.totalPrice,
                "إجمالي الطلب البديل",
              );

            const nextTotalMinor =
              oldTotalMinor -
              oldDeliveryChargeMinor +
              requestedDeliveryChargeMinor;

            if (
              !Number.isSafeInteger(nextTotalMinor) ||
              nextTotalMinor < 0 ||
              nextTotalMinor % 100 !== 0
            ) {
              throw new OnlineExchangeError(
                "تعذر تطبيق خصم التوصيل على الطلب البديل",
                409,
              );
            }

            const updatedRows =
              await tx
                .update(ordersTable)
                .set({
                  shippingCost:
                    requestedDeliveryChargeMinor / 100,
                  totalPrice:
                    nextTotalMinor / 100,
                })
                .where(
                  eq(
                    ordersTable.id,
                    replacementOrder.id,
                  ),
                )
                .returning();

            if (!updatedRows[0]) {
              throw new Error(
                "ONLINE_EXCHANGE_REPLACEMENT_SHIPPING_UPDATE_FAILED",
              );
            }

            replacementOrder = updatedRows[0];
          }

          const replacementSnapshot =
            calculateReplacementSnapshot(
              replacementOrder,
              settingsData,
            );

          const businessDate =
            getBusinessDate();

          const differenceMinor =
            replacementSnapshot.netMinor -
            returnNetMinor;

          const settlementAmountMinor =
            differenceMinor +
            replacementSnapshot.deliveryChargeMinor;

          if (
            !Number.isSafeInteger(
              differenceMinor,
            ) ||
            !Number.isSafeInteger(
              settlementAmountMinor,
            )
          ) {
            throw new OnlineExchangeError(
              "قيمة فرق التبديل غير صالحة",
              409,
            );
          }

          const exchangeRows =
            await tx
              .insert(
                exchangeDocumentsTable,
              )
              .values({
                publicId:
                  getExchangePublicId(
                    businessDate,
                  ),

                idempotencyKey:
                  payload.idempotencyKey,

                sourceType:
                  "online_order",

                originalPosSaleId:
                  null,

                originalOrderId:
                  originalOrder.id,

                replacementOrderId:
                  replacementOrder.id,

                replacementOrderOrigin:
                  replacementOrigin,

                businessDate,

                cashSessionId:
                  null,

                registerKey:
                  null,

                customerName:
                  originalOrder.customerName,

                createdByUserId:
                  user.id,

                status:
                  "completed",

                settlementType:
                  "delivery_company",

                settlementPartyId:
                  null,

                returnGrossMinor,
                returnDiscountMinor,
                returnNetMinor,

                newGrossMinor:
                  replacementSnapshot.grossMinor,

                newDiscountMinor:
                  replacementSnapshot.discountMinor,

                newNetMinor:
                  replacementSnapshot.netMinor,

                differenceMinor,

                deliveryBaseChargeMinor:
                  replacementSnapshot.baseChargeMinor,

                deliveryDiscountMinor:
                  replacementSnapshot.deliveryDiscountMinor,

                deliveryDiscountMode:
                  payload.deliveryDiscountMode,

                deliveryChargeMinor:
                  replacementSnapshot.deliveryChargeMinor,

                deliveryCompanyCostMinor:
                  0,

                settlementAmountMinor,

                reason:
                  "تبديل طلب أونلاين",

                notes:
                  payload.notes,
              })
              .returning();

          const exchange =
            exchangeRows[0];

          if (!exchange) {
            throw new Error(
              "ONLINE_EXCHANGE_INSERT_FAILED",
            );
          }

          await tx
            .insert(
              exchangeReturnItemsTable,
            )
            .values(
              returnLines.map(
                (line) => ({
                  ...line,
                  exchangeId:
                    exchange.id,
                }),
              ),
            );

          return buildResponse(
            tx,
            exchange,
            false,
          );
        },
      );

    return json(
      result,
      result.replayed
        ? 200
        : 201,
    );
  } catch (error) {
    if (
      error instanceof
      OnlineExchangeError
    ) {
      return json(
        { error: error.message },
        error.status,
      );
    }

    console.error(
      "ONLINE_ORDER_EXCHANGE_CREATE_FAILED",
      error,
    );

    return json(
      {
        error:
          "تعذر إنشاء تبديل طلب الأونلاين",
      },
      500,
    );
  }
}
