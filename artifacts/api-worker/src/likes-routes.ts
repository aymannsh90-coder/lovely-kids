import {
  productLikesTable,
  productsTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";

type Db = Awaited<
  ReturnType<typeof openDb>
>["db"];

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });

async function handleListLikes(
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
    return json(
      { error: "غير مسجل الدخول" },
      401,
    );
  }

  const rows = await db
    .select({
      productId: productLikesTable.productId,
    })
    .from(productLikesTable)
    .where(
      eq(productLikesTable.userId, user.id),
    );

  return json({
    productIds: rows.map((row) =>
      String(row.productId)
    ),
  });
}

async function handleAddLike(
  request: Request,
  db: Db,
  env: Env,
  productId: number,
) {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!user) {
    return json(
      { error: "غير مسجل الدخول" },
      401,
    );
  }

  const product = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);

  if (!product[0]) {
    return json(
      { error: "المنتج غير موجود" },
      404,
    );
  }

  await db
    .insert(productLikesTable)
    .values({
      userId: user.id,
      productId,
    })
    .onConflictDoNothing();

  return json({ success: true }, 201);
}

async function handleRemoveLike(
  request: Request,
  db: Db,
  env: Env,
  productId: number,
) {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!user) {
    return json(
      { error: "غير مسجل الدخول" },
      401,
    );
  }

  await db
    .delete(productLikesTable)
    .where(
      and(
        eq(productLikesTable.userId, user.id),
        eq(productLikesTable.productId, productId),
      ),
    );

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

export async function handleLikesRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "GET" &&
    path === "/api/likes"
  ) {
    return handleListLikes(request, db, env);
  }

  const match = path.match(
    /^\/api\/likes\/(\d+)$/,
  );

  if (!match) {
    return null;
  }

  const productId = Number(match[1]);

  if (!Number.isInteger(productId)) {
    return json(
      { error: "معرّف المنتج غير صالح" },
      400,
    );
  }

  if (request.method === "POST") {
    return handleAddLike(
      request,
      db,
      env,
      productId,
    );
  }

  if (request.method === "DELETE") {
    return handleRemoveLike(
      request,
      db,
      env,
      productId,
    );
  }

  return null;
}
