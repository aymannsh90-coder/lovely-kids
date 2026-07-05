import { Router } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getBearerToken, getUserFromToken } from "../lib/auth";

const router = Router();

// GET /api/settings
router.get("/settings", async (_req, res) => {
  const rows = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  res.json((rows[0]?.data as Record<string, unknown>) ?? {});
});

// PUT /api/settings (admin only)
router.put("/settings", async (req, res) => {
  const user = await getUserFromToken(getBearerToken(req));
  if (!user || !user.isAdmin) {
    res.status(403).json({ error: "غير مصرح لك بتعديل الإعدادات" });
    return;
  }

  const partial = (req.body ?? {}) as Record<string, unknown>;
  const existing = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  const merged = { ...((existing[0]?.data as Record<string, unknown>) ?? {}), ...partial };

  const rows = await db
    .insert(appSettingsTable)
    .values({ id: 1, data: merged })
    .onConflictDoUpdate({
      target: appSettingsTable.id,
      set: { data: merged, updatedAt: new Date() },
    })
    .returning();

  res.json(rows[0].data);
});

export default router;
