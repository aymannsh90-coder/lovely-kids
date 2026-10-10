import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { usersTable } from "./users";

export const employeesTable = pgTable(
  "employees",
  {
    id: serial("id").primaryKey(),

    code: text("code").notNull(),
    name: text("name").notNull(),

    phone: text("phone"),

    userId: integer("user_id").references(
      () => usersTable.id,
      {
        onDelete: "set null",
      },
    ),

    baseSalaryMinor: integer("base_salary_minor")
      .notNull()
      .default(0),

    hireDate: date("hire_date"),

    status: text("status")
      .notNull()
      .default("active"),

    notes: text("notes"),

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
      "employees_code_valid",
      sql`${table.code} ~ '^[A-Za-z0-9_-]{1,40}$'`,
    ),

    check(
      "employees_name_not_empty",
      sql`length(btrim(${table.name})) > 0`,
    ),

    check(
      "employees_salary_valid",
      sql`${table.baseSalaryMinor} >= 0`,
    ),

    check(
      "employees_status_valid",
      sql`${table.status} in ('active', 'inactive')`,
    ),

    uniqueIndex("employees_code_idx").on(table.code),

    uniqueIndex("employees_user_idx")
      .on(table.userId)
      .where(sql`${table.userId} is not null`),

    index("employees_name_idx").on(table.name),
    index("employees_status_idx").on(table.status),
  ],
).enableRLS();

export type DbEmployee =
  typeof employeesTable.$inferSelect;

export type InsertEmployee =
  typeof employeesTable.$inferInsert;
