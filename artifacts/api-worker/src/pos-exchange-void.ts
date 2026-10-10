import {
  financeTransactionLinesTable,
  financeTransactionsTable,
  cashSessionsTable,
  exchangeDocumentsTable,
  exchangeReturnItemCostsTable,
  exchangeReturnItemsTable,
  exchangeSaleItemCostsTable,
  exchangeSaleItemsTable,
  inventoryMovementsTable,
  productCostStateTable,
  productsTable,
  type ColorVariant,
} from "@workspace/db/schema";
import {
  and,
  asc,
  eq,
  inArray,
} from "drizzle-orm";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";
import {
  consumeExactProductCost,
  restoreExactProductCost,
  type CostQuality,
} from "./inventory-cost-engine";

type Db =
  Awaited<
    ReturnType<typeof openDb>
  >["db"];

const MAX_DB_INT = 2_147_483_647;
const MAX_STOCK = 2_000_000_000;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const json = (
  data: unknown,
  status = 200,
) =>
  new Response(
    JSON.stringify(data),
    {
      status,
      headers,
    },
  );

class PosExchangeVoidError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function parsePublicId(
  value: unknown,
) {
  const publicId =
    typeof value === "string"
      ? value.trim().toUpperCase()
      : "";

  if (
    !publicId ||
    publicId.length > 80 ||
    !/^[A-Z0-9_-]+$/.test(
      publicId,
    )
  ) {
    throw new PosExchangeVoidError(
      "رقم فاتورة التبديل غير صالح",
    );
  }

  return publicId;
}

function parseReason(
  value: unknown,
) {
  const reason =
    typeof value === "string"
      ? value.trim()
      : "";

  if (!reason) {
    throw new PosExchangeVoidError(
      "يجب إدخال سبب إلغاء فاتورة التبديل",
    );
  }

  if (reason.length > 500) {
    throw new PosExchangeVoidError(
      "سبب إلغاء فاتورة التبديل طويل جدًا",
    );
  }

  return reason;
}

function requireCostQuality(
  value: string,
): CostQuality {
  if (
    value === "confirmed" ||
    value === "estimated" ||
    value === "mixed"
  ) {
    return value;
  }

  throw new PosExchangeVoidError(
    "بيانات تكلفة فاتورة التبديل غير صالحة",
    409,
  );
}

type StockItem = {
  id: number;
  productId: number | null;

  barcode: string | null;
  productCode: string | null;
  productNameAr: string;

  color: string | null;
  size: string | null;

  quantity: number;

  generalStockBefore: number | null;
  generalStockAfter: number | null;

  variantStockBefore: number | null;
  variantStockAfter: number | null;
};

type ProductStockState = {
  generalStock: number | null;
  colorVariants: ColorVariant[];

  touchGeneral: boolean;
  touchVariants: boolean;
};

type StockMovementDraft = {
  productId: number;

  barcode: string | null;
  productCode: string | null;
  productNameAr: string;

  color: string | null;
  size: string | null;

  movementType: string;
  quantityDelta: number;

  generalStockBefore: number | null;
  generalStockAfter: number | null;

  variantStockBefore: number | null;
  variantStockAfter: number | null;

  sourceType: string;
  sourceId: number;
  sourceItemId: number;
  sourcePublicId: string;
  eventKey: string;
  occurredAt: Date;
};

export async function handleVoidPosExchange(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response> {
  try {
    const user =
      await getCurrentUser(
        db,
        request,
        env,
      );

    if (!user) {
      return json(
        {
          error:
            "يجب تسجيل الدخول",
        },
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

    let body: unknown;

    try {
      body =
        await request.json();
    } catch {
      throw new PosExchangeVoidError(
        "بيانات إلغاء فاتورة التبديل غير صالحة",
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      throw new PosExchangeVoidError(
        "بيانات إلغاء فاتورة التبديل غير صالحة",
      );
    }

    const payload =
      body as Record<
        string,
        unknown
      >;

    const publicId =
      parsePublicId(
        payload.publicId,
      );

    const reason =
      parseReason(
        payload.reason,
      );

    const result =
      await db.transaction(
        async (tx) => {
          const exchangeRows =
            await tx
              .select()
              .from(
                exchangeDocumentsTable,
              )
              .where(
                eq(
                  exchangeDocumentsTable.publicId,
                  publicId,
                ),
              )
              .for("update");

          const exchange =
            exchangeRows[0];

          if (!exchange) {
            throw new PosExchangeVoidError(
              "فاتورة التبديل غير موجودة",
              404,
            );
          }

          if (
            exchange.status ===
            "voided"
          ) {
            return {
              exchange,
              alreadyVoided: true,
              expectedCashBeforeMinor:
                null as number | null,
              expectedCashAfterMinor:
                null as number | null,
            };
          }

          if (
            exchange.status !==
            "completed"
          ) {
            throw new PosExchangeVoidError(
              "لا يمكن إلغاء فاتورة التبديل",
              409,
            );
          }

          if (
            exchange.sourceType !==
              "pos_sale" &&
            exchange.sourceType !==
              "pos_no_receipt"
          ) {
            throw new PosExchangeVoidError(
              "نوع فاتورة التبديل غير مدعوم في نقطة البيع",
              409,
            );
          }

          if (
            exchange.settlementType !==
              "cash" &&
            exchange.settlementType !==
              "card" &&
            exchange.settlementType !==
              "customer"
          ) {
            throw new PosExchangeVoidError(
              "طريقة تسوية فاتورة التبديل غير مدعومة",
              409,
            );
          }

          if (
            exchange.cashSessionId ===
            null
          ) {
            throw new PosExchangeVoidError(
              "فاتورة التبديل غير مرتبطة بصندوق",
              409,
            );
          }

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

          const saleItems =
            await tx
              .select()
              .from(
                exchangeSaleItemsTable,
              )
              .where(
                eq(
                  exchangeSaleItemsTable.exchangeId,
                  exchange.id,
                ),
              )
              .orderBy(
                asc(
                  exchangeSaleItemsTable.lineNumber,
                ),
              );

          const sessionRows =
            await tx
              .select()
              .from(
                cashSessionsTable,
              )
              .where(
                and(
                  eq(
                    cashSessionsTable.id,
                    exchange.cashSessionId,
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
            throw new PosExchangeVoidError(
              "لا يمكن إلغاء فاتورة التبديل بعد إغلاق يوم الصندوق",
              409,
            );
          }

          const expectedCashBeforeMinor =
            session.expectedBalanceMinor ??
            session.openingBalanceMinor;

          const expectedCashAfterMinor =
            exchange.settlementType ===
            "cash"
              ? expectedCashBeforeMinor -
                exchange.settlementAmountMinor
              : expectedCashBeforeMinor;

          if (
            !Number.isSafeInteger(
              expectedCashAfterMinor,
            ) ||
            expectedCashAfterMinor <
              0 ||
            expectedCashAfterMinor >
              MAX_DB_INT
          ) {
            throw new PosExchangeVoidError(
              exchange.settlementType ===
                  "cash" &&
                exchange.settlementAmountMinor >
                  0
                ? "رصيد الصندوق لا يكفي لإلغاء فاتورة التبديل"
                : "تعذر تحديث رصيد الصندوق عند إلغاء فاتورة التبديل",
              409,
            );
          }

          const returnItemIds =
            returnItems.map(
              (item) => item.id,
            );

          const saleItemIds =
            saleItems.map(
              (item) => item.id,
            );

          const returnCostRows =
            returnItemIds.length > 0
              ? await tx
                  .select()
                  .from(
                    exchangeReturnItemCostsTable,
                  )
                  .where(
                    inArray(
                      exchangeReturnItemCostsTable.returnItemId,
                      returnItemIds,
                    ),
                  )
              : [];

          const saleCostRows =
            saleItemIds.length > 0
              ? await tx
                  .select()
                  .from(
                    exchangeSaleItemCostsTable,
                  )
                  .where(
                    inArray(
                      exchangeSaleItemCostsTable.saleItemId,
                      saleItemIds,
                    ),
                  )
              : [];

          const returnCostByItemId =
            new Map(
              returnCostRows.map(
                (cost) => [
                  cost.returnItemId,
                  cost,
                ],
              ),
            );

          const saleCostByItemId =
            new Map(
              saleCostRows.map(
                (cost) => [
                  cost.saleItemId,
                  cost,
                ],
              ),
            );

          const productIds =
            Array.from(
              new Set(
                [
                  ...saleItems.map(
                    (item) =>
                      item.productId,
                  ),
                  ...returnItems.map(
                    (item) =>
                      item.productId,
                  ),
                ].filter(
                  (
                    value,
                  ): value is number =>
                    value !== null,
                ),
              ),
            ).sort(
              (left, right) =>
                left - right,
            );

          if (
            returnItems.some(
              (item) =>
                item.productId ===
                null,
            )
          ) {
            const missing =
              returnItems.find(
                (item) =>
                  item.productId ===
                  null,
              );

            throw new PosExchangeVoidError(
              `المنتج ${missing?.productNameAr ?? ""} لم يعد موجودًا ولا يمكن إلغاء التبديل`,
              409,
            );
          }

          const productRows =
            productIds.length > 0
              ? await tx
                  .select()
                  .from(
                    productsTable,
                  )
                  .where(
                    inArray(
                      productsTable.id,
                      productIds,
                    ),
                  )
                  .orderBy(
                    asc(
                      productsTable.id,
                    ),
                  )
                  .for("update")
              : [];

          const productById =
            new Map(
              productRows.map(
                (product) => [
                  product.id,
                  product,
                ],
              ),
            );

          for (
            const productId of
            productIds
          ) {
            if (
              !productById.has(
                productId,
              )
            ) {
              const item =
                (
                  [
                    ...saleItems,
                    ...returnItems,
                  ] as StockItem[]
                ).find(
                  (entry) =>
                    entry.productId ===
                    productId,
                );

              throw new PosExchangeVoidError(
                `المنتج ${item?.productNameAr ?? productId} لم يعد موجودًا`,
                409,
              );
            }
          }

          const stockStates =
            new Map<
              number,
              ProductStockState
            >();

          for (
            const product of
            productRows
          ) {
            stockStates.set(
              product.id,
              {
                generalStock:
                  product.stock ??
                  null,

                colorVariants:
                  (
                    product.colorVariants as
                      | ColorVariant[]
                      | null
                  ) ?? [],

                touchGeneral:
                  false,

                touchVariants:
                  false,
              },
            );
          }

          const movements:
            StockMovementDraft[] = [];

          const voidedAt =
            new Date();

          function applyStockDelta(
            item: StockItem,
            delta: number,
            movementType: string,
            phase:
              | "sale"
              | "return",
          ) {
            if (
              item.productId ===
              null
            ) {
              throw new PosExchangeVoidError(
                `المنتج ${item.productNameAr} لم يعد موجودًا`,
                409,
              );
            }

            const state =
              stockStates.get(
                item.productId,
              );

            if (!state) {
              throw new PosExchangeVoidError(
                `المنتج ${item.productNameAr} لم يعد موجودًا`,
                409,
              );
            }

            const touchesGeneral =
              item.generalStockBefore !==
                null ||
              item.generalStockAfter !==
                null;

            const touchesVariant =
              item.variantStockBefore !==
                null ||
              item.variantStockAfter !==
                null;

            if (
              (
                item.generalStockBefore ===
                null
              ) !==
              (
                item.generalStockAfter ===
                null
              )
            ) {
              throw new PosExchangeVoidError(
                `بيانات مخزون الصنف ${item.productNameAr} غير متطابقة`,
                409,
              );
            }

            if (
              (
                item.variantStockBefore ===
                null
              ) !==
              (
                item.variantStockAfter ===
                null
              )
            ) {
              throw new PosExchangeVoidError(
                `بيانات مخزون الصنف ${item.productNameAr} غير متطابقة`,
                409,
              );
            }

            let generalStockBefore:
              | number
              | null = null;

            let generalStockAfter:
              | number
              | null = null;

            let variantStockBefore:
              | number
              | null = null;

            let variantStockAfter:
              | number
              | null = null;

            if (touchesGeneral) {
              if (
                state.generalStock ===
                null
              ) {
                throw new PosExchangeVoidError(
                  `المخزون العام للصنف ${item.productNameAr} لم يعد مطابقًا للفاتورة`,
                  409,
                );
              }

              generalStockBefore =
                state.generalStock;

              const nextStock =
                state.generalStock +
                delta;

              if (
                !Number.isSafeInteger(
                  nextStock,
                ) ||
                nextStock < 0 ||
                nextStock >
                  MAX_STOCK
              ) {
                throw new PosExchangeVoidError(
                  delta < 0
                    ? `المخزون الحالي للصنف ${item.productNameAr} لا يكفي لإلغاء التبديل`
                    : `تعذر إعادة الصنف ${item.productNameAr} إلى المخزون`,
                  409,
                );
              }

              state.generalStock =
                nextStock;

              state.touchGeneral =
                true;

              generalStockAfter =
                nextStock;
            }

            if (touchesVariant) {
              if (!item.color) {
                throw new PosExchangeVoidError(
                  `لون ${item.productNameAr} غير محفوظ في فاتورة التبديل`,
                  409,
                );
              }

              const variantIndex =
                state.colorVariants
                  .findIndex(
                    (entry) =>
                      entry.color ===
                      item.color,
                  );

              if (
                variantIndex < 0
              ) {
                throw new PosExchangeVoidError(
                  `لون ${item.productNameAr} لم يعد موجودًا`,
                  409,
                );
              }

              const variant =
                state.colorVariants[
                  variantIndex
                ];

              if (!variant) {
                throw new PosExchangeVoidError(
                  `لون ${item.productNameAr} لم يعد موجودًا`,
                  409,
                );
              }

              const sizes =
                Array.isArray(
                  variant.sizes,
                )
                  ? variant.sizes
                  : [];

              if (!item.size) {
                throw new PosExchangeVoidError(
                  `مقاس ${item.productNameAr} غير محفوظ في فاتورة التبديل`,
                  409,
                );
              }

              const sizeIndex =
                sizes.findIndex(
                  (entry) =>
                    entry.size ===
                    item.size,
                );

              if (
                sizeIndex < 0
              ) {
                throw new PosExchangeVoidError(
                  `مقاس ${item.productNameAr} لم يعد موجودًا`,
                  409,
                );
              }

              const selectedSize =
                sizes[sizeIndex];

              if (
                !selectedSize ||
                selectedSize.stock ===
                  null ||
                selectedSize.stock ===
                  undefined
              ) {
                throw new PosExchangeVoidError(
                  `مخزون ${item.productNameAr} / ${item.color} / ${item.size} لم يعد مطابقًا للفاتورة`,
                  409,
                );
              }

              variantStockBefore =
                selectedSize.stock;

              const nextVariantStock =
                selectedSize.stock +
                delta;

              if (
                !Number.isSafeInteger(
                  nextVariantStock,
                ) ||
                nextVariantStock <
                  0 ||
                nextVariantStock >
                  MAX_STOCK
              ) {
                throw new PosExchangeVoidError(
                  delta < 0
                    ? `مخزون ${item.productNameAr} / ${item.color} / ${item.size} لا يكفي لإلغاء التبديل`
                    : `تعذر إعادة ${item.productNameAr} / ${item.color} / ${item.size} إلى المخزون`,
                  409,
                );
              }

              variantStockAfter =
                nextVariantStock;

              const nextSizes =
                sizes.map(
                  (
                    entry,
                    index,
                  ) =>
                    index ===
                    sizeIndex
                      ? {
                          ...entry,
                          stock:
                            nextVariantStock,
                          outOfStock:
                            nextVariantStock <=
                            0,
                        }
                      : entry,
                );

              state.colorVariants =
                state.colorVariants.map(
                  (
                    entry,
                    index,
                  ) =>
                    index ===
                    variantIndex
                      ? {
                          ...entry,
                          sizes:
                            nextSizes,
                        }
                      : entry,
                );

              state.touchVariants =
                true;
            }

            movements.push({
              productId:
                item.productId,

              barcode:
                item.barcode,

              productCode:
                item.productCode,

              productNameAr:
                item.productNameAr,

              color:
                item.color,

              size:
                item.size,

              movementType,

              quantityDelta:
                delta,

              generalStockBefore,
              generalStockAfter,

              variantStockBefore,
              variantStockAfter,

              sourceType:
                "exchange",

              sourceId:
                exchange.id,

              sourceItemId:
                item.id,

              sourcePublicId:
                exchange.publicId,

              eventKey:
                `exchange:${exchange.id}:${phase}:${item.id}:voided`,

              occurredAt:
                voidedAt,
            });
          }

          /*
           * Reverse physical inventory in exact inverse order:
           * 1) undo new-item sales (+ stock)
           * 2) undo returned items (- stock)
           */
          const orderedSaleItems =
            [...saleItems].sort(
              (left, right) =>
                left.productId -
                  right.productId ||
                right.lineNumber -
                  left.lineNumber,
            );

          for (
            const item of
            orderedSaleItems
          ) {
            applyStockDelta(
              item,
              item.quantity,
              "exchange_sale_void",
              "sale",
            );
          }

          const orderedReturnItems =
            [...returnItems].sort(
              (left, right) =>
                (
                  left.productId ??
                  Number.MAX_SAFE_INTEGER
                ) -
                  (
                    right.productId ??
                    Number.MAX_SAFE_INTEGER
                  ) ||
                right.lineNumber -
                  left.lineNumber,
            );

          for (
            const item of
            orderedReturnItems
          ) {
            applyStockDelta(
              item,
              -item.quantity,
              "exchange_return_void",
              "return",
            );
          }

          for (
            const [
              productId,
              state,
            ] of
            [...stockStates.entries()]
              .sort(
                (
                  [leftId],
                  [rightId],
                ) =>
                  leftId -
                  rightId,
              )
          ) {
            const updates: {
              stock?: number;
              colorVariants?: ColorVariant[];
            } = {};

            if (
              state.touchGeneral
            ) {
              if (
                state.generalStock ===
                null
              ) {
                throw new Error(
                  `POS_EXCHANGE_VOID_GENERAL_STOCK_STATE_MISSING:${productId}`,
                );
              }

              updates.stock =
                state.generalStock;
            }

            if (
              state.touchVariants
            ) {
              updates.colorVariants =
                state.colorVariants;
            }

            if (
              Object.keys(
                updates,
              ).length > 0
            ) {
              await tx
                .update(
                  productsTable,
                )
                .set(updates)
                .where(
                  eq(
                    productsTable.id,
                    productId,
                  ),
                );
            }
          }

          if (
            movements.length > 0
          ) {
            await tx
              .insert(
                inventoryMovementsTable,
              )
              .values(
                movements,
              );
          }

          /*
           * Lock all initialized cost states in deterministic
           * product order before reversing cost movements.
           */
          const costStateRows =
            productIds.length > 0
              ? await tx
                  .select({
                    productId:
                      productCostStateTable.productId,
                  })
                  .from(
                    productCostStateTable,
                  )
                  .where(
                    inArray(
                      productCostStateTable.productId,
                      productIds,
                    ),
                  )
                  .orderBy(
                    asc(
                      productCostStateTable.productId,
                    ),
                  )
                  .for("update")
              : [];

          const initializedCostProducts =
            new Set(
              costStateRows.map(
                (row) =>
                  row.productId,
              ),
            );

          /*
           * Reverse cost in inverse creation order:
           * 1) restore exact cost of the new sale items
           * 2) consume exact cost that was restored by returns
           */
          for (
            const item of
            orderedSaleItems
          ) {
            const cost =
              saleCostByItemId.get(
                item.id,
              );

            if (!cost) {
              if (
                initializedCostProducts.has(
                  item.productId,
                )
              ) {
                throw new PosExchangeVoidError(
                  `لا يمكن إلغاء التبديل للصنف ${item.productNameAr} لعدم وجود تكلفة البيع المحفوظة`,
                  409,
                );
              }

              console.warn(
                "POS_EXCHANGE_VOID_SALE_COST_UNTRACKED",
                {
                  exchangeId:
                    exchange.id,
                  saleItemId:
                    item.id,
                  productId:
                    item.productId,
                },
              );

              continue;
            }

            if (
              cost.productId !==
                item.productId ||
              cost.quantity !==
                item.quantity
            ) {
              throw new PosExchangeVoidError(
                `بيانات تكلفة الصنف ${item.productNameAr} لا تطابق فاتورة التبديل`,
                409,
              );
            }

            const restored =
              await restoreExactProductCost(
                tx,
                {
                  productId:
                    item.productId,

                  quantity:
                    item.quantity,

                  costTotalMinor:
                    cost.costTotalMinor,

                  costQuality:
                    requireCostQuality(
                      cost.costQuality,
                    ),

                  eventType:
                    "exchange_sale_void",

                  sourceType:
                    "exchange",

                  sourceRef:
                    String(
                      exchange.id,
                    ),

                  sourceItemRef:
                    String(
                      item.id,
                    ),

                  businessDate:
                    exchange.businessDate,

                  note:
                    `Exchange sale void ${exchange.publicId}`,

                  createdByUserId:
                    user.id,
                },
              );

            if (
              !restored.tracked
            ) {
              throw new PosExchangeVoidError(
                `تعذر عكس تكلفة الصنف ${item.productNameAr}: ${restored.reason}`,
                409,
              );
            }
          }

          for (
            const item of
            orderedReturnItems
          ) {
            if (
              item.productId ===
              null
            ) {
              throw new PosExchangeVoidError(
                `المنتج ${item.productNameAr} لم يعد موجودًا`,
                409,
              );
            }

            const cost =
              returnCostByItemId.get(
                item.id,
              );

            if (!cost) {
              if (
                initializedCostProducts.has(
                  item.productId,
                )
              ) {
                throw new PosExchangeVoidError(
                  `لا يمكن إلغاء التبديل للصنف ${item.productNameAr} لعدم وجود تكلفة المرتجع المحفوظة`,
                  409,
                );
              }

              console.warn(
                "POS_EXCHANGE_VOID_RETURN_COST_UNTRACKED",
                {
                  exchangeId:
                    exchange.id,
                  returnItemId:
                    item.id,
                  productId:
                    item.productId,
                },
              );

              continue;
            }

            if (
              cost.productId !==
                item.productId ||
              cost.quantity !==
                item.quantity
            ) {
              throw new PosExchangeVoidError(
                `بيانات تكلفة المرتجع ${item.productNameAr} لا تطابق فاتورة التبديل`,
                409,
              );
            }

            const consumed =
              await consumeExactProductCost(
                tx,
                {
                  productId:
                    item.productId,

                  quantity:
                    item.quantity,

                  costTotalMinor:
                    cost.costTotalMinor,

                  eventType:
                    "exchange_return_void",

                  sourceType:
                    "exchange",

                  sourceRef:
                    String(
                      exchange.id,
                    ),

                  sourceItemRef:
                    String(
                      item.id,
                    ),

                  businessDate:
                    exchange.businessDate,

                  note:
                    `Exchange return void ${exchange.publicId}`,

                  createdByUserId:
                    user.id,
                },
              );

            if (
              !consumed.tracked
            ) {
              throw new PosExchangeVoidError(
                `تعذر عكس تكلفة المرتجع ${item.productNameAr}: ${consumed.reason}`,
                409,
              );
            }
          }

          if (
            exchange.settlementType ===
              "customer" &&
            exchange.settlementAmountMinor !==
              0
          ) {
            const financeRows =
              await tx
                .select()
                .from(
                  financeTransactionsTable,
                )
                .where(
                  and(
                    eq(
                      financeTransactionsTable
                        .sourceType,
                      "exchange",
                    ),
                    eq(
                      financeTransactionsTable
                        .sourceId,
                      String(
                        exchange.id,
                      ),
                    ),
                    eq(
                      financeTransactionsTable
                        .sourceEvent,
                      "customer_settlement",
                    ),
                    eq(
                      financeTransactionsTable
                        .status,
                      "posted",
                    ),
                  ),
                )
                .limit(1)
                .for("update");

            const originalFinance =
              financeRows[0];

            if (!originalFinance) {
              throw new PosExchangeVoidError(
                "تعذر العثور على قيد حساب الزبون لفاتورة التبديل",
                409,
              );
            }

            const originalLines =
              await tx
                .select()
                .from(
                  financeTransactionLinesTable,
                )
                .where(
                  eq(
                    financeTransactionLinesTable
                      .transactionId,
                    originalFinance.id,
                  ),
                )
                .orderBy(
                  asc(
                    financeTransactionLinesTable
                      .lineNumber,
                  ),
                );

            if (
              originalLines.length <
              2
            ) {
              throw new Error(
                "POS_EXCHANGE_CUSTOMER_FINANCE_LINES_MISSING",
              );
            }

            const reversalRows =
              await tx
                .insert(
                  financeTransactionsTable,
                )
                .values({
                  publicId:
                    `FIN-EXC-VOID-${exchange.publicId}`,
                  idempotencyKey:
                    `pos-exchange:${exchange.id}:customer-settlement:void`,
                  businessDate:
                    exchange.businessDate,
                  transactionType:
                    "reversal",
                  sourceType:
                    "exchange",
                  sourceId:
                    String(
                      exchange.id,
                    ),
                  sourceEvent:
                    "customer_settlement_void",
                  cashSessionId:
                    exchange.cashSessionId,
                  status:
                    "posted",
                  notes:
                    `عكس حركة حساب الزبون لفاتورة التبديل ${exchange.publicId}`,
                  createdByUserId:
                    user.id,
                })
                .returning();

            const reversal =
              reversalRows[0];

            if (!reversal) {
              throw new Error(
                "POS_EXCHANGE_CUSTOMER_REVERSAL_FAILED",
              );
            }

            await tx
              .insert(
                financeTransactionLinesTable,
              )
              .values(
                originalLines.map(
                  (
                    line,
                    index,
                  ) => ({
                    transactionId:
                      reversal.id,
                    lineNumber:
                      index + 1,
                    accountId:
                      line.accountId,
                    debitMinor:
                      line.creditMinor,
                    creditMinor:
                      line.debitMinor,
                    memo:
                      `عكس ${exchange.publicId}`,
                  }),
                ),
              );

            await tx
              .update(
                financeTransactionsTable,
              )
              .set({
                status:
                  "reversed",
                updatedAt:
                  voidedAt,
              })
              .where(
                eq(
                  financeTransactionsTable.id,
                  originalFinance.id,
                ),
              );
          }

          if (
            exchange.settlementType ===
            "cash"
          ) {
            const updatedSessionRows =
              await tx
                .update(
                  cashSessionsTable,
                )
                .set({
                  expectedBalanceMinor:
                    expectedCashAfterMinor,

                  updatedAt:
                    voidedAt,
                })
                .where(
                  and(
                    eq(
                      cashSessionsTable.id,
                      session.id,
                    ),
                    eq(
                      cashSessionsTable.status,
                      "open",
                    ),
                  ),
                )
                .returning({
                  id:
                    cashSessionsTable.id,
                });

            if (
              !updatedSessionRows[0]
            ) {
              throw new PosExchangeVoidError(
                "تم إغلاق الصندوق قبل إلغاء فاتورة التبديل",
                409,
              );
            }
          }

          const updatedRows =
            await tx
              .update(
                exchangeDocumentsTable,
              )
              .set({
                status:
                  "voided",

                voidedAt,

                voidedByUserId:
                  user.id,

                voidReason:
                  reason,

                updatedAt:
                  voidedAt,
              })
              .where(
                and(
                  eq(
                    exchangeDocumentsTable.id,
                    exchange.id,
                  ),
                  eq(
                    exchangeDocumentsTable.status,
                    "completed",
                  ),
                ),
              )
              .returning();

          const updatedExchange =
            updatedRows[0];

          if (!updatedExchange) {
            throw new PosExchangeVoidError(
              "تم تغيير حالة فاتورة التبديل قبل اكتمال الإلغاء",
              409,
            );
          }

          return {
            exchange:
              updatedExchange,

            alreadyVoided:
              false,

            expectedCashBeforeMinor,
            expectedCashAfterMinor,
          };
        },
      );

    return json({
      ok: true,

      alreadyVoided:
        result.alreadyVoided,

      exchange: {
        id:
          result.exchange.id,

        publicId:
          result.exchange.publicId,

        status:
          result.exchange.status,

        sourceType:
          result.exchange.sourceType,

        settlementType:
          result.exchange.settlementType,

        settlementAmountMinor:
          result.exchange.settlementAmountMinor,

        businessDate:
          result.exchange.businessDate,

        voidedAt:
          result.exchange
            .voidedAt
            ?.toISOString() ??
          null,

        voidReason:
          result.exchange
            .voidReason,

        createdAt:
          result.exchange
            .createdAt
            .toISOString(),

        expectedCashBeforeMinor:
          result.expectedCashBeforeMinor,

        expectedCashAfterMinor:
          result.expectedCashAfterMinor,
      },
    });
  } catch (caught) {
    if (
      caught instanceof
      PosExchangeVoidError
    ) {
      return json(
        {
          error:
            caught.message,
        },
        caught.status,
      );
    }

    console.error(
      "POS_EXCHANGE_VOID_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر إلغاء فاتورة التبديل",
      },
      500,
    );
  }
}
