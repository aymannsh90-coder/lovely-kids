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

export const customersTable = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),

    code: text("code").notNull(),
    name: text("name").notNull(),

    phone: text("phone"),
    address: text("address"),
    notes: text("notes"),

    creditLimitMinor: integer("credit_limit_minor"),

    status: text("status")
      .notNull()
      .default("active"),

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
      "customers_code_valid",
      sql`${table.code} ~ '^[A-Za-z0-9_-]{1,40}$'`,
    ),

    check(
      "customers_name_not_empty",
      sql`length(btrim(${table.name})) > 0`,
    ),

    check(
      "customers_credit_limit_valid",
      sql`${table.creditLimitMinor} is null or ${table.creditLimitMinor} >= 0`,
    ),

    check(
      "customers_status_valid",
      sql`${table.status} in ('active', 'inactive')`,
    ),

    uniqueIndex("customers_code_idx").on(table.code),
    index("customers_name_idx").on(table.name),
    index("customers_phone_idx").on(table.phone),
    index("customers_status_idx").on(table.status),
  ],
).enableRLS();

export type DbCustomer =
  typeof customersTable.$inferSelect;

export type InsertCustomer =
  typeof customersTable.$inferInsert;
