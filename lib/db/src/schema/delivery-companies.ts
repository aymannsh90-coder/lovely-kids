import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { usersTable } from "./users";

export const deliveryCompaniesTable = pgTable(
  "delivery_companies",
  {
    id: serial("id").primaryKey(),

    code: text("code").notNull(),
    name: text("name").notNull(),

    phone: text("phone"),
    notes: text("notes"),

    status: text("status").notNull().default("active"),

    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
      }),

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
      "delivery_companies_code_valid",
      sql`length(btrim(${table.code})) between 1 and 40`,
    ),

    check(
      "delivery_companies_name_not_empty",
      sql`length(btrim(${table.name})) > 0`,
    ),

    check(
      "delivery_companies_status_valid",
      sql`${table.status} in ('active', 'inactive')`,
    ),

    uniqueIndex("delivery_companies_code_idx").on(table.code),

    index("delivery_companies_name_idx").on(table.name),

    index("delivery_companies_status_idx").on(table.status),
  ],
).enableRLS();

export type DbDeliveryCompany =
  typeof deliveryCompaniesTable.$inferSelect;

export type InsertDeliveryCompany =
  typeof deliveryCompaniesTable.$inferInsert;
