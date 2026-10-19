import { boolean, pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { deliveryCompaniesTable } from "./delivery-companies";
import { discountCodesTable } from "./discount-codes";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerAddress: text("customer_address").notNull(),
  items: jsonb("items").notNull(),
  totalPrice: integer("total_price").notNull(),
  shippingZone: text("shipping_zone"),

  // Amount actually charged to the customer for delivery.
  // May be zero during a free-delivery promotion.
  shippingCost: integer("shipping_cost"),

  // Snapshot of the regular delivery price at order time.
  // Kept separately so receipts can show a delivery promotion accurately
  // even if shipping settings change later.
  shippingOriginalCost: integer("shipping_original_cost"),
  shippingPromotionDiscount: integer("shipping_promotion_discount"),

  // Discount-code snapshot. The foreign key is optional on purpose:
  // historical receipts remain valid even if the admin later removes a code.
  discountCodeId: integer("discount_code_id").references(
    () => discountCodesTable.id,
    { onDelete: "set null" },
  ),
  discountCode: text("discount_code"),
  discountCodeLabel: text("discount_code_label"),
  discountCodePercent: integer("discount_code_percent"),
  discountCodeAmount: integer("discount_code_amount"),
  discountCodeStacksWithShippingPromotion: boolean(
    "discount_code_stacks_with_shipping_promotion",
  ),

  // delivery = courier company
  // pickup   = customer receives the order from the shop
  fulfillmentMethod: text("fulfillment_method"),

  deliveryCompanyId: integer("delivery_company_id")
    .references(() => deliveryCompaniesTable.id, {
      onDelete: "set null",
    }),

  // Real courier fee for this order, frozen when the order is dispatched.
  // Same unit as totalPrice/shippingCost (whole ILS, NOT minor units).
  // Example: West Bank actual courier cost = 19 ILS even when the
  // customer-facing shippingCost is 20 ILS or 0 ILS during a promotion.
  deliveryCompanyCost: integer("delivery_company_cost"),

  status: text("status").notNull().default("new"),

  // When several online orders are consolidated into one operational order,
  // source orders stay in the database for audit/history and point to the
  // surviving master order. Stock is NOT moved again during the merge.
  mergedIntoOrderId: integer("merged_into_order_id"),
  mergedAt: timestamp("merged_at"),
  mergedByUserId: integer("merged_by_user_id").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),

  notes: text("notes"),
  paymentMethod: text("payment_method").notNull().default("cod"),
  paymentStatus: text("payment_status").notNull().default("pending"),
  paymentProof: text("payment_proof"),
  printedAt: timestamp("printed_at"),
  printCount: integer("print_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}).enableRLS();

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  userId: true,
  printedAt: true,
  printCount: true,
  fulfillmentMethod: true,
  deliveryCompanyId: true,
  deliveryCompanyCost: true,
  shippingOriginalCost: true,
  shippingPromotionDiscount: true,
  discountCodeId: true,
  discountCodeLabel: true,
  discountCodePercent: true,
  discountCodeAmount: true,
  discountCodeStacksWithShippingPromotion: true,
  mergedIntoOrderId: true,
  mergedAt: true,
  mergedByUserId: true,
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
  discountCode: z.string().trim().max(80).optional(),
});

export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
