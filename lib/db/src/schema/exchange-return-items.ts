import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { exchangeDocumentsTable } from "./exchanges";
import { posSaleItemsTable } from "./pos-sales";
import { productsTable } from "./products";

export const exchangeReturnItemsTable = pgTable(
  "exchange_return_items",
  {
    id: serial("id").primaryKey(),

    exchangeId: integer("exchange_id")
      .notNull()
      .references(() => exchangeDocumentsTable.id, {
        onDelete: "cascade",
      }),

    lineNumber: integer("line_number").notNull(),

    originalPosSaleItemId: integer("original_pos_sale_item_id").references(
      () => posSaleItemsTable.id,
      { onDelete: "restrict" },
    ),

    originalOrderLineNumber: integer("original_order_line_number"),

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

    soldUnitPriceMinor: integer("sold_unit_price_minor").notNull(),
    grossAmountMinor: integer("gross_amount_minor").notNull(),

    lineDiscountMinor: integer("line_discount_minor")
      .notNull()
      .default(0),

    invoiceDiscountMinor: integer("invoice_discount_minor")
      .notNull()
      .default(0),

    allocatedDiscountMinor: integer("allocated_discount_minor").notNull(),

    returnNetMinor: integer("return_net_minor").notNull(),

    generalStockBefore: integer("general_stock_before"),
    generalStockAfter: integer("general_stock_after"),

    variantStockBefore: integer("variant_stock_before"),
    variantStockAfter: integer("variant_stock_after"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "exchange_return_items_line_positive",
      sql`${table.lineNumber} > 0`,
    ),

    check(
      "exchange_return_items_quantity_valid",
      sql`${table.quantity} > 0 and ${table.quantity} <= 99`,
    ),

    check(
      "exchange_return_items_source_valid",
      sql`
        (
          ${table.originalPosSaleItemId} is not null
          and ${table.originalOrderLineNumber} is null
        )
        or
        (
          ${table.originalPosSaleItemId} is null
          and ${table.originalOrderLineNumber} is not null
          and ${table.originalOrderLineNumber} > 0
        )
      `,
    ),

    check(
      "exchange_return_items_amounts_nonnegative",
      sql`
        ${table.soldUnitPriceMinor} >= 0
        and ${table.grossAmountMinor} >= 0
        and ${table.lineDiscountMinor} >= 0
        and ${table.invoiceDiscountMinor} >= 0
        and ${table.allocatedDiscountMinor} >= 0
        and ${table.returnNetMinor} >= 0
      `,
    ),

    check(
      "exchange_return_items_gross_matches",
      sql`
        ${table.grossAmountMinor} =
        ${table.soldUnitPriceMinor} * ${table.quantity}
      `,
    ),

    check(
      "exchange_return_items_discount_matches",
      sql`
        ${table.allocatedDiscountMinor} =
        ${table.lineDiscountMinor} + ${table.invoiceDiscountMinor}
      `,
    ),

    check(
      "exchange_return_items_discount_not_over_gross",
      sql`${table.allocatedDiscountMinor} <= ${table.grossAmountMinor}`,
    ),

    check(
      "exchange_return_items_net_matches",
      sql`
        ${table.returnNetMinor} =
        ${table.grossAmountMinor} - ${table.allocatedDiscountMinor}
      `,
    ),

    check(
      "exchange_return_items_general_stock_valid",
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
      "exchange_return_items_variant_stock_valid",
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

    uniqueIndex("exchange_return_items_exchange_line_idx").on(
      table.exchangeId,
      table.lineNumber,
    ),

    uniqueIndex("exchange_return_items_pos_source_idx")
      .on(table.exchangeId, table.originalPosSaleItemId)
      .where(sql`${table.originalPosSaleItemId} is not null`),

    uniqueIndex("exchange_return_items_online_source_idx")
      .on(table.exchangeId, table.originalOrderLineNumber)
      .where(sql`${table.originalOrderLineNumber} is not null`),

    index("exchange_return_items_exchange_idx").on(table.exchangeId),

    index("exchange_return_items_product_idx").on(table.productId),

    index("exchange_return_items_barcode_idx").on(table.barcode),
  ],
).enableRLS();

export type ExchangeReturnItem =
  typeof exchangeReturnItemsTable.$inferSelect;
