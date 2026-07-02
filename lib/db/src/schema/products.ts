import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  price: integer("price").notNull(),
  originalPrice: integer("original_price"),
  image: text("image").notNull(),
  images: jsonb("images").$type<string[]>().default([]),
  category: text("category").notNull(),
  ageGroup: text("age_group").notNull(),
  gender: text("gender"),
  sizes: jsonb("sizes").$type<string[]>().default([]),
  rating: integer("rating").notNull().default(48),
  reviews: integer("reviews").notNull().default(0),
  isNew: boolean("is_new").default(false),
  discount: integer("discount"),
  description: text("description").notNull().default(""),
  stock: integer("stock"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  createdAt: true,
}).extend({
  sizes: z.array(z.string()).optional(),
  stock: z.number().int().nonnegative().nullable().optional(),
  gender: z.enum(["boys", "girls"]).nullable().optional(),
});

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type DbProduct = typeof productsTable.$inferSelect;
