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

import { customersTable } from "./customers";
import { employeesTable } from "./employees";
import {
  financeAccountsTable,
  financeTransactionsTable,
} from "./finance";
import { financeCurrenciesTable } from "./finance-currencies";
import { suppliersTable } from "./suppliers";
import { usersTable } from "./users";

export const banksTable = pgTable(
  "banks",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    status: text("status")
      .notNull()
      .default("active"),
    notes: text("notes"),
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
      "banks_code_valid",
      sql`${table.code} ~ '^[A-Z0-9_-]{2,40}$'`,
    ),
    check(
      "banks_name_ar_valid",
      sql`length(btrim(${table.nameAr})) > 0`,
    ),
    check(
      "banks_status_valid",
      sql`${table.status} in ('active', 'inactive')`,
    ),
    uniqueIndex("banks_code_idx").on(
      table.code,
    ),
    index("banks_name_ar_idx").on(
      table.nameAr,
    ),
  ],
).enableRLS();

export const bankAccountsTable = pgTable(
  "bank_accounts",
  {
    id: serial("id").primaryKey(),
    bankId: integer("bank_id")
      .notNull()
      .references(() => banksTable.id, {
        onDelete: "restrict",
      }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    accountNumber: text(
      "account_number",
    ),
    iban: text("iban"),
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
    financeAccountId: integer(
      "finance_account_id",
    )
      .notNull()
      .references(
        () => financeAccountsTable.id,
        {
          onDelete: "restrict",
        },
      ),
    status: text("status")
      .notNull()
      .default("active"),
    notes: text("notes"),
    createdByUserId: integer(
      "created_by_user_id",
    ).references(
      () => usersTable.id,
      {
        onDelete: "restrict",
      },
    ),
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
      "bank_accounts_code_valid",
      sql`${table.code} ~ '^[A-Za-z0-9_-]{2,60}$'`,
    ),
    check(
      "bank_accounts_name_valid",
      sql`length(btrim(${table.name})) > 0`,
    ),
    check(
      "bank_accounts_account_number_valid",
      sql`
        ${table.accountNumber} is null
        or length(btrim(${table.accountNumber})) > 0
      `,
    ),
    check(
      "bank_accounts_iban_valid",
      sql`
        ${table.iban} is null
        or length(btrim(${table.iban})) > 0
      `,
    ),
    check(
      "bank_accounts_status_valid",
      sql`${table.status} in ('active', 'inactive')`,
    ),
    uniqueIndex(
      "bank_accounts_code_idx",
    ).on(table.code),
    uniqueIndex(
      "bank_accounts_finance_account_idx",
    ).on(table.financeAccountId),
    index("bank_accounts_bank_idx").on(
      table.bankId,
    ),
    index(
      "bank_accounts_currency_idx",
    ).on(table.currencyCode),
    index(
      "bank_accounts_status_idx",
    ).on(table.status),
  ],
).enableRLS();

export const financeChecksTable = pgTable(
  "finance_checks",
  {
    id: serial("id").primaryKey(),
    publicId: text("public_id").notNull(),
    idempotencyKey: text(
      "idempotency_key",
    ).notNull(),
    direction: text(
      "direction",
    ).notNull(),
    checkNumber: text(
      "check_number",
    ).notNull(),
    bankId: integer("bank_id")
      .notNull()
      .references(() => banksTable.id, {
        onDelete: "restrict",
      }),
    bankAccountId: integer(
      "bank_account_id",
    ).references(
      () => bankAccountsTable.id,
      {
        onDelete: "restrict",
      },
    ),
    depositedToBankAccountId:
      integer(
        "deposited_to_bank_account_id",
      ).references(
        () => bankAccountsTable.id,
        {
          onDelete: "restrict",
        },
      ),
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
    amountMinor: integer(
      "amount_minor",
    ).notNull(),
    exchangeRateMicros: integer(
      "exchange_rate_micros",
    ).notNull(),
    baseAmountMinor: integer(
      "base_amount_minor",
    ).notNull(),
    dueDate: date("due_date").notNull(),

    customerId: integer(
      "customer_id",
    ).references(
      () => customersTable.id,
      {
        onDelete: "restrict",
      },
    ),
    supplierId: integer(
      "supplier_id",
    ).references(
      () => suppliersTable.id,
      {
        onDelete: "restrict",
      },
    ),
    employeeId: integer(
      "employee_id",
    ).references(
      () => employeesTable.id,
      {
        onDelete: "restrict",
      },
    ),

    drawerName: text("drawer_name"),
    payeeName: text("payee_name"),

    status: text("status").notNull(),
    initialFinanceTransactionId:
      integer(
        "initial_finance_transaction_id",
      ).references(
        () =>
          financeTransactionsTable.id,
        {
          onDelete: "restrict",
        },
      ),
    settlementFinanceTransactionId:
      integer(
        "settlement_finance_transaction_id",
      ).references(
        () =>
          financeTransactionsTable.id,
        {
          onDelete: "restrict",
        },
      ),

    notes: text("notes"),
    createdByUserId: integer(
      "created_by_user_id",
    )
      .notNull()
      .references(
        () => usersTable.id,
        {
          onDelete: "restrict",
        },
      ),

    depositedAt: timestamp(
      "deposited_at",
      {
        withTimezone: true,
      },
    ),
    clearedAt: timestamp(
      "cleared_at",
      {
        withTimezone: true,
      },
    ),
    returnedAt: timestamp(
      "returned_at",
      {
        withTimezone: true,
      },
    ),
    cancelledAt: timestamp(
      "cancelled_at",
      {
        withTimezone: true,
      },
    ),
    cancelledByUserId: integer(
      "cancelled_by_user_id",
    ).references(
      () => usersTable.id,
      {
        onDelete: "restrict",
      },
    ),
    cancelReason: text(
      "cancel_reason",
    ),

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
      "finance_checks_public_id_valid",
      sql`length(btrim(${table.publicId})) between 6 and 100`,
    ),
    check(
      "finance_checks_idempotency_valid",
      sql`length(btrim(${table.idempotencyKey})) between 8 and 160`,
    ),
    check(
      "finance_checks_direction_valid",
      sql`${table.direction} in ('received', 'issued')`,
    ),
    check(
      "finance_checks_number_valid",
      sql`length(btrim(${table.checkNumber})) between 1 and 100`,
    ),
    check(
      "finance_checks_amount_valid",
      sql`
        ${table.amountMinor} > 0
        and ${table.exchangeRateMicros} > 0
        and ${table.baseAmountMinor} > 0
      `,
    ),
    check(
      "finance_checks_single_party",
      sql`
        num_nonnulls(
          ${table.customerId},
          ${table.supplierId},
          ${table.employeeId}
        ) <= 1
      `,
    ),
    check(
      "finance_checks_status_valid",
      sql`
        ${table.status} in (
          'on_hand',
          'deposited',
          'issued',
          'cleared',
          'returned',
          'cancelled'
        )
      `,
    ),
    check(
      "finance_checks_direction_status_valid",
      sql`
        (
          ${table.direction} = 'received'
          and ${table.status} in (
            'on_hand',
            'deposited',
            'cleared',
            'returned',
            'cancelled'
          )
        )
        or
        (
          ${table.direction} = 'issued'
          and ${table.status} in (
            'issued',
            'cleared',
            'returned',
            'cancelled'
          )
        )
      `,
    ),
    check(
      "finance_checks_cancel_state_valid",
      sql`
        (
          ${table.status} <> 'cancelled'
          and ${table.cancelledAt} is null
          and ${table.cancelledByUserId} is null
          and ${table.cancelReason} is null
        )
        or
        (
          ${table.status} = 'cancelled'
          and ${table.cancelledAt} is not null
          and ${table.cancelledByUserId} is not null
          and length(btrim(${table.cancelReason})) > 0
        )
      `,
    ),
    uniqueIndex(
      "finance_checks_public_id_idx",
    ).on(table.publicId),
    uniqueIndex(
      "finance_checks_idempotency_idx",
    ).on(table.idempotencyKey),
    index(
      "finance_checks_number_idx",
    ).on(table.checkNumber),
    index(
      "finance_checks_due_date_idx",
    ).on(table.dueDate),
    index(
      "finance_checks_status_idx",
    ).on(table.status),
    index(
      "finance_checks_bank_idx",
    ).on(table.bankId),
    index(
      "finance_checks_customer_idx",
    )
      .on(table.customerId)
      .where(
        sql`${table.customerId} is not null`,
      ),
    index(
      "finance_checks_supplier_idx",
    )
      .on(table.supplierId)
      .where(
        sql`${table.supplierId} is not null`,
      ),
    index(
      "finance_checks_employee_idx",
    )
      .on(table.employeeId)
      .where(
        sql`${table.employeeId} is not null`,
      ),
  ],
).enableRLS();

export type DbBank =
  typeof banksTable.$inferSelect;

export type DbBankAccount =
  typeof bankAccountsTable.$inferSelect;

export type DbFinanceCheck =
  typeof financeChecksTable.$inferSelect;
