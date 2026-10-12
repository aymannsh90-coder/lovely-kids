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

export const productDailyAnalyticsTable = pgTable(
  "product_daily_analytics",
  {
    id: serial("id").primaryKey(),

    visitorId: text("visitor_id").notNull(),

    // Deliberately not an FK. Analytics must remain historically readable
    // even if a product is permanently removed later.
    productId: integer("product_id").notNull(),

    eventDate: date("event_date", {
      mode: "string",
    }).notNull(),

    eventType: text("event_type").notNull(),

    eventCount: integer("event_count")
      .notNull()
      .default(1),

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
      "product_daily_analytics_visitor_valid",
      sql`length(btrim(${table.visitorId})) between 12 and 100`,
    ),

    check(
      "product_daily_analytics_product_valid",
      sql`${table.productId} > 0`,
    ),

    check(
      "product_daily_analytics_event_type_valid",
      sql`${table.eventType} in ('view', 'add_to_cart')`,
    ),

    check(
      "product_daily_analytics_event_count_valid",
      sql`${table.eventCount} > 0`,
    ),

    uniqueIndex(
      "product_daily_analytics_visitor_product_day_event_idx",
    ).on(
      table.visitorId,
      table.productId,
      table.eventDate,
      table.eventType,
    ),

    index(
      "product_daily_analytics_date_product_idx",
    ).on(
      table.eventDate,
      table.productId,
    ),

    index(
      "product_daily_analytics_event_date_idx",
    ).on(
      table.eventType,
      table.eventDate,
    ),

    index(
      "product_daily_analytics_product_date_idx",
    ).on(
      table.productId,
      table.eventDate,
    ),
  ],
).enableRLS();

export type ProductDailyAnalytics =
  typeof productDailyAnalyticsTable.$inferSelect;
