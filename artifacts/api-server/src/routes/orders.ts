import { Router } from "express";
import { db, ordersTable, productsTable, pushTokensTable, insertOrderSchema } from "@workspace/db";
import type { ColorVariant } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { getCurrentUser, requireAuth, requireAdmin } from "../lib/auth";
import { sendPushNotifications } from "./notifications";

const router = Router();

// POST /api/orders — create a new order + decrement stock
router.post("/orders", async (req, res) => {
  const parsed = insertOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات غير صالحة", details: parsed.error.issues });
    return;
  }

  const authUser = await getCurrentUser(req);

  // لا نسمح للعميل بتحديد حالة الطلب أو اعتباره مدفوعًا.
  // وعند تسجيل الدخول نربط الطلب برقم الهاتف الموجود في الحساب.
  const orderData = {
    ...parsed.data,
    customerPhone: authUser?.phone ?? parsed.data.customerPhone,
    status: "new",
    paymentStatus:
      parsed.data.paymentMethod === "bank_transfer"
        ? "awaiting_transfer"
        : "pending",
    paymentProof: null,
  };

  const order = await db.insert(ordersTable).values(orderData).returning();

  // Decrement stock for each ordered item
  const items = orderData.items as Array<{
    id: string;
    quantity: number;
    size?: string;
    color?: string;
  }>;
  for (const item of items) {
    const productId = Number(item.id);
    if (isNaN(productId)) continue;

    const current = await db
      .select({ stock: productsTable.stock, colorVariants: productsTable.colorVariants })
      .from(productsTable)
      .where(eq(productsTable.id, productId));
    if (current.length === 0) continue;

    const updates: { stock?: number; colorVariants?: ColorVariant[] } = {};

    if (item.color && item.size) {
      const colorVariants = (current[0].colorVariants as ColorVariant[] | null) ?? [];
      let variantChanged = false;
      const nextVariants = colorVariants.map((cv) => {
        if (cv.color !== item.color) return cv;
        return {
          ...cv,
          sizes: cv.sizes.map((s) => {
            if (s.size !== item.size || s.stock === undefined || s.stock === null) return s;
            variantChanged = true;
            const newStock = Math.max(0, s.stock - item.quantity);
            return { ...s, stock: newStock, outOfStock: newStock <= 0 };
          }),
        };
      });
      if (variantChanged) updates.colorVariants = nextVariants;
    }

    if (current[0].stock !== null && current[0].stock !== undefined) {
      updates.stock = Math.max(0, current[0].stock - item.quantity);
    }

    if (Object.keys(updates).length > 0) {
      await db.update(productsTable).set(updates).where(eq(productsTable.id, productId));
    }
  }

  res.status(201).json(order[0]);

  // ── Notify all admin devices about the new order (fire-and-forget) ──────────
  const newOrder = order[0];
  db.select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.isAdmin, true))
    .then((rows) => {
      const tokens = rows.map((r) => r.token);
      if (tokens.length === 0) return;
      const itemCount = (orderData.items as Array<unknown>).length;
      sendPushNotifications(
        tokens,
        "🛍️ طلب جديد!",
        `طلب جديد من ${newOrder.customerName} — ${itemCount} منتج — ${newOrder.totalPrice}₪`,
        { type: "new_order", orderId: newOrder.id }
      );
    })
    .catch(() => {});
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
