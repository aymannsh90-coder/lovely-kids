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

import { cashSessionsTable } from "./cash-sessions";
import { usersTable } from "./users";

export const financeAccountsTable = pgTable(
  "finance_accounts",
  {
    id: serial("id").primaryKey(),

    code: text("code").notNull(),
    name: text("name").notNull(),

    accountType: text("account_type").notNull(),

    linkedEntityType: text("linked_entity_type"),
    linkedEntityId: integer("linked_entity_id"),

    currencyCode: text("currency_code")
      .notNull()
      .default("ILS"),

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
      "finance_accounts_code_valid",
      sql`length(btrim(${table.code})) between 1 and 80`,
    ),

    check(
      "finance_accounts_name_not_empty",
      sql`length(btrim(${table.name})) > 0`,
    ),

    check(
      "finance_accounts_type_valid",
      sql`${table.accountType} in ('asset', 'liability', 'income', 'expense', 'equity')`,
    ),

    check(
      "finance_accounts_currency_valid",
      sql`char_length(${table.currencyCode}) = 3`,
    ),

    check(
      "finance_accounts_status_valid",
      sql`${table.status} in ('active', 'inactive')`,
    ),

    check(
      "finance_accounts_linked_entity_pair",
      sql`
        (
          ${table.linkedEntityType} is null
          and ${table.linkedEntityId} is null
        )
        or
        (
          ${table.linkedEntityType} is not null
          and ${table.linkedEntityId} is not null
        )
      `,
    ),

    uniqueIndex("finance_accounts_code_idx")
      .on(table.code),

    uniqueIndex("finance_accounts_linked_entity_idx")
      .on(
        table.linkedEntityType,
        table.linkedEntityId,
      )
      .where(
        sql`
          ${table.linkedEntityType} is not null
          and ${table.linkedEntityId} is not null
        `,
      ),

    index("finance_accounts_type_idx")
      .on(table.accountType),
  ],
).enableRLS();

export const financeTransactionsTable = pgTable(
  "finance_transactions",
  {
    id: serial("id").primaryKey(),

    publicId: text("public_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),

    businessDate: date("business_date").notNull(),

    transactionType: text("transaction_type").notNull(),

    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    sourceEvent: text("source_event").notNull(),

    cashSessionId: integer("cash_session_id")
      .references(() => cashSessionsTable.id, {
        onDelete: "restrict",
      }),

    status: text("status")
      .notNull()
      .default("posted"),

    notes: text("notes"),

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
      "finance_transactions_public_id_valid",
      sql`length(btrim(${table.publicId})) between 6 and 100`,
    ),

    check(
      "finance_transactions_idempotency_valid",
      sql`length(btrim(${table.idempotencyKey})) between 8 and 160`,
    ),

    check(
      "finance_transactions_type_valid",
      sql`
        ${table.transactionType} in (
          'sale',
          'purchase',
          'receipt',
          'payment',
          'expense',
          'refund',
          'reversal',
          'adjustment',
          'transfer'
        )
      `,
    ),

    check(
      "finance_transactions_source_valid",
      sql`
        length(btrim(${table.sourceType})) > 0
        and length(btrim(${table.sourceId})) > 0
        and length(btrim(${table.sourceEvent})) > 0
      `,
    ),

    check(
      "finance_transactions_status_valid",
      sql`${table.status} in ('posted', 'reversed')`,
    ),

    uniqueIndex("finance_transactions_public_id_idx")
      .on(table.publicId),

    uniqueIndex("finance_transactions_idempotency_idx")
      .on(table.idempotencyKey),

    uniqueIndex("finance_transactions_active_source_event_idx")
      .on(
        table.sourceType,
        table.sourceId,
        table.sourceEvent,
      )
      .where(sql`${table.status} = 'posted'`),

    index("finance_transactions_business_date_idx")
      .on(table.businessDate),

    index("finance_transactions_cash_session_idx")
      .on(table.cashSessionId),

    index("finance_transactions_source_idx")
      .on(table.sourceType, table.sourceId),

    index("finance_transactions_created_at_idx")
      .on(table.createdAt),
  ],
).enableRLS();

export const financeTransactionLinesTable = pgTable(
  "finance_transaction_lines",
  {
    id: serial("id").primaryKey(),

    transactionId: integer("transaction_id")
      .notNull()
      .references(() => financeTransactionsTable.id, {
        onDelete: "cascade",
      }),

    lineNumber: integer("line_number").notNull(),

    accountId: integer("account_id")
      .notNull()
      .references(() => financeAccountsTable.id, {
        onDelete: "restrict",
      }),

    debitMinor: integer("debit_minor")
      .notNull()
      .default(0),

    creditMinor: integer("credit_minor")
      .notNull()
      .default(0),

    memo: text("memo"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "finance_transaction_lines_line_positive",
      sql`${table.lineNumber} > 0`,
    ),

    check(
      "finance_transaction_lines_amount_valid",
      sql`
        (
          ${table.debitMinor} > 0
          and ${table.creditMinor} = 0
        )
        or
        (
          ${table.creditMinor} > 0
          and ${table.debitMinor} = 0
        )
      `,
    ),

    uniqueIndex("finance_transaction_lines_number_idx")
      .on(table.transactionId, table.lineNumber),

    index("finance_transaction_lines_transaction_idx")
      .on(table.transactionId),

    index("finance_transaction_lines_account_idx")
      .on(table.accountId),
  ],
).enableRLS();
