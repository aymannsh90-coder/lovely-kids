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
import { ordersTable } from "./orders";
import { posSalesTable } from "./pos-sales";
import { usersTable } from "./users";

export const exchangeDocumentsTable = pgTable(
  "exchange_documents",
  {
    id: serial("id").primaryKey(),

    publicId: text("public_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),

    sourceType: text("source_type").notNull(),

    originalPosSaleId: integer("original_pos_sale_id").references(
      () => posSalesTable.id,
      { onDelete: "restrict" },
    ),

    originalOrderId: integer("original_order_id").references(
      () => ordersTable.id,
      { onDelete: "restrict" },
    ),

    businessDate: date("business_date").notNull(),

    cashSessionId: integer("cash_session_id").references(
      () => cashSessionsTable.id,
      { onDelete: "restrict" },
    ),

    registerKey: text("register_key"),

    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
      }),

    status: text("status").notNull().default("completed"),

    settlementType: text("settlement_type").notNull(),
    settlementPartyId: integer("settlement_party_id"),

    returnGrossMinor: integer("return_gross_minor").notNull(),
    returnDiscountMinor: integer("return_discount_minor").notNull(),
    returnNetMinor: integer("return_net_minor").notNull(),

    newGrossMinor: integer("new_gross_minor").notNull(),
    newDiscountMinor: integer("new_discount_minor").notNull(),
    newNetMinor: integer("new_net_minor").notNull(),

    differenceMinor: integer("difference_minor").notNull(),

    deliveryChargeMinor: integer("delivery_charge_minor")
      .notNull()
      .default(0),

    deliveryCompanyCostMinor: integer("delivery_company_cost_minor")
      .notNull()
      .default(0),

    settlementAmountMinor: integer("settlement_amount_minor").notNull(),

    reason: text("reason"),
    notes: text("notes"),

    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByUserId: integer("voided_by_user_id").references(
      () => usersTable.id,
      { onDelete: "restrict" },
    ),
    voidReason: text("void_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "exchange_documents_source_valid",
      sql`
        (
          ${table.sourceType} = 'pos_sale'
          and ${table.originalPosSaleId} is not null
          and ${table.originalOrderId} is null
        )
        or
        (
          ${table.sourceType} = 'online_order'
          and ${table.originalPosSaleId} is null
          and ${table.originalOrderId} is not null
        )
      `,
    ),

    check(
      "exchange_documents_status_valid",
      sql`${table.status} in ('completed', 'voided')`,
    ),

    check(
      "exchange_documents_settlement_type_valid",
      sql`${table.settlementType} in ('cash', 'delivery_company', 'customer')`,
    ),

    check(
      "exchange_documents_settlement_party_valid",
      sql`
        (
          ${table.settlementType} = 'cash'
          and ${table.settlementPartyId} is null
        )
        or
        (
          ${table.settlementType} in ('delivery_company', 'customer')
          and ${table.settlementPartyId} is not null
        )
      `,
    ),

    check(
      "exchange_documents_amounts_valid",
      sql`
        ${table.returnGrossMinor} >= 0
        and ${table.returnDiscountMinor} >= 0
        and ${table.returnNetMinor} >= 0
        and ${table.newGrossMinor} >= 0
        and ${table.newDiscountMinor} >= 0
        and ${table.newNetMinor} >= 0
        and ${table.deliveryChargeMinor} >= 0
        and ${table.deliveryCompanyCostMinor} >= 0
      `,
    ),

    check(
      "exchange_documents_return_total_valid",
      sql`
        ${table.returnNetMinor} =
        ${table.returnGrossMinor} - ${table.returnDiscountMinor}
      `,
    ),

    check(
      "exchange_documents_new_total_valid",
      sql`
        ${table.newNetMinor} =
        ${table.newGrossMinor} - ${table.newDiscountMinor}
      `,
    ),

    check(
      "exchange_documents_difference_valid",
      sql`
        ${table.differenceMinor} =
        ${table.newNetMinor} - ${table.returnNetMinor}
      `,
    ),

    check(
      "exchange_documents_settlement_amount_valid",
      sql`
        ${table.settlementAmountMinor} =
        ${table.differenceMinor} + ${table.deliveryChargeMinor}
      `,
    ),

    check(
      "exchange_documents_void_state_valid",
      sql`
        (
          ${table.status} = 'completed'
          and ${table.voidedAt} is null
          and ${table.voidedByUserId} is null
        )
        or
        (
          ${table.status} = 'voided'
          and ${table.voidedAt} is not null
          and ${table.voidedByUserId} is not null
        )
      `,
    ),

    uniqueIndex("exchange_documents_public_id_idx").on(table.publicId),

    uniqueIndex("exchange_documents_idempotency_key_idx").on(
      table.idempotencyKey,
    ),

    index("exchange_documents_pos_sale_idx").on(table.originalPosSaleId),

    index("exchange_documents_order_idx").on(table.originalOrderId),

    index("exchange_documents_business_date_idx").on(table.businessDate),

    index("exchange_documents_settlement_party_idx").on(
      table.settlementType,
      table.settlementPartyId,
    ),
  ],
).enableRLS();

export type ExchangeDocument =
  typeof exchangeDocumentsTable.$inferSelect;
