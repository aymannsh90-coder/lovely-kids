import { sql } from "drizzle-orm";
import {
  boolean, check, date, foreignKey, index, integer, pgTable,
  serial, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { bankAccountsTable } from "./finance-banking";
import { financeAccountsTable, financeTransactionsTable } from "./finance";
import { cashSessionsTable } from "./cash-sessions";
import { suppliersTable } from "./suppliers";
import { posPurchasesTable } from "./pos-purchases";
import { financeVouchersTable } from "./finance-vouchers";

/**
 * Import case is a DOCUMENTATION DRAFT, not an accounting journal.
 * No payment/cost/stock postings can be triggered from these tables.
 */
export const importCostCasesTable = pgTable("import_cost_cases", {
  id: serial("id").primaryKey(),
  publicId: text("public_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  businessDate: date("business_date").notNull(),
  title: text("title").notNull(),
  withTravel: boolean("with_travel").notNull().default(false),
  travelRecordedIlsMinor: integer("travel_recorded_ils_minor").notNull().default(0),
  notes: text("notes"),
  status: text("status").notNull().default("draft"),
  revision: integer("revision").notNull().default(1),
  createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("import_cost_cases_public_unique").on(t.publicId),
  uniqueIndex("import_cost_cases_idempotency_unique").on(t.idempotencyKey),
  index("import_cost_cases_date_idx").on(t.businessDate),
  check("import_cost_cases_status_valid", sql`${t.status} in ('draft','closed')`),
  check("import_cost_cases_revision_positive", sql`${t.revision} > 0`),
  check("import_cost_cases_travel_nonnegative", sql`${t.travelRecordedIlsMinor} >= 0 AND (${t.withTravel} OR ${t.travelRecordedIlsMinor} = 0)`),
]).enableRLS();

export const importCostInvoicesTable = pgTable("import_cost_invoices", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => importCostCasesTable.id, { onDelete: "cascade" }),
  lineRef: text("line_ref").notNull(),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
  invoiceNumber: text("invoice_number").notNull(),
  goodsUsdMinor: integer("goods_usd_minor").notNull(),
  goodsBookedIlsMinor: integer("goods_booked_ils_minor").notNull(),
  // No advance balance stored here: it must eventually be derived from posted journals.
}, (t) => [
  uniqueIndex("import_cost_invoices_case_ref_unique").on(t.caseId, t.lineRef),
  uniqueIndex("import_cost_invoices_case_id_unique").on(t.caseId, t.id),
  index("import_cost_invoices_supplier_idx").on(t.supplierId),
  check("import_cost_invoices_amounts_nonnegative", sql`${t.goodsUsdMinor} >= 0 AND ${t.goodsBookedIlsMinor} >= 0`),
  check("import_cost_invoices_ref_valid", sql`length(btrim(${t.lineRef})) between 1 and 100`),
]).enableRLS();

export const importCostShipmentsTable = pgTable("import_cost_shipments", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => importCostCasesTable.id, { onDelete: "cascade" }),
  lineRef: text("line_ref").notNull(),
  trackingNumber: text("tracking_number"),
  freightIlsMinor: integer("freight_ils_minor").notNull().default(0),
  customsIlsMinor: integer("customs_ils_minor").notNull().default(0),
  localTransportIlsMinor: integer("local_transport_ils_minor").notNull().default(0),
  freightClearingIlsMinor: integer("freight_clearing_ils_minor").notNull(),
}, (t) => [
  uniqueIndex("import_cost_shipments_case_ref_unique").on(t.caseId, t.lineRef),
  uniqueIndex("import_cost_shipments_case_id_unique").on(t.caseId, t.id),
  check("import_cost_shipments_freight_nonnegative", sql`LEAST(${t.freightIlsMinor},${t.customsIlsMinor},${t.localTransportIlsMinor}) >= 0 AND ${t.freightClearingIlsMinor} = ${t.freightIlsMinor} + ${t.customsIlsMinor} + ${t.localTransportIlsMinor}`),
  check("import_cost_shipments_ref_valid", sql`length(btrim(${t.lineRef})) between 1 and 100`),
]).enableRLS();

export const importCostAllocationsTable = pgTable("import_cost_allocations", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => importCostCasesTable.id, { onDelete: "cascade" }),
  lineRef: text("line_ref").notNull(),
  invoiceId: integer("invoice_id").notNull().references(() => importCostInvoicesTable.id, { onDelete: "cascade" }),
  shipmentId: integer("shipment_id").notNull().references(() => importCostShipmentsTable.id, { onDelete: "cascade" }),
  goodsIlsMinor: integer("goods_ils_minor").notNull(),
  freightIlsMinor: integer("freight_ils_minor").notNull(),
  travelManagerialIlsMinor: integer("travel_managerial_ils_minor").notNull().default(0),
  travelCapitalizableIlsMinor: integer("travel_capitalizable_ils_minor").notNull().default(0),
  excelLandedIlsMinor: integer("excel_landed_ils_minor").notNull(),
}, (t) => [
  uniqueIndex("import_cost_allocations_case_ref_unique").on(t.caseId, t.lineRef),
  uniqueIndex("import_cost_allocations_case_id_unique").on(t.caseId, t.id),
  foreignKey({
    name: "import_cost_allocations_same_case_invoice_fk",
    columns: [t.caseId, t.invoiceId],
    foreignColumns: [importCostInvoicesTable.caseId, importCostInvoicesTable.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "import_cost_allocations_same_case_shipment_fk",
    columns: [t.caseId, t.shipmentId],
    foreignColumns: [importCostShipmentsTable.caseId, importCostShipmentsTable.id],
  }).onDelete("cascade"),
  index("import_cost_allocations_invoice_idx").on(t.invoiceId),
  index("import_cost_allocations_shipment_idx").on(t.shipmentId),
  check("import_cost_allocations_nonnegative", sql`LEAST(${t.goodsIlsMinor},${t.freightIlsMinor},${t.travelManagerialIlsMinor},${t.travelCapitalizableIlsMinor},${t.excelLandedIlsMinor}) >= 0`),
  check("import_cost_allocations_travel_eligible_limit", sql`${t.travelCapitalizableIlsMinor} <= ${t.travelManagerialIlsMinor}`),
  check("import_cost_allocations_excel_matches", sql`${t.excelLandedIlsMinor} = ${t.goodsIlsMinor} + ${t.freightIlsMinor} + ${t.travelManagerialIlsMinor}`),
]).enableRLS();

/**
 * Immutable actual USD advance payments. This table is inactive until
 * POS_IMPORT_FINANCIAL_POSTING_ENABLED=true AND its migration is deployed.
 */
export const importCostAdvancePaymentsTable = pgTable("import_cost_advance_payments", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => importCostCasesTable.id, { onDelete: "restrict" }),
  invoiceId: integer("invoice_id").notNull().references(() => importCostInvoicesTable.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  bankAccountId: integer("bank_account_id").notNull().references(() => bankAccountsTable.id, { onDelete: "restrict" }),
  businessDate: date("business_date").notNull(),
  usdAmountMinor: integer("usd_amount_minor").notNull(),
  spotRateMicros: integer("spot_rate_micros").notNull(),
  bankBookIlsMinor: integer("bank_book_ils_minor").notNull(),
  advanceIlsMinor: integer("advance_ils_minor").notNull(),
  fxGainIlsMinor: integer("fx_gain_ils_minor").notNull().default(0),
  fxLossIlsMinor: integer("fx_loss_ils_minor").notNull().default(0),
  financeTransactionId: integer("finance_transaction_id").references(() => financeTransactionsTable.id, { onDelete: "restrict" }),
  createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("import_cost_advance_payment_key_idx").on(t.idempotencyKey),
  uniqueIndex("import_cost_advance_payment_finance_transaction_idx").on(t.financeTransactionId),
  index("import_cost_advance_payment_invoice_idx").on(t.invoiceId),
  foreignKey({
    name: "import_cost_advance_payment_case_invoice_fk",
    columns: [t.caseId, t.invoiceId],
    foreignColumns: [importCostInvoicesTable.caseId, importCostInvoicesTable.id],
  }).onDelete("restrict"),
  check("import_cost_advance_payment_positive", sql`LEAST(${t.usdAmountMinor},${t.spotRateMicros},${t.bankBookIlsMinor},${t.advanceIlsMinor}) > 0`),
  check("import_cost_advance_payment_fx_nonnegative", sql`LEAST(${t.fxGainIlsMinor},${t.fxLossIlsMinor}) >= 0`),
  check("import_cost_advance_payment_one_fx_side", sql`${t.fxGainIlsMinor} = 0 OR ${t.fxLossIlsMinor} = 0`),
  check("import_cost_advance_payment_balanced", sql`${t.advanceIlsMinor} + ${t.fxLossIlsMinor} = ${t.bankBookIlsMinor} + ${t.fxGainIlsMinor}`),
]).enableRLS();

/** Immutable payments of shipment direct costs / optional shared trip costs. */
export const importCostDirectPaymentsTable = pgTable("import_cost_direct_payments", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => importCostCasesTable.id, { onDelete: "restrict" }),
  shipmentId: integer("shipment_id").references(() => importCostShipmentsTable.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  costType: text("cost_type").notNull(),
  paymentMethod: text("payment_method").notNull(),
  bankAccountId: integer("bank_account_id").references(() => bankAccountsTable.id, { onDelete: "restrict" }),
  cashSessionId: integer("cash_session_id").references(() => cashSessionsTable.id, { onDelete: "restrict" }),
  settlementFinanceAccountId: integer("settlement_finance_account_id").notNull().references(() => financeAccountsTable.id, { onDelete: "restrict" }),
  businessDate: date("business_date").notNull(),
  amountIlsMinor: integer("amount_ils_minor").notNull(),
  financeTransactionId: integer("finance_transaction_id").references(() => financeTransactionsTable.id, { onDelete: "restrict" }),
  createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("import_cost_direct_payment_key_idx").on(t.idempotencyKey),
  uniqueIndex("import_cost_direct_payment_finance_txn_idx").on(t.financeTransactionId),
  index("import_cost_direct_payment_case_idx").on(t.caseId),
  index("import_cost_direct_payment_shipment_idx").on(t.shipmentId),
  foreignKey({
    name: "import_cost_direct_payment_case_shipment_fk",
    columns: [t.caseId, t.shipmentId],
    foreignColumns: [importCostShipmentsTable.caseId, importCostShipmentsTable.id],
  }).onDelete("restrict"),
  check("import_cost_direct_payment_kind_valid", sql`${t.costType} in ('freight','customs','local_transport','travel')`),
  check("import_cost_direct_payment_method_valid", sql`${t.paymentMethod} in ('bank','cash')`),
  check("import_cost_direct_payment_amount_positive", sql`${t.amountIlsMinor} > 0`),
  check("import_cost_direct_payment_target_valid", sql`(${t.costType} = 'travel' and ${t.shipmentId} is null) OR (${t.costType} <> 'travel' and ${t.shipmentId} is not null)`),
  check("import_cost_direct_payment_settlement_valid", sql`
    (${t.paymentMethod} = 'bank' and ${t.bankAccountId} is not null and ${t.cashSessionId} is null)
    or
    (${t.paymentMethod} = 'cash' and ${t.cashSessionId} is not null and ${t.bankAccountId} is null)
  `),
]).enableRLS();


/**
 * Evidence-only link: an already-approved ILS POS purchase can be allocated
 * to exactly one Excel cost group. Never creates an inventory journal.
 */
export const importCostPurchaseLinksTable = pgTable("import_cost_purchase_links", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => importCostCasesTable.id, { onDelete: "restrict" }),
  allocationId: integer("allocation_id").notNull().references(() => importCostAllocationsTable.id, { onDelete: "restrict" }),
  purchaseId: integer("purchase_id").notNull().references(() => posPurchasesTable.id, { onDelete: "restrict" }),
  createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("import_cost_purchase_links_purchase_unique").on(t.purchaseId),
  index("import_cost_purchase_links_allocation_idx").on(t.allocationId),
  index("import_cost_purchase_links_case_idx").on(t.caseId),
  foreignKey({
    name: "import_cost_purchase_links_same_case_fk",
    columns: [t.caseId, t.allocationId],
    foreignColumns: [importCostAllocationsTable.caseId, importCostAllocationsTable.id],
  }).onDelete("restrict"),
]).enableRLS();


/**
 * Evidence-only assignment of existing posted ILS supplier vouchers to one
 * import invoice. Multiple invoice claims may share a voucher, bounded by
 * its original payment (checked transactionally).
 *
 * ATTENTION: Nothing here re-posts bank, cash, supplier payable or inventory.
 */
export const importCostSupplierVoucherClaimsTable = pgTable("import_cost_supplier_voucher_claims", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => importCostCasesTable.id, { onDelete: "restrict" }),
  invoiceId: integer("invoice_id").notNull().references(() => importCostInvoicesTable.id, { onDelete: "restrict" }),
  voucherId: integer("voucher_id").notNull().references(() => financeVouchersTable.id, { onDelete: "restrict" }),
  amountIlsMinor: integer("amount_ils_minor").notNull(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("import_cost_supplier_voucher_claim_unique").on(t.invoiceId,t.voucherId),
  index("import_cost_supplier_voucher_claim_voucher_idx").on(t.voucherId),
  index("import_cost_supplier_voucher_claim_case_idx").on(t.caseId),
  foreignKey({
    name: "import_cost_supplier_voucher_claim_case_invoice_fk",
    columns: [t.caseId,t.invoiceId],
    foreignColumns: [importCostInvoicesTable.caseId,importCostInvoicesTable.id],
  }).onDelete("restrict"),
  check("import_cost_supplier_voucher_claim_amount_positive", sql`${t.amountIlsMinor} > 0`),
]).enableRLS();


/** Immutable audit of each closed import settlement and its separate reversal. */
export const importCostClosuresTable = pgTable("import_cost_closures", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => importCostCasesTable.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("posted"),
  businessDate: date("business_date").notNull(),
  debitIlsMinor: integer("debit_ils_minor").notNull(),
  financeTransactionId: integer("finance_transaction_id").references(() => financeTransactionsTable.id, { onDelete: "restrict" }),
  reversalFinanceTransactionId: integer("reversal_finance_transaction_id").references(() => financeTransactionsTable.id, { onDelete: "restrict" }),
  reversalKey: text("reversal_key"),
  reversalReason: text("reversal_reason"),
  closedByUserId: integer("closed_by_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  reversedByUserId: integer("reversed_by_user_id").references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
}, t => [
  uniqueIndex("import_cost_closure_key_unique").on(t.idempotencyKey),
  uniqueIndex("import_cost_closure_reverse_key_unique").on(t.reversalKey),
  uniqueIndex("import_cost_closure_active_case_unique").on(t.caseId).where(sql`${t.status} = 'posted'`),
  uniqueIndex("import_cost_closure_finance_unique").on(t.financeTransactionId),
  uniqueIndex("import_cost_closure_reverse_finance_unique").on(t.reversalFinanceTransactionId),
  index("import_cost_closure_case_idx").on(t.caseId),
  check("import_cost_closure_status_valid", sql`${t.status} in ('posted','reversed')`),
  check("import_cost_closure_amount_valid", sql`${t.debitIlsMinor} >= 0`),
  check("import_cost_closure_reversal_valid", sql`
    (${t.status} = 'posted' and ${t.reversalFinanceTransactionId} is null and ${t.reversalKey} is null and ${t.reversedAt} is null)
    or (${t.status} = 'reversed' and ${t.reversalKey} is not null and ${t.reversalReason} is not null and ${t.reversedAt} is not null)
  `),
]).enableRLS();
