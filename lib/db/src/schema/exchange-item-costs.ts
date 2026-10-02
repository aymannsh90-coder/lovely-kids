import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { exchangeReturnItemsTable } from "./exchange-return-items";
import { exchangeSaleItemsTable } from "./exchange-sale-items";
import { productsTable } from "./products";

export const exchangeReturnItemCostsTable = pgTable(
  "exchange_return_item_costs",
  {
    returnItemId: integer("return_item_id")
      .primaryKey()
      .references(() => exchangeReturnItemsTable.id, {
        onDelete: "cascade",
      }),

    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, {
        onDelete: "restrict",
      }),

    quantity: integer("quantity").notNull(),

    unitCostMinor: integer("unit_cost_minor").notNull(),
    costTotalMinor: integer("cost_total_minor").notNull(),

    costQuality: text("cost_quality").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "exchange_return_item_costs_quantity_valid",
      sql`${table.quantity} > 0`,
    ),

    check(
      "exchange_return_item_costs_values_valid",
      sql`
        ${table.unitCostMinor} >= 0
        and ${table.costTotalMinor} >= 0
      `,
    ),

    check(
      "exchange_return_item_costs_quality_valid",
      sql`${table.costQuality} in ('confirmed', 'estimated', 'mixed')`,
    ),

    index("exchange_return_item_costs_product_idx").on(table.productId),
  ],
).enableRLS();

export const exchangeSaleItemCostsTable = pgTable(
  "exchange_sale_item_costs",
  {
    saleItemId: integer("sale_item_id")
      .primaryKey()
      .references(() => exchangeSaleItemsTable.id, {
        onDelete: "cascade",
      }),

    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, {
        onDelete: "restrict",
      }),

    quantity: integer("quantity").notNull(),

    unitCostMinor: integer("unit_cost_minor").notNull(),
    costTotalMinor: integer("cost_total_minor").notNull(),

    costQuality: text("cost_quality").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "exchange_sale_item_costs_quantity_valid",
      sql`${table.quantity} > 0`,
    ),

    check(
      "exchange_sale_item_costs_values_valid",
      sql`
        ${table.unitCostMinor} >= 0
        and ${table.costTotalMinor} >= 0
      `,
    ),

    check(
      "exchange_sale_item_costs_quality_valid",
      sql`${table.costQuality} in ('confirmed', 'estimated', 'mixed')`,
    ),

    index("exchange_sale_item_costs_product_idx").on(table.productId),
  ],
).enableRLS();

export type ExchangeReturnItemCost =
  typeof exchangeReturnItemCostsTable.$inferSelect;

export type ExchangeSaleItemCost =
  typeof exchangeSaleItemCostsTable.$inferSelect;
