import {
  boolean,
  check,
  date,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const discountCodesTable = pgTable(
  "discount_codes",
  {
    id: serial("id").primaryKey(),

    campaignName: text("campaign_name").notNull(),
    code: text("code").notNull(),
    normalizedCode: text("normalized_code").notNull(),

    discountPercent: integer("discount_percent").notNull(),

    isActive: boolean("is_active").notNull().default(true),

    stackWithShippingPromotion: boolean(
      "stack_with_shipping_promotion",
    )
      .notNull()
      .default(false),

    startDate: date("start_date"),
    endDate: date("end_date"),

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
    uniqueIndex(
      "discount_codes_normalized_code_unique",
    ).on(table.normalizedCode),

    check(
      "discount_codes_percent_valid",
      sql`${table.discountPercent} between 1 and 100`,
    ),

    check(
      "discount_codes_dates_valid",
      sql`
        ${table.startDate} is null
        or ${table.endDate} is null
        or ${table.endDate} >= ${table.startDate}
      `,
    ),
  ],
).enableRLS();

export type DiscountCode =
  typeof discountCodesTable.$inferSelect;

export type NewDiscountCode =
  typeof discountCodesTable.$inferInsert;
