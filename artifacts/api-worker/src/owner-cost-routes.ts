import {
  exchangeDocumentsTable,
  exchangeReturnItemCostsTable,
  exchangeReturnItemsTable,
  exchangeSaleItemCostsTable,
  exchangeSaleItemsTable,
  financeTransactionsTable,
  orderItemCostsTable,
  ordersTable,
  posSaleItemCostsTable,
  posSaleItemsTable,
  posSaleReturnItemCostsTable,
  posSaleRevisionItemCostsTable,
  posSaleReturnItemsTable,
  posSaleReturnsTable,
  posSalesTable,
  productCostLedgerTable,
  productCostStateTable,
  productHistoricalCostsTable,
  productsTable,
} from "@workspace/db/schema";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";

import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import { handleOwnerCostQualityAttestation } from "./owner-cost-quality-attestation";
import { getProductQuantity } from "./product-quantity";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });

async function requireOwner(
  request: Request,
  db: Db,
  env: Env,
) {
  const owner = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!owner?.isOwner) {
    return {
      ok: false as const,
      response: json(
        { error: "هذه البيانات متاحة للمالك فقط" },
        403,
      ),
    };
  }

  return {
    ok: true as const,
    owner,
  };
}

function parseProductId(
  value: unknown,
): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  if (
    !Number.isSafeInteger(numeric) ||
    numeric <= 0
  ) {
    return null;
  }

  return numeric;
}

function parseUnitCostMinor(
  value: unknown,
): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  if (
    !Number.isSafeInteger(numeric) ||
    numeric < 0 ||
    numeric > 2_147_483_647
  ) {
    return null;
  }

  return numeric;
}

function parseCostQuality(
  value: unknown,
): "confirmed" | "estimated" | null {
  if (
    value === "confirmed" ||
    value === "estimated"
  ) {
    return value;
  }

  return null;
}

function parseReportDate(
  value: unknown,
): string | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    return null;
  }

  const date =
    new Date(
      `${value}T00:00:00Z`,
    );

  if (
    Number.isNaN(
      date.getTime(),
    ) ||
    date
      .toISOString()
      .slice(0, 10) !== value
  ) {
    return null;
  }

  return value;
}

async function handleProducts(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requireOwner(
    request,
    db,
    env,
  );

  if (!auth.ok) {
    return auth.response;
  }

  const rows = await db
    .select({
      productId: productsTable.id,
      nameAr: productsTable.nameAr,
      productCode: productsTable.productCode,
      barcode: productsTable.barcode,
      price: productsTable.price,
      category: productsTable.category,
      isHidden: productsTable.isHidden,
      createdAt: productsTable.createdAt,
      stock: productsTable.stock,
      colorVariants: productsTable.colorVariants,

      costProductId:
        productCostStateTable.productId,
      quantityOnHand:
        productCostStateTable.quantityOnHand,
      inventoryValueMinor:
        productCostStateTable.inventoryValueMinor,
      referenceUnitCostMinor:
        productCostStateTable.referenceUnitCostMinor,
      costQuality:
        productCostStateTable.costQuality,
      initializedAt:
        productCostStateTable.initializedAt,
      updatedAt:
        productCostStateTable.updatedAt,
    })
    .from(productsTable)
    .leftJoin(
      productCostStateTable,
      eq(
        productCostStateTable.productId,
        productsTable.id,
      ),
    )
    .where(
      isNull(productsTable.deletedAt),
    )
    .orderBy(
      asc(productsTable.nameAr),
      asc(productsTable.id),
    );

  return json({
    products: rows.map((row) => {
      const currentQuantity =
        getProductQuantity({
          stock: row.stock,
          colorVariants:
            row.colorVariants,
        });

      const initialized =
        row.costProductId !== null;

      const accountingQuantity =
        initialized
          ? (row.quantityOnHand ?? 0)
          : null;

      const inventoryValueMinor =
        initialized
          ? (row.inventoryValueMinor ?? 0)
          : null;

      const referenceUnitCostMinor =
        initialized
          ? (row.referenceUnitCostMinor ?? 0)
          : null;

      const averageCostMinor =
        initialized &&
        accountingQuantity !== null &&
        accountingQuantity > 0 &&
        inventoryValueMinor !== null
          ? inventoryValueMinor /
            accountingQuantity
          : null;

      return {
        productId:
          String(row.productId),
        nameAr: row.nameAr,
        productCode:
          row.productCode ?? null,
        barcode:
          row.barcode ?? null,
        price: row.price,
        category: row.category,
        isHidden: row.isHidden,
        createdAt:
          row.createdAt.toISOString(),

        currentQuantity,
        stockTracked:
          currentQuantity !== null,

        initialized,

        accountingQuantity,
        inventoryValueMinor,
        referenceUnitCostMinor,
        averageCostMinor,
        costQuality:
          initialized
            ? row.costQuality
            : null,

        stockMatchesAccounting:
          !initialized ||
          currentQuantity === null ||
          accountingQuantity ===
            currentQuantity,

        initializedAt:
          row.initializedAt
            ?.toISOString() ?? null,

        updatedAt:
          row.updatedAt
            ?.toISOString() ?? null,
      };
    }),
  });
}

async function handleOpeningCost(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requireOwner(
    request,
    db,
    env,
  );

  if (!auth.ok) {
    return auth.response;
  }

  const body =
    await request
      .json()
      .catch(() => null);

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return json(
      { error: "البيانات غير صالحة" },
      400,
    );
  }

  const payload =
    body as Record<string, unknown>;

  const productId =
    parseProductId(
      payload.productId,
    );

  if (productId === null) {
    return json(
      { error: "رقم الصنف غير صالح" },
      400,
    );
  }

  const unitCostMinor =
    parseUnitCostMinor(
      payload.unitCostMinor,
    );

  if (unitCostMinor === null) {
    return json(
      {
        error:
          "تكلفة الصنف غير صالحة",
      },
      400,
    );
  }

  const costQuality =
    parseCostQuality(
      payload.costQuality,
    );

  if (!costQuality) {
    return json(
      {
        error:
          "حالة التكلفة يجب أن تكون confirmed أو estimated",
      },
      400,
    );
  }

  const ownerId =
    Number(auth.owner.id);

  if (
    !Number.isSafeInteger(ownerId) ||
    ownerId <= 0
  ) {
    return json(
      {
        error:
          "تعذر تحديد حساب المالك",
      },
      500,
    );
  }

  const result =
    await db.transaction(
      async (tx) => {
        const productRows =
          await tx
            .select({
              id: productsTable.id,
              nameAr:
                productsTable.nameAr,
              stock:
                productsTable.stock,
              colorVariants:
                productsTable.colorVariants,
              createdAt:
                productsTable.createdAt,
            })
            .from(productsTable)
            .where(
              and(
                eq(
                  productsTable.id,
                  productId,
                ),
                isNull(
                  productsTable.deletedAt,
                ),
              ),
            )
            .limit(1)
            .for("update");

        const product =
          productRows[0];

        if (!product) {
          return {
            ok: false as const,
            status: 404,
            error:
              "الصنف غير موجود",
          };
        }

        const currentQuantity =
          getProductQuantity({
            stock:
              product.stock,
            colorVariants:
              product.colorVariants,
          });

        if (
          currentQuantity === null
        ) {
          return {
            ok: false as const,
            status: 409,
            error:
              "لا يمكن تحديد كمية هذا الصنف. يجب ضبط المخزون أولاً.",
          };
        }

        if (
          !Number.isSafeInteger(
            currentQuantity,
          ) ||
          currentQuantity < 0
        ) {
          return {
            ok: false as const,
            status: 409,
            error:
              "كمية الصنف الحالية غير صالحة محاسبياً",
          };
        }

        const inventoryValueMinor =
          currentQuantity *
          unitCostMinor;

        if (
          !Number.isSafeInteger(
            inventoryValueMinor,
          ) ||
          inventoryValueMinor >
            2_147_483_647
        ) {
          return {
            ok: false as const,
            status: 400,
            error:
              "قيمة المخزون أكبر من الحد المسموح",
          };
        }


        // ----------------------------------------------------------
        // Historical backfill
        //
        // Business rule:
        // Existing products currently come from a single purchase
        // batch. The owner-confirmed opening unit cost is therefore
        // also the historical unit cost for legacy transactions that
        // do not yet have a frozen cost snapshot.
        //
        // We NEVER overwrite an existing snapshot.
        // ----------------------------------------------------------

        const historicalCostTotal = (
          quantity: number,
        ): number | null => {
          const total =
            quantity * unitCostMinor;

          if (
            !Number.isSafeInteger(total) ||
            total < 0 ||
            total > 2_147_483_647
          ) {
            return null;
          }

          return total;
        };

        const historicalSaleItems =
          await tx
            .select({
              saleItemId:
                posSaleItemsTable.id,
              quantity:
                posSaleItemsTable.quantity,
              existingCostSaleItemId:
                posSaleItemCostsTable.saleItemId,
            })
            .from(posSaleItemsTable)
            .innerJoin(
              posSalesTable,
              eq(
                posSalesTable.id,
                posSaleItemsTable.saleId,
              ),
            )
            .leftJoin(
              posSaleItemCostsTable,
              eq(
                posSaleItemCostsTable.saleItemId,
                posSaleItemsTable.id,
              ),
            )
            .where(
              and(
                eq(
                  posSaleItemsTable.productId,
                  productId,
                ),
                eq(
                  posSalesTable.status,
                  "completed",
                ),
                isNull(
                  posSaleItemCostsTable.saleItemId,
                ),
              ),
            );

        const historicalReturnItems =
          await tx
            .select({
              returnItemId:
                posSaleReturnItemsTable.id,
              originalSaleItemId:
                posSaleReturnItemsTable.originalSaleItemId,
              quantity:
                posSaleReturnItemsTable.quantity,
              existingCostReturnItemId:
                posSaleReturnItemCostsTable.returnItemId,
            })
            .from(posSaleReturnItemsTable)
            .innerJoin(
              posSaleReturnsTable,
              eq(
                posSaleReturnsTable.id,
                posSaleReturnItemsTable.returnId,
              ),
            )
            .leftJoin(
              posSaleReturnItemCostsTable,
              eq(
                posSaleReturnItemCostsTable.returnItemId,
                posSaleReturnItemsTable.id,
              ),
            )
            .where(
              and(
                eq(
                  posSaleReturnItemsTable.productId,
                  productId,
                ),
                eq(
                  posSaleReturnsTable.status,
                  "completed",
                ),
                isNull(
                  posSaleReturnItemCostsTable.returnItemId,
                ),
              ),
            );

        const historicalExchangeReturnItems =
          await tx
            .select({
              returnItemId:
                exchangeReturnItemsTable.id,
              quantity:
                exchangeReturnItemsTable.quantity,
            })
            .from(
              exchangeReturnItemsTable,
            )
            .innerJoin(
              exchangeDocumentsTable,
              eq(
                exchangeDocumentsTable.id,
                exchangeReturnItemsTable.exchangeId,
              ),
            )
            .leftJoin(
              exchangeReturnItemCostsTable,
              eq(
                exchangeReturnItemCostsTable.returnItemId,
                exchangeReturnItemsTable.id,
              ),
            )
            .where(
              and(
                eq(
                  exchangeReturnItemsTable.productId,
                  productId,
                ),
                eq(
                  exchangeDocumentsTable.status,
                  "completed",
                ),
                inArray(
                  exchangeDocumentsTable.sourceType,
                  [
                    "pos_sale",
                    "pos_no_receipt",
                  ],
                ),
                isNull(
                  exchangeReturnItemCostsTable.returnItemId,
                ),
              ),
            );

        const historicalExchangeSaleItems =
          await tx
            .select({
              saleItemId:
                exchangeSaleItemsTable.id,
              quantity:
                exchangeSaleItemsTable.quantity,
            })
            .from(
              exchangeSaleItemsTable,
            )
            .innerJoin(
              exchangeDocumentsTable,
              eq(
                exchangeDocumentsTable.id,
                exchangeSaleItemsTable.exchangeId,
              ),
            )
            .leftJoin(
              exchangeSaleItemCostsTable,
              eq(
                exchangeSaleItemCostsTable.saleItemId,
                exchangeSaleItemsTable.id,
              ),
            )
            .where(
              and(
                eq(
                  exchangeSaleItemsTable.productId,
                  productId,
                ),
                eq(
                  exchangeDocumentsTable.status,
                  "completed",
                ),
                inArray(
                  exchangeDocumentsTable.sourceType,
                  [
                    "pos_sale",
                    "pos_no_receipt",
                  ],
                ),
                isNull(
                  exchangeSaleItemCostsTable.saleItemId,
                ),
              ),
            );

        const saleBackfillInvalid =
          historicalSaleItems.some(
            (item) =>
              historicalCostTotal(
                item.quantity,
              ) === null,
          );

        const returnBackfillInvalid =
          historicalReturnItems.some(
            (item) =>
              historicalCostTotal(
                item.quantity,
              ) === null,
          );

        const exchangeReturnBackfillInvalid =
          historicalExchangeReturnItems.some(
            (item) =>
              historicalCostTotal(
                item.quantity,
              ) === null,
          );

        const exchangeSaleBackfillInvalid =
          historicalExchangeSaleItems.some(
            (item) =>
              historicalCostTotal(
                item.quantity,
              ) === null,
          );

        if (
          saleBackfillInvalid ||
          returnBackfillInvalid ||
          exchangeReturnBackfillInvalid ||
          exchangeSaleBackfillInvalid
        ) {
          return {
            ok: false as const,
            status: 400,
            error:
              "تعذر احتساب التكلفة التاريخية لبعض الحركات القديمة",
          };
        }

        const saleBackfillRows =
          historicalSaleItems.map(
            (item) => ({
              saleItemId:
                item.saleItemId,
              productId,
              quantity:
                item.quantity,
              unitCostMinor,
              costTotalMinor:
                historicalCostTotal(
                  item.quantity,
                )!,
              costQuality,
            }),
          );

        const returnBackfillRows =
          historicalReturnItems.map(
            (item) => ({
              returnItemId:
                item.returnItemId,
              originalSaleItemId:
                item.originalSaleItemId,
              productId,
              quantity:
                item.quantity,
              costTotalMinor:
                historicalCostTotal(
                  item.quantity,
                )!,
              costQuality,
            }),
          );

        const exchangeReturnBackfillRows =
          historicalExchangeReturnItems.map(
            (item) => ({
              returnItemId:
                item.returnItemId,
              productId,
              quantity:
                item.quantity,
              unitCostMinor,
              costTotalMinor:
                historicalCostTotal(
                  item.quantity,
                )!,
              costQuality,
            }),
          );

        const exchangeSaleBackfillRows =
          historicalExchangeSaleItems.map(
            (item) => ({
              saleItemId:
                item.saleItemId,
              productId,
              quantity:
                item.quantity,
              unitCostMinor,
              costTotalMinor:
                historicalCostTotal(
                  item.quantity,
                )!,
              costQuality,
            }),
          );

        const historicalOrders =
          await tx
            .select({
              id:
                ordersTable.id,
              items:
                ordersTable.items,
            })
            .from(ordersTable)
            .where(
              eq(
                ordersTable.status,
                "done",
              ),
            );

        const onlineBackfillRows: Array<{
          orderId: number;
          lineNumber: number;
          productId: number;
          color: string | null;
          size: string | null;
          quantity: number;
          unitCostMinor: number;
          costTotalMinor: number;
          costQuality:
            | "confirmed"
            | "estimated";
        }> = [];

        for (
          const order of historicalOrders
        ) {
          if (
            !Array.isArray(order.items)
          ) {
            continue;
          }

          for (
            let index = 0;
            index < order.items.length;
            index += 1
          ) {
            const rawItem =
              order.items[index];

            if (
              !rawItem ||
              typeof rawItem !== "object" ||
              Array.isArray(rawItem)
            ) {
              continue;
            }

            const item =
              rawItem as Record<
                string,
                unknown
              >;

            const itemProductId =
              parseProductId(
                item.id,
              );

            if (
              itemProductId !==
              productId
            ) {
              continue;
            }

            const quantity =
              typeof item.quantity ===
              "number"
                ? item.quantity
                : Number(
                    item.quantity,
                  );

            if (
              !Number.isSafeInteger(
                quantity,
              ) ||
              quantity <= 0
            ) {
              return {
                ok: false as const,
                status: 400,
                error:
                  "تعذر احتساب تكلفة أحد أصناف الطلبات القديمة",
              };
            }

            const costTotalMinor =
              historicalCostTotal(
                quantity,
              );

            if (
              costTotalMinor === null
            ) {
              return {
                ok: false as const,
                status: 400,
                error:
                  "قيمة التكلفة التاريخية لأحد الطلبات أكبر من الحد المسموح",
              };
            }

            onlineBackfillRows.push({
              orderId:
                order.id,
              lineNumber:
                index + 1,
              productId,
              color:
                typeof item.color ===
                "string"
                  ? item.color
                  : null,
              size:
                typeof item.size ===
                "string"
                  ? item.size
                  : null,
              quantity,
              unitCostMinor,
              costTotalMinor,
              costQuality,
            });
          }
        }

        const insertedState =
          await tx
            .insert(
              productCostStateTable,
            )
            .values({
              productId,
              quantityOnHand:
                currentQuantity,
              inventoryValueMinor,
              referenceUnitCostMinor:
                unitCostMinor,
              costQuality,
            })
            .onConflictDoNothing({
              target:
                productCostStateTable.productId,
            })
            .returning({
              productId:
                productCostStateTable.productId,
              quantityOnHand:
                productCostStateTable.quantityOnHand,
              inventoryValueMinor:
                productCostStateTable.inventoryValueMinor,
              referenceUnitCostMinor:
                productCostStateTable.referenceUnitCostMinor,
              costQuality:
                productCostStateTable.costQuality,
              initializedAt:
                productCostStateTable.initializedAt,
            });

        const state =
          insertedState[0];

        if (!state) {
          return {
            ok: false as const,
            status: 409,
            error:
              "تم إدخال تكلفة افتتاحية لهذا الصنف سابقاً",
          };
        }

        await tx
          .insert(
            productCostLedgerTable,
          )
          .values({
            productId,

            eventType: "opening",

            sourceType:
              "manual_opening",

            sourceRef:
              String(productId),

            sourceItemRef:
              "initial",

            quantityDelta:
              currentQuantity,

            inventoryValueDeltaMinor:
              inventoryValueMinor,

            quantityAfter:
              currentQuantity,

            inventoryValueAfterMinor:
              inventoryValueMinor,

            costQuality,

            note:
              "Opening inventory cost",

            createdByUserId:
              ownerId,
          });


        const historicalUntil =
          new Date();

        await tx
          .insert(
            productHistoricalCostsTable,
          )
          .values({
            productId,
            effectiveFrom:
              product.createdAt,
            effectiveTo:
              historicalUntil,
            unitCostMinor,
            costQuality,
            note:
              "Owner-confirmed opening cost used for legacy transactions",
            createdByUserId:
              ownerId,
          });

        const backfilledSales =
          saleBackfillRows.length > 0
            ? await tx
                .insert(
                  posSaleItemCostsTable,
                )
                .values(
                  saleBackfillRows,
                )
                .onConflictDoNothing()
                .returning({
                  saleItemId:
                    posSaleItemCostsTable.saleItemId,
                })
            : [];

        const backfilledReturns =
          returnBackfillRows.length > 0
            ? await tx
                .insert(
                  posSaleReturnItemCostsTable,
                )
                .values(
                  returnBackfillRows,
                )
                .onConflictDoNothing()
                .returning({
                  returnItemId:
                    posSaleReturnItemCostsTable.returnItemId,
                })
            : [];

        const backfilledExchangeReturns =
          exchangeReturnBackfillRows.length > 0
            ? await tx
                .insert(
                  exchangeReturnItemCostsTable,
                )
                .values(
                  exchangeReturnBackfillRows,
                )
                .onConflictDoNothing()
                .returning({
                  returnItemId:
                    exchangeReturnItemCostsTable.returnItemId,
                })
            : [];

        const backfilledExchangeSales =
          exchangeSaleBackfillRows.length > 0
            ? await tx
                .insert(
                  exchangeSaleItemCostsTable,
                )
                .values(
                  exchangeSaleBackfillRows,
                )
                .onConflictDoNothing()
                .returning({
                  saleItemId:
                    exchangeSaleItemCostsTable.saleItemId,
                })
            : [];

        const backfilledOnline =
          onlineBackfillRows.length > 0
            ? await tx
                .insert(
                  orderItemCostsTable,
                )
                .values(
                  onlineBackfillRows,
                )
                .onConflictDoNothing()
                .returning({
                  id:
                    orderItemCostsTable.id,
                })
            : [];

        return {
          ok: true as const,

          historicalBackfill: {
            posSaleItems:
              backfilledSales.length,
            posReturnItems:
              backfilledReturns.length,
            exchangeReturnItems:
              backfilledExchangeReturns.length,
            exchangeSaleItems:
              backfilledExchangeSales.length,
            onlineOrderItems:
              backfilledOnline.length,
          },

          product: {
            productId:
              String(product.id),

            nameAr:
              product.nameAr,

            quantity:
              currentQuantity,

            unitCostMinor,

            referenceUnitCostMinor:
              state.referenceUnitCostMinor,

            inventoryValueMinor,

            costQuality,

            initializedAt:
              state.initializedAt
                .toISOString(),
          },
        };
      },
    );

  if (!result.ok) {
    return json(
      { error: result.error },
      result.status,
    );
  }

  return json(
    result,
    201,
  );
}


async function handleOpeningCostCorrection(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requireOwner(
    request,
    db,
    env,
  );

  if (!auth.ok) {
    return auth.response;
  }

  const body =
    await request
      .json()
      .catch(() => null);

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return json(
      { error: "البيانات غير صالحة" },
      400,
    );
  }

  const payload =
    body as Record<string, unknown>;

  const productId =
    parseProductId(
      payload.productId,
    );

  const unitCostMinor =
    parseUnitCostMinor(
      payload.unitCostMinor,
    );

  const reason =
    typeof payload.reason === "string"
      ? payload.reason.trim().slice(0, 300)
      : "";

  if (productId === null) {
    return json(
      { error: "رقم الصنف غير صالح" },
      400,
    );
  }

  if (unitCostMinor === null) {
    return json(
      { error: "تكلفة الصنف غير صالحة" },
      400,
    );
  }

  const ownerId =
    Number(auth.owner.id);

  if (
    !Number.isSafeInteger(ownerId) ||
    ownerId <= 0
  ) {
    return json(
      { error: "تعذر تحديد حساب المالك" },
      500,
    );
  }

  const result =
    await db.transaction(
      async (tx) => {
        const productRows =
          await tx
            .select({
              id:
                productsTable.id,
              nameAr:
                productsTable.nameAr,
              stock:
                productsTable.stock,
              colorVariants:
                productsTable.colorVariants,
            })
            .from(productsTable)
            .where(
              and(
                eq(
                  productsTable.id,
                  productId,
                ),
                isNull(
                  productsTable.deletedAt,
                ),
              ),
            )
            .limit(1)
            .for("update");

        const product =
          productRows[0];

        if (!product) {
          return {
            ok: false as const,
            status: 404,
            error: "الصنف غير موجود",
          };
        }

        const stateRows =
          await tx
            .select()
            .from(
              productCostStateTable,
            )
            .where(
              eq(
                productCostStateTable.productId,
                productId,
              ),
            )
            .limit(1)
            .for("update");

        const state =
          stateRows[0];

        if (!state) {
          return {
            ok: false as const,
            status: 409,
            error:
              "تكلفة الصنف غير مدخلة بعد. استخدم إدخال التكلفة أولاً.",
          };
        }

        const currentQuantity =
          getProductQuantity({
            stock:
              product.stock,
            colorVariants:
              product.colorVariants,
          });

        if (
          currentQuantity === null ||
          currentQuantity !==
            state.quantityOnHand
        ) {
          return {
            ok: false as const,
            status: 409,
            error:
              "كمية المخزون لا تطابق كمية محاسبة التكلفة. عالج فرق الكمية قبل تعديل التكلفة.",
          };
        }

        const ledgerRows =
          await tx
            .select({
              id:
                productCostLedgerTable.id,
              eventType:
                productCostLedgerTable.eventType,
              sourceType:
                productCostLedgerTable.sourceType,
              quantityDelta:
                productCostLedgerTable.quantityDelta,
              quantityAfter:
                productCostLedgerTable.quantityAfter,
            })
            .from(
              productCostLedgerTable,
            )
            .where(
              eq(
                productCostLedgerTable.productId,
                productId,
              ),
            )
            .orderBy(
              asc(
                productCostLedgerTable.id,
              ),
            )
            .for("update");

        const opening =
          ledgerRows.find(
            (row) =>
              row.eventType ===
                "opening" &&
              row.sourceType ===
                "manual_opening",
          );

        if (!opening) {
          return {
            ok: false as const,
            status: 409,
            error:
              "لا توجد تكلفة افتتاحية قابلة للتصحيح لهذا الصنف.",
          };
        }

        const hasLaterAcquisitionCost =
          ledgerRows.some(
            (row) =>
              row.eventType ===
                "purchase" ||
              row.eventType ===
                "purchase_void" ||
              row.eventType ===
                "adjustment_in",
          );

        if (
          hasLaterAcquisitionCost
        ) {
          return {
            ok: false as const,
            status: 409,
            error:
              "لا يمكن تعديل التكلفة الأصلية مباشرة بعد وجود دفعة شراء أو إضافة مخزون بتكلفة لاحقة. استخدم تصحيح تكلفة مخصص للحركة اللاحقة.",
          };
        }

        const previousUnitCostMinor =
          state.referenceUnitCostMinor;

        const [
          saleCostRows,
          returnCostRows,
          revisionCostRows,
          exchangeReturnCostRows,
          exchangeSaleCostRows,
          onlineCostRows,
          historicalCostRows,
        ] =
          await Promise.all([
            tx
              .select({
                quantity:
                  posSaleItemCostsTable.quantity,
                unitCostMinor:
                  posSaleItemCostsTable.unitCostMinor,
                costTotalMinor:
                  posSaleItemCostsTable.costTotalMinor,
              })
              .from(
                posSaleItemCostsTable,
              )
              .where(
                eq(
                  posSaleItemCostsTable.productId,
                  productId,
                ),
              ),
            tx
              .select({
                quantity:
                  posSaleReturnItemCostsTable.quantity,
                costTotalMinor:
                  posSaleReturnItemCostsTable.costTotalMinor,
              })
              .from(
                posSaleReturnItemCostsTable,
              )
              .where(
                eq(
                  posSaleReturnItemCostsTable.productId,
                  productId,
                ),
              ),
            tx
              .select({
                quantity:
                  posSaleRevisionItemCostsTable.quantity,
                unitCostMinor:
                  posSaleRevisionItemCostsTable.unitCostMinor,
                costTotalMinor:
                  posSaleRevisionItemCostsTable.costTotalMinor,
              })
              .from(
                posSaleRevisionItemCostsTable,
              )
              .where(
                eq(
                  posSaleRevisionItemCostsTable.productId,
                  productId,
                ),
              ),
            tx
              .select({
                quantity:
                  exchangeReturnItemCostsTable.quantity,
                unitCostMinor:
                  exchangeReturnItemCostsTable.unitCostMinor,
                costTotalMinor:
                  exchangeReturnItemCostsTable.costTotalMinor,
              })
              .from(
                exchangeReturnItemCostsTable,
              )
              .where(
                eq(
                  exchangeReturnItemCostsTable.productId,
                  productId,
                ),
              ),
            tx
              .select({
                quantity:
                  exchangeSaleItemCostsTable.quantity,
                unitCostMinor:
                  exchangeSaleItemCostsTable.unitCostMinor,
                costTotalMinor:
                  exchangeSaleItemCostsTable.costTotalMinor,
              })
              .from(
                exchangeSaleItemCostsTable,
              )
              .where(
                eq(
                  exchangeSaleItemCostsTable.productId,
                  productId,
                ),
              ),
            tx
              .select({
                quantity:
                  orderItemCostsTable.quantity,
                unitCostMinor:
                  orderItemCostsTable.unitCostMinor,
                costTotalMinor:
                  orderItemCostsTable.costTotalMinor,
              })
              .from(
                orderItemCostsTable,
              )
              .where(
                eq(
                  orderItemCostsTable.productId,
                  productId,
                ),
              ),
            tx
              .select({
                unitCostMinor:
                  productHistoricalCostsTable.unitCostMinor,
              })
              .from(
                productHistoricalCostsTable,
              )
              .where(
                eq(
                  productHistoricalCostsTable.productId,
                  productId,
                ),
              ),
          ]);

        const hasDifferentHistoricalCost =
          saleCostRows.some(
            (row) =>
              row.unitCostMinor !==
                previousUnitCostMinor ||
              row.costTotalMinor !==
                row.quantity *
                  previousUnitCostMinor,
          ) ||
          returnCostRows.some(
            (row) =>
              row.costTotalMinor !==
                row.quantity *
                  previousUnitCostMinor,
          ) ||
          revisionCostRows.some(
            (row) =>
              row.unitCostMinor !==
                previousUnitCostMinor ||
              row.costTotalMinor !==
                row.quantity *
                  previousUnitCostMinor,
          ) ||
          exchangeReturnCostRows.some(
            (row) =>
              row.unitCostMinor !==
                previousUnitCostMinor ||
              row.costTotalMinor !==
                row.quantity *
                  previousUnitCostMinor,
          ) ||
          exchangeSaleCostRows.some(
            (row) =>
              row.unitCostMinor !==
                previousUnitCostMinor ||
              row.costTotalMinor !==
                row.quantity *
                  previousUnitCostMinor,
          ) ||
          onlineCostRows.some(
            (row) =>
              row.unitCostMinor !==
                previousUnitCostMinor ||
              row.costTotalMinor !==
                row.quantity *
                  previousUnitCostMinor,
          ) ||
          historicalCostRows.some(
            (row) =>
              row.unitCostMinor !==
                previousUnitCostMinor,
          );

        if (
          hasDifferentHistoricalCost
        ) {
          return {
            ok: false as const,
            status: 409,
            error:
              "يوجد لهذا الصنف سجل تكلفة تاريخي بسعر مختلف، لذلك لا يمكن تعديل التكلفة الأصلية تلقائياً بدون إعادة احتساب تاريخ التكلفة.",
          };
        }

        const inventoryValueMinor =
          state.quantityOnHand *
          unitCostMinor;

        if (
          !Number.isSafeInteger(
            inventoryValueMinor,
          ) ||
          inventoryValueMinor >
            2_147_483_647
        ) {
          return {
            ok: false as const,
            status: 400,
            error:
              "قيمة المخزون بعد التصحيح أكبر من الحد المسموح",
          };
        }

        if (
          previousUnitCostMinor ===
          unitCostMinor
        ) {
          return {
            ok: true as const,
            unchanged: true as const,
            product: {
              productId:
                String(product.id),
              nameAr:
                product.nameAr,
              quantity:
                state.quantityOnHand,
              previousUnitCostMinor,
              unitCostMinor,
              inventoryValueMinor:
                state.inventoryValueMinor,
            },
          };
        }

        await tx
          .update(
            productCostStateTable,
          )
          .set({
            inventoryValueMinor,
            referenceUnitCostMinor:
              unitCostMinor,
            costQuality:
              "confirmed",
            updatedAt:
              new Date(),
          })
          .where(
            eq(
              productCostStateTable.productId,
              productId,
            ),
          );

        await tx
          .update(
            productCostLedgerTable,
          )
          .set({
            inventoryValueDeltaMinor:
              sql`${productCostLedgerTable.quantityDelta} * ${unitCostMinor}`,
            inventoryValueAfterMinor:
              sql`${productCostLedgerTable.quantityAfter} * ${unitCostMinor}`,
            costQuality:
              "confirmed",
          })
          .where(
            eq(
              productCostLedgerTable.productId,
              productId,
            ),
          );

        await tx
          .update(
            posSaleItemCostsTable,
          )
          .set({
            unitCostMinor,
            costTotalMinor:
              sql`${posSaleItemCostsTable.quantity} * ${unitCostMinor}`,
            costQuality:
              "confirmed",
          })
          .where(
            eq(
              posSaleItemCostsTable.productId,
              productId,
            ),
          );

        await tx
          .update(
            posSaleReturnItemCostsTable,
          )
          .set({
            costTotalMinor:
              sql`${posSaleReturnItemCostsTable.quantity} * ${unitCostMinor}`,
            costQuality:
              "confirmed",
          })
          .where(
            eq(
              posSaleReturnItemCostsTable.productId,
              productId,
            ),
          );

        await tx
          .update(
            posSaleRevisionItemCostsTable,
          )
          .set({
            unitCostMinor,
            costTotalMinor:
              sql`${posSaleRevisionItemCostsTable.quantity} * ${unitCostMinor}`,
            costQuality:
              "confirmed",
          })
          .where(
            eq(
              posSaleRevisionItemCostsTable.productId,
              productId,
            ),
          );

        await tx
          .update(
            exchangeReturnItemCostsTable,
          )
          .set({
            unitCostMinor,
            costTotalMinor:
              sql`${exchangeReturnItemCostsTable.quantity} * ${unitCostMinor}`,
            costQuality:
              "confirmed",
          })
          .where(
            eq(
              exchangeReturnItemCostsTable.productId,
              productId,
            ),
          );

        await tx
          .update(
            exchangeSaleItemCostsTable,
          )
          .set({
            unitCostMinor,
            costTotalMinor:
              sql`${exchangeSaleItemCostsTable.quantity} * ${unitCostMinor}`,
            costQuality:
              "confirmed",
          })
          .where(
            eq(
              exchangeSaleItemCostsTable.productId,
              productId,
            ),
          );

        await tx
          .update(
            orderItemCostsTable,
          )
          .set({
            unitCostMinor,
            costTotalMinor:
              sql`${orderItemCostsTable.quantity} * ${unitCostMinor}`,
            costQuality:
              "confirmed",
            updatedAt:
              new Date(),
          })
          .where(
            eq(
              orderItemCostsTable.productId,
              productId,
            ),
          );

        await tx
          .update(
            productHistoricalCostsTable,
          )
          .set({
            unitCostMinor,
            costQuality:
              "confirmed",
            updatedAt:
              new Date(),
          })
          .where(
            eq(
              productHistoricalCostsTable.productId,
              productId,
            ),
          );

        await tx
          .insert(
            productCostLedgerTable,
          )
          .values({
            productId,
            eventType:
              "correction",
            sourceType:
              "opening_cost_correction",
            sourceRef:
              String(productId),
            sourceItemRef:
              crypto.randomUUID(),
            quantityDelta:
              0,
            inventoryValueDeltaMinor:
              0,
            quantityAfter:
              state.quantityOnHand,
            inventoryValueAfterMinor:
              inventoryValueMinor,
            costQuality:
              "confirmed",
            note:
              [
                `Opening cost corrected from ${previousUnitCostMinor} to ${unitCostMinor} minor units.`,
                reason
                  ? `Reason: ${reason}`
                  : null,
              ]
                .filter(Boolean)
                .join(" "),
            createdByUserId:
              ownerId,
          });

        return {
          ok: true as const,
          unchanged: false as const,
          product: {
            productId:
              String(product.id),
            nameAr:
              product.nameAr,
            quantity:
              state.quantityOnHand,
            previousUnitCostMinor,
            unitCostMinor,
            inventoryValueMinor,
          },
        };
      },
    );

  if (!result.ok) {
    return json(
      { error: result.error },
      result.status,
    );
  }

  return json(result);
}


async function handleHistoricalCostRepair(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requireOwner(
    request,
    db,
    env,
  );

  if (!auth.ok) {
    return auth.response;
  }

  const body =
    await request
      .json()
      .catch(() => null);

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return json(
      { error: "البيانات غير صالحة" },
      400,
    );
  }

  const payload =
    body as Record<string, unknown>;

  const productId =
    parseProductId(
      payload.productId,
    );

  const unitCostMinor =
    parseUnitCostMinor(
      payload.unitCostMinor,
    );

  const costQuality =
    parseCostQuality(
      payload.costQuality,
    );

  const from =
    parseReportDate(
      payload.from,
    );

  const to =
    parseReportDate(
      payload.to,
    );

  if (productId === null) {
    return json(
      { error: "رقم الصنف غير صالح" },
      400,
    );
  }

  if (unitCostMinor === null) {
    return json(
      {
        error:
          "تكلفة الصنف غير صالحة",
      },
      400,
    );
  }

  if (!costQuality) {
    return json(
      {
        error:
          "حالة التكلفة يجب أن تكون confirmed أو estimated",
      },
      400,
    );
  }

  if (!from || !to) {
    return json(
      {
        error:
          "يجب تحديد فترة التقرير بشكل صحيح",
      },
      400,
    );
  }

  if (from > to) {
    return json(
      {
        error:
          "تاريخ البداية يجب أن يسبق تاريخ النهاية",
      },
      400,
    );
  }

  const result =
    await db.transaction(
      async (tx) => {
        const productRows =
          await tx
            .select({
              id:
                productsTable.id,
              nameAr:
                productsTable.nameAr,
            })
            .from(productsTable)
            .where(
              eq(
                productsTable.id,
                productId,
              ),
            )
            .limit(1)
            .for("update");

        const product =
          productRows[0];

        if (!product) {
          return {
            ok: false as const,
            status: 404,
            error:
              "الصنف غير موجود",
          };
        }

        const historicalCostTotal = (
          quantity: number,
        ): number | null => {
          const total =
            quantity *
            unitCostMinor;

          if (
            !Number.isSafeInteger(
              total,
            ) ||
            total < 0 ||
            total >
              2_147_483_647
          ) {
            return null;
          }

          return total;
        };

        const historicalSaleItems =
          await tx
            .select({
              saleItemId:
                posSaleItemsTable.id,
              quantity:
                posSaleItemsTable.quantity,
            })
            .from(
              posSaleItemsTable,
            )
            .innerJoin(
              posSalesTable,
              eq(
                posSalesTable.id,
                posSaleItemsTable.saleId,
              ),
            )
            .leftJoin(
              posSaleItemCostsTable,
              eq(
                posSaleItemCostsTable.saleItemId,
                posSaleItemsTable.id,
              ),
            )
            .where(
              and(
                eq(
                  posSaleItemsTable.productId,
                  productId,
                ),
                eq(
                  posSalesTable.status,
                  "completed",
                ),
                sql`(${posSalesTable.createdAt} AT TIME ZONE 'Asia/Hebron')::date >= ${from}::date`,
                sql`(${posSalesTable.createdAt} AT TIME ZONE 'Asia/Hebron')::date <= ${to}::date`,
                isNull(
                  posSaleItemCostsTable.saleItemId,
                ),
              ),
            );

        const historicalReturnItems =
          await tx
            .select({
              returnItemId:
                posSaleReturnItemsTable.id,
              originalSaleItemId:
                posSaleReturnItemsTable.originalSaleItemId,
              quantity:
                posSaleReturnItemsTable.quantity,
            })
            .from(
              posSaleReturnItemsTable,
            )
            .innerJoin(
              posSaleReturnsTable,
              eq(
                posSaleReturnsTable.id,
                posSaleReturnItemsTable.returnId,
              ),
            )
            .leftJoin(
              posSaleReturnItemCostsTable,
              eq(
                posSaleReturnItemCostsTable.returnItemId,
                posSaleReturnItemsTable.id,
              ),
            )
            .where(
              and(
                eq(
                  posSaleReturnItemsTable.productId,
                  productId,
                ),
                eq(
                  posSaleReturnsTable.status,
                  "completed",
                ),
                sql`(${posSaleReturnsTable.createdAt} AT TIME ZONE 'Asia/Hebron')::date >= ${from}::date`,
                sql`(${posSaleReturnsTable.createdAt} AT TIME ZONE 'Asia/Hebron')::date <= ${to}::date`,
                isNull(
                  posSaleReturnItemCostsTable.returnItemId,
                ),
              ),
            );

        const historicalExchangeReturnItems =
          await tx
            .select({
              returnItemId:
                exchangeReturnItemsTable.id,
              quantity:
                exchangeReturnItemsTable.quantity,
            })
            .from(
              exchangeReturnItemsTable,
            )
            .innerJoin(
              exchangeDocumentsTable,
              eq(
                exchangeDocumentsTable.id,
                exchangeReturnItemsTable.exchangeId,
              ),
            )
            .leftJoin(
              exchangeReturnItemCostsTable,
              eq(
                exchangeReturnItemCostsTable.returnItemId,
                exchangeReturnItemsTable.id,
              ),
            )
            .where(
              and(
                eq(
                  exchangeReturnItemsTable.productId,
                  productId,
                ),
                eq(
                  exchangeDocumentsTable.status,
                  "completed",
                ),
                inArray(
                  exchangeDocumentsTable.sourceType,
                  [
                    "pos_sale",
                    "pos_no_receipt",
                  ],
                ),
                sql`(${exchangeDocumentsTable.createdAt} AT TIME ZONE 'Asia/Hebron')::date >= ${from}::date`,
                sql`(${exchangeDocumentsTable.createdAt} AT TIME ZONE 'Asia/Hebron')::date <= ${to}::date`,
                isNull(
                  exchangeReturnItemCostsTable.returnItemId,
                ),
              ),
            );

        const historicalExchangeSaleItems =
          await tx
            .select({
              saleItemId:
                exchangeSaleItemsTable.id,
              quantity:
                exchangeSaleItemsTable.quantity,
            })
            .from(
              exchangeSaleItemsTable,
            )
            .innerJoin(
              exchangeDocumentsTable,
              eq(
                exchangeDocumentsTable.id,
                exchangeSaleItemsTable.exchangeId,
              ),
            )
            .leftJoin(
              exchangeSaleItemCostsTable,
              eq(
                exchangeSaleItemCostsTable.saleItemId,
                exchangeSaleItemsTable.id,
              ),
            )
            .where(
              and(
                eq(
                  exchangeSaleItemsTable.productId,
                  productId,
                ),
                eq(
                  exchangeDocumentsTable.status,
                  "completed",
                ),
                inArray(
                  exchangeDocumentsTable.sourceType,
                  [
                    "pos_sale",
                    "pos_no_receipt",
                  ],
                ),
                sql`(${exchangeDocumentsTable.createdAt} AT TIME ZONE 'Asia/Hebron')::date >= ${from}::date`,
                sql`(${exchangeDocumentsTable.createdAt} AT TIME ZONE 'Asia/Hebron')::date <= ${to}::date`,
                isNull(
                  exchangeSaleItemCostsTable.saleItemId,
                ),
              ),
            );

        const onlineCompletions =
          await tx
            .select({
              sourceId:
                financeTransactionsTable.sourceId,
            })
            .from(
              financeTransactionsTable,
            )
            .where(
              and(
                eq(
                  financeTransactionsTable.sourceType,
                  "web_order",
                ),
                eq(
                  financeTransactionsTable.sourceEvent,
                  "done",
                ),
                eq(
                  financeTransactionsTable.status,
                  "posted",
                ),
                gte(
                  financeTransactionsTable.businessDate,
                  from,
                ),
                lte(
                  financeTransactionsTable.businessDate,
                  to,
                ),
              ),
            );

        const onlineOrderIds =
          [
            ...new Set(
              onlineCompletions
                .map(
                  (entry) =>
                    Number(
                      entry.sourceId,
                    ),
                )
                .filter(
                  (value) =>
                    Number.isSafeInteger(
                      value,
                    ) &&
                    value > 0,
                ),
            ),
          ];

        const historicalOrders =
          onlineOrderIds.length > 0
            ? await tx
                .select({
                  id:
                    ordersTable.id,
                  items:
                    ordersTable.items,
                })
                .from(
                  ordersTable,
                )
                .where(
                  and(
                    inArray(
                      ordersTable.id,
                      onlineOrderIds,
                    ),
                    eq(
                      ordersTable.status,
                      "done",
                    ),
                  ),
                )
            : [];

        const existingOnlineCosts =
          onlineOrderIds.length > 0
            ? await tx
                .select({
                  orderId:
                    orderItemCostsTable.orderId,
                  lineNumber:
                    orderItemCostsTable.lineNumber,
                })
                .from(
                  orderItemCostsTable,
                )
                .where(
                  inArray(
                    orderItemCostsTable.orderId,
                    onlineOrderIds,
                  ),
                )
            : [];

        const existingOnlineCostKeys =
          new Set(
            existingOnlineCosts.map(
              (entry) =>
                `${entry.orderId}:${entry.lineNumber}`,
            ),
          );

        const saleBackfillRows =
          historicalSaleItems.map(
            (item) => {
              const costTotalMinor =
                historicalCostTotal(
                  item.quantity,
                );

              if (
                costTotalMinor === null
              ) {
                throw new Error(
                  "INVALID_HISTORICAL_COST",
                );
              }

              return {
                saleItemId:
                  item.saleItemId,
                productId,
                quantity:
                  item.quantity,
                unitCostMinor,
                costTotalMinor,
                costQuality,
              };
            },
          );

        const returnBackfillRows =
          historicalReturnItems.map(
            (item) => {
              const costTotalMinor =
                historicalCostTotal(
                  item.quantity,
                );

              if (
                costTotalMinor === null
              ) {
                throw new Error(
                  "INVALID_HISTORICAL_COST",
                );
              }

              return {
                returnItemId:
                  item.returnItemId,
                originalSaleItemId:
                  item.originalSaleItemId,
                productId,
                quantity:
                  item.quantity,
                costTotalMinor,
                costQuality,
              };
            },
          );

        const exchangeReturnBackfillRows =
          historicalExchangeReturnItems.map(
            (item) => {
              const costTotalMinor =
                historicalCostTotal(
                  item.quantity,
                );

              if (
                costTotalMinor === null
              ) {
                throw new Error(
                  "INVALID_HISTORICAL_COST",
                );
              }

              return {
                returnItemId:
                  item.returnItemId,
                productId,
                quantity:
                  item.quantity,
                unitCostMinor,
                costTotalMinor,
                costQuality,
              };
            },
          );

        const exchangeSaleBackfillRows =
          historicalExchangeSaleItems.map(
            (item) => {
              const costTotalMinor =
                historicalCostTotal(
                  item.quantity,
                );

              if (
                costTotalMinor === null
              ) {
                throw new Error(
                  "INVALID_HISTORICAL_COST",
                );
              }

              return {
                saleItemId:
                  item.saleItemId,
                productId,
                quantity:
                  item.quantity,
                unitCostMinor,
                costTotalMinor,
                costQuality,
              };
            },
          );

        const onlineBackfillRows: Array<{
          orderId: number;
          lineNumber: number;
          productId: number;
          color: string | null;
          size: string | null;
          quantity: number;
          unitCostMinor: number;
          costTotalMinor: number;
          costQuality:
            | "confirmed"
            | "estimated";
        }> = [];

        for (
          const order of
          historicalOrders
        ) {
          if (
            !Array.isArray(
              order.items,
            )
          ) {
            continue;
          }

          for (
            let index = 0;
            index <
            order.items.length;
            index += 1
          ) {
            const lineNumber =
              index + 1;

            if (
              existingOnlineCostKeys.has(
                `${order.id}:${lineNumber}`,
              )
            ) {
              continue;
            }

            const rawItem =
              order.items[index];

            if (
              !rawItem ||
              typeof rawItem !==
                "object" ||
              Array.isArray(
                rawItem,
              )
            ) {
              continue;
            }

            const item =
              rawItem as Record<
                string,
                unknown
              >;

            if (
              parseProductId(
                item.id,
              ) !== productId
            ) {
              continue;
            }

            const quantity =
              typeof item.quantity ===
              "number"
                ? item.quantity
                : Number(
                    item.quantity,
                  );

            if (
              !Number.isSafeInteger(
                quantity,
              ) ||
              quantity <= 0
            ) {
              return {
                ok: false as const,
                status: 400,
                error:
                  "تعذر احتساب كمية أحد أصناف الطلبات القديمة",
              };
            }

            const costTotalMinor =
              historicalCostTotal(
                quantity,
              );

            if (
              costTotalMinor ===
              null
            ) {
              return {
                ok: false as const,
                status: 400,
                error:
                  "قيمة التكلفة التاريخية أكبر من الحد المسموح",
              };
            }

            onlineBackfillRows.push({
              orderId:
                order.id,
              lineNumber,
              productId,
              color:
                typeof item.color ===
                "string"
                  ? item.color
                  : null,
              size:
                typeof item.size ===
                "string"
                  ? item.size
                  : null,
              quantity,
              unitCostMinor,
              costTotalMinor,
              costQuality,
            });
          }
        }

        if (
          saleBackfillRows.length ===
            0 &&
          returnBackfillRows.length ===
            0 &&
          exchangeReturnBackfillRows.length ===
            0 &&
          exchangeSaleBackfillRows.length ===
            0 &&
          onlineBackfillRows.length ===
            0
        ) {
          return {
            ok: false as const,
            status: 409,
            error:
              "لا توجد حركة تكلفة تاريخية ناقصة لهذا الصنف ضمن الفترة المحددة",
          };
        }

        const backfilledSales =
          saleBackfillRows.length > 0
            ? await tx
                .insert(
                  posSaleItemCostsTable,
                )
                .values(
                  saleBackfillRows,
                )
                .onConflictDoNothing()
                .returning({
                  saleItemId:
                    posSaleItemCostsTable.saleItemId,
                })
            : [];

        const backfilledReturns =
          returnBackfillRows.length > 0
            ? await tx
                .insert(
                  posSaleReturnItemCostsTable,
                )
                .values(
                  returnBackfillRows,
                )
                .onConflictDoNothing()
                .returning({
                  returnItemId:
                    posSaleReturnItemCostsTable.returnItemId,
                })
            : [];

        const backfilledExchangeReturns =
          exchangeReturnBackfillRows.length >
          0
            ? await tx
                .insert(
                  exchangeReturnItemCostsTable,
                )
                .values(
                  exchangeReturnBackfillRows,
                )
                .onConflictDoNothing()
                .returning({
                  returnItemId:
                    exchangeReturnItemCostsTable.returnItemId,
                })
            : [];

        const backfilledExchangeSales =
          exchangeSaleBackfillRows.length >
          0
            ? await tx
                .insert(
                  exchangeSaleItemCostsTable,
                )
                .values(
                  exchangeSaleBackfillRows,
                )
                .onConflictDoNothing()
                .returning({
                  saleItemId:
                    exchangeSaleItemCostsTable.saleItemId,
                })
            : [];

        const backfilledOnline =
          onlineBackfillRows.length > 0
            ? await tx
                .insert(
                  orderItemCostsTable,
                )
                .values(
                  onlineBackfillRows,
                )
                .onConflictDoNothing()
                .returning({
                  id:
                    orderItemCostsTable.id,
                })
            : [];

        return {
          ok: true as const,
          range: {
            from,
            to,
          },
          product: {
            productId:
              String(
                product.id,
              ),
            nameAr:
              product.nameAr,
            unitCostMinor,
            costQuality,
          },
          historicalBackfill: {
            posSaleItems:
              backfilledSales.length,
            posReturnItems:
              backfilledReturns.length,
            exchangeReturnItems:
              backfilledExchangeReturns.length,
            exchangeSaleItems:
              backfilledExchangeSales.length,
            onlineOrderItems:
              backfilledOnline.length,
          },
        };
      },
    ).catch(
      (error) => {
        if (
          error instanceof Error &&
          error.message ===
            "INVALID_HISTORICAL_COST"
        ) {
          return {
            ok: false as const,
            status: 400,
            error:
              "قيمة التكلفة التاريخية أكبر من الحد المسموح",
          };
        }

        throw error;
      },
    );

  if (!result.ok) {
    return json(
      {
        error:
          result.error,
      },
      result.status,
    );
  }

  return json(
    result,
    201,
  );
}

export async function handleOwnerCostRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const url =
    new URL(request.url);

  const path =
    url.pathname;

  if (
    request.method === "GET" &&
    path ===
      "/api/owner/costs/products"
  ) {
    return handleProducts(
      request,
      db,
      env,
    );
  }

  if (
    request.method === "POST" &&
    path ===
      "/api/owner/costs/opening"
  ) {
    return handleOpeningCost(
      request,
      db,
      env,
    );
  }

  if (
    request.method === "POST" &&
    path ===
      "/api/owner/costs/opening-correction"
  ) {
    return handleOpeningCostCorrection(
      request,
      db,
      env,
    );
  }

  if (
    request.method === "POST" &&
    path ===
      "/api/owner/costs/historical-repair"
  ) {
    return handleHistoricalCostRepair(
      request,
      db,
      env,
    );
  }

  if (request.method === "POST" && path === "/api/owner/costs/quality-attestation") {
    return handleOwnerCostQualityAttestation(request, db, env);
  }

  return null;
}
