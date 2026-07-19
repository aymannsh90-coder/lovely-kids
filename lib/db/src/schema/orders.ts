import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerAddress: text("customer_address").notNull(),
  items: jsonb("items").notNull(),
  totalPrice: integer("total_price").notNull(),
  shippingZone: text("shipping_zone"),
  shippingCost: integer("shipping_cost"),
  status: text("status").notNull().default("new"),
  notes: text("notes"),
  paymentMethod: text("payment_method").notNull().default("cod"),
  paymentStatus: text("payment_status").notNull().default("pending"),
  paymentProof: text("payment_proof"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  userId: true,
  createdAt: true,
}).extend({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      price: z.number(),
      quantity: z.number(),
      image: z.string().optional(),
      size: z.string().optional(),
      color: z.string().optional(),
    })
  ),
  paymentMethod: z.enum(["cod", "bank_transfer"]).optional(),
  paymentStatus: z.string().optional(),
  paymentProof: z.string().optional(),
  shippingZone: z.string().optional(),
  shippingCost: z.number().optional(),
});

export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
