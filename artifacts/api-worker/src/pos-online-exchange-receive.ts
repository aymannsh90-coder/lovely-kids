import {
  exchangeDocumentsTable,
  exchangeReturnItemCostsTable,
  exchangeReturnItemsTable,
  inventoryMovementsTable,
  orderItemCostsTable,
  productsTable,
  type ColorVariant,
} from "@workspace/db/schema";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
} from "drizzle-orm";

import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import {
  addProductCostAtCurrentAverage,
  restoreExactProductCost,
  type CostQuality,
} from "./inventory-cost-engine";

type Db =
  Awaited<
    ReturnType<typeof openDb>
  >["db"];

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

class OnlineExchangeReceiveError
  extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function parsePublicId(
  value: unknown,
): string {
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
    throw new OnlineExchangeReceiveError(
      "رقم عملية التبديل غير صالح",
    );
  }

  return publicId;
}

function getBusinessDate(): string {
  try {
    const parts =
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone:
            "Asia/Jerusalem",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        },
      ).formatToParts(
        new Date(),
      );

    const values =
      Object.fromEntries(
        parts.map(
          (part) => [
            part.type,
            part.value,
          ],
        ),
      );

    return (
      `${values.year}-` +
      `${values.month}-` +
      `${values.day}`
    );
  } catch {
    return new Date()
      .toISOString()
      .slice(0, 10);
  }
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

  throw new OnlineExchangeReceiveError(
    "بيانات تكلفة الطلب القديم غير صالحة",
    409,
  );
}

function allocateCumulativeCostMinor(
  totalCostMinor: number,
  cumulativeQuantity: number,
  totalQuantity: number,
): number {
  if (
    !Number.isSafeInteger(
      totalCostMinor,
    ) ||
    totalCostMinor < 0 ||
    !Number.isSafeInteger(
      cumulativeQuantity,
    ) ||
    cumulativeQuantity < 0 ||
    !Number.isSafeInteger(
      totalQuantity,
    ) ||
    totalQuantity <= 0 ||
    cumulativeQuantity >
      totalQuantity
  ) {
    throw new OnlineExchangeReceiveError(
      "تعذر احتساب تكلفة المرتجع",
      409,
    );
  }

  if (
    cumulativeQuantity ===
    totalQuantity
  ) {
    return totalCostMinor;
  }

  return Number(
    (
      BigInt(totalCostMinor) *
      BigInt(cumulativeQuantity)
    ) /
      BigInt(totalQuantity),
  );
}

function cloneColorVariants(
  value: unknown,
): ColorVariant[] {
  const variants =
    (
      value as
        | ColorVariant[]
        | null
        | undefined
    ) ?? [];

  return variants.map(
    (variant) => ({
      ...variant,
      sizes:
        Array.isArray(
          variant.sizes,
        )
          ? variant.sizes.map(
              (size) => ({
                ...size,
              }),
            )
          : [],
    }),
  );
}

type ProductState = {
  row:
    typeof productsTable.$inferSelect;

  stock:
    number | null;

  colorVariants:
    ColorVariant[];

  changed:
    boolean;
};

type StockSnapshot = {
  generalStockBefore:
    number | null;

  generalStockAfter:
    number | null;

  variantStockBefore:
    number | null;

  variantStockAfter:
    number | null;
};

function restorePhysicalStock(
  state: ProductState,
  item: {
    productNameAr: string;
    color: string | null;
    size: string | null;
    quantity: number;
  },
): StockSnapshot {
  const quantity =
    item.quantity;

  if (
    !Number.isSafeInteger(
      quantity,
    ) ||
    quantity <= 0
  ) {
    throw new OnlineExchangeReceiveError(
      `كمية ${item.productNameAr} غير صالحة`,
      409,
    );
  }

  let generalStockBefore:
    number | null = null;

  let generalStockAfter:
    number | null = null;

  let variantStockBefore:
    number | null = null;

  let variantStockAfter:
    number | null = null;

  if (state.stock !== null) {
    generalStockBefore =
      state.stock;

    const next =
      state.stock +
      quantity;

    if (
      !Number.isSafeInteger(
        next,
      ) ||
      next < 0 ||
      next > MAX_STOCK
    ) {
      throw new OnlineExchangeReceiveError(
        `تعذر إعادة ${item.productNameAr} إلى المخزون`,
        409,
      );
    }

    state.stock =
      next;

    generalStockAfter =
      next;

    state.changed =
      true;
  }

  if (
    item.color &&
    item.size &&
    state.colorVariants.length >
      0
  ) {
    const variantIndex =
      state.colorVariants.findIndex(
        (variant) =>
          variant.color ===
          item.color,
      );

    if (
      variantIndex < 0
    ) {
      throw new OnlineExchangeReceiveError(
        `لون ${item.productNameAr} لم يعد موجودًا`,
        409,
      );
    }

    const variant =
      state.colorVariants[
        variantIndex
      ];

    const sizes =
      Array.isArray(
        variant.sizes,
      )
        ? variant.sizes
        : [];

    const sizeIndex =
      sizes.findIndex(
        (size) =>
          size.size ===
          item.size,
      );

    if (
      sizeIndex < 0
    ) {
      throw new OnlineExchangeReceiveError(
        `مقاس ${item.productNameAr} لم يعد موجودًا`,
        409,
      );
    }

    const selected =
      sizes[sizeIndex];

    if (
      selected.stock !== null &&
      selected.stock !==
        undefined
    ) {
      variantStockBefore =
        selected.stock;

      const next =
        selected.stock +
        quantity;

      if (
        !Number.isSafeInteger(
          next,
        ) ||
        next < 0 ||
        next > MAX_STOCK
      ) {
        throw new OnlineExchangeReceiveError(
          `تعذر إعادة ${item.productNameAr} إلى مخزون المقاس`,
          409,
        );
      }

      const nextSizes =
        sizes.map(
          (size, index) =>
            index ===
            sizeIndex
              ? {
                  ...size,
                  stock: next,
                  outOfStock:
                    false,
                }
              : size,
        );

      state.colorVariants =
        state.colorVariants.map(
          (
            colorVariant,
            index,
          ) =>
            index ===
            variantIndex
              ? {
                  ...colorVariant,
                  sizes:
                    nextSizes,
                }
              : colorVariant,
        );

      variantStockAfter =
        next;

      state.changed =
        true;
    }
  }

  return {
    generalStockBefore,
    generalStockAfter,
    variantStockBefore,
    variantStockAfter,
  };
}

export async function handleReceiveOnlineExchangeReturn(
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

  let publicId: string;

  try {
    const body =
      await request
        .json()
        .catch(
          () => null,
        );

    if (
      !body ||
      typeof body !==
        "object" ||
      Array.isArray(body)
    ) {
      throw new OnlineExchangeReceiveError(
        "بيانات استلام الطرد غير صالحة",
      );
    }

    publicId =
      parsePublicId(
        (
          body as
            Record<
              string,
              unknown
            >
        ).publicId,
      );
  } catch (error) {
    if (
      error instanceof
      OnlineExchangeReceiveError
    ) {
      return json(
        {
          error:
            error.message,
        },
        error.status,
      );
    }

    throw error;
  }

  try {
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
            throw new OnlineExchangeReceiveError(
              "عملية التبديل غير موجودة",
              404,
            );
          }

          if (
            exchange.sourceType !==
            "online_order"
          ) {
            throw new OnlineExchangeReceiveError(
              "هذه العملية ليست تبديل طلب أونلاين",
              409,
            );
          }

          if (
            exchange.status !==
            "completed"
          ) {
            throw new OnlineExchangeReceiveError(
              "لا يمكن استلام مرتجع عملية ملغاة",
              409,
            );
          }

          if (
            exchange.financialCompletedAt ===
              null ||
            exchange.financialBusinessDate ===
              null ||
            exchange.financialCompletedByUserId ===
              null
          ) {
            throw new OnlineExchangeReceiveError(
              "يجب تسليم الطلب البديل وتسجيله محاسبيًا قبل استلام الطرد القديم",
              409,
            );
          }

          if (
            exchange.returnReceivedAt !==
            null
          ) {
            return {
              alreadyReceived:
                true,

              exchange: {
                publicId:
                  exchange.publicId,

                returnReceivedAt:
                  exchange.returnReceivedAt.toISOString(),

                returnReceivedByUserId:
                  exchange.returnReceivedByUserId,
              },
            };
          }

          if (
            exchange.originalOrderId ===
            null
          ) {
            throw new OnlineExchangeReceiveError(
              "عملية التبديل غير مرتبطة بالطلب القديم",
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

          if (
            returnItems.length ===
            0
          ) {
            throw new OnlineExchangeReceiveError(
              "عملية التبديل لا تحتوي على أصناف مرتجعة",
              409,
            );
          }

          if (
            returnItems.some(
              (item) =>
                item.productId ===
                  null ||
                item.originalOrderLineNumber ===
                  null,
            )
          ) {
            throw new OnlineExchangeReceiveError(
              "بيانات أصناف المرتجع غير مكتملة",
              409,
            );
          }

          const productIds =
            [
              ...new Set(
                returnItems.map(
                  (item) =>
                    item.productId as number,
                ),
              ),
            ].sort(
              (left, right) =>
                left - right,
            );

          const productRows =
            await tx
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
              .for("update");

          if (
            productRows.length !==
            productIds.length
          ) {
            throw new OnlineExchangeReceiveError(
              "أحد المنتجات المرتجعة لم يعد موجودًا",
              409,
            );
          }

          const productStates =
            new Map<
              number,
              ProductState
            >(
              productRows.map(
                (product) => [
                  product.id,
                  {
                    row:
                      product,

                    stock:
                      product.stock ??
                      null,

                    colorVariants:
                      cloneColorVariants(
                        product.colorVariants,
                      ),

                    changed:
                      false,
                  },
                ],
              ),
            );

          const originalCosts =
            await tx
              .select()
              .from(
                orderItemCostsTable,
              )
              .where(
                eq(
                  orderItemCostsTable.orderId,
                  exchange.originalOrderId,
                ),
              )
              .orderBy(
                asc(
                  orderItemCostsTable.lineNumber,
                ),
              );

          const originalCostByLine =
            new Map(
              originalCosts.map(
                (cost) => [
                  cost.lineNumber,
                  cost,
                ],
              ),
            );

          // Only physically received previous exchanges
          // count toward cumulative cost restoration.
          const priorReceivedDocs =
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
                    exchange.originalOrderId,
                  ),
                  eq(
                    exchangeDocumentsTable.status,
                    "completed",
                  ),
                  isNotNull(
                    exchangeDocumentsTable.returnReceivedAt,
                  ),
                ),
              );

          const priorReceivedIds =
            priorReceivedDocs.map(
              (row) =>
                row.id,
            );

          const priorReceivedItems =
            priorReceivedIds.length ===
              0
              ? []
              : await tx
                  .select()
                  .from(
                    exchangeReturnItemsTable,
                  )
                  .where(
                    inArray(
                      exchangeReturnItemsTable.exchangeId,
                      priorReceivedIds,
                    ),
                  );

          const priorReceivedByLine =
            new Map<
              number,
              number
            >();

          for (
            const item of
            priorReceivedItems
          ) {
            if (
              item.originalOrderLineNumber ===
              null
            ) {
              continue;
            }

            const current =
              priorReceivedByLine.get(
                item.originalOrderLineNumber,
              ) ?? 0;

            const next =
              current +
              item.quantity;

            if (
              !Number.isSafeInteger(
                next,
              ) ||
              next < 0
            ) {
              throw new OnlineExchangeReceiveError(
                "بيانات المرتجعات المستلمة سابقًا غير صالحة",
                409,
              );
            }

            priorReceivedByLine.set(
              item.originalOrderLineNumber,
              next,
            );
          }

          const receivedAt =
            new Date();

          const businessDate =
            getBusinessDate();

          const movementRows:
            Array<
              typeof inventoryMovementsTable.$inferInsert
            > = [];

          for (
            const returnItem of
            returnItems
          ) {
            const productId =
              returnItem.productId as number;

            const lineNumber =
              returnItem.originalOrderLineNumber as number;

            const state =
              productStates.get(
                productId,
              );

            if (!state) {
              throw new OnlineExchangeReceiveError(
                `المنتج ${returnItem.productNameAr} غير موجود`,
                409,
              );
            }

            const snapshot =
              restorePhysicalStock(
                state,
                {
                  productNameAr:
                    returnItem.productNameAr,

                  color:
                    returnItem.color,

                  size:
                    returnItem.size,

                  quantity:
                    returnItem.quantity,
                },
              );

            await tx
              .update(
                exchangeReturnItemsTable,
              )
              .set({
                generalStockBefore:
                  snapshot.generalStockBefore,

                generalStockAfter:
                  snapshot.generalStockAfter,

                variantStockBefore:
                  snapshot.variantStockBefore,

                variantStockAfter:
                  snapshot.variantStockAfter,
              })
              .where(
                eq(
                  exchangeReturnItemsTable.id,
                  returnItem.id,
                ),
              );

            movementRows.push({
              productId,

              barcode:
                returnItem.barcode,

              productCode:
                returnItem.productCode,

              productNameAr:
                returnItem.productNameAr,

              color:
                returnItem.color,

              size:
                returnItem.size,

              movementType:
                "exchange_return",

              quantityDelta:
                returnItem.quantity,

              generalStockBefore:
                snapshot.generalStockBefore,

              generalStockAfter:
                snapshot.generalStockAfter,

              variantStockBefore:
                snapshot.variantStockBefore,

              variantStockAfter:
                snapshot.variantStockAfter,

              sourceType:
                "exchange",

              sourceId:
                exchange.id,

              sourceItemId:
                returnItem.id,

              sourcePublicId:
                exchange.publicId,

              eventKey:
                `exchange:${exchange.id}:return:${returnItem.id}:received`,

              occurredAt:
                receivedAt,
            });

            const originalCost =
              originalCostByLine.get(
                lineNumber,
              );

            if (!originalCost) {
              const estimated =
                await addProductCostAtCurrentAverage(
                  tx,
                  {
                    productId,

                    quantity:
                      returnItem.quantity,

                    addedCostQuality:
                      "estimated",

                    eventType:
                      "exchange_return",

                    sourceType:
                      "exchange",

                    sourceRef:
                      String(
                        exchange.id,
                      ),

                    sourceItemRef:
                      String(
                        returnItem.id,
                      ),

                    businessDate,

                    note:
                      `Online exchange return estimated cost ${exchange.publicId}`,

                    createdByUserId:
                      user.id,
                  },
                );

              if (
                estimated.tracked
              ) {
                await tx
                  .insert(
                    exchangeReturnItemCostsTable,
                  )
                  .values({
                    returnItemId:
                      returnItem.id,

                    productId,

                    quantity:
                      returnItem.quantity,

                    unitCostMinor:
                      estimated.unitCostMinor,

                    costTotalMinor:
                      estimated.costTotalMinor,

                    costQuality:
                      "estimated",
                  });
              } else {
                console.warn(
                  "ONLINE_EXCHANGE_RETURN_COST_UNTRACKED",
                  {
                    exchangeId:
                      exchange.id,

                    returnItemId:
                      returnItem.id,

                    productId,

                    reason:
                      estimated.reason,
                  },
                );
              }

              continue;
            }

            if (
              originalCost.productId !==
              productId
            ) {
              throw new OnlineExchangeReceiveError(
                `تكلفة السطر ${lineNumber} لا تطابق المنتج المرتجع`,
                409,
              );
            }

            if (
              !Number.isSafeInteger(
                originalCost.quantity,
              ) ||
              originalCost.quantity <= 0
            ) {
              throw new OnlineExchangeReceiveError(
                "كمية تكلفة الطلب القديم غير صالحة",
                409,
              );
            }

            const previouslyReceived =
              priorReceivedByLine.get(
                lineNumber,
              ) ?? 0;

            const receivedAfter =
              previouslyReceived +
              returnItem.quantity;

            if (
              !Number.isSafeInteger(
                receivedAfter,
              ) ||
              receivedAfter <= 0 ||
              receivedAfter >
                originalCost.quantity
            ) {
              throw new OnlineExchangeReceiveError(
                `كمية المرتجع المستلم من السطر ${lineNumber} أكبر من الكمية الأصلية`,
                409,
              );
            }

            const cumulativeAfter =
              allocateCumulativeCostMinor(
                originalCost.costTotalMinor,
                receivedAfter,
                originalCost.quantity,
              );

            const cumulativeBefore =
              previouslyReceived > 0
                ? allocateCumulativeCostMinor(
                    originalCost.costTotalMinor,
                    previouslyReceived,
                    originalCost.quantity,
                  )
                : 0;

            const returnCostTotalMinor =
              cumulativeAfter -
              cumulativeBefore;

            if (
              !Number.isSafeInteger(
                returnCostTotalMinor,
              ) ||
              returnCostTotalMinor <
                0
            ) {
              throw new OnlineExchangeReceiveError(
                "تعذر احتساب تكلفة الكمية المستلمة",
                409,
              );
            }

            const costQuality =
              requireCostQuality(
                originalCost.costQuality,
              );

            const restored =
              await restoreExactProductCost(
                tx,
                {
                  productId,

                  quantity:
                    returnItem.quantity,

                  costTotalMinor:
                    returnCostTotalMinor,

                  costQuality,

                  eventType:
                    "exchange_return",

                  sourceType:
                    "exchange",

                  sourceRef:
                    String(
                      exchange.id,
                    ),

                  sourceItemRef:
                    String(
                      returnItem.id,
                    ),

                  businessDate,

                  note:
                    `Online exchange return ${exchange.publicId}`,

                  createdByUserId:
                    user.id,
                },
              );

            if (
              !restored.tracked
            ) {
              throw new OnlineExchangeReceiveError(
                `تعذر إعادة تكلفة ${returnItem.productNameAr} للمخزون`,
                409,
              );
            }

            await tx
              .insert(
                exchangeReturnItemCostsTable,
              )
              .values({
                returnItemId:
                  returnItem.id,

                productId,

                quantity:
                  returnItem.quantity,

                unitCostMinor:
                  restored.unitCostMinor,

                costTotalMinor:
                  restored.costTotalMinor,

                costQuality,
              });

            priorReceivedByLine.set(
              lineNumber,
              receivedAfter,
            );
          }

          for (
            const state of
            [...productStates.values()]
              .sort(
                (left, right) =>
                  left.row.id -
                  right.row.id,
              )
          ) {
            if (
              !state.changed
            ) {
              continue;
            }

            await tx
              .update(
                productsTable,
              )
              .set({
                stock:
                  state.stock,

                colorVariants:
                  state.colorVariants,
              })
              .where(
                eq(
                  productsTable.id,
                  state.row.id,
                ),
              );
          }

          if (
            movementRows.length >
            0
          ) {
            await tx
              .insert(
                inventoryMovementsTable,
              )
              .values(
                movementRows,
              );
          }

          const updatedRows =
            await tx
              .update(
                exchangeDocumentsTable,
              )
              .set({
                returnReceivedAt:
                  receivedAt,

                returnReceivedByUserId:
                  user.id,

                updatedAt:
                  receivedAt,
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

          const updated =
            updatedRows[0];

          if (!updated) {
            throw new Error(
              "ONLINE_EXCHANGE_RETURN_RECEIVE_UPDATE_FAILED",
            );
          }

          return {
            alreadyReceived:
              false,

            exchange: {
              publicId:
                updated.publicId,

              originalOrderId:
                updated.originalOrderId ===
                null
                  ? null
                  : String(
                      updated.originalOrderId,
                    ),

              replacementOrderId:
                updated.replacementOrderId ===
                null
                  ? null
                  : String(
                      updated.replacementOrderId,
                    ),

              returnReceivedAt:
                updated.returnReceivedAt?.toISOString() ??
                null,

              returnReceivedByUserId:
                updated.returnReceivedByUserId,
            },

            items:
              returnItems.map(
                (item) => ({
                  id:
                    String(
                      item.id,
                    ),

                  productId:
                    item.productId ===
                    null
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
                }),
              ),
          };
        },
      );

    return json(result);
  } catch (error) {
    if (
      error instanceof
      OnlineExchangeReceiveError
    ) {
      return json(
        {
          error:
            error.message,
        },
        error.status,
      );
    }

    console.error(
      "ONLINE_EXCHANGE_RETURN_RECEIVE_FAILED",
      error,
    );

    return json(
      {
        error:
          "تعذر تسجيل استلام طرد التبديل",
      },
      500,
    );
  }
}
