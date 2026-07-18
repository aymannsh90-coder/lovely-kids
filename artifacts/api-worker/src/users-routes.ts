import {
  passwordResetTokensTable,
  productLikesTable,
  sessionsTable,
  usersTable,
} from "@workspace/db/schema";
import { asc, eq } from "drizzle-orm";
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

async function handleListUsers(
  request: Request,
  db: Db,
  env: Env,
) {
  const admin = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!admin?.isAdmin) {
    return json(
      { error: "غير مصرح" },
      403,
    );
  }

  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      phone: usersTable.phone,
      email: usersTable.email,
      isAdmin: usersTable.isAdmin,
      createdAt: usersTable.createdAt,
      clerkUserId: usersTable.clerkUserId,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(usersTable)
    .orderBy(asc(usersTable.createdAt));

  return json(
    rows.map((user) => ({
      ...user,
      id: String(user.id),
    })),
  );
}

async function handleDeleteUser(
  request: Request,
  db: Db,
  env: Env,
  userId: number,
) {
  const admin = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!admin?.isAdmin) {
    return json(
      { error: "غير مصرح" },
      403,
    );
  }

  if (userId === admin.id) {
    return json(
      { error: "لا يمكنك حذف حسابك الخاص" },
      400,
    );
  }

  const deleted = await db.transaction(
    async (tx) => {
      await tx
        .delete(sessionsTable)
        .where(eq(sessionsTable.userId, userId));

      await tx
        .delete(passwordResetTokensTable)
        .where(
          eq(passwordResetTokensTable.userId, userId),
        );

      await tx
        .delete(productLikesTable)
        .where(eq(productLikesTable.userId, userId));

      return tx
        .delete(usersTable)
        .where(eq(usersTable.id, userId))
        .returning({ id: usersTable.id });
    },
  );

  if (deleted.length === 0) {
    return json(
      { error: "المستخدم غير موجود" },
      404,
    );
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

export async function handleUsersRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "GET" &&
    path === "/api/users"
  ) {
    return handleListUsers(request, db, env);
  }

  const match = path.match(
    /^\/api\/users\/(\d+)$/,
  );

  if (
    request.method === "DELETE" &&
    match
  ) {
    const userId = Number(match[1]);

    if (!Number.isInteger(userId)) {
      return json(
        { error: "معرّف المستخدم غير صالح" },
        400,
      );
    }

    return handleDeleteUser(
      request,
      db,
      env,
      userId,
    );
  }

  return null;
}
