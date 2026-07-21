import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const webPushSubscriptionsTable = pgTable("web_push_subscriptions", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  phone: text("phone"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type WebPushSubscription =
  typeof webPushSubscriptionsTable.$inferSelect;
