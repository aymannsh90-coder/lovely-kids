import { Router } from "express";
import { db, productLikesTable, productsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "../lib/auth";

const router = Router();

// GET /api/likes — list liked product ids for the current user
router.get("/likes", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "غير مسجل الدخول" });
    return;
  }
  const rows = await db
    .select({ productId: productLikesTable.productId })
    .from(productLikesTable)
    .where(eq(productLikesTable.userId, user.id));
  res.json({ productIds: rows.map((r) => String(r.productId)) });
});

// POST /api/likes/:productId — like a product (idempotent)
router.post("/likes/:productId", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "غير مسجل الدخول" });
    return;
  }
  const productId = Number(req.params.productId);
  if (!Number.isInteger(productId)) {
    res.status(400).json({ error: "معرّف المنتج غير صالح" });
    return;
  }
  const product = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);

  if (!product[0]) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }

  const existing = await db
    .select()
    .from(productLikesTable)
    .where(and(eq(productLikesTable.userId, user.id), eq(productLikesTable.productId, productId)));
  if (existing.length === 0) {
    await db.insert(productLikesTable).values({ userId: user.id, productId });
  }
  res.status(201).json({ success: true });
});

// DELETE /api/likes/:productId — unlike a product
router.delete("/likes/:productId", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "غير مسجل الدخول" });
    return;
  }
  const productId = Number(req.params.productId);
  if (!Number.isInteger(productId)) {
    res.status(400).json({ error: "معرّف المنتج غير صالح" });
    return;
  }
  await db
    .delete(productLikesTable)
    .where(and(eq(productLikesTable.userId, user.id), eq(productLikesTable.productId, productId)));
  res.status(204).end();
});

export default router;
