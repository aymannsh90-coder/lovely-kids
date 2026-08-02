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
import { productsTable } from "./products";
import { suppliersTable } from "./suppliers";
import { usersTable } from "./users";

export const posPurchasesTable = pgTable(
  "pos_purchases",
  {
    id: serial("id").primaryKey(),

    publicId: text("public_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),

    supplierId: integer("supplier_id")
      .notNull()
      .references(() => suppliersTable.id, {
        onDelete: "restrict",
      }),

    supplierInvoiceNumber: text("supplier_invoice_number"),

    businessDate: date("business_date").notNull(),
    warehouseKey: text("warehouse_key").notNull().default("main"),
    currencyCode: text("currency_code").notNull().default("ILS"),

    enteredByUserId: integer("entered_by_user_id")
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
      }),

    status: text("status").notNull().default("completed"),
    paymentMethod: text("payment_method").notNull().default("credit"),

    subtotalMinor: integer("subtotal_minor").notNull(),
    discountMinor: integer("discount_minor").notNull().default(0),
    totalMinor: integer("total_minor").notNull(),

    paidMinor: integer("paid_minor").notNull().default(0),
    dueMinor: integer("due_minor").notNull(),

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
      "pos_purchases_public_id_valid",
      sql`length(btrim(${table.publicId})) between 6 and 80`,
    ),

    check(
      "pos_purchases_idempotency_key_valid",
      sql`length(btrim(${table.idempotencyKey})) between 8 and 120`,
    ),

    check(
      "pos_purchases_warehouse_key_valid",
      sql`${table.warehouseKey} ~ '^[a-z0-9_-]{1,50}$'`,
    ),

    check(
      "pos_purchases_currency_code_valid",
      sql`${table.currencyCode} ~ '^[A-Z]{3}$'`,
    ),

    check(
      "pos_purchases_status_valid",
      sql`${table.status} in ('completed', 'voided')`,
    ),

    check(
      "pos_purchases_payment_method_valid",
      sql`${table.paymentMethod} in ('cash', 'credit', 'mixed')`,
    ),

    check(
      "pos_purchases_amounts_nonnegative",
      sql`
        ${table.subtotalMinor} >= 0
        and ${table.discountMinor} >= 0
        and ${table.totalMinor} >= 0
        and ${table.paidMinor} >= 0
        and ${table.dueMinor} >= 0
      `,
    ),

    check(
      "pos_purchases_discount_not_over_subtotal",
      sql`${table.discountMinor} <= ${table.subtotalMinor}`,
    ),

    check(
      "pos_purchases_total_matches",
      sql`
        ${table.totalMinor} =
        ${table.subtotalMinor} - ${table.discountMinor}
      `,
    ),

    check(
      "pos_purchases_settlement_matches",
      sql`
        ${table.paidMinor} <= ${table.totalMinor}
        and ${table.dueMinor} =
          ${table.totalMinor} - ${table.paidMinor}
      `,
    ),

    check(
      "pos_purchases_void_state_valid",
      sql`
        (
          ${table.status} = 'completed'
          and ${table.voidedAt} is null
          and ${table.voidedByUserId} is null
          and ${table.voidReason} is null
        )
        or
        (
          ${table.status} = 'voided'
          and ${table.voidedAt} is not null
          and ${table.voidedByUserId} is not null
          and length(btrim(${table.voidReason})) > 0
        )
      `,
    ),

    uniqueIndex("pos_purchases_public_id_idx").on(table.publicId),

    uniqueIndex("pos_purchases_idempotency_key_idx").on(
      table.idempotencyKey,
    ),

    index("pos_purchases_supplier_idx").on(table.supplierId),

    uniqueIndex("pos_purchases_supplier_invoice_unique_idx")
      .on(
        table.supplierId,
        table.supplierInvoiceNumber,
      )
      .where(sql`${table.supplierInvoiceNumber} is not null`),

    index("pos_purchases_business_date_idx").on(table.businessDate),

    index("pos_purchases_entered_by_idx").on(table.enteredByUserId),

    index("pos_purchases_created_at_idx").on(table.createdAt),
  ],
).enableRLS();

export const posPurchaseItemsTable = pgTable(
  "pos_purchase_items",
  {
    id: serial("id").primaryKey(),

    purchaseId: integer("purchase_id")
      .notNull()
      .references(() => posPurchasesTable.id, {
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
    freeQuantity: integer("free_quantity").notNull().default(0),

    unitCostMinor: integer("unit_cost_minor").notNull(),
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
    check(
      "pos_purchase_items_line_positive",
      sql`${table.lineNumber} > 0`,
    ),

    check(
      "pos_purchase_items_quantities_valid",
      sql`
        ${table.quantity} > 0
        and ${table.quantity} <= 99999
        and ${table.freeQuantity} >= 0
        and ${table.freeQuantity} <= 99999
        and ${table.quantity} + ${table.freeQuantity} <= 99999
      `,
    ),

    check(
      "pos_purchase_items_prices_nonnegative",
      sql`
        ${table.unitCostMinor} >= 0
        and ${table.lineDiscountMinor} >= 0
        and ${table.lineTotalMinor} >= 0
      `,
    ),

    check(
      "pos_purchase_items_discount_not_over_gross",
      sql`
        ${table.lineDiscountMinor} <=
        ${table.unitCostMinor} * ${table.quantity}
      `,
    ),

    check(
      "pos_purchase_items_total_matches",
      sql`
        ${table.lineTotalMinor} =
        ${table.unitCostMinor} * ${table.quantity}
        - ${table.lineDiscountMinor}
      `,
    ),

    check(
      "pos_purchase_items_general_stock_valid",
      sql`
        (
          ${table.generalStockBefore} is null
          and ${table.generalStockAfter} is null
        )
        or
        (
          ${table.generalStockBefore} is not null
          and ${table.generalStockAfter} is not null
          and ${table.generalStockBefore} >= 0
          and ${table.generalStockAfter} =
            ${table.generalStockBefore}
            + ${table.quantity}
            + ${table.freeQuantity}
        )
      `,
    ),

    check(
      "pos_purchase_items_variant_stock_valid",
      sql`
        (
          ${table.variantStockBefore} is null
          and ${table.variantStockAfter} is null
        )
        or
        (
          ${table.variantStockBefore} is not null
          and ${table.variantStockAfter} is not null
          and ${table.variantStockBefore} >= 0
          and ${table.variantStockAfter} =
            ${table.variantStockBefore}
            + ${table.quantity}
            + ${table.freeQuantity}
        )
      `,
    ),

    uniqueIndex("pos_purchase_items_purchase_line_idx").on(
      table.purchaseId,
      table.lineNumber,
    ),

    index("pos_purchase_items_purchase_idx").on(table.purchaseId),
    index("pos_purchase_items_product_idx").on(table.productId),
    index("pos_purchase_items_barcode_idx").on(table.barcode),
  ],
).enableRLS();

export type DbPosPurchase = typeof posPurchasesTable.$inferSelect;
export type InsertPosPurchase = typeof posPurchasesTable.$inferInsert;

export type DbPosPurchaseItem =
  typeof posPurchaseItemsTable.$inferSelect;

export type InsertPosPurchaseItem =
  typeof posPurchaseItemsTable.$inferInsert;
