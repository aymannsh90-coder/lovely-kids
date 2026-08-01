import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { cashSessionsTable } from "./cash-sessions";
import { posSaleItemsTable, posSalesTable } from "./pos-sales";
import { productsTable } from "./products";
import { usersTable } from "./users";

export const posSaleReturnsTable = pgTable(
  "pos_sale_returns",
  {
    id: serial("id").primaryKey(),

    publicId: text("public_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),

    originalSaleId: integer("original_sale_id")
      .notNull()
      .references(() => posSalesTable.id, {
        onDelete: "restrict",
      }),

    cashSessionId: integer("cash_session_id")
      .notNull()
      .references(() => cashSessionsTable.id, {
        onDelete: "restrict",
      }),

    registerKey: text("register_key").notNull(),
    businessDate: date("business_date").notNull(),

    cashierUserId: integer("cashier_user_id")
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
      }),

    status: text("status").notNull().default("completed"),
    refundMethod: text("refund_method").notNull().default("cash"),

    grossAmountMinor: integer("gross_amount_minor").notNull(),
    discountAmountMinor: integer("discount_amount_minor").notNull(),
    refundAmountMinor: integer("refund_amount_minor").notNull(),

    reason: text("reason").notNull(),
    notes: text("notes"),

    voidedAt: timestamp("voided_at", {
      withTimezone: true,
    }),

    voidedByUserId: integer("voided_by_user_id").references(
      () => usersTable.id,
      {
        onDelete: "restrict",
      },
    ),

    voidReason: text("void_reason"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "pos_sale_returns_register_key_valid",
      sql`${table.registerKey} ~ '^[a-z0-9_-]{1,50}$'`,
    ),

    check(
      "pos_sale_returns_status_valid",
      sql`${table.status} in ('completed', 'voided')`,
    ),

    check(
      "pos_sale_returns_refund_method_valid",
      sql`${table.refundMethod} in ('cash')`,
    ),

    check(
      "pos_sale_returns_amounts_nonnegative",
      sql`
        ${table.grossAmountMinor} >= 0
        and ${table.discountAmountMinor} >= 0
        and ${table.refundAmountMinor} >= 0
      `,
    ),

    check(
      "pos_sale_returns_discount_not_over_gross",
      sql`${table.discountAmountMinor} <= ${table.grossAmountMinor}`,
    ),

    check(
      "pos_sale_returns_refund_matches",
      sql`
        ${table.refundAmountMinor} =
        ${table.grossAmountMinor} - ${table.discountAmountMinor}
      `,
    ),

    check(
      "pos_sale_returns_void_state_valid",
      sql`
        (
          ${table.status} = 'completed'
          and ${table.voidedAt} is null
          and ${table.voidedByUserId} is null
        )
        or
        (
          ${table.status} = 'voided'
          and ${table.voidedAt} is not null
          and ${table.voidedByUserId} is not null
        )
      `,
    ),

    uniqueIndex("pos_sale_returns_public_id_idx").on(table.publicId),

    uniqueIndex("pos_sale_returns_idempotency_key_idx").on(
      table.idempotencyKey,
    ),

    index("pos_sale_returns_original_sale_idx").on(table.originalSaleId),

    index("pos_sale_returns_cash_session_idx").on(table.cashSessionId),

    index("pos_sale_returns_business_date_idx").on(table.businessDate),

    index("pos_sale_returns_cashier_idx").on(table.cashierUserId),

    index("pos_sale_returns_created_at_idx").on(table.createdAt),
  ],
).enableRLS();

export const posSaleReturnItemsTable = pgTable(
  "pos_sale_return_items",
  {
    id: serial("id").primaryKey(),

    returnId: integer("return_id")
      .notNull()
      .references(() => posSaleReturnsTable.id, {
        onDelete: "cascade",
      }),

    originalSaleItemId: integer("original_sale_item_id")
      .notNull()
      .references(() => posSaleItemsTable.id, {
        onDelete: "restrict",
      }),

    lineNumber: integer("line_number").notNull(),

    productId: integer("product_id").references(() => productsTable.id, {
      onDelete: "set null",
    }),

    barcode: text("barcode"),
    productCode: text("product_code"),
    productNameAr: text("product_name_ar").notNull(),

    color: text("color"),
    size: text("size"),

    quantity: integer("quantity").notNull(),

    soldUnitPriceMinor: integer("sold_unit_price_minor").notNull(),
    grossAmountMinor: integer("gross_amount_minor").notNull(),

    lineDiscountMinor: integer("line_discount_minor").notNull().default(0),

    invoiceDiscountMinor: integer("invoice_discount_minor")
      .notNull()
      .default(0),

    allocatedDiscountMinor: integer("allocated_discount_minor").notNull(),
    refundAmountMinor: integer("refund_amount_minor").notNull(),

    generalStockBefore: integer("general_stock_before"),
    generalStockAfter: integer("general_stock_after"),

    variantStockBefore: integer("variant_stock_before"),
    variantStockAfter: integer("variant_stock_after"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("pos_sale_return_items_line_positive", sql`${table.lineNumber} > 0`),

    check(
      "pos_sale_return_items_quantity_valid",
      sql`${table.quantity} > 0 and ${table.quantity} <= 99`,
    ),

    check(
      "pos_sale_return_items_amounts_nonnegative",
      sql`
        ${table.soldUnitPriceMinor} >= 0
        and ${table.grossAmountMinor} >= 0
        and ${table.lineDiscountMinor} >= 0
        and ${table.invoiceDiscountMinor} >= 0
        and ${table.allocatedDiscountMinor} >= 0
        and ${table.refundAmountMinor} >= 0
      `,
    ),

    check(
      "pos_sale_return_items_discount_breakdown_matches",
      sql`
        ${table.allocatedDiscountMinor} =
        ${table.lineDiscountMinor} + ${table.invoiceDiscountMinor}
      `,
    ),

    check(
      "pos_sale_return_items_discount_not_over_gross",
      sql`${table.allocatedDiscountMinor} <= ${table.grossAmountMinor}`,
    ),

    check(
      "pos_sale_return_items_refund_matches",
      sql`
        ${table.refundAmountMinor} =
        ${table.grossAmountMinor} - ${table.allocatedDiscountMinor}
      `,
    ),

    check(
      "pos_sale_return_items_general_stock_valid",
      sql`
        (
          ${table.generalStockBefore} is null
          or ${table.generalStockBefore} >= 0
        )
        and
        (
          ${table.generalStockAfter} is null
          or ${table.generalStockAfter} >= 0
        )
      `,
    ),

    check(
      "pos_sale_return_items_variant_stock_valid",
      sql`
        (
          ${table.variantStockBefore} is null
          or ${table.variantStockBefore} >= 0
        )
        and
        (
          ${table.variantStockAfter} is null
          or ${table.variantStockAfter} >= 0
        )
      `,
    ),

    uniqueIndex("pos_sale_return_items_return_line_idx").on(
      table.returnId,
      table.lineNumber,
    ),

    uniqueIndex("pos_sale_return_items_return_sale_item_idx").on(
      table.returnId,
      table.originalSaleItemId,
    ),

    index("pos_sale_return_items_return_idx").on(table.returnId),

    index("pos_sale_return_items_original_item_idx").on(
      table.originalSaleItemId,
    ),

    index("pos_sale_return_items_product_idx").on(table.productId),
  ],
).enableRLS();

export type PosSaleReturn = typeof posSaleReturnsTable.$inferSelect;

export type PosSaleReturnItem = typeof posSaleReturnItemsTable.$inferSelect;
