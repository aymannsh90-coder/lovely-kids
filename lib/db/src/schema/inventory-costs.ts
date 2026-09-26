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

import { ordersTable } from "./orders";
import { posSaleReturnItemsTable } from "./pos-sale-returns";
import { posSaleItemsTable } from "./pos-sales";
import { productsTable } from "./products";
import { usersTable } from "./users";

export const productCostStateTable = pgTable(
  "product_cost_state",
  {
    productId: integer("product_id")
      .primaryKey()
      .references(() => productsTable.id, {
        onDelete: "restrict",
      }),

    quantityOnHand: integer("quantity_on_hand").notNull().default(0),

    inventoryValueMinor: integer("inventory_value_minor")
      .notNull()
      .default(0),

    costQuality: text("cost_quality").notNull().default("estimated"),

    initializedAt: timestamp("initialized_at", {
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
      "product_cost_state_quantity_valid",
      sql`${table.quantityOnHand} >= 0`,
    ),

    check(
      "product_cost_state_value_valid",
      sql`${table.inventoryValueMinor} >= 0`,
    ),

    check(
      "product_cost_state_empty_value_valid",
      sql`
        ${table.quantityOnHand} > 0
        or ${table.inventoryValueMinor} = 0
      `,
    ),

    check(
      "product_cost_state_quality_valid",
      sql`${table.costQuality} in ('confirmed', 'estimated', 'mixed')`,
    ),

    index("product_cost_state_quality_idx").on(table.costQuality),
  ],
).enableRLS();

export const productCostLedgerTable = pgTable(
  "product_cost_ledger",
  {
    id: serial("id").primaryKey(),

    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, {
        onDelete: "restrict",
      }),

    eventType: text("event_type").notNull(),

    sourceType: text("source_type"),
    sourceRef: text("source_ref"),
    sourceItemRef: text("source_item_ref"),

    quantityDelta: integer("quantity_delta").notNull(),

    inventoryValueDeltaMinor: integer(
      "inventory_value_delta_minor",
    ).notNull(),

    quantityAfter: integer("quantity_after").notNull(),

    inventoryValueAfterMinor: integer(
      "inventory_value_after_minor",
    ).notNull(),

    costQuality: text("cost_quality").notNull(),

    businessDate: date("business_date"),

    note: text("note"),

    createdByUserId: integer("created_by_user_id").references(
      () => usersTable.id,
      {
        onDelete: "set null",
      },
    ),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "product_cost_ledger_event_valid",
      sql`
        ${table.eventType} in (
          'opening',
          'purchase',
          'purchase_void',
          'pos_sale',
          'pos_sale_void',
          'pos_sale_edit_reverse',
          'pos_return',
          'pos_mobile_return',
          'pos_return_void',
          'online_order',
          'online_order_cancel',
          'online_order_edit_reverse',
          'adjustment_in',
          'adjustment_out',
          'correction'
        )
      `,
    ),

    check(
      "product_cost_ledger_quantity_after_valid",
      sql`${table.quantityAfter} >= 0`,
    ),

    check(
      "product_cost_ledger_value_after_valid",
      sql`${table.inventoryValueAfterMinor} >= 0`,
    ),

    check(
      "product_cost_ledger_empty_value_valid",
      sql`
        ${table.quantityAfter} > 0
        or ${table.inventoryValueAfterMinor} = 0
      `,
    ),

    check(
      "product_cost_ledger_quality_valid",
      sql`${table.costQuality} in ('confirmed', 'estimated', 'mixed')`,
    ),

    index("product_cost_ledger_product_idx").on(table.productId),

    index("product_cost_ledger_created_at_idx").on(table.createdAt),

    index("product_cost_ledger_business_date_idx").on(table.businessDate),

    index("product_cost_ledger_source_idx").on(
      table.sourceType,
      table.sourceRef,
      table.sourceItemRef,
    ),

    uniqueIndex("product_cost_ledger_source_event_unique_idx")
      .on(
        table.sourceType,
        table.sourceRef,
        table.sourceItemRef,
        table.eventType,
      )
      .where(
        sql`
          ${table.sourceRef} is not null
          and ${table.sourceItemRef} is not null
        `,
      ),
  ],
).enableRLS();

export const productHistoricalCostsTable = pgTable(
  "product_historical_costs",
  {
    id: serial("id").primaryKey(),

    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, {
        onDelete: "restrict",
      }),

    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),

    effectiveTo: timestamp("effective_to", {
      withTimezone: true,
    }),

    unitCostMinor: integer("unit_cost_minor").notNull(),

    costQuality: text("cost_quality").notNull(),

    note: text("note"),

    createdByUserId: integer("created_by_user_id").references(
      () => usersTable.id,
      {
        onDelete: "set null",
      },
    ),

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
      "product_historical_costs_cost_valid",
      sql`${table.unitCostMinor} >= 0`,
    ),

    check(
      "product_historical_costs_quality_valid",
      sql`${table.costQuality} in ('confirmed', 'estimated')`,
    ),

    check(
      "product_historical_costs_period_valid",
      sql`
        ${table.effectiveTo} is null
        or ${table.effectiveTo} > ${table.effectiveFrom}
      `,
    ),

    index("product_historical_costs_product_period_idx").on(
      table.productId,
      table.effectiveFrom,
    ),
  ],
).enableRLS();

export const posSaleItemCostsTable = pgTable(
  "pos_sale_item_costs",
  {
    saleItemId: integer("sale_item_id")
      .primaryKey()
      .references(() => posSaleItemsTable.id, {
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

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "pos_sale_item_costs_quantity_valid",
      sql`${table.quantity} > 0`,
    ),

    check(
      "pos_sale_item_costs_values_valid",
      sql`
        ${table.unitCostMinor} >= 0
        and ${table.costTotalMinor} >= 0
      `,
    ),

    check(
      "pos_sale_item_costs_quality_valid",
      sql`${table.costQuality} in ('confirmed', 'estimated', 'mixed')`,
    ),

    index("pos_sale_item_costs_product_idx").on(table.productId),
  ],
).enableRLS();

export const posSaleReturnItemCostsTable = pgTable(
  "pos_sale_return_item_costs",
  {
    returnItemId: integer("return_item_id")
      .primaryKey()
      .references(() => posSaleReturnItemsTable.id, {
        onDelete: "cascade",
      }),

    originalSaleItemId: integer("original_sale_item_id")
      .references(() => posSaleItemsTable.id, {
        onDelete: "restrict",
      }),

    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, {
        onDelete: "restrict",
      }),

    quantity: integer("quantity").notNull(),

    costTotalMinor: integer("cost_total_minor").notNull(),

    costQuality: text("cost_quality").notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "pos_sale_return_item_costs_quantity_valid",
      sql`${table.quantity} > 0`,
    ),

    check(
      "pos_sale_return_item_costs_value_valid",
      sql`${table.costTotalMinor} >= 0`,
    ),

    check(
      "pos_sale_return_item_costs_quality_valid",
      sql`${table.costQuality} in ('confirmed', 'estimated', 'mixed')`,
    ),

    index("pos_sale_return_item_costs_original_sale_item_idx").on(
      table.originalSaleItemId,
    ),

    index("pos_sale_return_item_costs_product_idx").on(table.productId),
  ],
).enableRLS();

export const orderItemCostsTable = pgTable(
  "order_item_costs",
  {
    id: serial("id").primaryKey(),

    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, {
        onDelete: "cascade",
      }),

    lineNumber: integer("line_number").notNull(),

    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, {
        onDelete: "restrict",
      }),

    color: text("color"),
    size: text("size"),

    quantity: integer("quantity").notNull(),

    unitCostMinor: integer("unit_cost_minor").notNull(),

    costTotalMinor: integer("cost_total_minor").notNull(),

    costQuality: text("cost_quality").notNull(),

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
      "order_item_costs_line_valid",
      sql`${table.lineNumber} > 0`,
    ),

    check(
      "order_item_costs_quantity_valid",
      sql`${table.quantity} > 0`,
    ),

    check(
      "order_item_costs_values_valid",
      sql`
        ${table.unitCostMinor} >= 0
        and ${table.costTotalMinor} >= 0
      `,
    ),

    check(
      "order_item_costs_quality_valid",
      sql`${table.costQuality} in ('confirmed', 'estimated', 'mixed')`,
    ),

    uniqueIndex("order_item_costs_order_line_idx").on(
      table.orderId,
      table.lineNumber,
    ),

    index("order_item_costs_product_idx").on(table.productId),
  ],
).enableRLS();

export type ProductCostState =
  typeof productCostStateTable.$inferSelect;

export type ProductCostLedgerEntry =
  typeof productCostLedgerTable.$inferSelect;

export type ProductHistoricalCost =
  typeof productHistoricalCostsTable.$inferSelect;

export type PosSaleItemCost =
  typeof posSaleItemCostsTable.$inferSelect;

export type PosSaleReturnItemCost =
  typeof posSaleReturnItemCostsTable.$inferSelect;

export type OrderItemCost =
  typeof orderItemCostsTable.$inferSelect;
