import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

// Private server-only counters; no anon/authenticated access or RLS policies.
export const authLoginFailuresTable = pgTable("auth_login_failures", {
  keyHash: text("key_hash").primaryKey(),
  failedCount: integer("failed_count").notNull().default(0),
  windowStartedAt: timestamp("window_started_at").notNull().defaultNow(),
  blockedUntil: timestamp("blocked_until"),
  lastFailedAt: timestamp("last_failed_at").notNull().defaultNow(),
}).enableRLS();
