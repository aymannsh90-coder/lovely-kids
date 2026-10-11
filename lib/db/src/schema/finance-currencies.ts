import { sql } from "drizzle-orm";
import {
  boolean,
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

export const financeCurrenciesTable = pgTable(
  "finance_currencies",
  {
    code: text("code").primaryKey(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    symbol: text("symbol").notNull(),
    minorUnit: integer("minor_unit")
      .notNull()
      .default(2),
    isBase: boolean("is_base")
      .notNull()
      .default(false),
    status: text("status")
      .notNull()
      .default("active"),
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
      "finance_currencies_code_valid",
      sql`${table.code} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "finance_currencies_name_ar_valid",
      sql`length(btrim(${table.nameAr})) > 0`,
    ),
    check(
      "finance_currencies_name_en_valid",
      sql`length(btrim(${table.nameEn})) > 0`,
    ),
    check(
      "finance_currencies_symbol_valid",
      sql`length(btrim(${table.symbol})) between 1 and 8`,
    ),
    check(
      "finance_currencies_minor_unit_valid",
      sql`${table.minorUnit} between 0 and 4`,
    ),
    check(
      "finance_currencies_status_valid",
      sql`${table.status} in ('active', 'inactive')`,
    ),
    uniqueIndex(
      "finance_currencies_single_base_idx",
    )
      .on(table.isBase)
      .where(
        sql`${table.isBase} = true`,
      ),
  ],
).enableRLS();

export const financeExchangeRatesTable =
  pgTable(
    "finance_exchange_rates",
    {
      id: serial("id").primaryKey(),
      currencyCode: text(
        "currency_code",
      )
        .notNull()
        .references(
          () =>
            financeCurrenciesTable.code,
          {
            onDelete: "restrict",
          },
        ),
      rateDate: date(
        "rate_date",
      ).notNull(),
      ilsPerUnitMicros: integer(
        "ils_per_unit_micros",
      ).notNull(),
      source: text("source"),
      notes: text("notes"),
      createdByUserId: integer(
        "created_by_user_id",
      ).references(
        () => usersTable.id,
        {
          onDelete: "restrict",
        },
      ),
      createdAt: timestamp(
        "created_at",
        {
          withTimezone: true,
        },
      )
        .defaultNow()
        .notNull(),
    },
    (table) => [
      check(
        "finance_exchange_rates_rate_valid",
        sql`${table.ilsPerUnitMicros} > 0`,
      ),
      check(
        "finance_exchange_rates_source_valid",
        sql`
          ${table.source} is null
          or length(btrim(${table.source})) > 0
        `,
      ),
      uniqueIndex(
        "finance_exchange_rates_currency_date_idx",
      ).on(
        table.currencyCode,
        table.rateDate,
      ),
      index(
        "finance_exchange_rates_date_idx",
      ).on(table.rateDate),
    ],
  ).enableRLS();

export type DbFinanceCurrency =
  typeof financeCurrenciesTable.$inferSelect;

export type DbFinanceExchangeRate =
  typeof financeExchangeRatesTable.$inferSelect;
