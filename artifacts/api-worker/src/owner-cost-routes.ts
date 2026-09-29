import {
  orderItemCostsTable,
  ordersTable,
  posSaleItemCostsTable,
  posSaleItemsTable,
  posSaleReturnItemCostsTable,
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
  isNull,
} from "drizzle-orm";

import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
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

        if (
          saleBackfillInvalid ||
          returnBackfillInvalid
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

  return null;
}
