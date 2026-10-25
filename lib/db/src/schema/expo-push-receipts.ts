import {
  index,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const expoPushReceiptsTable = pgTable(
  "expo_push_receipts",
  {
    id: serial("id").primaryKey(),
    ticketId: text("ticket_id").notNull().unique(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("expo_push_receipts_created_idx").on(
      table.createdAt,
    ),
  ],
).enableRLS();

export type ExpoPushReceipt =
  typeof expoPushReceiptsTable.$inferSelect;
