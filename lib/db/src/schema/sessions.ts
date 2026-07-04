import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const sessionsTable = pgTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DbSession = typeof sessionsTable.$inferSelect;
