import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DbPasswordResetToken = typeof passwordResetTokensTable.$inferSelect;
