import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";
import { usersTable } from "./users";

/** Physical receipt of a refused COD courier parcel (not an exchange return).
 * Zero return freight: does not overwrite the outbound delivery cost. */
export const orderFailedDeliveryReturnsTable = pgTable(
  "order_failed_delivery_returns",
  {
    orderId: integer("order_id").primaryKey().references(() => ordersTable.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    reason: text("reason").notNull(),
    returnDeliveryCostMinor: integer("return_delivery_cost_minor").notNull().default(0),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
    reportedByUserId: integer("reported_by_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    receivedByUserId: integer("received_by_user_id").references(() => usersTable.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    check("order_failed_delivery_returns_status_valid", sql`${table.status} in ('pending', 'received')`),
    check("order_failed_delivery_returns_no_return_fee", sql`${table.returnDeliveryCostMinor} = 0`),
    check("order_failed_delivery_returns_reason_valid", sql`length(btrim(${table.reason})) between 3 and 500`),
    check("order_failed_delivery_returns_receipt_valid", sql`
      (${table.status} = 'pending' and ${table.receivedAt} is null and ${table.receivedByUserId} is null)
      or (${table.status} = 'received' and ${table.receivedAt} is not null and ${table.receivedByUserId} is not null)
    `),
  ],
).enableRLS();
