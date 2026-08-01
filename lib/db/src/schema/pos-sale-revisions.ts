import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { posSalesTable } from "./pos-sales";
import { usersTable } from "./users";

export interface PosSaleRevisionSnapshot {
  sale: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
}

export const posSaleRevisionsTable = pgTable(
  "pos_sale_revisions",
  {
    id: serial("id").primaryKey(),

    saleId: integer("sale_id")
      .notNull()
      .references(() => posSalesTable.id, {
        onDelete: "restrict",
      }),

    idempotencyKey: text("idempotency_key").notNull(),

    revisionNumber: integer("revision_number").notNull(),

    editedByUserId: integer("edited_by_user_id")
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
      }),

    reason: text("reason").notNull(),

    beforeSnapshot: jsonb("before_snapshot")
      .$type<PosSaleRevisionSnapshot>()
      .notNull(),

    afterSnapshot: jsonb("after_snapshot")
      .$type<PosSaleRevisionSnapshot>()
      .notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "pos_sale_revisions_number_positive",
      sql`${table.revisionNumber} > 0`,
    ),

    check(
      "pos_sale_revisions_reason_not_empty",
      sql`char_length(trim(${table.reason})) > 0`,
    ),

    uniqueIndex("pos_sale_revisions_idempotency_key_idx").on(
      table.idempotencyKey,
    ),

    uniqueIndex("pos_sale_revisions_sale_number_idx").on(
      table.saleId,
      table.revisionNumber,
    ),

    index("pos_sale_revisions_sale_idx").on(table.saleId),

    index("pos_sale_revisions_editor_idx").on(table.editedByUserId),

    index("pos_sale_revisions_created_at_idx").on(table.createdAt),
  ],
).enableRLS();

export type PosSaleRevision = typeof posSaleRevisionsTable.$inferSelect;
