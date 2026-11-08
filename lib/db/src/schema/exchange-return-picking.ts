import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { exchangeDocumentsTable } from "./exchanges";
import { usersTable } from "./users";

/** Scan-only audit. No stock, finance, or exchange status changes occur here. */
export type ExchangeReturnPickingScan = {
  id: string;
  requestId: string;
  lineKey: string;
  barcode: string;
  scannedAt: string;
  scannedByUserId: number;
};

export const exchangeReturnPickingSessionsTable = pgTable("exchange_return_picking_sessions", {
  exchangeId: integer("exchange_id").primaryKey()
    .references(() => exchangeDocumentsTable.id, { onDelete: "cascade" }),
  itemsSignature: text("items_signature").notNull(),
  scans: jsonb("scans").$type<ExchangeReturnPickingScan[]>().notNull().default([]),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedByUserId: integer("verified_by_user_id")
    .references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();
