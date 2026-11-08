import {
  deliveryCompanySettlementItemsTable,
  exchangeDocumentsTable,
  financeTransactionsTable,
  orderFailedDeliveryReturnsTable,
  ordersTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import type { openDb } from "./db";
import { cancelOrderAndRestoreStockInTransaction, OrderEditError } from "./order-stock";
import { LOCAL_NABLUS_DELIVERY_LABEL, STORE_PICKUP_LABEL } from "./order-service";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

export class FailedDeliveryReturnError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

/**
 * Mark a COD order as refused while the delivery company physically holds the parcel.
 * This deliberately does NOT restore saleable stock, cancel costs, settle courier
 * receivables, or create journals. The original outbound delivery charge stays intact.
 * The return leg costs exactly 0.
 */
export async function reportFailedDeliveryReturn(
  db: Db, orderId: number, userId: number, reason: string,
) {
  const safeReason = reason.trim();
  if (safeReason.length < 3 || safeReason.length > 500)
    throw new FailedDeliveryReturnError("يجب إدخال سبب رجوع الطرد (3 إلى 500 حرف)", 400);

  return db.transaction(async tx => {
    // Lock the order first in all workflows to prevent double state changes.
    const [order] = await tx.select().from(ordersTable)
      .where(eq(ordersTable.id, orderId)).for("update");
    if (!order) throw new FailedDeliveryReturnError("الطلب غير موجود", 404);
    const [existing] = await tx.select().from(orderFailedDeliveryReturnsTable)
      .where(eq(orderFailedDeliveryReturnsTable.orderId, orderId)).limit(1);
    if (existing) {
      if (existing.status === "pending" && order.status === "returning")
        return { alreadyReported: true, order, returnParcel: existing };
      throw new FailedDeliveryReturnError("تم تسجيل استلام أو معالجة هذا الطرد الراجع مسبقًا");
    }
    if (order.status !== "delivering")
      throw new FailedDeliveryReturnError("لا يمكن تسجيل رجوع الطرد إلا من حالة قيد التوصيل");
    if (order.mergedIntoOrderId !== null)
      throw new FailedDeliveryReturnError("لا يمكن معالجة طلب مدمج بشكل منفصل");
    if (order.fulfillmentMethod !== "delivery" ||
        !order.deliveryCompanyId ||
        order.shippingZone === STORE_PICKUP_LABEL ||
        order.shippingZone === LOCAL_NABLUS_DELIVERY_LABEL) {
      throw new FailedDeliveryReturnError("هذه الميزة لطرود شركات التوصيل الخارجية فقط");
    }
    if (order.paymentMethod !== "cod" || order.paymentStatus !== "pending")
      throw new FailedDeliveryReturnError("هذا الطلب ليس دفعًا عند الاستلام غير محصل؛ راجع المالية أولاً");

    const postedFinance = await tx.select({ id: financeTransactionsTable.id })
      .from(financeTransactionsTable)
      .where(and(
        eq(financeTransactionsTable.sourceType, "web_order"),
        eq(financeTransactionsTable.sourceId, String(orderId)),
        eq(financeTransactionsTable.status, "posted"),
      )).limit(1);
    if (postedFinance.length)
      throw new FailedDeliveryReturnError("يوجد قيد مالي مرحّل لهذا الطلب؛ يلزم فحصه قبل إرجاع الطرد");

    const settled = await tx.select({ id: deliveryCompanySettlementItemsTable.id })
      .from(deliveryCompanySettlementItemsTable)
      .where(and(
        eq(deliveryCompanySettlementItemsTable.orderId, orderId),
        eq(deliveryCompanySettlementItemsTable.status, "posted"),
      )).limit(1);
    if (settled.length)
      throw new FailedDeliveryReturnError("تم إدراج الطرد في تسوية شركة التوصيل؛ يلزم مراجعته أولاً");

    const linkedExchange = await tx.select({ id: exchangeDocumentsTable.id })
      .from(exchangeDocumentsTable)
      .where(and(
        eq(exchangeDocumentsTable.sourceType, "online_order"),
        eq(exchangeDocumentsTable.replacementOrderId, orderId),
        eq(exchangeDocumentsTable.status, "completed"),
      )).limit(1);
    if (linkedExchange.length)
      throw new FailedDeliveryReturnError("هذا طرد تبديل؛ استخدم مسار مرتجعات التبديل بدلًا من الراجع العادي");

    const now = new Date();
    const [returnParcel] = await tx.insert(orderFailedDeliveryReturnsTable)
      .values({
        orderId, status: "pending", reason: safeReason,
        returnDeliveryCostMinor: 0,
        reportedAt: now, reportedByUserId: userId, updatedAt: now,
      }).returning();
    const [updated] = await tx.update(ordersTable)
      .set({ status: "returning" })
      .where(eq(ordersTable.id, orderId)).returning();
    return { alreadyReported: false, order: updated, returnParcel };
  });
}

/**
 * Receipt is the ONLY point that cancels the refused sale and restores original
 * stock plus exact historical cost. Both receipt audit and reversal are committed
 * atomically, under the original order lock. Duplicate requests are read-only.
 */
export async function receiveFailedDeliveryReturn(db: Db, orderId: number, userId: number) {
  return db.transaction(async tx => {
    const [order] = await tx.select().from(ordersTable)
      .where(eq(ordersTable.id, orderId)).for("update");
    if (!order) throw new FailedDeliveryReturnError("الطلب غير موجود", 404);
    const [returnParcel] = await tx.select().from(orderFailedDeliveryReturnsTable)
      .where(eq(orderFailedDeliveryReturnsTable.orderId, orderId)).for("update");
    if (!returnParcel) throw new FailedDeliveryReturnError("الطلب ليس طردًا راجعًا مسجّلًا", 404);
    if (returnParcel.status === "received" && order.status === "cancelled") {
      return { alreadyReceived: true, order, returnParcel };
    }
    if (returnParcel.status !== "pending" || order.status !== "returning")
      throw new FailedDeliveryReturnError("حالة الطرد الراجع غير متطابقة؛ تم منع ترحيل المخزون");

    // Revalidate against intervening finance/settlement changes at receipt
    // time too. Neither a paid invoice nor a courier settlement can be
    // silently undone by an inventory-only cancellation.
    const postedFinance = await tx.select({ id: financeTransactionsTable.id })
      .from(financeTransactionsTable)
      .where(and(
        eq(financeTransactionsTable.sourceType, "web_order"),
        eq(financeTransactionsTable.sourceId, String(orderId)),
        eq(financeTransactionsTable.status, "posted"),
      )).limit(1);
    if (postedFinance.length)
      throw new FailedDeliveryReturnError("ظهر قيد مالي مرحّل بعد تسجيل الرجوع؛ يلزم تسوية محاسبية قبل الاستلام");
    const settlement = await tx.select({ id: deliveryCompanySettlementItemsTable.id })
      .from(deliveryCompanySettlementItemsTable)
      .where(and(
        eq(deliveryCompanySettlementItemsTable.orderId, orderId),
        eq(deliveryCompanySettlementItemsTable.status, "posted"),
      )).limit(1);
    if (settlement.length)
      throw new FailedDeliveryReturnError("الطلب أُدرج في تسوية شركة التوصيل؛ يجب مراجعة التسوية أولًا");

    // Existing cancellation restores the exact historical item stock and
    // cost, with strict validation. One transaction protects both receipt
    // audit and stock ledger; on any error all changes roll back together.
    const cancelled = await cancelOrderAndRestoreStockInTransaction(
      tx, orderId, ["returning"], userId, undefined, false, true,
    );
    if (cancelled.kind !== "updated")
      throw new FailedDeliveryReturnError("تعذّر إلغاء الطلب وإرجاع القطع للمخزون");
    const now = new Date();
    const [updatedReturn] = await tx.update(orderFailedDeliveryReturnsTable)
      .set({ status: "received", receivedAt: now, receivedByUserId: userId, updatedAt: now })
      .where(eq(orderFailedDeliveryReturnsTable.orderId, orderId)).returning();
    return { alreadyReceived: false, order: cancelled.order, returnParcel: updatedReturn };
  });
}
