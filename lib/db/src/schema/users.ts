import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  passwordHash: true,
  isAdmin: true,
}).extend({
  phone: z.string().min(6),
  name: z.string().min(1),
});

export const registerSchema = insertUserSchema.extend({
  password: z.string().min(4),
});

export const loginSchema = z.object({
  phone: z.string().min(6),
  password: z.string().min(1),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type DbUser = typeof usersTable.$inferSelect;
