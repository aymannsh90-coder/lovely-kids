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
import { productsTable } from "./products";
import { usersTable } from "./users";

export const posSalesTable = pgTable(
  "pos_sales",
  {
    id: serial("id").primaryKey(),

    publicId: text("public_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),

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

    paymentMethod: text("payment_method").notNull().default("cash"),

    subtotalMinor: integer("subtotal_minor").notNull(),

    discountMinor: integer("discount_minor").notNull().default(0),

    itemDiscountMinor: integer("item_discount_minor").notNull().default(0),

    invoiceDiscountMinor: integer("invoice_discount_minor")
      .notNull()
      .default(0),

    totalMinor: integer("total_minor").notNull(),
    paidMinor: integer("paid_minor").notNull(),

    changeMinor: integer("change_minor").notNull().default(0),

    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
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
      "pos_sales_register_key_valid",
      sql`${table.registerKey} ~ '^[a-z0-9_-]{1,50}$'`,
    ),

    check(
      "pos_sales_status_valid",
      sql`${table.status} in ('completed', 'voided')`,
    ),

    check(
      "pos_sales_payment_method_valid",
      sql`${table.paymentMethod} in ('cash', 'card', 'mixed')`,
    ),

    check(
      "pos_sales_amounts_nonnegative",
      sql`
        ${table.subtotalMinor} >= 0
        and ${table.discountMinor} >= 0
        and ${table.itemDiscountMinor} >= 0
        and ${table.invoiceDiscountMinor} >= 0
        and ${table.totalMinor} >= 0
        and ${table.paidMinor} >= 0
        and ${table.changeMinor} >= 0
      `,
    ),

    check(
      "pos_sales_discount_not_over_subtotal",
      sql`${table.discountMinor} <= ${table.subtotalMinor}`,
    ),

    check(
      "pos_sales_discount_breakdown_matches",
      sql`
        ${table.discountMinor} =
        ${table.itemDiscountMinor} + ${table.invoiceDiscountMinor}
      `,
    ),

    check(
      "pos_sales_total_matches",
      sql`
        ${table.totalMinor} =
        ${table.subtotalMinor} - ${table.discountMinor}
      `,
    ),

    check(
      "pos_sales_payment_matches",
      sql`
        ${table.paidMinor} >= ${table.totalMinor}
        and ${table.changeMinor} =
          ${table.paidMinor} - ${table.totalMinor}
      `,
    ),

    check(
      "pos_sales_void_state_valid",
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

    uniqueIndex("pos_sales_public_id_idx").on(table.publicId),

    uniqueIndex("pos_sales_idempotency_key_idx").on(table.idempotencyKey),

    index("pos_sales_cash_session_idx").on(table.cashSessionId),

    index("pos_sales_business_date_idx").on(table.businessDate),

    index("pos_sales_cashier_idx").on(table.cashierUserId),

    index("pos_sales_created_at_idx").on(table.createdAt),
  ],
).enableRLS();

export const posSaleItemsTable = pgTable(
  "pos_sale_items",
  {
    id: serial("id").primaryKey(),

    saleId: integer("sale_id")
      .notNull()
      .references(() => posSalesTable.id, {
        onDelete: "cascade",
      }),

    lineNumber: integer("line_number").notNull(),

    productId: integer("product_id").references(() => productsTable.id, {
      onDelete: "set null",
    }),

    barcode: text("barcode"),
    productCode: text("product_code"),
    productNameAr: text("product_name_ar").notNull(),
    productImage: text("product_image"),

    color: text("color"),
    size: text("size"),

    quantity: integer("quantity").notNull(),

    websiteUnitPriceMinor: integer("website_unit_price_minor").notNull(),

    soldUnitPriceMinor: integer("sold_unit_price_minor").notNull(),

    lineDiscountMinor: integer("line_discount_minor").notNull().default(0),

    lineTotalMinor: integer("line_total_minor").notNull(),

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
    check("pos_sale_items_line_positive", sql`${table.lineNumber} > 0`),

    check(
      "pos_sale_items_quantity_valid",
      sql`${table.quantity} > 0 and ${table.quantity} <= 99`,
    ),

    check(
      "pos_sale_items_prices_nonnegative",
      sql`
        ${table.websiteUnitPriceMinor} >= 0
        and ${table.soldUnitPriceMinor} >= 0
        and ${table.lineDiscountMinor} >= 0
        and ${table.lineTotalMinor} >= 0
      `,
    ),

    check(
      "pos_sale_items_line_discount_not_over_gross",
      sql`
        ${table.lineDiscountMinor} <=
        ${table.soldUnitPriceMinor} * ${table.quantity}
      `,
    ),

    check(
      "pos_sale_items_total_matches",
      sql`
        ${table.lineTotalMinor} =
        ${table.soldUnitPriceMinor} * ${table.quantity}
        - ${table.lineDiscountMinor}
      `,
    ),

    check(
      "pos_sale_items_general_stock_valid",
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
      "pos_sale_items_variant_stock_valid",
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

    uniqueIndex("pos_sale_items_sale_line_idx").on(
      table.saleId,
      table.lineNumber,
    ),

    index("pos_sale_items_sale_idx").on(table.saleId),

    index("pos_sale_items_product_idx").on(table.productId),

    index("pos_sale_items_barcode_idx").on(table.barcode),
  ],
).enableRLS();

export type PosSale = typeof posSalesTable.$inferSelect;

export type PosSaleItem = typeof posSaleItemsTable.$inferSelect;
