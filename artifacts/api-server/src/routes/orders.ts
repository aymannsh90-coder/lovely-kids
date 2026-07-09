import { Router } from "express";
import { db, ordersTable, productsTable, insertOrderSchema } from "@workspace/db";
import type { ColorVariant } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router = Router();

// POST /api/orders — create a new order + decrement stock
router.post("/orders", async (req, res) => {
  const parsed = insertOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات غير صالحة", details: parsed.error.issues });
    return;
  }

  const order = await db.insert(ordersTable).values(parsed.data).returning();

  // Decrement stock for each ordered item (fire-and-forget, don't block response)
  const items = parsed.data.items as Array<{ id: string; quantity: number; size?: string; color?: string }>;
  for (const item of items) {
    const productId = Number(item.id);
    if (isNaN(productId)) continue;

    const current = await db
      .select({ stock: productsTable.stock, colorVariants: productsTable.colorVariants })
      .from(productsTable)
      .where(eq(productsTable.id, productId));
    if (current.length === 0) continue;

    const updates: { stock?: number; colorVariants?: ColorVariant[] } = {};

    // Decrement the specific color+size quantity, if tracked.
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

    // Also keep the overall product stock count in sync, if tracked.
    if (current[0].stock !== null && current[0].stock !== undefined) {
      updates.stock = Math.max(0, current[0].stock - item.quantity);
    }

    if (Object.keys(updates).length > 0) {
      await db.update(productsTable).set(updates).where(eq(productsTable.id, productId));
    }
  }

  res.status(201).json(order[0]);
});

// GET /api/orders — get all orders (newest first)
router.get("/orders", async (_req, res) => {
  const orders = await db
    .select()
    .from(ordersTable)
    .orderBy(desc(ordersTable.createdAt));
  res.json(orders);
});

// GET /api/orders/my?phone=:phone — get orders for a specific customer phone
router.get("/orders/my", async (req, res) => {
  const phone = (req.query.phone as string | undefined)?.trim();
  if (!phone) {
    res.status(400).json({ error: "رقم الهاتف مطلوب" });
    return;
  }
  const orders = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.customerPhone, phone))
    .orderBy(desc(ordersTable.createdAt));
  res.json(orders);
});

// PATCH /api/orders/:id/cancel — customer cancels their own order (only if not shipped/delivered)
router.patch("/orders/:id/cancel", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "معرّف الطلب غير صالح" });
    return;
  }

  const current = await db
    .select({ status: ordersTable.status })
    .from(ordersTable)
    .where(eq(ordersTable.id, id));

  if (current.length === 0) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  const { status } = current[0];
  if (status === "shipped" || status === "delivered" || status === "cancelled") {
    res.status(400).json({ error: "لا يمكن إلغاء هذا الطلب بعد الآن" });
    return;
  }

  const updated = await db
    .update(ordersTable)
    .set({ status: "cancelled" })
    .where(eq(ordersTable.id, id))
    .returning();

  res.json(updated[0]);
});

// PATCH /api/orders/:id/status — update order status
router.patch("/orders/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body as { status: string };

  if (!status) {
    res.status(400).json({ error: "الحالة مطلوبة" });
    return;
  }

  const updated = await db
    .update(ordersTable)
    .set({ status })
    .where(eq(ordersTable.id, id))
    .returning();

  if (updated.length === 0) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  res.json(updated[0]);
});

// PATCH /api/orders/:id/payment-proof — customer uploads transfer receipt
router.patch("/orders/:id/payment-proof", async (req, res) => {
  const id = Number(req.params.id);
  const { paymentProof } = req.body as { paymentProof: string };

  if (!paymentProof) {
    res.status(400).json({ error: "صورة الوصل مطلوبة" });
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
router.patch("/orders/:id/confirm-payment", async (req, res) => {
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
router.delete("/orders/:id", async (req, res) => {
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
