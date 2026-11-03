import { date, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { posPurchasesTable, posPurchaseItemsTable } from "./pos-purchases";
import { suppliersTable } from "./suppliers";
import { productsTable } from "./products";
import { usersTable } from "./users";

export const posPurchaseReturnsTable = pgTable("pos_purchase_returns", {
  id: serial("id").primaryKey(),
  publicId: text("public_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  purchaseId: integer("purchase_id").notNull().references(() => posPurchasesTable.id, { onDelete: "restrict" }),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
  businessDate: date("business_date").notNull(),
  status: text("status").notNull().default("completed"),
  refundAmountMinor: integer("refund_amount_minor").notNull(),
  inventoryCostMinor: integer("inventory_cost_minor").notNull(),
  reason: text("reason").notNull(),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedByUserId: integer("voided_by_user_id").references(() => usersTable.id, { onDelete: "restrict" }),
  voidReason: text("void_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("pos_purchase_returns_public_id_idx").on(table.publicId),
  uniqueIndex("pos_purchase_returns_idempotency_idx").on(table.idempotencyKey),
  index("pos_purchase_returns_purchase_idx").on(table.purchaseId),
  index("pos_purchase_returns_supplier_idx").on(table.supplierId),
  index("pos_purchase_returns_business_date_idx").on(table.businessDate),
]).enableRLS();

export const posPurchaseReturnItemsTable = pgTable("pos_purchase_return_items", {
  id: serial("id").primaryKey(),
  returnId: integer("return_id").notNull().references(() => posPurchaseReturnsTable.id, { onDelete: "cascade" }),
  purchaseItemId: integer("purchase_item_id").notNull().references(() => posPurchaseItemsTable.id, { onDelete: "restrict" }),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "restrict" }),
  color: text("color"),
  size: text("size"),
  quantity: integer("quantity").notNull(),
  refundAmountMinor: integer("refund_amount_minor").notNull(),
  inventoryCostMinor: integer("inventory_cost_minor").notNull(),
  costQuality: text("cost_quality").notNull(),
  generalStockBefore: integer("general_stock_before"),
  generalStockAfter: integer("general_stock_after"),
  variantStockBefore: integer("variant_stock_before"),
  variantStockAfter: integer("variant_stock_after"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("pos_purchase_return_items_return_idx").on(table.returnId),
  index("pos_purchase_return_items_purchase_item_idx").on(table.purchaseItemId),
  index("pos_purchase_return_items_product_idx").on(table.productId),
]).enableRLS();
