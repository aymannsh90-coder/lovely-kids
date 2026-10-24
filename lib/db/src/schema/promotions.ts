import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { exchangeDocumentsTable } from "./exchanges";
import { ordersTable } from "./orders";
import { posSaleItemsTable, posSalesTable } from "./pos-sales";
import { productsTable } from "./products";

export const promotionsTable = pgTable(
  "promotions",
  {
    id: serial("id").primaryKey(),

    name: text("name").notNull(),
    publicLabel: text("public_label").notNull(),
    description: text("description"),

    kind: text("kind").notNull(),
    scope: text("scope").notNull().default("selected_products"),
    channel: text("channel").notNull().default("both"),
    status: text("status").notNull().default("draft"),

    buyQuantity: integer("buy_quantity"),
    rewardQuantity: integer("reward_quantity"),
    rewardMode: text("reward_mode"),
    rewardPercent: integer("reward_percent"),
    rewardPriceMinor: integer("reward_price_minor"),
    rewardSelectionMode: text("reward_selection_mode")
      .notNull()
      .default("cheapest"),

    percentOff: integer("percent_off"),
    bundleQuantity: integer("bundle_quantity"),
    bundlePriceMinor: integer("bundle_price_minor"),

    spendThresholdMinor: integer("spend_threshold_minor"),

    repeatable: boolean("repeatable").notNull().default(true),
    maxApplicationsPerOrder: integer("max_applications_per_order"),

    stackWithOtherPromotions: boolean("stack_with_other_promotions")
      .notNull()
      .default(false),
    stackWithDiscountCodes: boolean("stack_with_discount_codes")
      .notNull()
      .default(false),
    stackWithShippingPromotion: boolean("stack_with_shipping_promotion")
      .notNull()
      .default(true),

    priority: integer("priority").notNull().default(100),

    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),

    archivedAt: timestamp("archived_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "promotions_kind_valid",
      sql`${table.kind} in ('buy_x_get_y', 'percent_off', 'bundle_price', 'spend_x_get_gift')`,
    ),
    check(
      "promotions_scope_valid",
      sql`${table.scope} in ('all_products', 'selected_products')`,
    ),
    check(
      "promotions_channel_valid",
      sql`${table.channel} in ('web', 'pos', 'both')`,
    ),
    check(
      "promotions_status_valid",
      sql`${table.status} in ('draft', 'active', 'archived')`,
    ),
    check(
      "promotions_dates_valid",
      sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.endsAt} >= ${table.startsAt}`,
    ),
    check(
      "promotions_priority_valid",
      sql`${table.priority} between 0 and 100000`,
    ),
    check(
      "promotions_max_applications_valid",
      sql`${table.maxApplicationsPerOrder} is null or ${table.maxApplicationsPerOrder} > 0`,
    ),
    check(
      "promotions_reward_selection_mode_valid",
      sql`${table.rewardSelectionMode} in ('cheapest', 'customer_choice')`,
    ),
    check(
      "promotions_buy_x_get_y_valid",
      sql`
        ${table.kind} <> 'buy_x_get_y'
        or (
          ${table.buyQuantity} is not null
          and ${table.buyQuantity} > 0
          and ${table.rewardQuantity} is not null
          and ${table.rewardQuantity} > 0
          and ${table.rewardMode} in ('free', 'percent_off', 'fixed_price')
          and (
            ${table.rewardMode} <> 'percent_off'
            or (${table.rewardPercent} between 1 and 100)
          )
          and (
            ${table.rewardMode} <> 'fixed_price'
            or ${table.rewardPriceMinor} >= 0
          )
        )
      `,
    ),
    check(
      "promotions_percent_off_valid",
      sql`
        ${table.kind} <> 'percent_off'
        or ${table.percentOff} between 1 and 100
      `,
    ),
    check(
      "promotions_bundle_price_valid",
      sql`
        ${table.kind} <> 'bundle_price'
        or (
          ${table.bundleQuantity} is not null
          and ${table.bundleQuantity} > 1
          and ${table.bundlePriceMinor} is not null
          and ${table.bundlePriceMinor} >= 0
        )
      `,
    ),
    check(
      "promotions_spend_x_get_gift_valid",
      sql`
        ${table.kind} <> 'spend_x_get_gift'
        or (
          ${table.spendThresholdMinor} is not null
          and ${table.spendThresholdMinor} > 0
          and ${table.rewardQuantity} = 1
          and ${table.rewardMode} = 'free'
          and ${table.rewardSelectionMode} = 'customer_choice'
        )
      `,
    ),
    index("promotions_status_window_idx").on(
      table.status,
      table.startsAt,
      table.endsAt,
    ),
    index("promotions_channel_idx").on(table.channel),
  ],
).enableRLS();

export const promotionProductsTable = pgTable(
  "promotion_products",
  {
    id: serial("id").primaryKey(),

    promotionId: integer("promotion_id")
      .notNull()
      .references(() => promotionsTable.id, {
        onDelete: "cascade",
      }),

    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, {
        onDelete: "cascade",
      }),

    role: text("role").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "promotion_products_role_valid",
      sql`${table.role} in ('qualifying', 'reward', 'excluded')`,
    ),
    uniqueIndex("promotion_products_unique").on(
      table.promotionId,
      table.productId,
      table.role,
    ),
    index("promotion_products_product_idx").on(table.productId),
    index("promotion_products_promotion_idx").on(table.promotionId),
  ],
).enableRLS();

export const orderPromotionsTable = pgTable(
  "order_promotions",
  {
    id: serial("id").primaryKey(),

    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, {
        onDelete: "cascade",
      }),

    promotionId: integer("promotion_id").references(
      () => promotionsTable.id,
      { onDelete: "set null" },
    ),

    promotionName: text("promotion_name").notNull(),
    promotionKind: text("promotion_kind").notNull(),

    discountMinor: integer("discount_minor").notNull(),
    applicationCount: integer("application_count").notNull(),

    snapshot: jsonb("snapshot").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "order_promotions_discount_valid",
      sql`${table.discountMinor} >= 0`,
    ),
    check(
      "order_promotions_application_count_valid",
      sql`${table.applicationCount} > 0`,
    ),
    index("order_promotions_order_idx").on(table.orderId),
    index("order_promotions_promotion_idx").on(table.promotionId),
  ],
).enableRLS();

export const posSalePromotionsTable = pgTable(
  "pos_sale_promotions",
  {
    id: serial("id").primaryKey(),

    saleId: integer("sale_id")
      .notNull()
      .references(() => posSalesTable.id, {
        onDelete: "cascade",
      }),

    promotionId: integer("promotion_id").references(
      () => promotionsTable.id,
      { onDelete: "set null" },
    ),

    promotionName: text("promotion_name").notNull(),
    promotionKind: text("promotion_kind").notNull(),

    discountMinor: integer("discount_minor").notNull(),
    applicationCount: integer("application_count").notNull(),

    snapshot: jsonb("snapshot").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "pos_sale_promotions_discount_valid",
      sql`${table.discountMinor} >= 0`,
    ),
    check(
      "pos_sale_promotions_application_count_valid",
      sql`${table.applicationCount} > 0`,
    ),
    index("pos_sale_promotions_sale_idx").on(table.saleId),
    index("pos_sale_promotions_promotion_idx").on(table.promotionId),
  ],
).enableRLS();

export const exchangeSalePromotionsTable = pgTable(
  "exchange_sale_promotions",
  {
    id: serial("id").primaryKey(),

    exchangeId: integer("exchange_id")
      .notNull()
      .references(() => exchangeDocumentsTable.id, {
        onDelete: "cascade",
      }),

    promotionId: integer("promotion_id").references(
      () => promotionsTable.id,
      { onDelete: "set null" },
    ),

    promotionName: text("promotion_name").notNull(),
    promotionKind: text("promotion_kind").notNull(),

    discountMinor: integer("discount_minor").notNull(),
    applicationCount: integer("application_count").notNull(),

    snapshot: jsonb("snapshot").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "exchange_sale_promotions_discount_valid",
      sql`${table.discountMinor} >= 0`,
    ),
    check(
      "exchange_sale_promotions_application_count_valid",
      sql`${table.applicationCount} > 0`,
    ),
    index("exchange_sale_promotions_exchange_idx").on(table.exchangeId),
    index("exchange_sale_promotions_promotion_idx").on(table.promotionId),
  ],
).enableRLS();

export const posSaleItemPromotionAllocationsTable = pgTable(
  "pos_sale_item_promotion_allocations",
  {
    id: serial("id").primaryKey(),

    saleId: integer("sale_id")
      .notNull()
      .references(() => posSalesTable.id, {
        onDelete: "cascade",
      }),

    saleItemId: integer("sale_item_id")
      .notNull()
      .references(() => posSaleItemsTable.id, {
        onDelete: "cascade",
      }),

    promotionId: integer("promotion_id").references(
      () => promotionsTable.id,
      { onDelete: "set null" },
    ),

    promotionName: text("promotion_name").notNull(),
    groupKey: text("group_key").notNull(),
    discountMinor: integer("discount_minor").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "pos_sale_item_promotion_allocations_discount_valid",
      sql`${table.discountMinor} >= 0`,
    ),
    index("pos_sale_item_promotion_allocations_sale_idx").on(table.saleId),
    index("pos_sale_item_promotion_allocations_item_idx").on(table.saleItemId),
    index("pos_sale_item_promotion_allocations_promotion_idx").on(
      table.promotionId,
    ),
  ],
).enableRLS();

export type Promotion = typeof promotionsTable.$inferSelect;
export type PromotionProduct = typeof promotionProductsTable.$inferSelect;
