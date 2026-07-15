import { Router } from "express";
import { db, ordersTable, pushTokensTable, insertOrderSchema } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { getCurrentUser, requireAuth, requireAdmin } from "../lib/auth";
import { sendPushNotifications } from "./notifications";
import { createTrustedOrder, OrderValidationError } from "../lib/create-order";

const router = Router();


// POST /api/orders — create an order using trusted server data
router.post("/orders", async (req, res) => {
  const parsed = insertOrderSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "بيانات غير صالحة",
      details: parsed.error.issues,
    });
    return;
  }

  try {
    const authUser = await getCurrentUser(req);

    const newOrder = await createTrustedOrder({
      customerName: parsed.data.customerName,
      customerPhone:
        authUser?.phone ?? parsed.data.customerPhone,
      customerAddress: parsed.data.customerAddress,
      notes: parsed.data.notes,
      shippingZone: parsed.data.shippingZone,
      paymentMethod: parsed.data.paymentMethod,
      items: parsed.data.items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        size: item.size,
        color: item.color,
      })),
    });

    res.status(201).json(newOrder);

    const itemCount = Array.isArray(newOrder.items)
      ? newOrder.items.length
      : 0;

    db.select({ token: pushTokensTable.token })
      .from(pushTokensTable)
      .where(eq(pushTokensTable.isAdmin, true))
      .then((rows) => {
        const tokens = rows.map((row) => row.token);

        if (tokens.length === 0) return;

        return sendPushNotifications(
          tokens,
          "🛍️ طلب جديد!",
          `طلب جديد من ${newOrder.customerName} — ${itemCount} منتج — ${newOrder.totalPrice}₪`,
          {
            type: "new_order",
            orderId: newOrder.id,
          },
        );
      })
      .catch(() => {});
  } catch (error) {
    if (error instanceof OrderValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }

    console.error("Failed to create order:", error);
    res.status(500).json({ error: "تعذر إنشاء الطلب، حاول مرة أخرى" });
  }
});

// GET /api/orders — get all orders (newest first)
router.get("/orders", requireAdmin, async (_req, res) => {
  const orders = await db
    .select()
    .from(ordersTable)
    .orderBy(desc(ordersTable.createdAt));
  res.json(orders);
});

// GET /api/orders/my — get orders for the authenticated user
router.get("/orders/my", requireAuth, async (_req, res) => {
  const user = res.locals.user as {
    phone?: string | null;
  };

  if (!user.phone) {
    res.status(400).json({ error: "أضف رقم الهاتف إلى حسابك لعرض طلباتك" });
    return;
  }

  const orders = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.customerPhone, user.phone))
    .orderBy(desc(ordersTable.createdAt));

  res.json(orders);
});

// PATCH /api/orders/:id/cancel — customer cancels their order (only when status = "new")
router.patch("/orders/:id/cancel", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "معرّف الطلب غير صالح" });
    return;
  }

  const current = await db
    .select({
      status: ordersTable.status,
      customerPhone: ordersTable.customerPhone,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id));

  if (current.length === 0) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  const user = res.locals.user as {
    phone?: string | null;
    isAdmin?: boolean;
  };

  if (
    !user.isAdmin &&
    (!user.phone || current[0].customerPhone !== user.phone)
  ) {
    res.status(403).json({ error: "لا يمكنك إلغاء طلب لا يخص حسابك" });
    return;
  }

  const { status } = current[0];
  // Only allow cancellation when the order is still "new" (جديد)
  if (status !== "new") {
    const msgMap: Record<string, string> = {
      confirmed:  "لا يمكن إلغاء الطلب بعد تأكيده",
      delivering: "لا يمكن إلغاء الطلب وهو قيد التوصيل",
      done:       "لا يمكن إلغاء الطلب بعد تسليمه",
      cancelled:  "الطلب ملغى مسبقاً",
    };
    res.status(400).json({ error: msgMap[status] ?? "لا يمكن إلغاء هذا الطلب" });
    return;
  }

  const updated = await db
    .update(ordersTable)
    .set({ status: "cancelled" })
    .where(eq(ordersTable.id, id))
    .returning();

  res.json(updated[0]);
});

// PATCH /api/orders/:id/status — update order status (admin)
// When status becomes "shipped", sends a push notification to the customer.
router.patch("/orders/:id/status", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body as { status: string };

  if (!status) {
    res.status(400).json({ error: "الحالة مطلوبة" });
    return;
  }

  // Fetch current order to detect status transition
  const current = await db
    .select({ status: ordersTable.status, customerPhone: ordersTable.customerPhone, id: ordersTable.id })
    .from(ordersTable)
    .where(eq(ordersTable.id, id));

  if (current.length === 0) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  const updated = await db
    .update(ordersTable)
    .set({ status })
    .where(eq(ordersTable.id, id))
    .returning();

  res.json(updated[0]);

  // ── Send push notification when order moves to "delivering" ────────────────
  if (status === "delivering" && current[0].status !== "delivering") {
    const customerPhone = current[0].customerPhone;
    if (customerPhone) {
      const tokenRows = await db
        .select({ token: pushTokensTable.token })
        .from(pushTokensTable)
        .where(eq(pushTokensTable.phone, customerPhone));

      const tokens = tokenRows.map((r) => r.token);
      if (tokens.length > 0) {
        sendPushNotifications(
          tokens,
          "طلبك في الطريق! 🚴",
          `طلبك رقم #${id} قيد التوصيل وفي طريقه إليك`,
          { type: "order_delivering", orderId: id }
        ).catch(() => {});
      }
    }
  }
});

// PATCH /api/orders/:id/payment-proof — customer uploads transfer receipt
router.patch("/orders/:id/payment-proof", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { paymentProof } = req.body as { paymentProof: string };

  if (isNaN(id)) {
    res.status(400).json({ error: "معرّف الطلب غير صالح" });
    return;
  }

  if (
    !paymentProof ||
    !paymentProof.startsWith("data:image/") ||
    paymentProof.length > 8_000_000
  ) {
    res.status(400).json({ error: "صورة الوصل غير صالحة أو كبيرة جدًا" });
    return;
  }

  const current = await db
    .select({
      customerPhone: ordersTable.customerPhone,
      paymentMethod: ordersTable.paymentMethod,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id));

  if (current.length === 0) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  const user = res.locals.user as {
    phone?: string | null;
    isAdmin?: boolean;
  };

  if (
    !user.isAdmin &&
    (!user.phone || current[0].customerPhone !== user.phone)
  ) {
    res.status(403).json({ error: "لا يمكنك تعديل طلب لا يخص حسابك" });
    return;
  }

  if (current[0].paymentMethod !== "bank_transfer") {
    res.status(400).json({ error: "هذا الطلب لا يستخدم التحويل البنكي" });
    return;
  }

  const updated = await db
    .update(ordersTable)
    .set({ paymentProof, paymentStatus: "proof_submitted" })
    .where(eq(ordersTable.id, id))
    .returning();

  if (updated.length === 0) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  res.json(updated[0]);
});

// PATCH /api/orders/:id/confirm-payment — admin confirms payment
router.patch("/orders/:id/confirm-payment", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);

  const updated = await db
    .update(ordersTable)
    .set({ paymentStatus: "confirmed", status: "confirmed" })
    .where(eq(ordersTable.id, id))
    .returning();

  if (updated.length === 0) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  res.json(updated[0]);
});

// DELETE /api/orders/:id — remove an order
router.delete("/orders/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "معرّف الطلب غير صالح" });
    return;
  }

  const deleted = await db.delete(ordersTable).where(eq(ordersTable.id, id)).returning();

  if (deleted.length === 0) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  res.status(204).send();
});

export default router;
