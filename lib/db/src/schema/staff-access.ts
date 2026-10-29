import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Staff accounts do not inherit the administrator/owner flags.
export const staffAccessTable = pgTable("staff_access", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  roleName: text("role_name").notNull(),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();
