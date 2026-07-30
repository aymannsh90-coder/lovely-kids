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

export const cashSessionsTable = pgTable(
  "cash_sessions",
  {
    id: serial("id").primaryKey(),

    registerKey: text("register_key")
      .notNull()
      .default("main"),

    businessDate: date("business_date").notNull(),

    openedByUserId: integer("opened_by_user_id")
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
      }),

    closedByUserId: integer("closed_by_user_id")
      .references(() => usersTable.id, {
        onDelete: "restrict",
      }),

    openingBalanceMinor: integer("opening_balance_minor")
      .notNull(),

    closingBalanceMinor: integer("closing_balance_minor"),
    expectedBalanceMinor: integer("expected_balance_minor"),

    currencyCode: text("currency_code")
      .notNull()
      .default("ILS"),

    status: text("status")
      .notNull()
      .default("open"),

    openingNote: text("opening_note"),
    closingNote: text("closing_note"),

    openedAt: timestamp("opened_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    closedAt: timestamp("closed_at", {
      withTimezone: true,
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
      "cash_sessions_opening_balance_nonnegative",
      sql`${table.openingBalanceMinor} >= 0`,
    ),
    check(
      "cash_sessions_closing_balance_nonnegative",
      sql`${table.closingBalanceMinor} is null or ${table.closingBalanceMinor} >= 0`,
    ),
    check(
      "cash_sessions_valid_status",
      sql`${table.status} in ('open', 'closed')`,
    ),
    check(
      "cash_sessions_currency_code_length",
      sql`char_length(${table.currencyCode}) = 3`,
    ),

    uniqueIndex("cash_sessions_one_open_per_register")
      .on(table.registerKey)
      .where(sql`${table.status} = 'open'`),

    index("cash_sessions_business_date_idx")
      .on(table.businessDate),

    index("cash_sessions_opened_by_user_idx")
      .on(table.openedByUserId),
  ],
).enableRLS();

export type CashSession =
  typeof cashSessionsTable.$inferSelect;
