import { Router } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "../lib/auth";

const router = Router();

// =======================
// GET /api/settings
// =======================
router.get("/settings", async (_req, res) => {
  const rows = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  return res.json((rows[0]?.data as Record<string, unknown>) ?? {});
});

// =======================
// PUT /api/settings (admin only)
// =======================
router.put("/settings", async (req, res) => {
  const user = await getCurrentUser(req);

  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: "غير مصرح لك بتعديل الإعدادات" });
  }

  const partial = (req.body ?? {}) as Record<string, unknown>;

  const rows = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  const existing = (rows[0]?.data as Record<string, unknown>) ?? {};
  const merged = { ...existing, ...partial };

  await db
    .insert(appSettingsTable)
    .values({ id: 1, data: merged })
    .onConflictDoUpdate({ target: appSettingsTable.id, set: { data: merged } });

  return res.json(merged);
});

export default router;
