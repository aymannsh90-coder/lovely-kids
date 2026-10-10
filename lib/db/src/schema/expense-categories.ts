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

import { financeAccountsTable } from "./finance";
import { usersTable } from "./users";

export const expenseCategoriesTable = pgTable(
  "expense_categories",
  {
    id: serial("id").primaryKey(),

    code: text("code").notNull(),
    name: text("name").notNull(),

    financeAccountId: integer("finance_account_id")
      .notNull()
      .references(() => financeAccountsTable.id, {
        onDelete: "restrict",
      }),

    status: text("status")
      .notNull()
      .default("active"),

    createdByUserId: integer("created_by_user_id")
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
      "expense_categories_code_valid",
      sql`${table.code} ~ '^[A-Za-z0-9_-]{1,50}$'`,
    ),

    check(
      "expense_categories_name_valid",
      sql`length(btrim(${table.name})) > 0`,
    ),

    check(
      "expense_categories_status_valid",
      sql`${table.status} in ('active', 'inactive')`,
    ),

    uniqueIndex("expense_categories_code_idx")
      .on(table.code),

    uniqueIndex("expense_categories_finance_account_idx")
      .on(table.financeAccountId),

    index("expense_categories_status_idx")
      .on(table.status),
  ],
).enableRLS();

export type DbExpenseCategory =
  typeof expenseCategoriesTable.$inferSelect;
