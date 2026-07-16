import bcrypt from "bcryptjs";
import { sessionsTable, usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  generateToken,
  getBearerToken,
  getCurrentUser,
  hashSessionToken,
  normalizePhone,
  toUser,
} from "./auth";
import { getClerkUserId } from "./clerk";
import type { Env, openDb } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Access-Control-Allow-Origin": "*" },
  });

async function handleLogin(request: Request, db: Db) {
  const body = await request.json().catch(() => null) as {
    phone?: string;
    password?: string;
  } | null;

  if (!body?.phone?.trim() || !body.password) {
    return json({ error: "يرجى تعبئة جميع الحقول" }, 400);
  }

  const phone = normalizePhone(body.phone.trim());

  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, phone))
    .limit(1);

  const user = rows[0];

  if (!user?.passwordHash) {
    return json(
      { error: "رقم الجوال أو كلمة المرور غير صحيحة" },
      401,
    );
  }

  const valid = await bcrypt.compare(
    body.password,
    user.passwordHash,
  );

  if (!valid) {
    return json(
      { error: "رقم الجوال أو كلمة المرور غير صحيحة" },
      401,
    );
  }

  const token = generateToken();

  await db.insert(sessionsTable).values({
    token: hashSessionToken(token),
    userId: user.id,
  });

  return json({ token, user: toUser(user) });
}

export async function handleAuthRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "POST" &&
    path === "/api/auth/register"
  ) {
    return handleRegister(request, db);
  }

  if (
    request.method === "POST" &&
    path === "/api/auth/login"
  ) {
    return handleLogin(request, db);
  }

  if (
    request.method === "GET" &&
    path === "/api/auth/me"
  ) {
    const user = await getCurrentUser(db, request, env);

    if (!user) {
      return json({ error: "غير مسجل الدخول" }, 401);
    }

    return json(toUser(user));
  }

  if (
    request.method === "POST" &&
    path === "/api/auth/logout"
  ) {
    return handleLogout(request, db);
  }

  if (
    request.method === "PATCH" &&
    path === "/api/auth/password"
  ) {
    return handlePassword(request, db, env);
  }

  if (
    request.method === "POST" &&
    path === "/api/auth/promote-admin"
  ) {
    return handlePromoteAdmin(request, db, env);
  }

  if (
    request.method === "POST" &&
    path === "/api/auth/sync-user"
  ) {
    return handleSyncUser(request, db, env);
  }

  if (
    request.method === "PATCH" &&
    path === "/api/auth/profile"
  ) {
    return handleProfile(request, db, env);
  }

  return null;
}

async function handleRegister(request: Request, db: Db) {
  const body = await request.json().catch(() => null) as {
    name?: string;
    phone?: string;
    email?: string;
    password?: string;
  } | null;

  if (
    !body?.name?.trim() ||
    !body.phone?.trim() ||
    !body.email?.trim() ||
    !body.password
  ) {
    return json({ error: "يرجى تعبئة جميع الحقول" }, 400);
  }

  if (body.password.length < 4) {
    return json(
      { error: "كلمة المرور يجب أن تكون 4 أحرف على الأقل" },
      400,
    );
  }

  const normalPhone = normalizePhone(body.phone.trim());
  const normalEmail = body.email.trim().toLowerCase();

  const existingPhone = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.phone, normalPhone))
    .limit(1);

  if (existingPhone.length > 0) {
    return json({ error: "رقم الجوال مسجل مسبقاً" }, 409);
  }

  const existingEmail = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalEmail))
    .limit(1);

  if (existingEmail.length > 0) {
    return json(
      { error: "البريد الإلكتروني مسجل في حساب آخر" },
      409,
    );
  }

  const passwordHash = await bcrypt.hash(
    body.password,
    10,
  );

  const rows = await db
    .insert(usersTable)
    .values({
      name: body.name.trim(),
      email: normalEmail,
      phone: normalPhone,
      passwordHash,
    })
    .returning();

  const user = rows[0];

  if (!user) {
    return json({ error: "تعذر إنشاء الحساب" }, 500);
  }

  const token = generateToken();

  await db.insert(sessionsTable).values({
    token: hashSessionToken(token),
    userId: user.id,
  });

  return json({ token, user: toUser(user) }, 201);
}

async function handleLogout(request: Request, db: Db) {
  const token = getBearerToken(request);

  if (token) {
    await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.token, hashSessionToken(token)));

    await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.token, token));
  }

  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

async function handlePassword(request: Request, db: Db, env: Env) {
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return json({ error: "غير مسجل الدخول" }, 401);
  }

  const body = await request.json().catch(() => null) as {
    currentPassword?: string;
    newPassword?: string;
  } | null;

  if (!body?.currentPassword || !body.newPassword) {
    return json(
      { error: "كلمة المرور الحالية والجديدة مطلوبتان" },
      400,
    );
  }

  if (
    body.newPassword.length < 4 ||
    body.newPassword.length > 128
  ) {
    return json(
      { error: "كلمة المرور الجديدة يجب أن تكون بين 4 و128 حرفًا" },
      400,
    );
  }

  if (!user.passwordHash) {
    return json(
      { error: "لا يمكن تغيير كلمة المرور لهذا الحساب" },
      400,
    );
  }

  const valid = await bcrypt.compare(
    body.currentPassword,
    user.passwordHash,
  );

  if (!valid) {
    return json(
      { error: "كلمة المرور الحالية غير صحيحة" },
      401,
    );
  }

  if (body.currentPassword === body.newPassword) {
    return json(
      { error: "كلمة المرور الجديدة مطابقة للحالية" },
      400,
    );
  }

  const passwordHash = await bcrypt.hash(
    body.newPassword,
    10,
  );

  await db
    .update(usersTable)
    .set({ passwordHash })
    .where(eq(usersTable.id, user.id));

  return json({ ok: true });
}

async function handlePromoteAdmin(
  request: Request,
  db: Db,
  env: Env,
) {
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return json({ error: "غير مسجل الدخول" }, 401);
  }

  const body = await request.json().catch(() => null) as {
    password?: string;
  } | null;

  if (!env.ADMIN_PROMOTE_PASSWORD) {
    return json(
      { error: "إعداد الإدارة غير مكتمل على الخادم" },
      500,
    );
  }

  if (body?.password !== env.ADMIN_PROMOTE_PASSWORD) {
    return json(
      { error: "كلمة مرور الإدارة غير صحيحة" },
      403,
    );
  }

  const rows = await db
    .update(usersTable)
    .set({ isAdmin: true })
    .where(eq(usersTable.id, user.id))
    .returning();

  return json(toUser(rows[0]));
}

async function handleSyncUser(
  request: Request,
  db: Db,
  env: Env,
) {
  const clerkUserId = await getClerkUserId(request, env);

  if (!clerkUserId) {
    return json({ error: "غير مصرح" }, 401);
  }

  const body = await request.json().catch(() => null) as {
    name?: string;
    email?: string;
    phone?: string;
  } | null;

  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);

  if (existing[0]) {
    const updates: Partial<
      typeof usersTable.$inferInsert
    > = {};

    if (body?.name?.trim()) {
      updates.name = body.name.trim();
    }

    if (body?.email?.trim()) {
      updates.email = body.email.trim().toLowerCase();
    }

    if (body?.phone?.trim()) {
      updates.phone = normalizePhone(body.phone.trim());
    }

    const rows = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .returning();

    return json(toUser(rows[0]));
  }

  const rows = await db
    .insert(usersTable)
    .values({
      clerkUserId,
      name: body?.name?.trim() || "مستخدم جديد",
      email:
        body?.email?.trim().toLowerCase() || null,
      phone:
        body?.phone?.trim()
          ? normalizePhone(body.phone.trim())
          : null,
    })
    .returning();

  return json(toUser(rows[0]), 201);
}

async function handleProfile(
  request: Request,
  db: Db,
  env: Env,
) {
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return json({ error: "غير مسجل الدخول" }, 401);
  }

  const body = await request.json().catch(() => null) as {
    name?: string;
    deliveryAddress?: string;
    phone?: string;
    email?: string;
    currentPassword?: string;
  } | null;

  const updates: Partial<
    typeof usersTable.$inferInsert
  > = {};

  if (body?.name?.trim()) {
    updates.name = body.name.trim();
  }

  if (typeof body?.deliveryAddress === "string") {
    updates.deliveryAddress =
      body.deliveryAddress.trim() || null;
  }

  const newPhone =
    body?.phone?.trim()
      ? normalizePhone(body.phone.trim())
      : null;

  const newEmail =
    body?.email?.trim()
      ? body.email.trim().toLowerCase()
      : null;

  const changingPhone =
    !!newPhone && newPhone !== user.phone;

  const changingEmail =
    !!newEmail && newEmail !== user.email;

  if (changingPhone || changingEmail) {
    if (
      changingEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail!)
    ) {
      return json(
        { error: "صيغة البريد الإلكتروني غير صحيحة" },
        400,
      );
    }

    if (!body?.currentPassword) {
      return json(
        {
          error:
            "يجب إدخال كلمة المرور الحالية لتغيير رقم الجوال أو البريد",
        },
        400,
      );
    }

    if (!user.passwordHash) {
      return json(
        { error: "لا يمكن التحقق من كلمة المرور" },
        400,
      );
    }

    const valid = await bcrypt.compare(
      body.currentPassword,
      user.passwordHash,
    );

    if (!valid) {
      return json(
        { error: "كلمة المرور الحالية غير صحيحة" },
        401,
      );
    }

    if (changingPhone) {
      const existing = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.phone, newPhone!))
        .limit(1);

      if (existing.length > 0) {
        return json(
          { error: "رقم الجوال مسجل في حساب آخر" },
          409,
        );
      }

      updates.phone = newPhone!;
    }

    if (changingEmail) {
      const existing = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, newEmail!))
        .limit(1);

      if (existing.length > 0) {
        return json(
          { error: "البريد الإلكتروني مسجل في حساب آخر" },
          409,
        );
      }

      updates.email = newEmail!;
    }
  }

  if (Object.keys(updates).length === 0) {
    return json(
      { error: "لا توجد بيانات للتحديث" },
      400,
    );
  }

  const rows = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, user.id))
    .returning();

  return json(toUser(rows[0]));
}
