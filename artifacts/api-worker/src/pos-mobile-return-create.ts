import {
  cashSessionsTable,
  posSaleReturnItemsTable,
  posSaleReturnsTable,
  productBarcodesTable,
  productsTable,
  type ColorVariant,
} from "@workspace/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
type PosUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

const MAX_MINOR = 2_000_000_000;
const MAX_STOCK = 2_000_000_000;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers,
  });

class MobileReturnError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type PosAuthResult =
  | {
      ok: true;
      user: PosUser;
    }
  | {
      ok: false;
      response: Response;
    };

async function requirePosUser(
  request: Request,
  db: Db,
  env: Env,
): Promise<PosAuthResult> {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!user) {
    return {
      ok: false,
      response: json(
        {
          error: "يجب تسجيل الدخول",
        },
        401,
      ),
    };
  }

  if (!user.isAdmin && !user.isOwner) {
    return {
      ok: false,
      response: json(
        {
          error:
            "غير مصرح باستخدام نقطة البيع",
        },
        403,
      ),
    };
  }

  return {
    ok: true,
    user,
  };
}

function normalizeRegisterKey(
  value: unknown,
) {
  const key =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : "main";

  return /^[a-z0-9_-]{1,50}$/.test(key)
    ? key
    : null;
}

function normalizeIdempotencyKey(
  value: unknown,
) {
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

function normalizeBarcode(
  value: unknown,
) {
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

function parseOptionalText(
  value: unknown,
  maxLength: number,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const result = value.trim();

  if (result.length > maxLength) {
    return null;
  }

  return result || null;
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

  const minor = Math.round(amount * 100);

  if (
    !Number.isSafeInteger(minor) ||
    minor > MAX_MINOR ||
    Math.abs(minor / 100 - amount) >
      0.000001
  ) {
    return null;
  }

  return minor;
}

interface ParsedMobileReturnItem {
  barcode: string;
  color: string | null;
  size: string | null;
  quantity: number;
  refundUnitPriceMinor: number;
}

function parseItems(
  value: unknown,
): ParsedMobileReturnItem[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 100
  ) {
    throw new MobileReturnError(
      "يجب إضافة صنف واحد على الأقل",
    );
  }

  const seen = new Set<string>();

  return value.map((raw) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      throw new MobileReturnError(
        "بيانات أحد أصناف المردود غير صالحة",
      );
    }

    const item =
      raw as Record<string, unknown>;

    const barcode = normalizeBarcode(
      item.barcode,
    );

    if (!barcode) {
      throw new MobileReturnError(
        "باركود أحد الأصناف غير صالح",
      );
    }

    const color = parseOptionalText(
      item.color,
      100,
    );

    const size = parseOptionalText(
      item.size,
      100,
    );

    const key = [
      barcode,
      color ?? "",
      size ?? "",
    ].join("|");

    if (seen.has(key)) {
      throw new MobileReturnError(
        "لا يمكن تكرار نفس الصنف في المردود",
      );
    }

    seen.add(key);

    const quantity =
      typeof item.quantity === "number"
        ? item.quantity
        : typeof item.quantity === "string"
          ? Number(item.quantity.trim())
          : Number.NaN;

    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 99
    ) {
      throw new MobileReturnError(
        "كمية أحد الأصناف غير صالحة",
      );
    }

    const refundUnitPriceMinor =
      parseMoneyToMinor(
        item.refundUnitPrice,
      );

    if (refundUnitPriceMinor === null) {
      throw new MobileReturnError(
        "سعر مردود أحد الأصناف غير صالح",
      );
    }

    return {
      barcode,
      color,
      size,
      quantity,
      refundUnitPriceMinor,
    };
  });
}

function getPublicId(
  businessDate: string,
) {
  const datePart =
    businessDate.replace(/-/g, "");

  const randomPart = randomUUID()
    .replace(/-/g, "")
    .slice(0, 12)
    .toUpperCase();

  return `MRET-${datePart}-${randomPart}`;
}

async function getExistingReturn(
  db: Db,
  idempotencyKey: string,
) {
  const rows = await db
    .select()
    .from(posSaleReturnsTable)
    .where(
      eq(
        posSaleReturnsTable.idempotencyKey,
        idempotencyKey,
      ),
    )
    .limit(1);

  const saleReturn = rows[0];

  if (!saleReturn) {
    return null;
  }

  const items = await db
    .select()
    .from(posSaleReturnItemsTable)
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

  return {
    saleReturn,
    items,
  };
}

function toResponse(
  saleReturn:
    typeof posSaleReturnsTable.$inferSelect,
  items: Array<
    typeof posSaleReturnItemsTable.$inferSelect
  >,
  alreadyCreated: boolean,
) {
  return {
    alreadyCreated,

    saleReturn: {
      id: String(saleReturn.id),
      publicId: saleReturn.publicId,

      cashSessionId: String(
        saleReturn.cashSessionId,
      ),

      registerKey:
        saleReturn.registerKey,

      businessDate:
        saleReturn.businessDate,

      cashierUserId: String(
        saleReturn.cashierUserId,
      ),

      status: saleReturn.status,

      grossAmountMinor:
        saleReturn.grossAmountMinor,

      grossAmount:
        saleReturn.grossAmountMinor /
        100,

      refundAmountMinor:
        saleReturn.refundAmountMinor,

      refundAmount:
        saleReturn.refundAmountMinor /
        100,

      reason: saleReturn.reason,

      createdAt:
        saleReturn.createdAt.toISOString(),
    },

    items: items.map((item) => ({
      id: String(item.id),

      productId:
        item.productId === null
          ? null
          : String(item.productId),

      barcode: item.barcode,
      productCode: item.productCode,

      productNameAr:
        item.productNameAr,

      color: item.color,
      size: item.size,

      quantity: item.quantity,

      refundUnitPriceMinor:
        item.soldUnitPriceMinor,

      refundUnitPrice:
        item.soldUnitPriceMinor / 100,

      refundAmountMinor:
        item.refundAmountMinor,

      refundAmount:
        item.refundAmountMinor / 100,

      generalStockBefore:
        item.generalStockBefore,

      generalStockAfter:
        item.generalStockAfter,

      variantStockBefore:
        item.variantStockBefore,

      variantStockAfter:
        item.variantStockAfter,
    })),
  };
}

export async function handleCreateMobileEmergencyReturn(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response> {
  const auth = await requirePosUser(
    request,
    db,
    env,
  );

  if (!auth.ok) {
    return auth.response;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        error:
          "بيانات مردود الهاتف غير صالحة",
      },
      400,
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return json(
      {
        error:
          "بيانات مردود الهاتف غير صالحة",
      },
      400,
    );
  }

  const payload =
    body as Record<string, unknown>;

  try {
    const registerKey =
      normalizeRegisterKey(
        payload.registerKey,
      );

    if (!registerKey) {
      throw new MobileReturnError(
        "معرّف نقطة البيع غير صالح",
      );
    }

    const idempotencyKey =
      normalizeIdempotencyKey(
        payload.idempotencyKey,
      );

    if (!idempotencyKey) {
      throw new MobileReturnError(
        "معرّف عملية المردود غير صالح",
      );
    }

    const requestedItems =
      parseItems(payload.items);

    const existing =
      await getExistingReturn(
        db,
        idempotencyKey,
      );

    if (existing) {
      return json(
        toResponse(
          existing.saleReturn,
          existing.items,
          true,
        ),
      );
    }

    const result =
      await db.transaction(
        async (tx) => {
          const duplicateRows =
            await tx
              .select()
              .from(posSaleReturnsTable)
              .where(
                eq(
                  posSaleReturnsTable.idempotencyKey,
                  idempotencyKey,
                ),
              )
              .limit(1);

          if (duplicateRows[0]) {
            const duplicateItems =
              await tx
                .select()
                .from(
                  posSaleReturnItemsTable,
                )
                .where(
                  eq(
                    posSaleReturnItemsTable.returnId,
                    duplicateRows[0].id,
                  ),
                )
                .orderBy(
                  asc(
                    posSaleReturnItemsTable.lineNumber,
                  ),
                );

            return {
              saleReturn:
                duplicateRows[0],

              items:
                duplicateItems,

              alreadyCreated: true,
            };
          }

          const sessionRows =
            await tx
              .select()
              .from(cashSessionsTable)
              .where(
                and(
                  eq(
                    cashSessionsTable.registerKey,
                    registerKey,
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
            throw new MobileReturnError(
              "يجب فتح يوم العمل أولًا",
              409,
            );
          }

          const grossAmountMinor =
            requestedItems.reduce(
              (total, item) =>
                total +
                item.refundUnitPriceMinor *
                  item.quantity,
              0,
            );

          if (
            !Number.isSafeInteger(
              grossAmountMinor,
            ) ||
            grossAmountMinor < 0 ||
            grossAmountMinor > MAX_MINOR
          ) {
            throw new MobileReturnError(
              "قيمة المردود تتجاوز الحد المسموح",
            );
          }

          const expectedBefore =
            session.expectedBalanceMinor ??
            session.openingBalanceMinor;

          if (
            expectedBefore <
            grossAmountMinor
          ) {
            throw new MobileReturnError(
              "رصيد الصندوق لا يكفي لتنفيذ مبلغ المردود",
              409,
            );
          }

          const expectedAfter =
            expectedBefore -
            grossAmountMinor;

          const returnLines: Array<
            Omit<
              typeof posSaleReturnItemsTable.$inferInsert,
              "returnId"
            >
          > = [];

          let lineNumber = 1;

          for (
            const requested of requestedItems
          ) {
            const barcodeRows =
              await tx
                .select()
                .from(
                  productBarcodesTable,
                )
                .where(
                  eq(
                    productBarcodesTable.barcode,
                    requested.barcode,
                  ),
                )
                .limit(1);

            const mappedBarcode =
              barcodeRows[0] ?? null;

            let productRows;

            if (mappedBarcode) {
              productRows = await tx
                .select()
                .from(productsTable)
                .where(
                  eq(
                    productsTable.id,
                    mappedBarcode.productId,
                  ),
                )
                .for("update");
            } else {
              productRows = await tx
                .select()
                .from(productsTable)
                .where(
                  eq(
                    productsTable.barcode,
                    requested.barcode,
                  ),
                )
                .for("update");
            }

            const product =
              productRows[0];

            if (!product) {
              throw new MobileReturnError(
                `الباركود ${requested.barcode} غير موجود`,
                404,
              );
            }

            if (product.deletedAt) {
              throw new MobileReturnError(
                `المنتج ${product.nameAr} محذوف ولا يمكن إرجاعه للمخزون`,
                409,
              );
            }

            const color =
              mappedBarcode?.color ??
              requested.color;

            const size =
              mappedBarcode?.size ??
              requested.size;

            if (
              mappedBarcode?.color &&
              requested.color &&
              mappedBarcode.color !==
                requested.color
            ) {
              throw new MobileReturnError(
                `لون باركود ${requested.barcode} غير مطابق`,
                409,
              );
            }

            if (
              mappedBarcode?.size &&
              requested.size &&
              mappedBarcode.size !==
                requested.size
            ) {
              throw new MobileReturnError(
                `مقاس باركود ${requested.barcode} غير مطابق`,
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

            if (
              product.stock !== null &&
              product.stock !== undefined
            ) {
              generalStockBefore =
                product.stock;

              generalStockAfter =
                product.stock +
                requested.quantity;

              if (
                !Number.isSafeInteger(
                  generalStockAfter,
                ) ||
                generalStockAfter >
                  MAX_STOCK
              ) {
                throw new MobileReturnError(
                  `مخزون ${product.nameAr} يتجاوز الحد المسموح`,
                );
              }

              updates.stock =
                generalStockAfter;
            }

            let variantStockBefore:
              | number
              | null = null;

            let variantStockAfter:
              | number
              | null = null;

            if (color || size) {
              if (!color || !size) {
                throw new MobileReturnError(
                  `بيانات اللون أو المقاس للمنتج ${product.nameAr} غير مكتملة`,
                  409,
                );
              }

              const colorVariants =
                (product.colorVariants as
                  | ColorVariant[]
                  | null) ?? [];

              const variantIndex =
                colorVariants.findIndex(
                  (variant) =>
                    variant.color ===
                    color,
                );

              if (variantIndex < 0) {
                throw new MobileReturnError(
                  `اللون ${color} غير موجود في ${product.nameAr}`,
                  409,
                );
              }

              const variant =
                colorVariants[
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
                  (entry) =>
                    entry.size === size,
                );

              if (sizeIndex < 0) {
                throw new MobileReturnError(
                  `المقاس ${size} غير موجود في ${product.nameAr}`,
                  409,
                );
              }

              const selectedSize =
                sizes[sizeIndex];

              if (
                selectedSize.stock !==
                  null &&
                selectedSize.stock !==
                  undefined
              ) {
                variantStockBefore =
                  selectedSize.stock;

                variantStockAfter =
                  selectedSize.stock +
                  requested.quantity;

                if (
                  !Number.isSafeInteger(
                    variantStockAfter,
                  ) ||
                  variantStockAfter >
                    MAX_STOCK
                ) {
                  throw new MobileReturnError(
                    `مخزون ${product.nameAr} / ${color} / ${size} يتجاوز الحد المسموح`,
                  );
                }

                const nextSizes =
                  sizes.map(
                    (
                      entry,
                      index,
                    ) =>
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
            }

            if (
              generalStockAfter === null &&
              variantStockAfter === null
            ) {
              throw new MobileReturnError(
                `لا يوجد مخزون قابل للتتبع للمنتج ${product.nameAr}`,
                409,
              );
            }

            await tx
              .update(productsTable)
              .set(updates)
              .where(
                eq(
                  productsTable.id,
                  product.id,
                ),
              );

            const lineAmountMinor =
              requested.refundUnitPriceMinor *
              requested.quantity;

            returnLines.push({
              originalSaleItemId: null,

              lineNumber,

              productId:
                product.id,

              barcode:
                requested.barcode,

              productCode:
                product.productCode ??
                null,

              productNameAr:
                product.nameAr,

              color,
              size,

              quantity:
                requested.quantity,

              soldUnitPriceMinor:
                requested.refundUnitPriceMinor,

              grossAmountMinor:
                lineAmountMinor,

              lineDiscountMinor: 0,

              invoiceDiscountMinor: 0,

              allocatedDiscountMinor: 0,

              refundAmountMinor:
                lineAmountMinor,

              generalStockBefore,
              generalStockAfter,

              variantStockBefore,
              variantStockAfter,
            });

            lineNumber += 1;
          }

          const insertedReturns =
            await tx
              .insert(
                posSaleReturnsTable,
              )
              .values({
                publicId:
                  getPublicId(
                    session.businessDate,
                  ),

                idempotencyKey,

                originalSaleId: null,

                cashSessionId:
                  session.id,

                registerKey,

                businessDate:
                  session.businessDate,

                cashierUserId:
                  auth.user.id,

                status: "completed",

                refundMethod: "cash",

                grossAmountMinor,

                discountAmountMinor: 0,

                refundAmountMinor:
                  grossAmountMinor,

                reason:
                  "مردود مبيعات من الهاتف",

                notes:
                  "مردود احتياطي من شاشة الهاتف بدون ربط بفاتورة أصلية",
              })
              .returning();

          const saleReturn =
            insertedReturns[0];

          if (!saleReturn) {
            throw new Error(
              "MOBILE_POS_RETURN_INSERT_FAILED",
            );
          }

          const insertedItems =
            await tx
              .insert(
                posSaleReturnItemsTable,
              )
              .values(
                returnLines.map(
                  (line) => ({
                    ...line,

                    returnId:
                      saleReturn.id,
                  }),
                ),
              )
              .returning();

          const updatedSessionRows =
            await tx
              .update(
                cashSessionsTable,
              )
              .set({
                expectedBalanceMinor:
                  expectedAfter,

                updatedAt:
                  new Date(),
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
                id: cashSessionsTable.id,
              });

          if (
            !updatedSessionRows[0]
          ) {
            throw new MobileReturnError(
              "تم إغلاق الصندوق قبل إتمام المردود",
              409,
            );
          }

          return {
            saleReturn,

            items:
              insertedItems.sort(
                (left, right) =>
                  left.lineNumber -
                  right.lineNumber,
              ),

            alreadyCreated: false,
          };
        },
      );

    return json(
      toResponse(
        result.saleReturn,
        result.items,
        result.alreadyCreated,
      ),

      result.alreadyCreated
        ? 200
        : 201,
    );
  } catch (error) {
    if (
      error instanceof
      MobileReturnError
    ) {
      return json(
        {
          error: error.message,
        },
        error.status,
      );
    }

    const code = (
      error as {
        code?: string;
      }
    ).code;

    if (code === "23505") {
      const key =
        normalizeIdempotencyKey(
          payload.idempotencyKey,
        );

      if (key) {
        const existing =
          await getExistingReturn(
            db,
            key,
          );

        if (existing) {
          return json(
            toResponse(
              existing.saleReturn,
              existing.items,
              true,
            ),
          );
        }
      }
    }

    console.error(
      "MOBILE_POS_RETURN_ERROR",
      error,
    );

    return json(
      {
        error:
          "تعذر تنفيذ مردود الهاتف",
      },
      500,
    );
  }
}
