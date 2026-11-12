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
import { deliveryCompaniesTable } from "./delivery-companies";
import { financeTransactionsTable } from "./finance";
import { ordersTable } from "./orders";
import { usersTable } from "./users";

export const deliveryCompanySettlementsTable = pgTable(
  "delivery_company_settlements",
  {
    id: serial("id").primaryKey(),

    publicId: text("public_id").notNull(),

    deliveryCompanyId: integer("delivery_company_id")
      .notNull()
      .references(() => deliveryCompaniesTable.id, {
        onDelete: "restrict",
      }),

    businessDate: date("business_date").notNull(),

    receiptMethod: text("receipt_method").notNull(),

    totalMinor: integer("total_minor").notNull(),

    cashSessionId: integer("cash_session_id")
      .references(() => cashSessionsTable.id, {
        onDelete: "restrict",
      }),

    financeTransactionId: integer("finance_transaction_id")
      .references(() => financeTransactionsTable.id, {
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
      "delivery_company_settlements_public_id_valid",
      sql`length(btrim(${table.publicId})) between 6 and 100`,
    ),

    check(
      "delivery_company_settlements_total_positive",
      sql`${table.totalMinor} > 0`,
    ),

    check(
      "delivery_company_settlements_receipt_method_valid",
      sql`${table.receiptMethod} in ('cash', 'bank')`,
    ),

    check(
      "delivery_company_settlements_status_valid",
      sql`${table.status} in ('posted', 'reversed')`,
    ),

    check(
      "delivery_company_settlements_cash_session_valid",
      sql`
        (
          ${table.receiptMethod} = 'cash'
          and ${table.cashSessionId} is not null
        )
        or
        (
          ${table.receiptMethod} = 'bank'
          and ${table.cashSessionId} is null
        )
      `,
    ),

    uniqueIndex("delivery_company_settlements_public_id_idx")
      .on(table.publicId),

    uniqueIndex("delivery_company_settlements_finance_tx_idx")
      .on(table.financeTransactionId)
      .where(sql`${table.financeTransactionId} is not null`),

    index("delivery_company_settlements_company_idx")
      .on(table.deliveryCompanyId),

    index("delivery_company_settlements_business_date_idx")
      .on(table.businessDate),

    index("delivery_company_settlements_status_idx")
      .on(table.status),
  ],
).enableRLS();

export const deliveryCompanySettlementItemsTable = pgTable(
  "delivery_company_settlement_items",
  {
    id: serial("id").primaryKey(),

    settlementId: integer("settlement_id")
      .notNull()
      .references(() => deliveryCompanySettlementsTable.id, {
        onDelete: "cascade",
      }),

    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, {
        onDelete: "restrict",
      }),

    amountMinor: integer("amount_minor").notNull(),

    status: text("status")
      .notNull()
      .default("posted"),

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
      "delivery_company_settlement_items_amount_positive",
      sql`${table.amountMinor} > 0`,
    ),

    check(
      "delivery_company_settlement_items_status_valid",
      sql`${table.status} in ('posted', 'reversed')`,
    ),

    uniqueIndex("delivery_company_settlement_items_pair_idx")
      .on(table.settlementId, table.orderId),

    index("delivery_company_settlement_items_settlement_idx")
      .on(table.settlementId),

    index("delivery_company_settlement_items_order_idx")
      .on(table.orderId),
  ],
).enableRLS();

export type DbDeliveryCompanySettlement =
  typeof deliveryCompanySettlementsTable.$inferSelect;

export type DbDeliveryCompanySettlementItem =
  typeof deliveryCompanySettlementItemsTable.$inferSelect;

/**
 * Non-cash reconciliation of negative online-exchange parcels.
 * "historical" marks a courier deduction already reflected in a prior
 * external statement; "posted" belongs to a new settlement's payable offset.
 */
export const deliveryCompanyExchangeOffsetsTable = pgTable(
  "delivery_company_exchange_offsets",
  {
    id: serial("id").primaryKey(),
    deliveryCompanyId: integer("delivery_company_id")
      .notNull()
      .references(() => deliveryCompaniesTable.id, { onDelete: "restrict" }),
    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "restrict" }),
    settlementId: integer("settlement_id")
      .references(() => deliveryCompanySettlementsTable.id, { onDelete: "restrict" }),
    amountMinor: integer("amount_minor").notNull(),
    status: text("status").notNull().default("posted"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("delivery_company_exchange_offsets_amount_positive", sql`${table.amountMinor} > 0`),
    check("delivery_company_exchange_offsets_status_valid", sql`${table.status} in ('historical', 'posted', 'reversed')`),
    check(
      "delivery_company_exchange_offsets_settlement_valid",
      sql`(${table.status} = 'historical' and ${table.settlementId} is null) or (${table.status} in ('posted', 'reversed') and ${table.settlementId} is not null)`,
    ),
    uniqueIndex("delivery_company_exchange_offsets_settlement_order_idx")
      .on(table.settlementId, table.orderId)
      .where(sql`${table.settlementId} is not null`),
    uniqueIndex("delivery_company_exchange_offsets_historical_order_idx")
      .on(table.deliveryCompanyId, table.orderId)
      .where(sql`${table.status} = 'historical'`),
    index("delivery_company_exchange_offsets_company_idx").on(table.deliveryCompanyId),
    index("delivery_company_exchange_offsets_order_idx").on(table.orderId),
  ],
).enableRLS();

export type DbDeliveryCompanyExchangeOffset =
  typeof deliveryCompanyExchangeOffsetsTable.$inferSelect;
