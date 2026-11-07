import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";
import { usersTable } from "./users";

/** Verification records only. Scanning never posts stock, finance or order status. */
export type OrderPickingScan = {
  id: string;
  requestId: string;
  lineKey: string;
  barcode: string;
  scannedAt: string;
  scannedByUserId: number;
};

export const orderPickingSessionsTable = pgTable("order_picking_sessions", {
  orderId: integer("order_id").primaryKey()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  itemsSignature: text("items_signature").notNull(),
  scans: jsonb("scans").$type<OrderPickingScan[]>().notNull().default([]),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedByUserId: integer("verified_by_user_id")
    .references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();
