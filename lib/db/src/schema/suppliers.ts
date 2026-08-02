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
import { usersTable } from "./users";

export const suppliersTable = pgTable(
  "suppliers",
  {
    id: serial("id").primaryKey(),

    code: text("code").notNull(),
    name: text("name").notNull(),

    contactPerson: text("contact_person"),
    phone: text("phone"),
    mobile: text("mobile"),
    email: text("email"),
    address: text("address"),
    notes: text("notes"),

    status: text("status").notNull().default("active"),

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
      "suppliers_code_valid",
      sql`${table.code} ~ '^[A-Za-z0-9_-]{1,40}$'`,
    ),

    check(
      "suppliers_name_not_empty",
      sql`length(btrim(${table.name})) > 0`,
    ),

    check(
      "suppliers_status_valid",
      sql`${table.status} in ('active', 'inactive')`,
    ),

    uniqueIndex("suppliers_code_idx").on(table.code),
    index("suppliers_name_idx").on(table.name),
    index("suppliers_status_idx").on(table.status),
    index("suppliers_created_at_idx").on(table.createdAt),
  ],
).enableRLS();

export type DbSupplier = typeof suppliersTable.$inferSelect;
export type InsertSupplier = typeof suppliersTable.$inferInsert;
