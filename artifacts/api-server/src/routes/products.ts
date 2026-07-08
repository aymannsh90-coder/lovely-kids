import { Router } from "express";
import { db, productsTable, insertProductSchema } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router = Router();

function toProduct(r: typeof productsTable.$inferSelect) {
  return {
    id: String(r.id),
    name: r.name,
    nameAr: r.nameAr,
    price: r.price,
    originalPrice: r.originalPrice ?? undefined,
    image: r.image,
    images: (r.images as string[]) ?? [],
    category: r.category,
    ageGroup: r.ageGroup,
    gender: (r.gender as "boys" | "girls" | null) ?? null,
    season: (r.season as "summer" | "winter" | null) ?? null,
    sizes: (r.sizes as string[]) ?? [],
    colorVariants: (r.colorVariants as unknown[]) ?? [],
    rating: r.rating / 10,
    reviews: r.reviews,
    isNew: r.isNew ?? false,
    discount: r.discount ?? undefined,
    description: r.description,
    stock: r.stock ?? null,
  };
}

// GET /api/products
router.get("/products", async (_req, res) => {
  const rows = await db.select().from(productsTable).orderBy(desc(productsTable.createdAt));
  res.json(rows.map(toProduct));
});

// POST /api/products
router.post("/products", async (req, res) => {
  const parsed = insertProductSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات غير صالحة", details: parsed.error.issues });
    return;
  }
  const row = await db.insert(productsTable).values(parsed.data).returning();
  res.status(201).json(toProduct(row[0]));
});

// PUT /api/products/:id
router.put("/products/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = insertProductSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات غير صالحة", details: parsed.error.issues });
    return;
  }
  const updated = await db.update(productsTable).set(parsed.data).where(eq(productsTable.id, id)).returning();
  if (updated.length === 0) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }
  res.json(toProduct(updated[0]));
});

// PATCH /api/products/:id/stock
// Body options:
//   { action: "set",      amount: 10 }  → set stock to exact value
//   { action: "add",      amount: 5  }  → add to current stock
//   { action: "subtract", amount: 2  }  → subtract from current stock (min 0)
router.patch("/products/:id/stock", async (req, res) => {
  const id = Number(req.params.id);
  const { action, amount } = req.body as { action: "set" | "add" | "subtract"; amount: number };

  if (!action || typeof amount !== "number" || amount < 0) {
    res.status(400).json({ error: "action و amount مطلوبان" });
    return;
  }

  const current = await db.select({ stock: productsTable.stock }).from(productsTable).where(eq(productsTable.id, id));
  if (current.length === 0) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }

  let newStock: number;
  if (action === "set") {
    newStock = Math.max(0, Math.round(amount));
  } else if (action === "add") {
    const cur = current[0].stock ?? 0;
    newStock = cur + Math.round(amount);
  } else {
    const cur = current[0].stock ?? 0;
    newStock = Math.max(0, cur - Math.round(amount));
  }

  const updated = await db
    .update(productsTable)
    .set({ stock: newStock })
    .where(eq(productsTable.id, id))
    .returning();

  res.json(toProduct(updated[0]));
});

// DELETE /api/products/:id
router.delete("/products/:id", async (req, res) => {
  const id = Number(req.params.id);
  const deleted = await db.delete(productsTable).where(eq(productsTable.id, id)).returning();
  if (deleted.length === 0) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }
  res.json({ success: true });
});

export default router;
