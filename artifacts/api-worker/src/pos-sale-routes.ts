import {
  cashSessionsTable,
  posSaleItemsTable,
  posSaleReturnsTable,
  posSalesTable,
  productBarcodesTable,
  productsTable,
  type ColorVariant,
} from "@workspace/db/schema";
import { and, asc, desc, eq, gt, ilike, inArray, lt, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";
import { handleUpdatePosSale } from "./pos-sale-edit";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

type PosUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

const MAX_MINOR = 2_000_000_000;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers,
  });

class PosSaleError extends Error {
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
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return {
      ok: false,
      response: json({ error: "يجب تسجيل الدخول" }, 401),
    };
  }

  if (!user.isAdmin && !user.isOwner) {
    return {
      ok: false,
      response: json(
        {
          error: "غير مصرح باستخدام نقطة البيع",
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

function normalizeRegisterKey(value: unknown): string | null {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "main";

  return /^[a-z0-9_-]{1,50}$/.test(key) ? key : null;
}

function normalizeBarcode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const barcode = value.trim();

  if (barcode.length < 1 || barcode.length > 128) {
    return null;
  }

  return barcode;
}

function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const key = value.trim();

  if (key.length < 8 || key.length > 100 || !/^[A-Za-z0-9:_-]+$/.test(key)) {
    return null;
  }

  return key;
}

function parseMoneyToMinor(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }

  const normalized =
    typeof value === "string" ? value.trim().replace(",", ".") : value;

  const amount =
    typeof normalized === "number" ? normalized : Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  const minor = Math.round(amount * 100);

  if (
    Math.abs(minor / 100 - amount) > 0.000001 ||
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
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new PosSaleError(`${fieldName} غير صالح`);
  }

  const text = value.trim();

  if (text.length > maxLength) {
    throw new PosSaleError(`${fieldName} طويل جدًا`);
  }

  return text || null;
}

interface ParsedSaleItem {
  lineNumber: number;
  barcode: string;
  quantity: number;
  soldUnitPriceMinor: number;
  lineDiscountMinor: number;
  color: string | null;
  size: string | null;
}

function parseSaleItems(value: unknown): ParsedSaleItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new PosSaleError("يجب إضافة صنف واحد على الأقل");
  }

  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new PosSaleError("بيانات أحد الأصناف غير صالحة");
    }

    const item = raw as Record<string, unknown>;

    const barcode = normalizeBarcode(item.barcode);

    if (!barcode) {
      throw new PosSaleError("باركود أحد الأصناف غير صالح");
    }

    const quantity =
      typeof item.quantity === "number"
        ? item.quantity
        : typeof item.quantity === "string" && item.quantity.trim()
          ? Number(item.quantity)
          : Number.NaN;

    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new PosSaleError("كمية أحد الأصناف غير صالحة");
    }

    const soldUnitPriceMinor = parseMoneyToMinor(item.soldUnitPrice);

    if (soldUnitPriceMinor === null) {
      throw new PosSaleError("سعر بيع أحد الأصناف غير صالح");
    }

    const lineDiscountMinor =
      item.lineDiscount === undefined
        ? 0
        : parseMoneyToMinor(item.lineDiscount);

    if (lineDiscountMinor === null) {
      throw new PosSaleError("خصم أحد الأصناف غير صالح");
    }

    const lineGrossMinor = soldUnitPriceMinor * quantity;

    if (
      !Number.isSafeInteger(lineGrossMinor) ||
      lineGrossMinor > MAX_MINOR ||
      lineDiscountMinor > lineGrossMinor
    ) {
      throw new PosSaleError("خصم أحد الأصناف أكبر من قيمة الصنف");
    }

    return {
      lineNumber: index + 1,
      barcode,
      quantity,
      soldUnitPriceMinor,
      lineDiscountMinor,

      color: parseOptionalText(item.color, 100, "اللون"),

      size: parseOptionalText(item.size, 100, "المقاس"),
    };
  });
}

function getPublicId(businessDate: string): string {
  const datePart = businessDate.replace(/-/g, "");

  const randomPart = randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();

  return `POS-${datePart}-${randomPart}`;
}

function toSaleResponse(
  sale: typeof posSalesTable.$inferSelect,
  items: Array<typeof posSaleItemsTable.$inferSelect>,
  alreadyCreated: boolean,
  navigation: {
    previousPublicId: string | null;
    nextPublicId: string | null;
  } = {
    previousPublicId: null,
    nextPublicId: null,
  },
) {
  return {
    alreadyCreated,
    navigation,

    sale: {
      id: String(sale.id),
      publicId: sale.publicId,
      cashSessionId: String(sale.cashSessionId),
      registerKey: sale.registerKey,
      businessDate: sale.businessDate,
      cashierUserId: String(sale.cashierUserId),
      status: sale.status,
      paymentMethod: sale.paymentMethod,

      subtotalMinor: sale.subtotalMinor,
      subtotal: sale.subtotalMinor / 100,

      discountMinor: sale.discountMinor,
      discount: sale.discountMinor / 100,

      itemDiscountMinor: sale.itemDiscountMinor,
      itemDiscount: sale.itemDiscountMinor / 100,

      invoiceDiscountMinor: sale.invoiceDiscountMinor,
      invoiceDiscount: sale.invoiceDiscountMinor / 100,

      totalMinor: sale.totalMinor,
      total: sale.totalMinor / 100,

      paidMinor: sale.paidMinor,
      paid: sale.paidMinor / 100,

      changeMinor: sale.changeMinor,
      change: sale.changeMinor / 100,

      customerName: sale.customerName,
      customerPhone: sale.customerPhone,
      notes: sale.notes,

      voidedAt: sale.voidedAt?.toISOString() ?? null,

      voidedByUserId:
        sale.voidedByUserId === null ? null : String(sale.voidedByUserId),

      voidReason: sale.voidReason,

      createdAt: sale.createdAt.toISOString(),
      updatedAt: sale.updatedAt.toISOString(),
    },

    items: items.map((item) => ({
      id: String(item.id),

      productId: item.productId === null ? null : String(item.productId),

      lineNumber: item.lineNumber,
      barcode: item.barcode,
      productCode: item.productCode,
      productNameAr: item.productNameAr,
      productImage: item.productImage,

      color: item.color,
      size: item.size,
      quantity: item.quantity,

      websiteUnitPriceMinor: item.websiteUnitPriceMinor,

      websiteUnitPrice: item.websiteUnitPriceMinor / 100,

      soldUnitPriceMinor: item.soldUnitPriceMinor,

      soldUnitPrice: item.soldUnitPriceMinor / 100,

      lineDiscountMinor: item.lineDiscountMinor,
      lineDiscount: item.lineDiscountMinor / 100,

      lineTotalMinor: item.lineTotalMinor,

      lineTotal: item.lineTotalMinor / 100,

      generalStockBefore: item.generalStockBefore,

      generalStockAfter: item.generalStockAfter,

      variantStockBefore: item.variantStockBefore,

      variantStockAfter: item.variantStockAfter,
    })),
  };
}

async function getExistingSale(db: Db, idempotencyKey: string) {
  const saleRows = await db
    .select()
    .from(posSalesTable)
    .where(eq(posSalesTable.idempotencyKey, idempotencyKey))
    .limit(1);

  const sale = saleRows[0];

  if (!sale) {
    return null;
  }

  const items = await db
    .select()
    .from(posSaleItemsTable)
    .where(eq(posSaleItemsTable.saleId, sale.id))
    .orderBy(asc(posSaleItemsTable.lineNumber));

  return {
    sale,
    items,
  };
}

function toPosProductLookup(
  product: typeof productsTable.$inferSelect,
  barcode: string,
  color: string | null,
  size: string | null,
) {
  const colorVariants = (product.colorVariants as ColorVariant[] | null) ?? [];

  let exactStock = product.stock ?? null;

  let outOfStock =
    product.stock !== null && product.stock !== undefined && product.stock <= 0;

  if (color && size) {
    const variant = colorVariants.find((entry) => entry.color === color);

    const sizeEntry = variant?.sizes?.find((entry) => entry.size === size);

    if (sizeEntry) {
      exactStock = sizeEntry.stock ?? null;

      outOfStock =
        !!sizeEntry.outOfStock ||
        (sizeEntry.stock !== null &&
          sizeEntry.stock !== undefined &&
          sizeEntry.stock <= 0);
    }
  }

  return {
    productId: String(product.id),
    barcode,
    productCode: product.productCode ?? null,
    nameAr: product.nameAr,
    image: product.image,
    websiteUnitPrice: product.price,
    websiteUnitPriceMinor: product.price * 100,
    mappedColor: color,
    mappedSize: size,
    sizes: (product.sizes as string[]) ?? [],
    colorVariants,
    stock: exactStock,
    outOfStock,
  };
}

function normalizeProductSearch(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const query = value.trim();

  if (query.length < 1 || query.length > 100) {
    return null;
  }

  return query;
}

async function handleProductSearch(request: Request, db: Db, env: Env) {
  const auth = await requirePosUser(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);

  const query = normalizeProductSearch(url.searchParams.get("q"));

  if (!query) {
    return json(
      {
        error: "أدخل اسم الصنف أو الكود أو الباركود",
      },
      400,
    );
  }

  const requestedLimit = Number(url.searchParams.get("limit") ?? "15");

  const limit =
    Number.isSafeInteger(requestedLimit) &&
    requestedLimit >= 1 &&
    requestedLimit <= 25
      ? requestedLimit
      : 15;

  const pattern = `%${query}%`;
  const candidateLimit = limit * 3;

  const primaryMatches = await db
    .select()
    .from(productsTable)
    .where(
      or(
        ilike(productsTable.nameAr, pattern),
        ilike(productsTable.name, pattern),
        ilike(productsTable.productCode, pattern),
        ilike(productsTable.barcode, pattern),
      ),
    )
    .limit(candidateLimit);

  const barcodeMatches = await db
    .select({
      productId: productBarcodesTable.productId,
      barcode: productBarcodesTable.barcode,
      color: productBarcodesTable.color,
      size: productBarcodesTable.size,
    })
    .from(productBarcodesTable)
    .where(ilike(productBarcodesTable.barcode, pattern))
    .limit(candidateLimit);

  const barcodeProductIds = [
    ...new Set(barcodeMatches.map((row) => row.productId)),
  ];

  const barcodeProducts =
    barcodeProductIds.length > 0
      ? await db
          .select()
          .from(productsTable)
          .where(inArray(productsTable.id, barcodeProductIds))
      : [];

  const productsById = new Map<number, typeof productsTable.$inferSelect>();

  for (const product of [...primaryMatches, ...barcodeProducts]) {
    productsById.set(product.id, product);
  }

  const candidateIds = [...productsById.keys()];

  const candidateBarcodes =
    candidateIds.length > 0
      ? await db
          .select({
            productId: productBarcodesTable.productId,
            barcode: productBarcodesTable.barcode,
            color: productBarcodesTable.color,
            size: productBarcodesTable.size,
          })
          .from(productBarcodesTable)
          .where(inArray(productBarcodesTable.productId, candidateIds))
      : [];

  const barcodesByProduct = new Map<number, typeof candidateBarcodes>();

  for (const row of candidateBarcodes) {
    const current = barcodesByProduct.get(row.productId) ?? [];

    current.push(row);

    barcodesByProduct.set(row.productId, current);
  }

  const normalizedQuery = query.toLocaleLowerCase("ar");

  const ranked = [...productsById.values()]
    .map((product) => {
      const extraBarcodes = barcodesByProduct.get(product.id) ?? [];

      const primaryBarcode = product.barcode?.trim() || null;

      const fallbackBarcode = extraBarcodes[0] ?? null;

      const productCode =
        product.productCode?.trim().toLocaleLowerCase("ar") ?? "";

      const primaryBarcodeValue = primaryBarcode?.toLocaleLowerCase("ar") ?? "";

      const name = product.nameAr.trim().toLocaleLowerCase("ar");

      const exactExtraBarcode = extraBarcodes.find(
        (row) => row.barcode.toLocaleLowerCase("ar") === normalizedQuery,
      );

      const selectedMapping =
        exactExtraBarcode ?? (primaryBarcode ? null : fallbackBarcode);

      const selectedBarcode =
        exactExtraBarcode?.barcode ??
        primaryBarcode ??
        fallbackBarcode?.barcode ??
        null;

      if (!selectedBarcode) {
        return null;
      }

      let rank = 4;

      if (
        productCode === normalizedQuery ||
        primaryBarcodeValue === normalizedQuery ||
        exactExtraBarcode
      ) {
        rank = 0;
      } else if (
        name.startsWith(normalizedQuery) ||
        productCode.startsWith(normalizedQuery)
      ) {
        rank = 1;
      } else if (
        name.includes(normalizedQuery) ||
        productCode.includes(normalizedQuery)
      ) {
        rank = 2;
      } else {
        rank = 3;
      }

      return {
        rank,
        name,
        result: toPosProductLookup(
          product,
          selectedBarcode,
          selectedMapping?.color ?? null,
          selectedMapping?.size ?? null,
        ),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort(
      (left, right) =>
        left.rank - right.rank || left.name.localeCompare(right.name, "ar"),
    )
    .slice(0, limit)
    .map((item) => item.result);

  return json({
    query,
    results: ranked,
  });
}

async function handleBarcodeLookup(request: Request, db: Db, env: Env) {
  const auth = await requirePosUser(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);

  const barcode = normalizeBarcode(url.searchParams.get("barcode"));

  if (!barcode) {
    return json({ error: "الباركود غير صالح" }, 400);
  }

  const mappedRows = await db
    .select()
    .from(productBarcodesTable)
    .where(eq(productBarcodesTable.barcode, barcode))
    .limit(1);

  const mapping = mappedRows[0];

  const productRows = mapping
    ? await db
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, mapping.productId))
        .limit(1)
    : await db
        .select()
        .from(productsTable)
        .where(eq(productsTable.barcode, barcode))
        .limit(1);

  const product = productRows[0];

  if (!product) {
    return json({ error: "لم يتم العثور على المنتج" }, 404);
  }

  return json(
    toPosProductLookup(
      product,
      barcode,
      mapping?.color ?? null,
      mapping?.size ?? null,
    ),
  );
}

async function handleCreateSale(request: Request, db: Db, env: Env) {
  const auth = await requirePosUser(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "بيانات الفاتورة غير صالحة" }, 400);
  }

  try {
    const payload = body as Record<string, unknown>;

    const registerKey = normalizeRegisterKey(payload.registerKey ?? "main");

    if (!registerKey) {
      throw new PosSaleError("معرف صندوق غير صالح");
    }

    const idempotencyKey = normalizeIdempotencyKey(payload.idempotencyKey);

    if (!idempotencyKey) {
      throw new PosSaleError("مفتاح منع تكرار الفاتورة غير صالح");
    }

    if (
      payload.paymentMethod !== undefined &&
      payload.paymentMethod !== "cash"
    ) {
      throw new PosSaleError("الدفع النقدي فقط متاح حاليًا");
    }

    const items = parseSaleItems(payload.items);

    const invoiceDiscountMinor =
      payload.discountAmount === undefined
        ? 0
        : parseMoneyToMinor(payload.discountAmount);

    if (invoiceDiscountMinor === null) {
      throw new PosSaleError("خصم الفاتورة غير صالح");
    }

    const paidMinor = parseMoneyToMinor(payload.paidAmount);

    if (paidMinor === null) {
      throw new PosSaleError("المبلغ المدفوع غير صالح");
    }

    const customerName = parseOptionalText(
      payload.customerName,
      150,
      "اسم العميل",
    );

    const customerPhone = parseOptionalText(
      payload.customerPhone,
      50,
      "هاتف العميل",
    );

    const notes = parseOptionalText(payload.notes, 1000, "الملاحظات");

    const result = await db.transaction(async (tx) => {
      const existingSaleRows = await tx
        .select()
        .from(posSalesTable)
        .where(eq(posSalesTable.idempotencyKey, idempotencyKey))
        .limit(1);

      const existingSale = existingSaleRows[0];

      if (existingSale) {
        if (existingSale.registerKey !== registerKey) {
          throw new PosSaleError("مفتاح الفاتورة مستخدم لصندوق آخر", 409);
        }

        const existingItems = await tx
          .select()
          .from(posSaleItemsTable)
          .where(eq(posSaleItemsTable.saleId, existingSale.id))
          .orderBy(asc(posSaleItemsTable.lineNumber));

        return {
          sale: existingSale,
          items: existingItems,
          alreadyCreated: true,
        };
      }

      const resolvedItems: Array<
        ParsedSaleItem & {
          productId: number;
          mappedColor: string | null;
          mappedSize: string | null;
        }
      > = [];

      for (const item of items) {
        const mappingRows = await tx
          .select()
          .from(productBarcodesTable)
          .where(eq(productBarcodesTable.barcode, item.barcode))
          .limit(1);

        const mapping = mappingRows[0];

        if (mapping) {
          resolvedItems.push({
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
          .where(eq(productsTable.barcode, item.barcode))
          .limit(1);

        const primary = primaryRows[0];

        if (!primary) {
          throw new PosSaleError(`الباركود ${item.barcode} غير موجود`, 404);
        }

        resolvedItems.push({
          ...item,
          productId: primary.id,
          mappedColor: null,
          mappedSize: null,
        });
      }

      resolvedItems.sort(
        (left, right) =>
          left.productId - right.productId ||
          left.lineNumber - right.lineNumber,
      );

      const sessionRows = await tx
        .select()
        .from(cashSessionsTable)
        .where(
          and(
            eq(cashSessionsTable.registerKey, registerKey),
            eq(cashSessionsTable.status, "open"),
          ),
        )
        .for("update");

      const session = sessionRows[0];

      if (!session) {
        throw new PosSaleError("يجب فتح يوم الصندوق قبل البيع", 409);
      }

      const saleLines: Array<typeof posSaleItemsTable.$inferInsert> = [];

      let subtotalMinor = 0;
      let itemDiscountMinor = 0;

      for (const item of resolvedItems) {
        const productRows = await tx
          .select()
          .from(productsTable)
          .where(eq(productsTable.id, item.productId))
          .for("update");

        const product = productRows[0];

        if (!product) {
          throw new PosSaleError("أحد المنتجات لم يعد موجودًا", 404);
        }

        if (!Number.isSafeInteger(product.price) || product.price < 0) {
          throw new PosSaleError(`سعر المنتج ${product.nameAr} غير صالح`);
        }

        if (item.mappedColor && item.color && item.mappedColor !== item.color) {
          throw new PosSaleError(`لون باركود ${item.barcode} غير مطابق`);
        }

        if (item.mappedSize && item.size && item.mappedSize !== item.size) {
          throw new PosSaleError(`مقاس باركود ${item.barcode} غير مطابق`);
        }

        const color = item.mappedColor ?? item.color;

        const size = item.mappedSize ?? item.size;

        const colorVariants =
          (product.colorVariants as ColorVariant[] | null) ?? [];

        const generalSizes = (product.sizes as string[] | null) ?? [];

        let nextColorVariants: ColorVariant[] | undefined;

        let variantStockBefore: number | null = null;

        let variantStockAfter: number | null = null;

        if (colorVariants.length > 0) {
          if (!color) {
            throw new PosSaleError(`يجب تحديد لون ${product.nameAr}`);
          }

          const variantIndex = colorVariants.findIndex(
            (variant) => variant.color === color,
          );

          if (variantIndex < 0) {
            throw new PosSaleError(`لون ${product.nameAr} غير متوفر`);
          }

          const variant = colorVariants[variantIndex];

          const variantSizes = Array.isArray(variant.sizes)
            ? variant.sizes
            : [];

          if (variantSizes.length > 0) {
            if (!size) {
              throw new PosSaleError(`يجب تحديد مقاس ${product.nameAr}`);
            }

            const sizeIndex = variantSizes.findIndex(
              (entry) => entry.size === size,
            );

            if (sizeIndex < 0) {
              throw new PosSaleError(`مقاس ${product.nameAr} غير متوفر`);
            }

            const selectedSize = variantSizes[sizeIndex];

            variantStockBefore = selectedSize.stock ?? null;

            if (
              selectedSize.outOfStock ||
              (selectedSize.stock !== null &&
                selectedSize.stock !== undefined &&
                selectedSize.stock < item.quantity)
            ) {
              throw new PosSaleError(
                `الكمية المطلوبة من ${product.nameAr} غير متوفرة`,
                409,
              );
            }

            if (
              selectedSize.stock !== null &&
              selectedSize.stock !== undefined
            ) {
              variantStockAfter = selectedSize.stock - item.quantity;

              const nextSizes = variantSizes.map((entry, index) =>
                index === sizeIndex
                  ? {
                      ...entry,
                      stock: variantStockAfter,
                      outOfStock: variantStockAfter! <= 0,
                    }
                  : entry,
              );

              nextColorVariants = colorVariants.map((entry, index) =>
                index === variantIndex
                  ? {
                      ...entry,
                      sizes: nextSizes,
                    }
                  : entry,
              );
            }
          } else if (size) {
            throw new PosSaleError(`المقاس غير صالح للمنتج ${product.nameAr}`);
          }
        } else {
          if (color) {
            throw new PosSaleError(`اللون غير صالح للمنتج ${product.nameAr}`);
          }

          if (generalSizes.length > 0) {
            if (!size || !generalSizes.includes(size)) {
              throw new PosSaleError(`مقاس ${product.nameAr} غير متوفر`);
            }
          } else if (size) {
            throw new PosSaleError(`المقاس غير صالح للمنتج ${product.nameAr}`);
          }
        }

        const generalStockBefore = product.stock ?? null;

        let generalStockAfter: number | null = null;

        if (product.stock !== null && product.stock !== undefined) {
          if (product.stock < item.quantity) {
            throw new PosSaleError(
              `الكمية المطلوبة من ${product.nameAr} غير متوفرة`,
              409,
            );
          }

          generalStockAfter = product.stock - item.quantity;
        }

        const updates: {
          stock?: number;
          colorVariants?: ColorVariant[];
        } = {};

        if (generalStockAfter !== null) {
          updates.stock = generalStockAfter;
        }

        if (nextColorVariants !== undefined) {
          updates.colorVariants = nextColorVariants;
        }

        if (Object.keys(updates).length > 0) {
          await tx
            .update(productsTable)
            .set(updates)
            .where(eq(productsTable.id, product.id));
        }

        const websiteUnitPriceMinor = product.price * 100;

        const lineGrossMinor = item.soldUnitPriceMinor * item.quantity;

        const lineDiscountMinor = item.lineDiscountMinor;

        const lineTotalMinor = lineGrossMinor - lineDiscountMinor;

        if (
          !Number.isSafeInteger(websiteUnitPriceMinor) ||
          websiteUnitPriceMinor > MAX_MINOR ||
          !Number.isSafeInteger(lineGrossMinor) ||
          lineGrossMinor > MAX_MINOR ||
          !Number.isSafeInteger(lineDiscountMinor) ||
          lineDiscountMinor < 0 ||
          lineDiscountMinor > lineGrossMinor ||
          !Number.isSafeInteger(lineTotalMinor) ||
          lineTotalMinor < 0 ||
          lineTotalMinor > MAX_MINOR
        ) {
          throw new PosSaleError("قيمة الفاتورة تتجاوز الحد المسموح");
        }

        subtotalMinor += lineGrossMinor;
        itemDiscountMinor += lineDiscountMinor;

        if (
          !Number.isSafeInteger(subtotalMinor) ||
          subtotalMinor > MAX_MINOR ||
          !Number.isSafeInteger(itemDiscountMinor) ||
          itemDiscountMinor > MAX_MINOR
        ) {
          throw new PosSaleError("إجمالي الفاتورة يتجاوز الحد المسموح");
        }

        saleLines.push({
          saleId: 0,
          lineNumber: item.lineNumber,
          productId: product.id,
          barcode: item.barcode,
          productCode: product.productCode ?? null,
          productNameAr: product.nameAr,
          productImage: product.image,
          color,
          size,
          quantity: item.quantity,
          websiteUnitPriceMinor,
          soldUnitPriceMinor: item.soldUnitPriceMinor,
          lineDiscountMinor,
          lineTotalMinor,
          generalStockBefore,
          generalStockAfter,
          variantStockBefore,
          variantStockAfter,
        });
      }

      const itemsNetMinor = subtotalMinor - itemDiscountMinor;

      if (invoiceDiscountMinor > itemsNetMinor) {
        throw new PosSaleError("خصم الفاتورة أكبر من صافي قيمة الأصناف");
      }

      const discountMinor = itemDiscountMinor + invoiceDiscountMinor;

      if (
        !Number.isSafeInteger(discountMinor) ||
        discountMinor > subtotalMinor
      ) {
        throw new PosSaleError("إجمالي الخصومات غير صالح");
      }

      const totalMinor = subtotalMinor - discountMinor;

      if (paidMinor < totalMinor) {
        throw new PosSaleError("المبلغ المدفوع أقل من قيمة الفاتورة");
      }

      const changeMinor = paidMinor - totalMinor;

      const expectedBefore =
        session.expectedBalanceMinor ?? session.openingBalanceMinor;

      const expectedAfter = expectedBefore + totalMinor;

      if (!Number.isSafeInteger(expectedAfter) || expectedAfter > MAX_MINOR) {
        throw new PosSaleError("رصيد الصندوق يتجاوز الحد المسموح");
      }

      const saleRows = await tx
        .insert(posSalesTable)
        .values({
          publicId: getPublicId(session.businessDate),
          idempotencyKey,
          cashSessionId: session.id,
          registerKey,
          businessDate: session.businessDate,
          cashierUserId: auth.user.id,
          status: "completed",
          paymentMethod: "cash",
          subtotalMinor,
          discountMinor,
          itemDiscountMinor,
          invoiceDiscountMinor,
          totalMinor,
          paidMinor,
          changeMinor,
          customerName,
          customerPhone,
          notes,
        })
        .returning();

      const sale = saleRows[0];

      if (!sale) {
        throw new Error("POS_SALE_INSERT_FAILED");
      }

      const insertedItems = await tx
        .insert(posSaleItemsTable)
        .values(
          saleLines
            .sort((left, right) => left.lineNumber - right.lineNumber)
            .map((line) => ({
              ...line,
              saleId: sale.id,
            })),
        )
        .returning();

      const updatedSessionRows = await tx
        .update(cashSessionsTable)
        .set({
          expectedBalanceMinor: expectedAfter,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(cashSessionsTable.id, session.id),
            eq(cashSessionsTable.status, "open"),
          ),
        )
        .returning({
          id: cashSessionsTable.id,
        });

      if (!updatedSessionRows[0]) {
        throw new PosSaleError("تم إغلاق الصندوق قبل إتمام البيع", 409);
      }

      return {
        sale,
        items: insertedItems.sort(
          (left, right) => left.lineNumber - right.lineNumber,
        ),
        alreadyCreated: false,
      };
    });

    return json(
      toSaleResponse(result.sale, result.items, result.alreadyCreated),
      result.alreadyCreated ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof PosSaleError) {
      return json({ error: error.message }, error.status);
    }

    const code = (error as { code?: string }).code;

    if (code === "23505") {
      const payload = body as Record<string, unknown>;

      const idempotencyKey = normalizeIdempotencyKey(payload.idempotencyKey);

      const registerKey = normalizeRegisterKey(payload.registerKey ?? "main");

      if (idempotencyKey && registerKey) {
        const existing = await getExistingSale(db, idempotencyKey);

        if (existing && existing.sale.registerKey === registerKey) {
          return json(toSaleResponse(existing.sale, existing.items, true));
        }
      }
    }

    console.error("POS_SALE_CREATE_FAILED", error);

    return json(
      {
        error: "تعذر إتمام عملية البيع",
      },
      500,
    );
  }
}

async function handleVoidSale(request: Request, db: Db, env: Env) {
  const auth = await requirePosUser(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      throw new PosSaleError("بيانات إلغاء الفاتورة غير صالحة");
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new PosSaleError("بيانات إلغاء الفاتورة غير صالحة");
    }

    const payload = body as Record<string, unknown>;

    const publicId =
      typeof payload.publicId === "string"
        ? payload.publicId.trim().toUpperCase()
        : "";

    if (!publicId || publicId.length > 80 || !/^[A-Z0-9_-]+$/.test(publicId)) {
      throw new PosSaleError("رقم الفاتورة غير صالح");
    }

    const reason = parseOptionalText(payload.reason, 500, "سبب الإلغاء");

    if (!reason) {
      throw new PosSaleError("يجب إدخال سبب إلغاء الفاتورة");
    }

    const result = await db.transaction(async (tx) => {
      const saleRows = await tx
        .select()
        .from(posSalesTable)
        .where(eq(posSalesTable.publicId, publicId))
        .for("update");

      const sale = saleRows[0];

      if (!sale) {
        throw new PosSaleError("الفاتورة غير موجودة", 404);
      }

      const saleItems = await tx
        .select()
        .from(posSaleItemsTable)
        .where(eq(posSaleItemsTable.saleId, sale.id))
        .orderBy(asc(posSaleItemsTable.lineNumber));

      if (sale.status === "voided") {
        return {
          sale,
          items: saleItems,
        };
      }

      if (sale.status !== "completed") {
        throw new PosSaleError("لا يمكن إلغاء هذه الفاتورة", 409);
      }

      const completedReturnRows = await tx
        .select({
          id: posSaleReturnsTable.id,
        })
        .from(posSaleReturnsTable)
        .where(
          and(
            eq(posSaleReturnsTable.originalSaleId, sale.id),
            eq(posSaleReturnsTable.status, "completed"),
          ),
        )
        .limit(1);

      if (completedReturnRows[0]) {
        throw new PosSaleError("لا يمكن إلغاء فاتورة تحتوي على مردودات", 409);
      }

      const sessionRows = await tx
        .select()
        .from(cashSessionsTable)
        .where(
          and(
            eq(cashSessionsTable.id, sale.cashSessionId),
            eq(cashSessionsTable.status, "open"),
          ),
        )
        .for("update");

      const session = sessionRows[0];

      if (!session) {
        throw new PosSaleError(
          "لا يمكن إلغاء الفاتورة بعد إغلاق يوم الصندوق",
          409,
        );
      }

      const expectedBefore =
        session.expectedBalanceMinor ?? session.openingBalanceMinor;

      if (expectedBefore < sale.totalMinor) {
        throw new PosSaleError("رصيد الصندوق لا يكفي لإلغاء الفاتورة", 409);
      }

      const orderedItems = [...saleItems].sort((left, right) => {
        const leftId = left.productId ?? Number.MAX_SAFE_INTEGER;
        const rightId = right.productId ?? Number.MAX_SAFE_INTEGER;

        return leftId - rightId || left.lineNumber - right.lineNumber;
      });

      for (const item of orderedItems) {
        if (item.productId === null) {
          throw new PosSaleError(
            `المنتج ${item.productNameAr} لم يعد موجودًا`,
            409,
          );
        }

        const productRows = await tx
          .select()
          .from(productsTable)
          .where(eq(productsTable.id, item.productId))
          .for("update");

        const product = productRows[0];

        if (!product) {
          throw new PosSaleError(
            `المنتج ${item.productNameAr} لم يعد موجودًا`,
            409,
          );
        }

        const updates: {
          stock?: number;
          colorVariants?: ColorVariant[];
        } = {};

        if (product.stock !== null && product.stock !== undefined) {
          const nextStock = product.stock + item.quantity;

          if (!Number.isSafeInteger(nextStock) || nextStock < 0) {
            throw new PosSaleError(
              `تعذر إعادة مخزون ${item.productNameAr}`,
              409,
            );
          }

          updates.stock = nextStock;
        }

        const colorVariants =
          (product.colorVariants as ColorVariant[] | null) ?? [];

        if (colorVariants.length > 0) {
          if (!item.color) {
            throw new PosSaleError(
              `لون ${item.productNameAr} غير محفوظ في الفاتورة`,
              409,
            );
          }

          const variantIndex = colorVariants.findIndex(
            (entry) => entry.color === item.color,
          );

          if (variantIndex < 0) {
            throw new PosSaleError(
              `لون ${item.productNameAr} لم يعد موجودًا`,
              409,
            );
          }

          const variant = colorVariants[variantIndex];
          const sizes = Array.isArray(variant.sizes) ? variant.sizes : [];

          if (sizes.length > 0) {
            if (!item.size) {
              throw new PosSaleError(
                `مقاس ${item.productNameAr} غير محفوظ في الفاتورة`,
                409,
              );
            }

            const sizeIndex = sizes.findIndex(
              (entry) => entry.size === item.size,
            );

            if (sizeIndex < 0) {
              throw new PosSaleError(
                `مقاس ${item.productNameAr} لم يعد موجودًا`,
                409,
              );
            }

            const selectedSize = sizes[sizeIndex];

            if (
              selectedSize.stock !== null &&
              selectedSize.stock !== undefined
            ) {
              const nextVariantStock = selectedSize.stock + item.quantity;

              if (
                !Number.isSafeInteger(nextVariantStock) ||
                nextVariantStock < 0
              ) {
                throw new PosSaleError(
                  `تعذر إعادة مخزون ${item.productNameAr}`,
                  409,
                );
              }

              const nextSizes = sizes.map((entry, index) =>
                index === sizeIndex
                  ? {
                      ...entry,
                      stock: nextVariantStock,
                      outOfStock: nextVariantStock <= 0,
                    }
                  : entry,
              );

              updates.colorVariants = colorVariants.map((entry, index) =>
                index === variantIndex
                  ? {
                      ...entry,
                      sizes: nextSizes,
                    }
                  : entry,
              );
            }
          } else if (item.size) {
            throw new PosSaleError(
              `المقاس المسجل لم يعد مطابقًا للمنتج ${item.productNameAr}`,
              409,
            );
          }
        } else if (item.color) {
          throw new PosSaleError(
            `اللون المسجل لم يعد مطابقًا للمنتج ${item.productNameAr}`,
            409,
          );
        }

        if (Object.keys(updates).length > 0) {
          await tx
            .update(productsTable)
            .set(updates)
            .where(eq(productsTable.id, product.id));
        }
      }

      const expectedAfter = expectedBefore - sale.totalMinor;

      const updatedSessionRows = await tx
        .update(cashSessionsTable)
        .set({
          expectedBalanceMinor: expectedAfter,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(cashSessionsTable.id, session.id),
            eq(cashSessionsTable.status, "open"),
          ),
        )
        .returning({
          id: cashSessionsTable.id,
        });

      if (!updatedSessionRows[0]) {
        throw new PosSaleError("تم إغلاق الصندوق قبل إلغاء الفاتورة", 409);
      }

      const updatedSaleRows = await tx
        .update(posSalesTable)
        .set({
          status: "voided",
          voidedAt: new Date(),
          voidedByUserId: auth.user.id,
          voidReason: reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(posSalesTable.id, sale.id),
            eq(posSalesTable.status, "completed"),
          ),
        )
        .returning();

      const updatedSale = updatedSaleRows[0];

      if (!updatedSale) {
        throw new PosSaleError("تم تغيير حالة الفاتورة قبل إلغائها", 409);
      }

      return {
        sale: updatedSale,
        items: saleItems,
      };
    });

    const navigation = await getSaleNavigation(db, result.sale);

    return json(toSaleResponse(result.sale, result.items, false, navigation));
  } catch (error) {
    if (error instanceof PosSaleError) {
      return json({ error: error.message }, error.status);
    }

    console.error("POS_SALE_VOID_FAILED", error);

    return json(
      {
        error: "تعذر إلغاء الفاتورة",
      },
      500,
    );
  }
}

async function handleTodaySales(request: Request, db: Db, env: Env) {
  const auth = await requirePosUser(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);

  const registerKey = normalizeRegisterKey(
    url.searchParams.get("register") ?? "main",
  );

  if (!registerKey) {
    return json(
      {
        error: "معرّف الصندوق غير صالح",
      },
      400,
    );
  }

  const sessionRows = await db
    .select()
    .from(cashSessionsTable)
    .where(
      and(
        eq(cashSessionsTable.registerKey, registerKey),
        eq(cashSessionsTable.status, "open"),
      ),
    )
    .orderBy(desc(cashSessionsTable.openedAt))
    .limit(1);

  const session = sessionRows[0];

  if (!session) {
    return json({
      session: null,
      sales: [],
    });
  }

  const sales = await db
    .select()
    .from(posSalesTable)
    .where(
      and(
        eq(posSalesTable.cashSessionId, session.id),
        eq(posSalesTable.status, "completed"),
      ),
    )
    .orderBy(asc(posSalesTable.createdAt), asc(posSalesTable.id));

  if (sales.length === 0) {
    return json({
      session: {
        id: String(session.id),
        registerKey: session.registerKey,
        businessDate: session.businessDate,
      },
      sales: [],
    });
  }

  const saleIds = sales.map((sale) => sale.id);

  const items = await db
    .select()
    .from(posSaleItemsTable)
    .where(inArray(posSaleItemsTable.saleId, saleIds))
    .orderBy(asc(posSaleItemsTable.saleId), asc(posSaleItemsTable.lineNumber));

  const itemsBySale = new Map<number, typeof items>();

  for (const item of items) {
    const current = itemsBySale.get(item.saleId) ?? [];

    current.push(item);
    itemsBySale.set(item.saleId, current);
  }

  return json({
    session: {
      id: String(session.id),
      registerKey: session.registerKey,
      businessDate: session.businessDate,
    },

    sales: sales.map((sale) =>
      toSaleResponse(sale, itemsBySale.get(sale.id) ?? [], false),
    ),
  });
}

async function getSaleNavigation(
  db: Db,
  sale: typeof posSalesTable.$inferSelect,
) {
  const [previousRows, nextRows] = await Promise.all([
    db
      .select({
        publicId: posSalesTable.publicId,
      })
      .from(posSalesTable)
      .where(
        and(
          eq(posSalesTable.registerKey, sale.registerKey),
          lt(posSalesTable.id, sale.id),
        ),
      )
      .orderBy(desc(posSalesTable.id))
      .limit(1),

    db
      .select({
        publicId: posSalesTable.publicId,
      })
      .from(posSalesTable)
      .where(
        and(
          eq(posSalesTable.registerKey, sale.registerKey),
          gt(posSalesTable.id, sale.id),
        ),
      )
      .orderBy(asc(posSalesTable.id))
      .limit(1),
  ]);

  return {
    previousPublicId: previousRows[0]?.publicId ?? null,
    nextPublicId: nextRows[0]?.publicId ?? null,
  };
}

async function handleSaleByPublicId(request: Request, db: Db, env: Env) {
  const auth = await requirePosUser(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);

  const publicId = (url.searchParams.get("publicId") ?? "")
    .trim()
    .toUpperCase();

  if (!publicId || publicId.length > 80 || !/^[A-Z0-9_-]+$/.test(publicId)) {
    return json(
      {
        error: "رقم الفاتورة غير صالح",
      },
      400,
    );
  }

  const saleRows = await db
    .select()
    .from(posSalesTable)
    .where(eq(posSalesTable.publicId, publicId))
    .limit(1);

  const sale = saleRows[0];

  if (!sale) {
    return json(
      {
        error: "الفاتورة غير موجودة",
      },
      404,
    );
  }

  const items = await db
    .select()
    .from(posSaleItemsTable)
    .where(eq(posSaleItemsTable.saleId, sale.id))
    .orderBy(asc(posSaleItemsTable.lineNumber));

  const navigation = await getSaleNavigation(db, sale);

  return json(toSaleResponse(sale, items, false, navigation));
}

export async function handlePosSaleRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (request.method === "GET" && path === "/api/pos/products/search") {
    return handleProductSearch(request, db, env);
  }

  if (request.method === "GET" && path === "/api/pos/products/by-barcode") {
    return handleBarcodeLookup(request, db, env);
  }

  if (request.method === "GET" && path === "/api/pos/sales/today") {
    return handleTodaySales(request, db, env);
  }

  if (request.method === "GET" && path === "/api/pos/sales/by-public-id") {
    return handleSaleByPublicId(request, db, env);
  }

  if (request.method === "PUT" && path === "/api/pos/sales") {
    return handleUpdatePosSale(request, db, env);
  }

  if (request.method === "POST" && path === "/api/pos/sales/void") {
    return handleVoidSale(request, db, env);
  }

  if (request.method === "POST" && path === "/api/pos/sales") {
    return handleCreateSale(request, db, env);
  }

  return null;
}
