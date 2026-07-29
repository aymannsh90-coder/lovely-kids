import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const securityAuditLogsTable = pgTable(
  "security_audit_logs",
  {
    id: serial("id").primaryKey(),
    actorUserId: integer("actor_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    targetUserId: integer("target_user_id"),
    action: text("action").notNull(),
    details: jsonb("details").notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
).enableRLS();
