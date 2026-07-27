import {
  insertProductSchema,
  ordersTable,
  productBarcodesTable,
  productBarcodeInputSchema,
  type ColorVariant,
  productsTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import { deleteProductImageObjects, getProductImageObjectPath } from "./image-routes";

type Db = Awaited<
  ReturnType<typeof openDb>
>["db"];

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });

const createProductRequestSchema = insertProductSchema.extend({
  additionalBarcodes: productBarcodeInputSchema.array().optional(),
});

const updateProductRequestSchema = createProductRequestSchema.partial();

type AdditionalBarcode = {
  barcode: string;
  color: string | null;
  size: string | null;
};

function normalizeAdditionalBarcodes(
  items: Array<{ barcode: string; color?: string | null; size?: string | null }>,
): AdditionalBarcode[] {
  return items.map((item) => ({
    barcode: item.barcode.trim(),
    color: item.color?.trim() || null,
    size: item.size?.trim() || null,
  }));
}

async function findBarcodeConflict(
  db: Db,
  barcodes: string[],
  excludeProductId?: number,
) {
  if (barcodes.length === 0) return null;

  const primaryRows = await db
    .select({
      id: productsTable.id,
      barcode: productsTable.barcode,
    })
    .from(productsTable)
    .where(inArray(productsTable.barcode, barcodes));

  const primaryConflict = primaryRows.find(
    (row) => row.id !== excludeProductId,
  );

  if (primaryConflict?.barcode) return primaryConflict.barcode;

  const extraRows = await db
    .select({
      productId: productBarcodesTable.productId,
      barcode: productBarcodesTable.barcode,
    })
    .from(productBarcodesTable)
    .where(inArray(productBarcodesTable.barcode, barcodes));

  const extraConflict = extraRows.find(
    (row) => row.productId !== excludeProductId,
  );

  return extraConflict?.barcode ?? null;
}

function findDuplicateBarcode(barcodes: string[]) {
  const seen = new Set<string>();

  for (const barcode of barcodes) {
    if (seen.has(barcode)) return barcode;
    seen.add(barcode);
  }

  return null;
}

async function getAdditionalBarcodes(
  db: Db,
  productId: number,
): Promise<AdditionalBarcode[]> {
  const rows = await db
    .select({
      barcode: productBarcodesTable.barcode,
      color: productBarcodesTable.color,
      size: productBarcodesTable.size,
    })
    .from(productBarcodesTable)
    .where(eq(productBarcodesTable.productId, productId));

  return rows.map((row) => ({
    barcode: row.barcode,
    color: row.color ?? null,
    size: row.size ?? null,
  }));
}

async function requireAdmin(
  request: Request,
  db: Db,
  env: Env,
) {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  if (!user.isAdmin) {
    return json({ error: "غير مصرح" }, 403);
  }


  return null;
}

function toProduct(
  row: typeof productsTable.$inferSelect,
  additionalBarcodes: AdditionalBarcode[] = [],
) {
  return {
    id: String(row.id),
    name: row.name,
    nameAr: row.nameAr,
    productCode: row.productCode ?? null,
    barcode: row.barcode ?? null,
    additionalBarcodes,
    price: row.price,
    originalPrice:
      row.originalPrice ?? undefined,
    image: row.image,
    images: (row.images as string[]) ?? [],
    category: row.category,
    ageGroup: row.ageGroup,
    gender: row.gender ?? null,
    season: row.season ?? null,
    sizes: (row.sizes as string[]) ?? [],
    colorVariants:
      (row.colorVariants as unknown[]) ?? [],
    rating: row.rating / 10,
    reviews: row.reviews,
    isPinned: !!row.isPinned,
    isNew:
      !!row.isNew &&
      !!row.newUntil &&
      row.newUntil.getTime() > Date.now(),
    newUntil: row.newUntil?.toISOString() ?? null,
    discount: row.discount ?? undefined,
    description: row.description,
    stock: row.stock ?? null,
  };
}

async function handleCreateProduct(
  request: Request,
  db: Db,
  env: Env,
) {
  const authError = await requireAdmin(
    request,
    db,
    env,
  );

  if (authError) return authError;

  const body = await request.json().catch(() => null);
  const parsed = createProductRequestSchema.safeParse(body);

  if (!parsed.success) {
    return json(
      {
        error: "بيانات غير صالحة",
        details: parsed.error.issues,
      },
      400,
    );
  }

  const {
    additionalBarcodes: rawAdditionalBarcodes = [],
    ...productData
  } = parsed.data;

  const additionalBarcodes =
    normalizeAdditionalBarcodes(rawAdditionalBarcodes);

  const allBarcodes = [
    productData.barcode?.trim() || null,
    ...additionalBarcodes.map((item) => item.barcode),
  ].filter((value): value is string => !!value);

  const duplicateBarcode = findDuplicateBarcode(allBarcodes);

  if (duplicateBarcode) {
    return json(
      { error: `الباركود ${duplicateBarcode} مكرر داخل نفس المنتج` },
      409,
    );
  }

  const conflictBarcode = await findBarcodeConflict(
    db,
    allBarcodes,
  );

  if (conflictBarcode) {
    return json(
      { error: `الباركود ${conflictBarcode} مستخدم لمنتج آخر` },
      409,
    );
  }

  const product = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(productsTable)
      .values({
        ...productData,
        barcode: productData.barcode?.trim() || null,
      })
      .returning();

    const created = rows[0];

    if (!created) {
      throw new Error("PRODUCT_CREATE_FAILED");
    }

    if (additionalBarcodes.length > 0) {
      await tx.insert(productBarcodesTable).values(
        additionalBarcodes.map((item) => ({
          productId: created.id,
          barcode: item.barcode,
          color: item.color,
          size: item.size,
        })),
      );
    }

    return created;
  });

  return json(
    toProduct(product, additionalBarcodes),
    201,
  );
}

async function handleUpdateProduct(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const authError = await requireAdmin(
    request,
    db,
    env,
  );

  if (authError) return authError;

  const body = await request.json().catch(() => null);
  const parsed = updateProductRequestSchema.safeParse(body);

  if (!parsed.success) {
    return json(
      {
        error: "بيانات غير صالحة",
        details: parsed.error.issues,
      },
      400,
    );
  }

  const currentRows = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, id))
    .limit(1);

  const currentProduct = currentRows[0];

  if (!currentProduct) {
    return json(
      { error: "المنتج غير موجود" },
      404,
    );
  }

  const currentAdditionalBarcodes =
    await getAdditionalBarcodes(db, id);

  const {
    additionalBarcodes: rawAdditionalBarcodes,
    ...productData
  } = parsed.data;

  const additionalBarcodes =
    rawAdditionalBarcodes === undefined
      ? currentAdditionalBarcodes
      : normalizeAdditionalBarcodes(rawAdditionalBarcodes);

  const primaryBarcode =
    productData.barcode === undefined
      ? currentProduct.barcode?.trim() || null
      : productData.barcode?.trim() || null;

  const allBarcodes = [
    primaryBarcode,
    ...additionalBarcodes.map((item) => item.barcode),
  ].filter((value): value is string => !!value);

  const duplicateBarcode = findDuplicateBarcode(allBarcodes);

  if (duplicateBarcode) {
    return json(
      { error: `الباركود ${duplicateBarcode} مكرر داخل نفس المنتج` },
      409,
    );
  }

  const conflictBarcode = await findBarcodeConflict(
    db,
    allBarcodes,
    id,
  );

  if (conflictBarcode) {
    return json(
      { error: `الباركود ${conflictBarcode} مستخدم لمنتج آخر` },
      409,
    );
  }

  const product = await db.transaction(async (tx) => {
    let updated = currentProduct;

    if (Object.keys(productData).length > 0) {
      const rows = await tx
        .update(productsTable)
        .set({
          ...productData,
          ...(productData.barcode !== undefined
            ? { barcode: productData.barcode?.trim() || null }
            : {}),
        })
        .where(eq(productsTable.id, id))
        .returning();

      if (!rows[0]) {
        throw new Error("PRODUCT_UPDATE_FAILED");
      }

      updated = rows[0];
    }

    if (rawAdditionalBarcodes !== undefined) {
      await tx
        .delete(productBarcodesTable)
        .where(eq(productBarcodesTable.productId, id));

      if (additionalBarcodes.length > 0) {
        await tx.insert(productBarcodesTable).values(
          additionalBarcodes.map((item) => ({
            productId: id,
            barcode: item.barcode,
            color: item.color,
            size: item.size,
          })),
        );
      }
    }

    return updated;
  });

  return json(
    toProduct(product, additionalBarcodes),
  );
}

async function handleStock(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const authError = await requireAdmin(
    request,
    db,
    env,
  );

  if (authError) return authError;

  const body = await request.json().catch(() => null) as {
    action?: "set" | "add" | "subtract";
    amount?: number;
  } | null;

  if (
    !body?.action ||
    typeof body.amount !== "number" ||
    body.amount < 0
  ) {
    return json(
      { error: "action و amount مطلوبان" },
      400,
    );
  }

  const current = await db
    .select({ stock: productsTable.stock })
    .from(productsTable)
    .where(eq(productsTable.id, id))
    .limit(1);

  if (!current[0]) {
    return json(
      { error: "المنتج غير موجود" },
      404,
    );
  }

  const amount = Math.round(body.amount);
  const oldStock = current[0].stock ?? 0;

  let newStock: number;

  if (body.action === "set") {
    newStock = Math.max(0, amount);
  } else if (body.action === "add") {
    newStock = oldStock + amount;
  } else {
    newStock = Math.max(0, oldStock - amount);
  }

  const rows = await db
    .update(productsTable)
    .set({ stock: newStock })
    .where(eq(productsTable.id, id))
    .returning();

  const product = rows[0];

  if (!product) {
    return json(
      { error: "المنتج غير موجود" },
      404,
    );
  }

  const additionalBarcodes =
    await getAdditionalBarcodes(db, id);

  return json(toProduct(product, additionalBarcodes));
}

export async function handleProductRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "GET" &&
    path === "/api/products/barcodes"
  ) {
    const authError = await requireAdmin(
      request,
      db,
      env,
    );

    if (authError) return authError;

    const rows = await db
      .select({
        productId: productBarcodesTable.productId,
        barcode: productBarcodesTable.barcode,
        color: productBarcodesTable.color,
        size: productBarcodesTable.size,
      })
      .from(productBarcodesTable);

    return json(
      rows.map((row) => ({
        productId: String(row.productId),
        barcode: row.barcode,
        color: row.color ?? null,
        size: row.size ?? null,
      })),
    );
  }

  if (
    request.method === "POST" &&
    path === "/api/products"
  ) {
    return handleCreateProduct(request, db, env);
  }

  const variantMatch = path.match(
    /^\/api\/products\/(\d+)\/variant-stock$/,
  );

  if (
    request.method === "PATCH" &&
    variantMatch
  ) {
    return handleVariantStock(
      request,
      db,
      env,
      Number(variantMatch[1]),
    );
  }

  const stockMatch = path.match(
    /^\/api\/products\/(\d+)\/stock$/,
  );

  if (
    request.method === "PATCH" &&
    stockMatch
  ) {
    return handleStock(
      request,
      db,
      env,
      Number(stockMatch[1]),
    );
  }

  const productMatch = path.match(
    /^\/api\/products\/(\d+)$/,
  );

  if (
    request.method === "PUT" &&
    productMatch
  ) {
    return handleUpdateProduct(
      request,
      db,
      env,
      Number(productMatch[1]),
    );
  }

  if (
    request.method === "DELETE" &&
    productMatch
  ) {
    return handleDeleteProduct(
      request,
      db,
      env,
      Number(productMatch[1]),
    );
  }

  return null;
}

async function handleVariantStock(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const authError = await requireAdmin(
    request,
    db,
    env,
  );

  if (authError) return authError;

  const body = await request.json().catch(() => null) as {
    color?: string;
    size?: string;
    action?: "set" | "add" | "subtract";
    amount?: number;
  } | null;

  if (
    !body?.color ||
    !body.size ||
    !body.action ||
    typeof body.amount !== "number" ||
    body.amount < 0
  ) {
    return json(
      {
        error:
          "color و size و action و amount مطلوبة",
      },
      400,
    );
  }

  const current = await db
    .select({
      colorVariants: productsTable.colorVariants,
    })
    .from(productsTable)
    .where(eq(productsTable.id, id))
    .limit(1);

  if (!current[0]) {
    return json(
      { error: "المنتج غير موجود" },
      404,
    );
  }

  const variants =
    (current[0].colorVariants as
      | ColorVariant[]
      | null) ?? [];

  const color = body.color;
  const size = body.size;
  const action = body.action;
  const amount = Math.round(body.amount);

  let found = false;

  const updatedVariants = variants.map((variant) => {
    if (variant.color !== color) return variant;

    return {
      ...variant,
      sizes: variant.sizes.map((entry) => {
        if (entry.size !== size) return entry;

        found = true;
        const oldStock = entry.stock ?? 0;

        let newStock: number;

        if (action === "set") {
          newStock = Math.max(0, amount);
        } else if (action === "add") {
          newStock = oldStock + amount;
        } else {
          newStock = Math.max(0, oldStock - amount);
        }

        return {
          ...entry,
          stock: newStock,
          outOfStock: newStock <= 0,
        };
      }),
    };
  });

  if (!found) {
    return json(
      { error: "المقاس أو اللون غير موجود" },
      404,
    );
  }

  const rows = await db
    .update(productsTable)
    .set({ colorVariants: updatedVariants })
    .where(eq(productsTable.id, id))
    .returning();

  const product = rows[0];

  if (!product) {
    return json(
      { error: "المنتج غير موجود" },
      404,
    );
  }

  const additionalBarcodes =
    await getAdditionalBarcodes(db, id);

  return json(toProduct(product, additionalBarcodes));
}

async function handleDeleteProduct(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const authError = await requireAdmin(
    request,
    db,
    env,
  );

  if (authError) return authError;

  let rows;

  try {
    rows = await db
      .delete(productsTable)
      .where(eq(productsTable.id, id))
      .returning();
  } catch (error) {
    console.error("DELETE_PRODUCT_FAILED", {
      productId: id,
      error,
    });

    return json(
      { error: "تعذر حذف المنتج" },
      500,
    );
  }

  if (!rows[0]) {
    return json({ error: "المنتج غير موجود" }, 404);
  }

  try {
    const deletedProduct = rows[0];

    const deletedImageUrls = new Set<string>();

    if (deletedProduct.image) {
      deletedImageUrls.add(deletedProduct.image);
    }

    for (const url of (deletedProduct.images as string[]) ?? []) {
      if (url) deletedImageUrls.add(url);
    }

    for (const variant of (deletedProduct.colorVariants as ColorVariant[]) ??
      []) {
      if (variant.image) deletedImageUrls.add(variant.image);
    }

    const remainingProducts = await db
      .select({
        image: productsTable.image,
        images: productsTable.images,
        colorVariants: productsTable.colorVariants,
      })
      .from(productsTable);

    const usedImageUrls = new Set<string>();

    for (const product of remainingProducts) {
      if (product.image) usedImageUrls.add(product.image);

      for (const url of (product.images as string[]) ?? []) {
        if (url) usedImageUrls.add(url);
      }

      for (const variant of (product.colorVariants as ColorVariant[]) ?? []) {
        if (variant.image) usedImageUrls.add(variant.image);
      }
    }

    const existingOrders = await db
      .select({ items: ordersTable.items })
      .from(ordersTable);

    for (const order of existingOrders) {
      const items = (order.items as Array<{ image?: string }>) ?? [];

      for (const item of items) {
        if (item.image) usedImageUrls.add(item.image);
      }
    }

    const objectPaths = [...deletedImageUrls]
      .filter((url) => !usedImageUrls.has(url))
      .map((url) => getProductImageObjectPath(url, env))
      .filter((path): path is string => !!path);

    await deleteProductImageObjects(env, objectPaths);
  } catch (error) {
    console.error("DELETE_PRODUCT_STORAGE_CLEANUP_FAILED", {
      productId: id,
      error,
    });
  }

  return json({ success: true });
}
