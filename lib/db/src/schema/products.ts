import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface SizeStock {
  size: string;
  outOfStock?: boolean;
  stock?: number | null;
}

export interface ColorVariant {
  color: string;
  hex: string;
  image?: string;
  sizes: SizeStock[];
}

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  productCode: text("product_code"),
  barcode: text("barcode"),
  price: integer("price").notNull(),
  originalPrice: integer("original_price"),
  image: text("image").notNull(),
  images: jsonb("images").$type<string[]>().default([]),
  category: text("category").notNull(),
  ageGroup: text("age_group").notNull(),
  gender: text("gender"),
  season: text("season"),
  sizes: jsonb("sizes").$type<string[]>().default([]),
  colorVariants: jsonb("color_variants").$type<ColorVariant[]>().default([]),
  rating: integer("rating").notNull().default(48),
  reviews: integer("reviews").notNull().default(0),
  isNew: boolean("is_new").default(false),
  isPinned: boolean("is_pinned").default(false),
  showInOffers: boolean("show_in_offers").notNull().default(false),
  facebookUrl: text("facebook_url"),
  instagramUrl: text("instagram_url"),
  tiktokUrl: text("tiktok_url"),
  newUntil: timestamp("new_until"),
  discount: integer("discount"),
  description: text("description").notNull().default(""),
  stock: integer("stock"),
  isHidden: boolean("is_hidden").notNull().default(false),
  autoHiddenOutOfStock: boolean("auto_hidden_out_of_stock").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}).enableRLS();

export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  createdAt: true,
  isHidden: true,
  autoHiddenOutOfStock: true,
  deletedAt: true,
}).extend({
  sizes: z.array(z.string()).optional(),
  colorVariants: z
    .array(
      z.object({
        color: z.string(),
        hex: z.string(),
        image: z.string().optional(),
        sizes: z.array(
          z.object({
            size: z.string(),
            outOfStock: z.boolean().optional(),
            stock: z.number().int().nonnegative().nullable().optional(),
          })
        ),
      })
    )
    .optional(),
  stock: z.number().int().nonnegative().nullable().optional(),
  newUntil: z.coerce.date().nullable().optional(),
  gender: z.enum(["boys", "girls"]).nullable().optional(),
  season: z.enum(["summer", "winter"]).nullable().optional(),
});

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type DbProduct = typeof productsTable.$inferSelect;
