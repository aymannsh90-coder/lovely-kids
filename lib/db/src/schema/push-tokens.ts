import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const pushTokensTable = pgTable("push_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  phone: text("phone"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PushToken = typeof pushTokensTable.$inferSelect;
