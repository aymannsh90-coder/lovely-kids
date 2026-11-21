import bcrypt from "bcryptjs";
import { getStaffAccess, getStaffLoginProfile } from "./staff-permissions";
import { authLoginFailuresTable, sessionsTable, usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  generateToken,
  getBearerToken,
  getCurrentUser,
  hashSessionToken,
  normalizePhone,
  toUser,
} from "./auth";
import { getClerkUserId } from "./clerk";
import {
  LOGIN_COOLDOWN_MS,
  LOGIN_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_MS,
  clientIpFromCloudflare,
  isLoginTemporarilyBlocked,
  loginFailureKey,
  sessionExpiresAt,
} from "./auth-security-policy";
import type { Env, openDb } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });


function tooManyLoginsResponse() {
  return Response.json(
    { error: "محاولات دخول كثيرة. يرجى الانتظار دقيقة ثم المحاولة مجددًا" },
    {
      status: 429,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Retry-After": "60",
      },
    },
  );
}

// Atomic counter in Postgres: Cloudflare Workers run in multiple isolates, so
// counters in module memory cannot protect a shared production account.
async function recordFailedLogin(db: Db, keyHash: string): Promise<void> {
  const now = new Date();
  const windowBoundary = new Date(now.getTime() - LOGIN_FAILURE_WINDOW_MS);
  const cooldownUntil = new Date(now.getTime() + LOGIN_COOLDOWN_MS);

  await db
    .insert(authLoginFailuresTable)
    .values({
      keyHash,
      failedCount: 1,
      windowStartedAt: now,
      lastFailedAt: now,
    })
    .onConflictDoUpdate({
      target: authLoginFailuresTable.keyHash,
      set: {
        failedCount: sql`CASE
          WHEN ${authLoginFailuresTable.windowStartedAt} < ${windowBoundary}::timestamp THEN 1
          ELSE ${authLoginFailuresTable.failedCount} + 1 END`,
        windowStartedAt: sql`CASE
          WHEN ${authLoginFailuresTable.windowStartedAt} < ${windowBoundary}::timestamp
            THEN ${now}::timestamp
          ELSE ${authLoginFailuresTable.windowStartedAt} END`,
        blockedUntil: sql`CASE
          WHEN ${authLoginFailuresTable.windowStartedAt} < ${windowBoundary}::timestamp THEN NULL
          WHEN ${authLoginFailuresTable.failedCount} + 1 >= ${LOGIN_FAILURE_LIMIT}
            THEN ${cooldownUntil}::timestamp
          ELSE NULL END`,
        lastFailedAt: now,
      },
    });
}

async function handleLogin(request: Request, db: Db) {
  const body = await request.json().catch(() => null) as {
    phone?: unknown;
    password?: unknown;
  } | null;

  if (
    typeof body?.phone !== "string" ||
    typeof body?.password !== "string" ||
    !body.phone.trim() ||
    !body.password
  ) {
    return json({ error: "يرجى تعبئة جميع الحقول" }, 400);
  }

  // Reject unreasonable input before running the expensive bcrypt check.
  if (body.phone.length > 40 || body.password.length > 256) {
    return json({ error: "بيانات تسجيل الدخول غير صالحة" }, 400);
  }

  const phone = normalizePhone(body.phone.trim());
  const clientIp = clientIpFromCloudflare(request);
  const failureKey = clientIp ? loginFailureKey(phone, clientIp) : null;

  if (failureKey) {
    const [counter] = await db
      .select({ blockedUntil: authLoginFailuresTable.blockedUntil })
      .from(authLoginFailuresTable)
      .where(eq(authLoginFailuresTable.keyHash, failureKey))
      .limit(1);

    if (counter && isLoginTemporarilyBlocked(counter.blockedUntil, new Date())) {
      return tooManyLoginsResponse();
    }
  }

  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, phone))
    .limit(1);

  const user = rows[0];
  const valid = user?.passwordHash
    ? await bcrypt.compare(body.password, user.passwordHash)
    : false;

  if (!valid || !user) {
    if (failureKey) {
      await recordFailedLogin(db, failureKey);
    }
    return json({ error: "رقم الجوال أو كلمة المرور غير صحيحة" }, 401);
  }

  const staffAccess = !user.isOwner && !user.isAdmin
    ? await getStaffAccess(db, user.id)
    : null;
  if (staffAccess && !staffAccess.enabled) {
    return json({ error: "حساب الموظف معطل من المالك" }, 403);
  }

  // Successful authentication clears the pair's failed-attempt history.
  if (failureKey) {
    await db.delete(authLoginFailuresTable)
      .where(eq(authLoginFailuresTable.keyHash, failureKey));
  }

  const token = generateToken();
  await db.insert(sessionsTable).values({
    token: hashSessionToken(token),
    userId: user.id,
    expiresAt: sessionExpiresAt(
      new Date(),
      user.isAdmin || user.isOwner || staffAccess !== null,
    ),
  });

  return json({
    token,
    user: { ...toUser(user), ...await getStaffLoginProfile(db, user) },
  });
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

    return json({ ...toUser(user), ...await getStaffLoginProfile(db, user) });
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
    expiresAt: sessionExpiresAt(new Date(), false),
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
  void request;
  void db;
  void env;

  return json(
    { error: "تم تعطيل الترقية الذاتية للإدارة" },
    403,
  );
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
