import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getAuth } from "@clerk/express";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getBearerToken, getUserFromToken, getCurrentUser } from "../lib/auth";

const router = Router();

// ─── Shared normalization helpers ─────────────────────────────────────────
/**
 * Normalize a phone string:
 * - Convert Arabic-Indic digits (٠-٩ / U+0660-U+0669) to Western digits
 * - Strip whitespace, dashes, parentheses, and dots
 * - Preserve leading '+' and '00' (international prefixes)
 */
export function normalizePhone(raw: string): string {
  return raw
    .replace(/[\u0660-\u0669]/g, (c) => String(c.codePointAt(0)! - 0x0660))
    .replace(/[\s\-().]/g, "");
}

/** Mask all but the first and last character — safe for server logs. */
function maskValue(s: string): string {
  if (s.length <= 2) return "**";
  return s[0] + "*".repeat(Math.min(s.length - 2, 8)) + s[s.length - 1];
}

function toUser(u: typeof usersTable.$inferSelect) {
  return {
    id: String(u.id),
    phone: u.phone,
    email: u.email,
    name: u.name,
    isAdmin: u.isAdmin,
    avatarUrl: u.avatarUrl,
    deliveryAddress: u.deliveryAddress,
  };
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// POST /api/auth/register — custom phone+password registration (email stored for recovery only)
router.post("/auth/register", async (req, res) => {
  const { name, phone, email, password } = req.body as {
    name?: string;
    phone?: string;
    email?: string;
    password?: string;
  };

  if (!name?.trim() || !phone?.trim() || !email?.trim() || !password) {
    res.status(400).json({ error: "يرجى تعبئة جميع الحقول" });
    return;
  }
  if (password.length < 4) {
    res.status(400).json({ error: "كلمة المرور يجب أن تكون 4 أحرف على الأقل" });
    return;
  }

  const normalPhone = normalizePhone(phone.trim());
  const normalEmail = email.trim().toLowerCase();

  // Check phone uniqueness first
  const existingByPhone = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.phone, normalPhone));
  if (existingByPhone.length > 0) {
    res.status(409).json({ error: "رقم الجوال مسجل مسبقاً" });
    return;
  }

  // Check email uniqueness
  const existingByEmail = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalEmail));
  if (existingByEmail.length > 0) {
    res.status(409).json({ error: "البريد الإلكتروني مسجل في حساب آخر" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const rows = await db
    .insert(usersTable)
    .values({
      name: name.trim(),
      email: normalEmail,
      phone: normalPhone,
      passwordHash,
    })
    .returning();

  const user = rows[0];
  const token = generateToken();
  await db.insert(sessionsTable).values({ token, userId: user.id });

  res.status(201).json({ token, user: toUser(user) });
});

// POST /api/auth/login — phone + password login only
router.post("/auth/login", async (req, res) => {
  const { phone, password } = req.body as {
    phone?: string;
    password?: string;
  };

  if (!phone?.trim() || !password) {
    res.status(400).json({ error: "يرجى تعبئة جميع الحقول" });
    return;
  }

  const normalPhone = normalizePhone(phone.trim());

  req.log?.debug({ phoneMasked: maskValue(normalPhone) }, "login: normalized phone");

  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, normalPhone));

  const user = rows[0];

  req.log?.debug({ userFound: !!user, hasHash: !!user?.passwordHash }, "login: user lookup");

  if (!user || !user.passwordHash) {
    res.status(401).json({ error: "رقم الجوال أو كلمة المرور غير صحيحة" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  req.log?.debug({ passwordValid: valid }, "login: bcrypt result");

  if (!valid) {
    res.status(401).json({ error: "رقم الجوال أو كلمة المرور غير صحيحة" });
    return;
  }

  const token = generateToken();
  await db.insert(sessionsTable).values({ token, userId: user.id });

  res.json({ token, user: toUser(user) });
});

// POST /api/auth/logout — delete session token
router.post("/auth/logout", async (req, res) => {
  const token = getBearerToken(req);
  if (token) {
    await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
  }
  res.status(204).end();
});

// GET /api/auth/me — returns the current user profile
router.get("/auth/me", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "غير مسجل الدخول" });
    return;
  }
  res.json(toUser(user));
});

// POST /api/auth/sync-user — upsert Clerk user profile data (kept for Clerk OAuth compatibility)
router.post("/auth/sync-user", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "غير مصرح" });
    return;
  }
  const { name, email, phone } = req.body as { name?: string; email?: string; phone?: string };

  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, auth.userId));

  if (existing[0]) {
    const updates: Partial<typeof usersTable.$inferInsert> = {};
    if (name?.trim()) updates.name = name.trim();
    if (email?.trim()) updates.email = email.trim().toLowerCase();
    if (phone?.trim()) updates.phone = phone.trim();
    const rows = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.clerkUserId, auth.userId))
      .returning();
    res.json(toUser(rows[0]));
    return;
  }

  const rows = await db
    .insert(usersTable)
    .values({
      clerkUserId: auth.userId,
      name: name?.trim() || "مستخدم جديد",
      email: email?.trim().toLowerCase() || null,
      phone: phone?.trim() || null,
    })
    .returning();
  res.status(201).json(toUser(rows[0]));
});

// POST /api/auth/lookup-phone — returns the email for a phone number
router.post("/auth/lookup-phone", async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone?.trim()) {
    res.status(400).json({ error: "رقم الهاتف مطلوب" });
    return;
  }
  const rows = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.phone, normalizePhone(phone.trim())));
  if (!rows[0]?.email) {
    res.status(404).json({ error: "رقم الجوال غير مسجل" });
    return;
  }
  res.json({ email: rows[0].email });
});

// GET /api/users — list all users (admin only)
router.get("/users", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user?.isAdmin) {
    res.status(403).json({ error: "غير مصرح" });
    return;
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
    .orderBy(usersTable.createdAt);
  res.json(rows.map((u) => ({ ...u, id: String(u.id) })));
});

// DELETE /api/users/:id — delete a user (admin only, cannot delete self)
router.delete("/users/:id", async (req, res) => {
  const admin = await getCurrentUser(req);
  if (!admin?.isAdmin) {
    res.status(403).json({ error: "غير مصرح" });
    return;
  }
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "معرّف المستخدم غير صالح" });
    return;
  }
  if (id === admin.id) {
    res.status(400).json({ error: "لا يمكنك حذف حسابك الخاص" });
    return;
  }
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, id));
  const deleted = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
  if (deleted.length === 0) {
    res.status(404).json({ error: "المستخدم غير موجود" });
    return;
  }
  res.status(204).end();
});

// PUT /api/auth/profile — update name / deliveryAddress (legacy, kept for compatibility)
router.put("/auth/profile", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "غير مسجل الدخول" });
    return;
  }
  const { name, deliveryAddress } = req.body as { name?: string; deliveryAddress?: string };
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (typeof deliveryAddress === "string") updates.deliveryAddress = deliveryAddress.trim() || null;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  const rows = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, user.id))
    .returning();
  res.json(toUser(rows[0]));
});

// PATCH /api/auth/profile — update name, deliveryAddress, phone (sensitive: needs currentPassword), email (sensitive: needs currentPassword)
router.patch("/auth/profile", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "غير مسجل الدخول" });
    return;
  }

  const { name, deliveryAddress, phone, email, currentPassword } = req.body as {
    name?: string;
    deliveryAddress?: string;
    phone?: string;
    email?: string;
    currentPassword?: string;
  };

  const updates: Partial<typeof usersTable.$inferInsert> = {};

  // Simple fields — no password required
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (typeof deliveryAddress === "string") updates.deliveryAddress = deliveryAddress.trim() || null;

  // Sensitive fields — require password verification
  const newPhone = typeof phone === "string" && phone.trim() ? normalizePhone(phone.trim()) : null;
  const newEmail = typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;

  const changingPhone = !!newPhone && newPhone !== user.phone;
  const changingEmail = !!newEmail && newEmail !== user.email;

  if (changingPhone || changingEmail) {
    if (changingEmail) {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail!);
      if (!emailOk) {
        res.status(400).json({ error: "صيغة البريد الإلكتروني غير صحيحة" });
        return;
      }
    }

    if (!currentPassword) {
      res.status(400).json({ error: "يجب إدخال كلمة المرور الحالية لتغيير رقم الجوال أو البريد" });
      return;
    }
    if (!user.passwordHash) {
      res.status(400).json({ error: "لا يمكن التحقق من كلمة المرور" });
      return;
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة" });
      return;
    }

    if (changingPhone) {
      const existing = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.phone, newPhone!));
      if (existing.length > 0) {
        res.status(409).json({ error: "رقم الجوال مسجل في حساب آخر" });
        return;
      }
      updates.phone = newPhone!;
    }

    if (changingEmail) {
      const existing = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, newEmail!));
      if (existing.length > 0) {
        res.status(409).json({ error: "البريد الإلكتروني مسجل في حساب آخر" });
        return;
      }
      updates.email = newEmail!;
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  const rows = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, user.id))
    .returning();
  res.json(toUser(rows[0]));
});

// POST /api/auth/promote-admin
router.post("/auth/promote-admin", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "غير مسجل الدخول" });
    return;
  }
  const { password } = req.body ?? {};
  const adminPassword = process.env.ADMIN_PROMOTE_PASSWORD;
  if (!adminPassword) {
    req.log?.error("ADMIN_PROMOTE_PASSWORD is not configured");
    res.status(500).json({ error: "إعداد الإدارة غير مكتمل على الخادم" });
    return;
  }
  if (password !== adminPassword) {
    res.status(403).json({ error: "كلمة مرور الإدارة غير صحيحة" });
    return;
  }
  const rows = await db
    .update(usersTable)
    .set({ isAdmin: true })
    .where(eq(usersTable.id, user.id))
    .returning();
  res.json(toUser(rows[0]));
});

export default router;
