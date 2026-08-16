import {
  date,
  index,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const visitorDailyVisitsTable = pgTable(
  "visitor_daily_visits",
  {
    id: serial("id").primaryKey(),
    visitorId: text("visitor_id").notNull(),
    visitDate: date("visit_date", { mode: "string" }).notNull(),
    country: text("country").notNull().default("XX"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("visitor_daily_visits_visitor_day_idx").on(
      table.visitorId,
      table.visitDate,
    ),
    index("visitor_daily_visits_date_idx").on(table.visitDate),
    index("visitor_daily_visits_country_date_idx").on(
      table.country,
      table.visitDate,
    ),
  ],
).enableRLS();

export type DbVisitorDailyVisit =
  typeof visitorDailyVisitsTable.$inferSelect;
