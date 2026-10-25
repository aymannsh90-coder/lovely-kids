import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { productsTable } from "./products";

export const stockNotificationSubscriptionsTable = pgTable(
  "stock_notification_subscriptions",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, {
        onDelete: "cascade",
      }),
    color: text("color"),
    size: text("size"),
    channel: text("channel").notNull(),
    target: text("target").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index(
      "stock_notification_subscriptions_product_idx",
    ).on(
      table.productId,
      table.color,
      table.size,
    ),
    index(
      "stock_notification_subscriptions_target_idx",
    ).on(
      table.channel,
      table.target,
    ),
  ],
).enableRLS();

export type StockNotificationSubscription =
  typeof stockNotificationSubscriptionsTable.$inferSelect;
