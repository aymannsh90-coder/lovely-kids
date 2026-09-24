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

import { productsTable } from "./products";

export const inventoryMovementsTable = pgTable(
  "inventory_movements",
  {
    id: serial("id").primaryKey(),

    productId: integer("product_id")
      .references(() => productsTable.id, {
        onDelete: "set null",
      }),

    barcode: text("barcode"),
    productCode: text("product_code"),
    productNameAr: text("product_name_ar").notNull(),

    color: text("color"),
    size: text("size"),

    movementType: text("movement_type").notNull(),

    quantityDelta: integer("quantity_delta").notNull(),

    generalStockBefore: integer("general_stock_before"),
    generalStockAfter: integer("general_stock_after"),

    variantStockBefore: integer("variant_stock_before"),
    variantStockAfter: integer("variant_stock_after"),

    sourceType: text("source_type").notNull(),
    sourceId: integer("source_id"),
    sourceItemId: integer("source_item_id"),
    sourcePublicId: text("source_public_id"),

    eventKey: text("event_key").notNull(),

    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
    }).notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "inventory_movements_type_valid",
      sql`${table.movementType} in (
        'purchase',
        'purchase_void',
        'pos_sale',
        'pos_sale_void',
        'pos_sale_edit',
        'pos_sale_return',
        'pos_sale_return_void',
        'online_order',
        'online_order_cancel',
        'online_order_restore',
        'online_order_edit',
        'adjustment'
      )`,
    ),

    check(
      "inventory_movements_source_type_valid",
      sql`${table.sourceType} in (
        'pos_purchase',
        'pos_sale',
        'pos_sale_return',
        'online_order',
        'manual'
      )`,
    ),

    check(
      "inventory_movements_delta_nonzero",
      sql`${table.quantityDelta} <> 0`,
    ),

    check(
      "inventory_movements_event_key_valid",
      sql`length(btrim(${table.eventKey})) between 3 and 180`,
    ),

    check(
      "inventory_movements_general_stock_valid",
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
          and ${table.generalStockAfter} >= 0
          and ${table.generalStockAfter} =
            ${table.generalStockBefore} + ${table.quantityDelta}
        )
      `,
    ),

    check(
      "inventory_movements_variant_stock_valid",
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
          and ${table.variantStockAfter} >= 0
          and ${table.variantStockAfter} =
            ${table.variantStockBefore} + ${table.quantityDelta}
        )
      `,
    ),

    uniqueIndex("inventory_movements_event_key_idx").on(table.eventKey),

    index("inventory_movements_product_idx").on(table.productId),

    index("inventory_movements_product_occurred_idx").on(
      table.productId,
      table.occurredAt,
    ),

    index("inventory_movements_barcode_idx").on(table.barcode),

    index("inventory_movements_source_idx").on(
      table.sourceType,
      table.sourceId,
    ),

    index("inventory_movements_occurred_at_idx").on(table.occurredAt),
  ],
).enableRLS();

export type InventoryMovement =
  typeof inventoryMovementsTable.$inferSelect;

export type InsertInventoryMovement =
  typeof inventoryMovementsTable.$inferInsert;
