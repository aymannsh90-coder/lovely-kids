import { pgTable, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const productLikesTable = pgTable(
  "product_likes",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    productId: integer("product_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("product_likes_user_product_idx").on(table.userId, table.productId),
  ]
);

export type DbProductLike = typeof productLikesTable.$inferSelect;
