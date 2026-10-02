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
import { productsTable } from "./products";

export const exchangeSaleItemsTable = pgTable(
  "exchange_sale_items",
  {
    id: serial("id").primaryKey(),

    exchangeId: integer("exchange_id")
      .notNull()
      .references(() => exchangeDocumentsTable.id, {
        onDelete: "cascade",
      }),

    lineNumber: integer("line_number").notNull(),

    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, {
        onDelete: "restrict",
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

    grossAmountMinor: integer("gross_amount_minor").notNull(),

    lineDiscountMinor: integer("line_discount_minor")
      .notNull()
      .default(0),

    invoiceDiscountMinor: integer("invoice_discount_minor")
      .notNull()
      .default(0),

    allocatedDiscountMinor: integer("allocated_discount_minor").notNull(),

    lineNetMinor: integer("line_net_minor").notNull(),

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
      "exchange_sale_items_line_positive",
      sql`${table.lineNumber} > 0`,
    ),

    check(
      "exchange_sale_items_quantity_valid",
      sql`${table.quantity} > 0 and ${table.quantity} <= 99`,
    ),

    check(
      "exchange_sale_items_amounts_nonnegative",
      sql`
        ${table.websiteUnitPriceMinor} >= 0
        and ${table.soldUnitPriceMinor} >= 0
        and ${table.grossAmountMinor} >= 0
        and ${table.lineDiscountMinor} >= 0
        and ${table.invoiceDiscountMinor} >= 0
        and ${table.allocatedDiscountMinor} >= 0
        and ${table.lineNetMinor} >= 0
      `,
    ),

    check(
      "exchange_sale_items_gross_matches",
      sql`
        ${table.grossAmountMinor} =
        ${table.soldUnitPriceMinor} * ${table.quantity}
      `,
    ),

    check(
      "exchange_sale_items_discount_matches",
      sql`
        ${table.allocatedDiscountMinor} =
        ${table.lineDiscountMinor} + ${table.invoiceDiscountMinor}
      `,
    ),

    check(
      "exchange_sale_items_discount_not_over_gross",
      sql`${table.allocatedDiscountMinor} <= ${table.grossAmountMinor}`,
    ),

    check(
      "exchange_sale_items_net_matches",
      sql`
        ${table.lineNetMinor} =
        ${table.grossAmountMinor} - ${table.allocatedDiscountMinor}
      `,
    ),

    check(
      "exchange_sale_items_general_stock_valid",
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
      "exchange_sale_items_variant_stock_valid",
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

    uniqueIndex("exchange_sale_items_exchange_line_idx").on(
      table.exchangeId,
      table.lineNumber,
    ),

    index("exchange_sale_items_exchange_idx").on(table.exchangeId),

    index("exchange_sale_items_product_idx").on(table.productId),

    index("exchange_sale_items_barcode_idx").on(table.barcode),
  ],
).enableRLS();

export type ExchangeSaleItem =
  typeof exchangeSaleItemsTable.$inferSelect;
