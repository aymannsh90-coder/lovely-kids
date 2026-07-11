import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getBearerToken, getUserFromToken, getCurrentUser } from "../lib/auth";

const router = Router();

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

// POST /api/auth/sync-user — called by the Expo app after Clerk sign-up/sign-in
// to upsert the user's extra profile data (name, phone, email) into Supabase.
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

// POST /api/auth/lookup-phone — no auth required; returns the email for a phone number
router.post("/auth/lookup-phone", async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone?.trim()) {
    res.status(400).json({ error: "رقم الهاتف مطلوب" });
    return;
  }
  const rows = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.phone, phone.trim()));
  if (!rows[0]?.email) {
    res.status(404).json({ error: "رقم الجوال غير مسجل" });
    return;
  }
  res.json({ email: rows[0].email });
});

// POST /api/auth/register — legacy phone+password (kept for backward compatibility)
router.post("/auth/register", async (req, res) => {
  res.status(410).json({ error: "يرجى إنشاء الحساب عبر البريد الإلكتروني" });
});

// POST /api/auth/login — legacy phone+password (kept for backward compatibility)
router.post("/auth/login", async (req, res) => {
  res.status(410).json({ error: "يرجى تسجيل الدخول عبر البريد الإلكتروني" });
});

// POST /api/auth/logout — legacy session invalidation
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

// PUT /api/auth/profile — update name / deliveryAddress
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
