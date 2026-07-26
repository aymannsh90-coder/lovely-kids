import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { productsTable } from "./products";

export const productBarcodesTable = pgTable(
  "product_barcodes",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "cascade" }),
    barcode: text("barcode").notNull(),
    color: text("color"),
    size: text("size"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("product_barcodes_barcode_idx").on(table.barcode),
  ],
);

export type DbProductBarcode = typeof productBarcodesTable.$inferSelect;

export const productBarcodeInputSchema = z.object({
  barcode: z.string().trim().min(1),
  color: z.string().trim().nullable().optional(),
  size: z.string().trim().nullable().optional(),
});

export type ProductBarcodeInput = z.infer<typeof productBarcodeInputSchema>;
