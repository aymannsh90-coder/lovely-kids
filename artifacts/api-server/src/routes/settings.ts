import { Router } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "../lib/auth";

const router = Router();

function sanitizePublicSettingsData(
  data: Record<string, unknown>,
) {
  const shippingZones =
    Array.isArray(data.shippingZones)
      ? data.shippingZones.map((zone) => {
          if (
            !zone ||
            typeof zone !== "object" ||
            Array.isArray(zone)
          ) {
            return zone;
          }

          const publicZone = {
            ...(zone as Record<string, unknown>),
          };

          delete publicZone.companyCost;

          return publicZone;
        })
      : data.shippingZones;

  return {
    ...data,
    ...(shippingZones === undefined
      ? {}
      : { shippingZones }),
  };
}

function mergeSettingsPreservingCompanyCosts(
  existing: Record<string, unknown>,
  partial: Record<string, unknown>,
) {
  if (!Array.isArray(partial.shippingZones)) {
    return {
      ...existing,
      ...partial,
    };
  }

  const existingZones =
    Array.isArray(existing.shippingZones)
      ? existing.shippingZones
      : [];

  const companyCostByLabel =
    new Map<string, unknown>();

  for (const zone of existingZones) {
    if (
      !zone ||
      typeof zone !== "object" ||
      Array.isArray(zone)
    ) {
      continue;
    }

    const current =
      zone as Record<string, unknown>;

    if (
      typeof current.label === "string" &&
      current.companyCost !== undefined
    ) {
      companyCostByLabel.set(
        current.label,
        current.companyCost,
      );
    }
  }

  const shippingZones =
    partial.shippingZones.map((zone) => {
      if (
        !zone ||
        typeof zone !== "object" ||
        Array.isArray(zone)
      ) {
        return zone;
      }

      const next = {
        ...(zone as Record<string, unknown>),
      };

      if (
        next.companyCost === undefined &&
        typeof next.label === "string"
      ) {
        const existingCompanyCost =
          companyCostByLabel.get(next.label);

        if (existingCompanyCost !== undefined) {
          next.companyCost =
            existingCompanyCost;
        }
      }

      return next;
    });

  return {
    ...existing,
    ...partial,
    shippingZones,
  };
}

// =======================
// GET /api/settings
// =======================
router.get("/settings", async (req, res) => {
  const rows = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.id, 1));

  const data =
    (rows[0]?.data as Record<string, unknown>) ?? {};

  const user =
    await getCurrentUser(req);

  return res.json(
    user?.isAdmin
      ? data
      : sanitizePublicSettingsData(data),
  );
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
  const merged =
    mergeSettingsPreservingCompanyCosts(
      existing,
      partial,
    );

  await db
    .insert(appSettingsTable)
    .values({ id: 1, data: merged })
    .onConflictDoUpdate({ target: appSettingsTable.id, set: { data: merged } });

  return res.json(merged);
});

export default router;
