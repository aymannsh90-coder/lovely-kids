import {
  financeTransactionLinesTable,
  financeTransactionsTable,
  cashSessionsTable,
  inventoryMovementsTable,
  posSaleReturnItemCostsTable,
  posSaleReturnItemsTable,
  posSaleReturnsTable,
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
} from "./inventory-cost-engine";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

const MAX_DB_INT = 2_147_483_647;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers,
  });

class PosSaleReturnVoidError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function parsePublicId(value: unknown) {
  const publicId =
    typeof value === "string"
      ? value.trim().toUpperCase()
      : "";

  if (
    !publicId ||
    publicId.length > 80 ||
    !/^[A-Z0-9_-]+$/.test(publicId)
  ) {
    throw new PosSaleReturnVoidError(
      "رقم المرتجع غير صالح",
    );
  }

  return publicId;
}

function parseReason(value: unknown) {
  const reason =
    typeof value === "string"
      ? value.trim()
      : "";

  if (!reason) {
    throw new PosSaleReturnVoidError(
      "يجب إدخال سبب إلغاء المرتجع",
    );
  }

  if (reason.length > 500) {
    throw new PosSaleReturnVoidError(
      "سبب إلغاء المرتجع طويل جدًا",
    );
  }

  return reason;
}

export async function handleVoidPosSaleReturn(
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
          error: "يجب تسجيل الدخول",
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
      body = await request.json();
    } catch {
      throw new PosSaleReturnVoidError(
        "بيانات إلغاء المرتجع غير صالحة",
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      throw new PosSaleReturnVoidError(
        "بيانات إلغاء المرتجع غير صالحة",
      );
    }

    const payload =
      body as Record<string, unknown>;

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
          const returnRows =
            await tx
              .select()
              .from(
                posSaleReturnsTable,
              )
              .where(
                eq(
                  posSaleReturnsTable.publicId,
                  publicId,
                ),
              )
              .for("update");

          const saleReturn =
            returnRows[0];

          if (!saleReturn) {
            throw new PosSaleReturnVoidError(
              "المرتجع غير موجود",
              404,
            );
          }

          const returnItems =
            await tx
              .select()
              .from(
                posSaleReturnItemsTable,
              )
              .where(
                eq(
                  posSaleReturnItemsTable.returnId,
                  saleReturn.id,
                ),
              )
              .orderBy(
                asc(
                  posSaleReturnItemsTable.lineNumber,
                ),
              );

          if (
            saleReturn.status ===
            "voided"
          ) {
            return {
              saleReturn,
              alreadyVoided: true,
            };
          }

          if (
            saleReturn.status !==
            "completed"
          ) {
            throw new PosSaleReturnVoidError(
              "لا يمكن إلغاء هذا المرتجع",
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
                    cashSessionsTable.id,
                    saleReturn.cashSessionId,
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
            throw new PosSaleReturnVoidError(
              "لا يمكن إلغاء المرتجع بعد إغلاق يوم الصندوق",
              409,
            );
          }

          const expectedBefore =
            session.expectedBalanceMinor ??
            session.openingBalanceMinor;

          const expectedAfter =
            saleReturn.refundMethod ===
            "cash"
              ? expectedBefore +
                saleReturn.refundAmountMinor
              : expectedBefore;

          if (
            !Number.isSafeInteger(
              expectedAfter,
            ) ||
            expectedAfter < 0 ||
            expectedAfter > MAX_DB_INT
          ) {
            throw new PosSaleReturnVoidError(
              "تعذر تحديث رصيد الصندوق",
              409,
            );
          }

          const returnItemIds =
            returnItems.map(
              (item) => item.id,
            );

          const costRows =
            returnItemIds.length > 0
              ? await tx
                  .select()
                  .from(
                    posSaleReturnItemCostsTable,
                  )
                  .where(
                    inArray(
                      posSaleReturnItemCostsTable.returnItemId,
                      returnItemIds,
                    ),
                  )
              : [];

          const costByReturnItemId =
            new Map(
              costRows.map(
                (cost) => [
                  cost.returnItemId,
                  cost,
                ],
              ),
            );

          const voidedAt =
            new Date();

          const orderedItems =
            [...returnItems].sort(
              (left, right) =>
                (left.productId ??
                  Number.MAX_SAFE_INTEGER) -
                  (right.productId ??
                    Number.MAX_SAFE_INTEGER) ||
                left.lineNumber -
                  right.lineNumber,
            );

          for (
            const item of orderedItems
          ) {
            if (
              item.productId === null
            ) {
              throw new PosSaleReturnVoidError(
                `المنتج ${item.productNameAr} لم يعد موجودًا`,
                409,
              );
            }

            const productRows =
              await tx
                .select()
                .from(productsTable)
                .where(
                  eq(
                    productsTable.id,
                    item.productId,
                  ),
                )
                .for("update");

            const product =
              productRows[0];

            if (!product) {
              throw new PosSaleReturnVoidError(
                `المنتج ${item.productNameAr} لم يعد موجودًا`,
                409,
              );
            }

            const updates: {
              stock?: number;
              colorVariants?: ColorVariant[];
            } = {};

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

            if (
              product.stock !== null &&
              product.stock !==
                undefined
            ) {
              generalStockBefore =
                product.stock;

              const nextStock =
                product.stock -
                item.quantity;

              if (
                !Number.isSafeInteger(
                  nextStock,
                ) ||
                nextStock < 0
              ) {
                throw new PosSaleReturnVoidError(
                  `المخزون الحالي للصنف ${item.productNameAr} لا يكفي لإلغاء المرتجع`,
                  409,
                );
              }

              generalStockAfter =
                nextStock;

              updates.stock =
                nextStock;
            }

            const colorVariants =
              (product.colorVariants as
                | ColorVariant[]
                | null) ?? [];

            if (
              colorVariants.length > 0
            ) {
              if (!item.color) {
                throw new PosSaleReturnVoidError(
                  `لون ${item.productNameAr} غير محفوظ في المرتجع`,
                  409,
                );
              }

              const variantIndex =
                colorVariants.findIndex(
                  (entry) =>
                    entry.color ===
                    item.color,
                );

              if (
                variantIndex < 0
              ) {
                throw new PosSaleReturnVoidError(
                  `لون ${item.productNameAr} لم يعد موجودًا`,
                  409,
                );
              }

              const variant =
                colorVariants[
                  variantIndex
                ];

              if (!variant) {
                throw new PosSaleReturnVoidError(
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

              if (
                sizes.length > 0
              ) {
                if (!item.size) {
                  throw new PosSaleReturnVoidError(
                    `مقاس ${item.productNameAr} غير محفوظ في المرتجع`,
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
                  throw new PosSaleReturnVoidError(
                    `مقاس ${item.productNameAr} لم يعد موجودًا`,
                    409,
                  );
                }

                const selectedSize =
                  sizes[sizeIndex];

                if (
                  !selectedSize
                ) {
                  throw new PosSaleReturnVoidError(
                    `مقاس ${item.productNameAr} لم يعد موجودًا`,
                    409,
                  );
                }

                if (
                  selectedSize.stock !==
                    null &&
                  selectedSize.stock !==
                    undefined
                ) {
                  variantStockBefore =
                    selectedSize.stock;

                  const nextVariantStock =
                    selectedSize.stock -
                    item.quantity;

                  if (
                    !Number.isSafeInteger(
                      nextVariantStock,
                    ) ||
                    nextVariantStock < 0
                  ) {
                    throw new PosSaleReturnVoidError(
                      `مخزون ${item.productNameAr} / ${item.color} / ${item.size} لا يكفي لإلغاء المرتجع`,
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

                  updates.colorVariants =
                    colorVariants.map(
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
                }
              } else if (
                item.size
              ) {
                throw new PosSaleReturnVoidError(
                  `المقاس المسجل لم يعد مطابقًا للمنتج ${item.productNameAr}`,
                  409,
                );
              }
            } else if (
              item.color
            ) {
              throw new PosSaleReturnVoidError(
                `اللون المسجل لم يعد مطابقًا للمنتج ${item.productNameAr}`,
                409,
              );
            }

            if (
              Object.keys(updates)
                .length > 0
            ) {
              await tx
                .update(
                  productsTable,
                )
                .set(updates)
                .where(
                  eq(
                    productsTable.id,
                    product.id,
                  ),
                );
            }

            await tx
              .insert(
                inventoryMovementsTable,
              )
              .values({
                productId:
                  product.id,

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

                movementType:
                  "pos_sale_return_void",

                quantityDelta:
                  -item.quantity,

                generalStockBefore,
                generalStockAfter,

                variantStockBefore,
                variantStockAfter,

                sourceType:
                  "pos_sale_return",

                sourceId:
                  saleReturn.id,

                sourceItemId:
                  item.id,

                sourcePublicId:
                  saleReturn.publicId,

                eventKey:
                  `pos-sale-return:${saleReturn.id}:item:${item.id}:voided`,

                occurredAt:
                  voidedAt,
              });

            const returnCost =
              costByReturnItemId.get(
                item.id,
              );

            /*
             * Legacy returns may have no cost snapshot.
             * Do NOT invent historical cost here.
             *
             * The legacy cost-sync policy will be handled
             * separately before the cost feature is deployed.
             */
            if (!returnCost) {
              const costStateRows =
                await tx
                  .select({
                    productId:
                      productCostStateTable.productId,
                  })
                  .from(
                    productCostStateTable,
                  )
                  .where(
                    eq(
                      productCostStateTable.productId,
                      product.id,
                    ),
                  )
                  .for("update")
                  .limit(1);

              if (costStateRows[0]) {
                throw new PosSaleReturnVoidError(
                  `لا يمكن إلغاء المرتجع القديم للصنف ${item.productNameAr} بعد بدء محاسبة التكلفة لعدم وجود تكلفة تاريخية محفوظة`,
                  409,
                );
              }

              console.warn(
                "POS_RETURN_VOID_COST_UNTRACKED",
                {
                  returnId:
                    saleReturn.id,
                  returnItemId:
                    item.id,
                  productId:
                    product.id,
                },
              );

              continue;
            }

            if (
              returnCost.productId !==
                product.id ||
              returnCost.quantity !==
                item.quantity
            ) {
              throw new Error(
                `POS_RETURN_VOID_COST_SNAPSHOT_MISMATCH:${item.id}`,
              );
            }

            const consumedCost =
              await consumeExactProductCost(
                tx,
                {
                  productId:
                    product.id,

                  quantity:
                    item.quantity,

                  costTotalMinor:
                    returnCost.costTotalMinor,

                  eventType:
                    "pos_return_void",

                  sourceType:
                    "pos_return",

                  sourceRef:
                    String(
                      saleReturn.id,
                    ),

                  sourceItemRef:
                    String(
                      item.id,
                    ),

                  businessDate:
                    saleReturn.businessDate,

                  note:
                    `POS return void ${saleReturn.publicId}`,

                  createdByUserId:
                    user.id,
                },
              );

            if (
              !consumedCost.tracked
            ) {
              throw new PosSaleReturnVoidError(
                `تعذر عكس تكلفة الصنف ${item.productNameAr}: ${consumedCost.reason}`,
                409,
              );
            }
          }

          if (
            saleReturn.refundMethod ===
              "customer" &&
            saleReturn.refundAmountMinor >
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
                      financeTransactionsTable.sourceType,
                      "pos_sale_return",
                    ),
                    eq(
                      financeTransactionsTable.sourceId,
                      String(
                        saleReturn.id,
                      ),
                    ),
                    eq(
                      financeTransactionsTable.sourceEvent,
                      "customer_credit",
                    ),
                    eq(
                      financeTransactionsTable.status,
                      "posted",
                    ),
                  ),
                )
                .limit(1)
                .for("update");

            const originalFinance =
              financeRows[0];

            if (!originalFinance) {
              throw new PosSaleReturnVoidError(
                "تعذر العثور على قيد حساب الزبون للمرتجع",
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
              originalLines.length < 2
            ) {
              throw new Error(
                "POS_RETURN_CUSTOMER_FINANCE_LINES_MISSING",
              );
            }

            const reversalRows =
              await tx
                .insert(
                  financeTransactionsTable,
                )
                .values({
                  publicId:
                    `FIN-RET-VOID-${saleReturn.publicId}`,
                  idempotencyKey:
                    `pos-sale-return:${saleReturn.id}:customer-credit:void`,
                  businessDate:
                    saleReturn.businessDate,
                  transactionType:
                    "reversal",
                  sourceType:
                    "pos_sale_return",
                  sourceId:
                    String(
                      saleReturn.id,
                    ),
                  sourceEvent:
                    "customer_credit_void",
                  cashSessionId:
                    saleReturn.cashSessionId,
                  status:
                    "posted",
                  notes:
                    `عكس مردود حساب الزبون ${saleReturn.publicId}`,
                  createdByUserId:
                    user.id,
                })
                .returning();

            const reversal =
              reversalRows[0];

            if (!reversal) {
              throw new Error(
                "POS_RETURN_CUSTOMER_REVERSAL_FAILED",
              );
            }

            await tx
              .insert(
                financeTransactionLinesTable,
              )
              .values(
                originalLines.map(
                  (line, index) => ({
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
                      `عكس ${saleReturn.publicId}`,
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
            saleReturn.refundMethod ===
            "cash"
          ) {
            const sessionRowsUpdated =
              await tx
                .update(
                  cashSessionsTable,
                )
                .set({
                  expectedBalanceMinor:
                    expectedAfter,

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
              !sessionRowsUpdated[0]
            ) {
              throw new PosSaleReturnVoidError(
                "تم إغلاق الصندوق قبل إلغاء المرتجع",
                409,
              );
            }
          }

          const updatedRows =
            await tx
              .update(
                posSaleReturnsTable,
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
                    posSaleReturnsTable.id,
                    saleReturn.id,
                  ),
                  eq(
                    posSaleReturnsTable.status,
                    "completed",
                  ),
                ),
              )
              .returning();

          const updatedReturn =
            updatedRows[0];

          if (!updatedReturn) {
            throw new PosSaleReturnVoidError(
              "تم تغيير حالة المرتجع قبل إلغائه",
              409,
            );
          }

          return {
            saleReturn:
              updatedReturn,

            alreadyVoided:
              false,
          };
        },
      );

    return json({
      alreadyVoided:
        result.alreadyVoided,

      saleReturn: {
        id:
          String(
            result.saleReturn.id,
          ),

        publicId:
          result.saleReturn.publicId,

        status:
          result.saleReturn.status,

        refundAmountMinor:
          result.saleReturn
            .refundAmountMinor,

        refundAmount:
          result.saleReturn
            .refundAmountMinor /
          100,

        voidedAt:
          result.saleReturn
            .voidedAt
            ?.toISOString() ??
          null,

        voidedByUserId:
          result.saleReturn
            .voidedByUserId ===
          null
            ? null
            : String(
                result.saleReturn
                  .voidedByUserId,
              ),

        voidReason:
          result.saleReturn
            .voidReason,
      },
    });
  } catch (error) {
    if (
      error instanceof
      PosSaleReturnVoidError
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
      "POS_SALE_RETURN_VOID_FAILED",
      error,
    );

    return json(
      {
        error:
          "تعذر إلغاء المرتجع",
      },
      500,
    );
  }
}
