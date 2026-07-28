import {
  passwordResetTokensTable,
  productLikesTable,
  securityAuditLogsTable,
  sessionsTable,
  usersTable,
} from "@workspace/db/schema";
import { asc, desc, eq } from "drizzle-orm";
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
    return json({ error: "غير مصرح" }, 403);
  }

  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      phone: usersTable.phone,
      email: usersTable.email,
      isAdmin: usersTable.isAdmin,
      isOwner: usersTable.isOwner,
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

async function handleSetAdminRole(
  request: Request,
  db: Db,
  env: Env,
  userId: number,
) {
  const owner = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!owner?.isOwner) {
    return json(
      { error: "هذه العملية متاحة للمالك فقط" },
      403,
    );
  }

  const body = await request.json().catch(() => null) as {
    isAdmin?: boolean;
  } | null;

  if (typeof body?.isAdmin !== "boolean") {
    return json(
      { error: "قيمة صلاحية الأدمن غير صالحة" },
      400,
    );
  }

  const targets = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const target = targets[0];

  if (!target) {
    return json(
      { error: "المستخدم غير موجود" },
      404,
    );
  }

  if (target.isOwner) {
    return json(
      { error: "لا يمكن تعديل صلاحيات المالك" },
      403,
    );
  }

  if (target.id === owner.id) {
    return json(
      { error: "لا يمكن تعديل صلاحية حساب المالك" },
      400,
    );
  }

  if (target.isAdmin === body.isAdmin) {
    return json({
      id: String(target.id),
      name: target.name,
      phone: target.phone,
      email: target.email,
      isAdmin: target.isAdmin,
      isOwner: target.isOwner,
      createdAt: target.createdAt,
      clerkUserId: target.clerkUserId,
      avatarUrl: target.avatarUrl,
    });
  }

  const updated = await db.transaction(
    async (tx) => {
      const rows = await tx
        .update(usersTable)
        .set({ isAdmin: body.isAdmin })
        .where(eq(usersTable.id, userId))
        .returning({
          id: usersTable.id,
          name: usersTable.name,
          phone: usersTable.phone,
          email: usersTable.email,
          isAdmin: usersTable.isAdmin,
          isOwner: usersTable.isOwner,
          createdAt: usersTable.createdAt,
          clerkUserId: usersTable.clerkUserId,
          avatarUrl: usersTable.avatarUrl,
        });

      await tx
        .insert(securityAuditLogsTable)
        .values({
          actorUserId: owner.id,
          targetUserId: target.id,
          action: body.isAdmin
            ? "admin_granted"
            : "admin_revoked",
          details: {
            targetName: target.name,
            targetEmail: target.email,
            previousIsAdmin: target.isAdmin,
            newIsAdmin: body.isAdmin,
          },
        });

      return rows[0];
    },
  );

  return json({
    ...updated,
    id: String(updated.id),
  });
}

async function handleAuditLog(
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
    return json(
      { error: "هذه العملية متاحة للمالك فقط" },
      403,
    );
  }

  const rows = await db
    .select()
    .from(securityAuditLogsTable)
    .orderBy(desc(securityAuditLogsTable.createdAt))
    .limit(200);

  return json(rows);
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

  const targets = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const target = targets[0];

  if (!target) {
    return json(
      { error: "المستخدم غير موجود" },
      404,
    );
  }

  if (target.isOwner) {
    return json(
      { error: "لا يمكن حذف حساب المالك" },
      403,
    );
  }

  if (target.isAdmin && !admin.isOwner) {
    return json(
      { error: "الأدمن العادي لا يستطيع حذف أدمن آخر" },
      403,
    );
  }

  const deleted = await db.transaction(
    async (tx) => {
      await tx
        .insert(securityAuditLogsTable)
        .values({
          actorUserId: admin.id,
          targetUserId: target.id,
          action: "user_deleted",
          details: {
            targetName: target.name,
            targetEmail: target.email,
            wasAdmin: target.isAdmin,
          },
        });

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

  if (
    request.method === "GET" &&
    path === "/api/users/security-audit"
  ) {
    return handleAuditLog(request, db, env);
  }

  const adminRoleMatch = path.match(
    /^\/api\/users\/(\d+)\/admin$/,
  );

  if (
    request.method === "PATCH" &&
    adminRoleMatch
  ) {
    return handleSetAdminRole(
      request,
      db,
      env,
      Number(adminRoleMatch[1]),
    );
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
