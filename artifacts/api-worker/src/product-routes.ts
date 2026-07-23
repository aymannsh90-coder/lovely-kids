import {
  insertProductSchema,
  ordersTable,
  type ColorVariant,
  productsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
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
) {
  return {
    id: String(row.id),
    name: row.name,
    nameAr: row.nameAr,
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
    isNew: row.isNew ?? false,
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
  const parsed = insertProductSchema.safeParse(body);

  if (!parsed.success) {
    return json(
      {
        error: "بيانات غير صالحة",
        details: parsed.error.issues,
      },
      400,
    );
  }

  const rows = await db
    .insert(productsTable)
    .values(parsed.data)
    .returning();

  const product = rows[0];

  if (!product) {
    return json(
      { error: "تعذر إنشاء المنتج" },
      500,
    );
  }

  return json(toProduct(product), 201);
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
  const parsed =
    insertProductSchema.partial().safeParse(body);

  if (!parsed.success) {
    return json(
      {
        error: "بيانات غير صالحة",
        details: parsed.error.issues,
      },
      400,
    );
  }

  const rows = await db
    .update(productsTable)
    .set(parsed.data)
    .where(eq(productsTable.id, id))
    .returning();

  const product = rows[0];

  if (!product) {
    return json(
      { error: "المنتج غير موجود" },
      404,
    );
  }

  return json(toProduct(product));
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

  return json(toProduct(product));
}

export async function handleProductRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

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

  return json(toProduct(product));
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
