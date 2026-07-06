import { Router } from "express";
import { supabase } from "../lib/supabase";
import { getBearerToken, getUserFromToken } from "../lib/auth";

const router = Router();

// =======================
// GET /api/settings
// =======================
router.get("/settings", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("settings")
      .select("*")
      .eq("key", "app")
      .single();

    if (error || !data) {
      return res.json({});
    }

    return res.json(data.value ?? {});
  } catch (err) {
    return res.json({});
  }
});

// =======================
// PUT /api/settings (admin only)
// =======================
router.put("/settings", async (req, res) => {
  try {
    const user = await getUserFromToken(getBearerToken(req));

    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: "غير مصرح لك بتعديل الإعدادات" });
    }

    const partial = (req.body ?? {}) as Record<string, unknown>;

    // جلب الإعدادات الحالية
    const { data: existing } = await supabase
      .from("settings")
      .select("*")
      .eq("key", "app")
      .single();

    // دمج القديم مع الجديد
    const merged = {
      ...(existing?.value ?? {}),
      ...partial,
    };

    // حفظ في Supabase
    const { data, error } = await supabase
      .from("settings")
      .upsert({
        key: "app",
        value: merged,
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json(data.value);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
