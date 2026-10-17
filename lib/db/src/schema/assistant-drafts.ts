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

import { employeesTable } from "./employees";
import { expenseCategoriesTable } from "./expense-categories";
import { financeVouchersTable } from "./finance-vouchers";
import { usersTable } from "./users";

export const assistantDraftsTable = pgTable(
  "assistant_drafts",
  {
    id: serial("id").primaryKey(),

    publicId: text("public_id").notNull(),

    originalText: text("original_text").notNull(),

    source: text("source")
      .notNull()
      .default("text"),

    intent: text("intent"),

    amountMinor: integer("amount_minor"),

    employeeId: integer("employee_id").references(
      () => employeesTable.id,
      {
        onDelete: "restrict",
      },
    ),

    expenseCategoryId: integer(
      "expense_category_id",
    ).references(
      () => expenseCategoriesTable.id,
      {
        onDelete: "restrict",
      },
    ),

    paymentMethod: text("payment_method")
      .notNull()
      .default("cash"),

    registerKey: text("register_key")
      .notNull()
      .default("main"),

    confidence: integer("confidence"),

    parseMessage: text("parse_message"),

    notes: text("notes"),

    status: text("status")
      .notNull()
      .default("pending"),

    financeVoucherId: integer(
      "finance_voucher_id",
    ).references(
      () => financeVouchersTable.id,
      {
        onDelete: "restrict",
      },
    ),

    createdByUserId: integer(
      "created_by_user_id",
    )
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
      }),

    reviewedByUserId: integer(
      "reviewed_by_user_id",
    ).references(() => usersTable.id, {
      onDelete: "restrict",
    }),

    reviewedAt: timestamp("reviewed_at", {
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
      "assistant_drafts_public_id_valid",
      sql`length(btrim(${table.publicId})) between 6 and 100`,
    ),

    check(
      "assistant_drafts_original_text_valid",
      sql`length(btrim(${table.originalText})) between 1 and 2000`,
    ),

    check(
      "assistant_drafts_source_valid",
      sql`${table.source} in ('text', 'voice')`,
    ),

    check(
      "assistant_drafts_intent_valid",
      sql`
        ${table.intent} is null
        or ${table.intent} in (
          'expense',
          'employee_advance',
          'owner_withdrawal'
        )
      `,
    ),

    check(
      "assistant_drafts_amount_valid",
      sql`
        ${table.amountMinor} is null
        or ${table.amountMinor} > 0
      `,
    ),

    check(
      "assistant_drafts_payment_method_valid",
      sql`${table.paymentMethod} = 'cash'`,
    ),

    check(
      "assistant_drafts_register_key_valid",
      sql`${table.registerKey} ~ '^[a-z0-9_-]{1,50}$'`,
    ),

    check(
      "assistant_drafts_confidence_valid",
      sql`
        ${table.confidence} is null
        or ${table.confidence} between 0 and 100
      `,
    ),

    check(
      "assistant_drafts_employee_scope_valid",
      sql`
        ${table.employeeId} is null
        or ${table.intent} = 'employee_advance'
      `,
    ),

    check(
      "assistant_drafts_expense_scope_valid",
      sql`
        ${table.expenseCategoryId} is null
        or ${table.intent} = 'expense'
      `,
    ),

    check(
      "assistant_drafts_status_valid",
      sql`${table.status} in ('pending', 'approved', 'rejected')`,
    ),

    check(
      "assistant_drafts_review_state_valid",
      sql`
        (
          ${table.status} = 'pending'
          and ${table.financeVoucherId} is null
          and ${table.reviewedByUserId} is null
          and ${table.reviewedAt} is null
        )
        or
        (
          ${table.status} = 'approved'
          and ${table.financeVoucherId} is not null
          and ${table.reviewedByUserId} is not null
          and ${table.reviewedAt} is not null
          and ${table.intent} is not null
          and ${table.amountMinor} is not null
          and (
            (
              ${table.intent} = 'employee_advance'
              and ${table.employeeId} is not null
              and ${table.expenseCategoryId} is null
            )
            or
            (
              ${table.intent} = 'expense'
              and ${table.expenseCategoryId} is not null
              and ${table.employeeId} is null
            )
            or
            (
              ${table.intent} = 'owner_withdrawal'
              and ${table.employeeId} is null
              and ${table.expenseCategoryId} is null
            )
          )
        )
        or
        (
          ${table.status} = 'rejected'
          and ${table.financeVoucherId} is null
          and ${table.reviewedByUserId} is not null
          and ${table.reviewedAt} is not null
        )
      `,
    ),

    uniqueIndex("assistant_drafts_public_id_idx")
      .on(table.publicId),

    uniqueIndex("assistant_drafts_finance_voucher_idx")
      .on(table.financeVoucherId)
      .where(
        sql`${table.financeVoucherId} is not null`,
      ),

    index("assistant_drafts_status_idx")
      .on(table.status),

    index("assistant_drafts_created_by_idx")
      .on(table.createdByUserId),

    index("assistant_drafts_created_at_idx")
      .on(table.createdAt),
  ],
).enableRLS();

export type DbAssistantDraft =
  typeof assistantDraftsTable.$inferSelect;
