import { pgTable, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const appSettingsTable = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  data: jsonb("data").notNull().default({}),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DbAppSettings = typeof appSettingsTable.$inferSelect;
