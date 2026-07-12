import { Router } from "express";
import { db, pushTokensTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "../lib/auth";

const router = Router();

// POST /api/push-tokens — register a device push token
// Optionally linked to a phone; if the request has a valid admin Bearer token,
// the record is marked isAdmin=true so targeted admin notifications can be sent.
router.post("/push-tokens", async (req, res) => {
  const { token, phone } = req.body as { token?: string; phone?: string };
  if (!token) {
    res.status(400).json({ error: "التوكن مطلوب" });
    return;
  }

  // Determine if the requester is an admin
  const user = await getCurrentUser(req);
  const isAdmin = user?.isAdmin ?? false;

  await db
    .insert(pushTokensTable)
    .values({ token, phone: phone?.trim() || null, isAdmin })
    .onConflictDoUpdate({
      target: pushTokensTable.token,
      set: { phone: phone?.trim() || null, isAdmin },
    });

  res.status(201).json({ success: true });
});

// POST /api/notifications/send — send push notification to all registered tokens (admin only)
router.post("/notifications/send", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user || !user.isAdmin) {
    res.status(403).json({ error: "غير مصرح لك بإرسال الإشعارات" });
    return;
  }

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

  const { sent, failed } = await sendPushNotifications(
    tokens.map((t) => t.token),
    title,
    body,
    { type: "admin_notification" }
  );

  res.json({ sent, total: tokens.length, failed });
});

// GET /api/push-tokens/count — get count of registered tokens
router.get("/push-tokens/count", async (_req, res) => {
  const tokens = await db.select().from(pushTokensTable);
  res.json({ count: tokens.length });
});

export default router;

// ─── Shared helper: send Expo push notifications to a list of tokens ──────────
export async function sendPushNotifications(
  tokenList: string[],
  title: string,
  body: string,
  data: Record<string, unknown> = {}
): Promise<{ sent: number; failed: number }> {
  if (tokenList.length === 0) return { sent: 0, failed: 0 };

  const messages = tokenList.map((to) => ({
    to,
    sound: "default" as const,
    title,
    body,
    data,
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

      const result = (await response.json()) as {
        data: Array<{ status: string; id?: string; message?: string }>;
      };
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

  // Remove invalid tokens from DB
  if (failedTokens.length > 0) {
    await db
      .delete(pushTokensTable)
      .where(inArray(pushTokensTable.token, failedTokens));
  }

  return { sent, failed: failedTokens.length };
}
