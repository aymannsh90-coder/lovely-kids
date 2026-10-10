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
import { expenseCategoriesTable } from "./expense-categories";
import { financeTransactionsTable } from "./finance";
import { usersTable } from "./users";

export const financeVouchersTable = pgTable(
  "finance_vouchers",
  {
    id: serial("id").primaryKey(),

    publicId: text("public_id").notNull(),

    idempotencyKey: text("idempotency_key")
      .notNull(),

    voucherType: text("voucher_type").notNull(),

    partyType: text("party_type"),
    partyId: integer("party_id"),

    expenseCategoryId: integer("expense_category_id")
      .references(() => expenseCategoriesTable.id, {
        onDelete: "restrict",
      }),

    paymentMethod: text("payment_method")
      .notNull(),

    amountMinor: integer("amount_minor")
      .notNull(),

    businessDate: date("business_date")
      .notNull(),

    referencePeriod: text("reference_period"),

    cashSessionId: integer("cash_session_id")
      .references(() => cashSessionsTable.id, {
        onDelete: "restrict",
      }),

    financeTransactionId: integer(
      "finance_transaction_id",
    ).references(() => financeTransactionsTable.id, {
      onDelete: "restrict",
    }),

    status: text("status")
      .notNull()
      .default("posted"),

    notes: text("notes"),

    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
      }),

    voidedAt: timestamp("voided_at", {
      withTimezone: true,
    }),

    voidedByUserId: integer(
      "voided_by_user_id",
    ).references(() => usersTable.id, {
      onDelete: "restrict",
    }),

    voidReason: text("void_reason"),

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
      "finance_vouchers_public_id_valid",
      sql`length(btrim(${table.publicId})) between 6 and 100`,
    ),

    check(
      "finance_vouchers_idempotency_valid",
      sql`length(btrim(${table.idempotencyKey})) between 8 and 160`,
    ),

    check(
      "finance_vouchers_type_valid",
      sql`${table.voucherType} in (
        'customer_receipt',
        'expense',
        'employee_advance',
        'employee_repayment',
        'salary_accrual',
        'employee_payment',
        'owner_withdrawal',
        'adjustment'
      )`,
    ),

    check(
      "finance_vouchers_party_pair_valid",
      sql`
        (
          ${table.partyType} is null
          and ${table.partyId} is null
        )
        or
        (
          ${table.partyType} in (
            'customer',
            'employee',
            'owner'
          )
          and ${table.partyId} is not null
        )
      `,
    ),

    check(
      "finance_vouchers_party_type_matches",
      sql`
        (
          ${table.voucherType} = 'customer_receipt'
          and ${table.partyType} = 'customer'
          and ${table.partyId} is not null
        )
        or
        (
          ${table.voucherType} in (
            'employee_advance',
            'employee_repayment',
            'salary_accrual',
            'employee_payment'
          )
          and ${table.partyType} = 'employee'
          and ${table.partyId} is not null
        )
        or
        (
          ${table.voucherType} = 'owner_withdrawal'
          and ${table.partyType} = 'owner'
          and ${table.partyId} is not null
        )
        or
        (
          ${table.voucherType} in (
            'expense',
            'adjustment'
          )
        )
      `,
    ),

    check(
      "finance_vouchers_expense_category_valid",
      sql`
        (
          ${table.voucherType} = 'expense'
          and ${table.expenseCategoryId} is not null
        )
        or
        (
          ${table.voucherType} <> 'expense'
          and ${table.expenseCategoryId} is null
        )
      `,
    ),

    check(
      "finance_vouchers_payment_method_valid",
      sql`${table.paymentMethod} in (
        'cash',
        'card',
        'bank',
        'non_cash'
      )`,
    ),

    check(
      "finance_vouchers_amount_valid",
      sql`${table.amountMinor} > 0`,
    ),

    check(
      "finance_vouchers_cash_session_valid",
      sql`
        (
          ${table.paymentMethod} = 'cash'
          and ${table.cashSessionId} is not null
        )
        or
        (
          ${table.paymentMethod} <> 'cash'
          and ${table.cashSessionId} is null
        )
      `,
    ),

    check(
      "finance_vouchers_status_valid",
      sql`${table.status} in ('posted', 'voided')`,
    ),

    check(
      "finance_vouchers_void_state_valid",
      sql`
        (
          ${table.status} = 'posted'
          and ${table.voidedAt} is null
          and ${table.voidedByUserId} is null
          and ${table.voidReason} is null
        )
        or
        (
          ${table.status} = 'voided'
          and ${table.voidedAt} is not null
          and ${table.voidedByUserId} is not null
          and length(btrim(${table.voidReason})) > 0
        )
      `,
    ),

    uniqueIndex("finance_vouchers_public_id_idx")
      .on(table.publicId),

    uniqueIndex("finance_vouchers_idempotency_idx")
      .on(table.idempotencyKey),

    uniqueIndex("finance_vouchers_finance_tx_idx")
      .on(table.financeTransactionId)
      .where(
        sql`${table.financeTransactionId} is not null`,
      ),

    index("finance_vouchers_business_date_idx")
      .on(table.businessDate),

    index("finance_vouchers_party_idx")
      .on(table.partyType, table.partyId),

    index("finance_vouchers_type_idx")
      .on(table.voucherType),

    index("finance_vouchers_cash_session_idx")
      .on(table.cashSessionId),
  ],
).enableRLS();

export type DbFinanceVoucher =
  typeof financeVouchersTable.$inferSelect;
