import {
  productCostLedgerTable,
  productCostStateTable,
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

type Db = Awaited<ReturnType<typeof openDb>>["db"];

type ColorVariant = {
  sizes?: Array<{
    stock?: number | null;
  }>;
};

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

/**
 * Cost is ALWAYS model/product-level.
 *
 * Variant sizes are used only to determine the current physical
 * quantity of the product. They never have their own cost.
 *
 * This intentionally mirrors the existing inventory dashboard rule:
 *
 * - general stock + fully tracked size stock:
 *     use MIN(general, variants)
 * - only general:
 *     use general
 * - only fully tracked variants:
 *     use variants
 * - neither:
 *     quantity is unknown
 */
function getProductQuantity(input: {
  stock: number | null;
  colorVariants: unknown;
}): number | null {
  const variants = Array.isArray(input.colorVariants)
    ? (input.colorVariants as ColorVariant[])
    : [];

  const variantSizes = variants.flatMap(
    (variant) =>
      Array.isArray(variant.sizes)
        ? variant.sizes
        : [],
  );

  const allVariantStocksTracked =
    variantSizes.length > 0 &&
    variantSizes.every(
      (size) =>
        typeof size.stock === "number" &&
        Number.isFinite(size.stock),
    );

  const variantStock =
    allVariantStocksTracked
      ? variantSizes.reduce(
          (sum, size) =>
            sum + Math.max(0, size.stock ?? 0),
          0,
        )
      : null;

  const generalStock =
    typeof input.stock === "number" &&
    Number.isFinite(input.stock)
      ? Math.max(0, input.stock)
      : null;

  if (
    generalStock !== null &&
    variantStock !== null
  ) {
    return Math.min(
      generalStock,
      variantStock,
    );
  }

  if (generalStock !== null) {
    return generalStock;
  }

  if (variantStock !== null) {
    return variantStock;
  }

  return null;
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
    numeric < 0
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

        return {
          ok: true as const,

          product: {
            productId:
              String(product.id),

            nameAr:
              product.nameAr,

            quantity:
              currentQuantity,

            unitCostMinor,

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
