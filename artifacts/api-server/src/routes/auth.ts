import { Router } from "express";
import { db, usersTable, sessionsTable, registerSchema, loginSchema } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken } from "../lib/password";
import { getBearerToken, getUserFromToken } from "../lib/auth";

const router = Router();

function toUser(u: typeof usersTable.$inferSelect) {
  return {
    id: String(u.id),
    phone: u.phone,
    name: u.name,
    isAdmin: u.isAdmin,
  };
}

// POST /api/auth/register
router.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات غير صالحة", details: parsed.error.issues });
    return;
  }
  const { phone, name, password } = parsed.data;

  const existing = await db.select().from(usersTable).where(eq(usersTable.phone, phone));
  if (existing.length > 0) {
    res.status(409).json({ error: "رقم الهاتف مسجل بالفعل" });
    return;
  }

  const passwordHash = hashPassword(password);
  const rows = await db
    .insert(usersTable)
    .values({ phone, name, passwordHash })
    .returning();
  const user = rows[0];

  const token = generateToken();
  await db.insert(sessionsTable).values({ token, userId: user.id });

  res.status(201).json({ token, user: toUser(user) });
});

// POST /api/auth/login
router.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات غير صالحة" });
    return;
  }
  const { phone, password } = parsed.data;

  const rows = await db.select().from(usersTable).where(eq(usersTable.phone, phone));
  const user = rows[0];
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "رقم الهاتف أو كلمة المرور غير صحيحة" });
    return;
  }

  const token = generateToken();
  await db.insert(sessionsTable).values({ token, userId: user.id });

  res.json({ token, user: toUser(user) });
});

// GET /api/auth/me
router.get("/auth/me", async (req, res) => {
  const user = await getUserFromToken(getBearerToken(req));
  if (!user) {
    res.status(401).json({ error: "غير مسجل الدخول" });
    return;
  }
  res.json(toUser(user));
});

// POST /api/auth/logout
router.post("/auth/logout", async (req, res) => {
  const token = getBearerToken(req);
  if (token) {
    await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
  }
  res.status(204).end();
});

// POST /api/auth/promote-admin
router.post("/auth/promote-admin", async (req, res) => {
  const user = await getUserFromToken(getBearerToken(req));
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
