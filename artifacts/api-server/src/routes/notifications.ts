import { Router } from "express";
import { db, pushTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// POST /api/push-tokens — register a device push token
router.post("/push-tokens", async (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token) {
    res.status(400).json({ error: "التوكن مطلوب" });
    return;
  }

  await db
    .insert(pushTokensTable)
    .values({ token })
    .onConflictDoNothing();

  res.status(201).json({ success: true });
});

// POST /api/notifications/send — send push notification to all registered tokens
router.post("/notifications/send", async (req, res) => {
  const { title, body } = req.body as { title?: string; body?: string };

  if (!title || !body) {
    res.status(400).json({ error: "العنوان والنص مطلوبان" });
    return;
  }

  const tokens = await db.select().from(pushTokensTable);

  if (tokens.length === 0) {
    res.json({ sent: 0, message: "لا يوجد مستخدمون مسجّلون بعد" });
    return;
  }

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: "default",
    title,
    body,
    data: { type: "admin_notification" },
  }));

  const CHUNK_SIZE = 100;
  let sent = 0;
  const failedTokens: string[] = [];

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(chunk),
      });

      const result = await response.json() as { data: Array<{ status: string; id?: string; message?: string }> };
      if (result.data) {
        for (let j = 0; j < result.data.length; j++) {
          if (result.data[j].status === "ok") {
            sent++;
          } else {
            failedTokens.push(chunk[j].to);
          }
        }
      }
    } catch {
      // continue on chunk error
    }
  }

  // Remove invalid tokens
  if (failedTokens.length > 0) {
    for (const token of failedTokens) {
      await db.delete(pushTokensTable).where(eq(pushTokensTable.token, token));
    }
  }

  res.json({ sent, total: tokens.length, failed: failedTokens.length });
});

// GET /api/push-tokens/count — get count of registered tokens
router.get("/push-tokens/count", async (_req, res) => {
  const tokens = await db.select().from(pushTokensTable);
  res.json({ count: tokens.length });
});

export default router;
