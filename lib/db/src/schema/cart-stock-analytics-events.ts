import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, bigserial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Internal analytics table. No direct client role can read or write it.
export const cartStockAnalyticsEventsTable = pgTable(
  "cart_stock_analytics_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventId: text("event_id").notNull(),
    visitorId: text("visitor_id").notNull(),
    productId: integer("product_id").notNull(),
    eventType: text("event_type").notNull(),
    issueKind: text("issue_kind").notNull(),
    selectedColor: text("selected_color"),
    selectedSize: text("selected_size"),
    requestedQuantity: integer("requested_quantity").notNull(),
    availableQuantity: integer("available_quantity"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("cart_stock_analytics_events_event_id_key").on(table.eventId),
    index("cart_stock_analytics_created_type_idx").on(table.createdAt, table.eventType),
    index("cart_stock_analytics_product_date_idx").on(table.productId, table.createdAt),
    check("cart_stock_analytics_product_valid", sql`${table.productId} > 0`),
  ],
).enableRLS();
