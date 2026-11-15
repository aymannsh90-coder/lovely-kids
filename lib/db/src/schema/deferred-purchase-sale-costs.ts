import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { productsTable } from "./products";

/**
 * A sale of real, physically entered inventory whose supplier receipt is still
 * a draft. A draft is removed when approved, so its PUBLIC identifier is kept
 * here without a foreign key. The sale item is immutable until settlement.
 */
export const deferredPurchaseSaleCostsTable = pgTable(
  "deferred_purchase_sale_costs",
  {
    id: serial("id").primaryKey(),
    draftPublicId: text("draft_public_id").notNull(),
    productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
    // Historical sale ID remains valid even after an approved invoice is edited.
    saleItemId: integer("sale_item_id").notNull(),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull().default("pending"),
    approvedPurchaseId: integer("approved_purchase_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("deferred_purchase_sale_costs_quantity_valid", sql`${t.quantity} > 0 AND ${t.quantity} <= 99`),
    check("deferred_purchase_sale_costs_status_valid", sql`${t.status} IN ('pending', 'voided', 'settled')`),
    uniqueIndex("deferred_purchase_sale_costs_item_idx").on(t.saleItemId),
    index("deferred_purchase_sale_costs_draft_idx").on(t.draftPublicId, t.productId, t.status),
  ],
).enableRLS();
