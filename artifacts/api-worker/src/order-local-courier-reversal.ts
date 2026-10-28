import {
  cashSessionsTable,
  exchangeDocumentsTable,
  financeAccountsTable,
  financeTransactionLinesTable,
  financeTransactionsTable,
  ordersTable,
} from "@workspace/db/schema";
import { and, eq, or, asc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { openDb } from "./db";
import { postFinanceTransaction } from "./finance-posting";
import { LOCAL_NABLUS_DELIVERY_LABEL } from "./order-service";
import { LOCAL_COURIER_CASH_EVENT } from "./order-local-courier";
import { cancelOrderAndRestoreStockInTransaction } from "./order-stock";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

export const LOCAL_COURIER_REVERSE_CASH_EVENT = "local_courier_reverse_cash";
export const LOCAL_COURIER_REVERSE_SALE_EVENT = "local_courier_reverse_sale";

export class LocalCourierReversalError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

function businessDate() {
  const v = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return `${v.year}-${v.month}-${v.day}`;
}

type ReversalConfirmation = {
  reason: string;
  goodsReturned: boolean;
  courierRefunded: boolean;
  noCourierFeeOwed: boolean;
};

/**
 * An accounting cancellation, not a deletion: two reversing journal entries
 * (if the sale was already posted) plus the exact inventory/cost restoration,
 * all in ONE database transaction. The refund moves current-register cash;
 * old/closed cash sessions are never edited.
 */
export async function reverseFailedLocalCourierOrder(
  db: Db,
  orderId: number,
  userId: number,
  input: ReversalConfirmation,
) {
  const reason = input.reason.trim();
  if (
    reason.length < 3 || reason.length > 500 ||
    input.goodsReturned !== true ||
    input.courierRefunded !== true ||
    input.noCourierFeeOwed !== true
  ) {
    throw new LocalCourierReversalError(
      "تأكد من رجوع الطرد ورد قيمة البضاعة للمندوب وعدم وجود أجرة توصيل مستحقة، واكتب سبب الإلغاء",
      400,
    );
  }

  return db.transaction(async (tx) => {
    const orderRows = await tx.select().from(ordersTable)
      .where(eq(ordersTable.id, orderId)).for("update");
    const order = orderRows[0];
    if (!order) throw new LocalCourierReversalError("الطلب غير موجود", 404);
    if (
      order.shippingZone !== LOCAL_NABLUS_DELIVERY_LABEL ||
      (order.paymentMethod !== "cod" && order.paymentMethod !== "local_store_cash") ||
      !["confirmed", "delivering", "done"].includes(order.status) ||
      order.mergedIntoOrderId !== null
    ) {
      throw new LocalCourierReversalError("الإلغاء المالي مخصص لطلبات ديلفري نابلس النقدية فقط");
    }

    // Never reverse a replacement order or one participating in a live exchange.
    const exchangeLinks = await tx.select({ id: exchangeDocumentsTable.id })
      .from(exchangeDocumentsTable)
      .where(and(
        eq(exchangeDocumentsTable.status, "completed"),
        or(
          eq(exchangeDocumentsTable.originalOrderId, orderId),
          eq(exchangeDocumentsTable.replacementOrderId, orderId),
        ),
      )).limit(1);
    if (exchangeLinks.length > 0) {
      throw new LocalCourierReversalError("الطلب مرتبط بتبديل؛ يلزم تسوية التبديل أولاً");
    }

    const postings = await tx.select().from(financeTransactionsTable)
      .where(and(
        eq(financeTransactionsTable.sourceType, "web_order"),
        eq(financeTransactionsTable.sourceId, String(orderId)),
      )).for("update");

    if (postings.some((p) =>
      p.sourceEvent === LOCAL_COURIER_REVERSE_CASH_EVENT ||
      p.sourceEvent === LOCAL_COURIER_REVERSE_SALE_EVENT
    )) {
      throw new LocalCourierReversalError("سبق عكس الطلب مالياً ولا يمكن تنفيذ العكس مرتين");
    }

    const unexpected = postings.filter((p) =>
      p.status === "posted" &&
      p.sourceEvent !== LOCAL_COURIER_CASH_EVENT &&
      p.sourceEvent !== "done"
    );
    if (unexpected.length > 0) {
      throw new LocalCourierReversalError("للطلب قيود مالية إضافية؛ يلزم مراجعتها قبل العكس");
    }

    const cashReceipts = postings.filter((p) =>
      p.sourceEvent === LOCAL_COURIER_CASH_EVENT && p.status === "posted"
    );
    const sales = postings.filter((p) =>
      p.sourceEvent === "done" && p.status === "posted"
    );
    if (
      cashReceipts.length !== 1 ||
      !cashReceipts[0]!.cashSessionId ||
      (order.status === "done" ? sales.length !== 1 : sales.length !== 0)
    ) {
      throw new LocalCourierReversalError("القيود الأصلية للقبض والتسليم غير متطابقة؛ العكس موقوف لحماية الحسابات");
    }

    const receipt = cashReceipts[0]!;
    const goodsMinor = (order.totalPrice - (order.shippingCost ?? 0)) * 100;
    if (!Number.isSafeInteger(goodsMinor) || goodsMinor <= 0 || goodsMinor > 2_147_483_647) {
      throw new LocalCourierReversalError("قيمة البضاعة المطلوب ردها غير صالحة");
    }

    const date = businessDate();
    const sessions = await tx.select().from(cashSessionsTable)
      .where(and(
        eq(cashSessionsTable.registerKey, "main"),
        eq(cashSessionsTable.status, "open"),
      )).for("update");
    const session = sessions[0];
    if (!session || session.businessDate !== date || session.currencyCode !== "ILS") {
      throw new LocalCourierReversalError(
        "يجب فتح الصندوق الرئيسي لليوم الحالي بالشيكل لتسجيل رد المبلغ للمندوب",
      );
    }
    const currentBalance = session.expectedBalanceMinor ?? session.openingBalanceMinor;
    const expectedBalance = currentBalance - goodsMinor;
    if (!Number.isSafeInteger(expectedBalance) || expectedBalance < 0) {
      throw new LocalCourierReversalError(
        "رصيد الصندوق الحالي لا يكفي لرد قيمة البضاعة للمندوب",
      );
    }

    const cashAccounts = await tx.select({ id: financeAccountsTable.id })
      .from(financeAccountsTable)
      .where(eq(financeAccountsTable.code, "CASH_MAIN")).limit(1);
    const cashAccountId = cashAccounts[0]?.id;
    if (!cashAccountId) throw new LocalCourierReversalError("حساب الصندوق الرئيسي غير موجود");

    const readLines = async (id: number) => tx.select()
      .from(financeTransactionLinesTable)
      .where(eq(financeTransactionLinesTable.transactionId, id))
      .orderBy(asc(financeTransactionLinesTable.lineNumber));

    const cashLines = await readLines(receipt.id);
    const originalCash = cashLines.filter((line) => line.accountId === cashAccountId);
    if (
      cashLines.length < 2 ||
      originalCash.length !== 1 ||
      originalCash[0]!.debitMinor !== goodsMinor ||
      originalCash[0]!.creditMinor !== 0
    ) {
      throw new LocalCourierReversalError("قيد القبض الأصلي لا يطابق قيمة البضاعة");
    }

    const reversePosting = async (
      original: typeof financeTransactionsTable.$inferSelect,
      originalLines: typeof cashLines,
      event: string,
      label: string,
      cashSessionId: number | null,
    ) => {
      if (originalLines.length < 2) {
        throw new LocalCourierReversalError("لا يمكن عكس قيد مالي دون تفاصيل");
      }
      const result = await postFinanceTransaction(tx, {
        publicId: `FIN-${date.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
        idempotencyKey: `order:${orderId}:${event}`,
        businessDate: date,
        transactionType: "reversal",
        sourceType: "web_order",
        sourceId: String(orderId),
        sourceEvent: event,
        cashSessionId,
        notes: `${label} للطلب #${orderId} — القيد الأصلي ${original.publicId} — السبب: ${reason}`,
        createdByUserId: userId,
        lines: originalLines.map((line) => ({
          accountId: line.accountId,
          customerId: line.customerId,
          employeeId: line.employeeId,
          supplierId: line.supplierId,
          debitMinor: line.creditMinor,
          creditMinor: line.debitMinor,
          memo: `عكس: ${line.memo ?? original.publicId}`,
        })),
      });
      if (result.alreadyPosted) {
        throw new LocalCourierReversalError("القيد العكسي مسجل مسبقًا");
      }
      return result;
    };

    // Sale reverses revenue, actual courier cost, and courier balances;
    // cash receipt reverses the exact physical money handover.
    if (sales.length === 1) {
      await reversePosting(
        sales[0]!, await readLines(sales[0]!.id),
        LOCAL_COURIER_REVERSE_SALE_EVENT,
        "عكس مبيعات وديلفري طلب مرفوض", null,
      );
    }
    await reversePosting(
      receipt, cashLines,
      LOCAL_COURIER_REVERSE_CASH_EVENT,
      "رد قيمة البضاعة نقداً للمندوب بعد رجوع الطرد", session.id,
    );

    // Reuse the same cost/variant inventory restoration as a normal cancellation.
    // Only this audited flow may cancel an already completed order with cash receipt.
    const stockResult = await cancelOrderAndRestoreStockInTransaction(
      tx,
      orderId,
      ["confirmed", "delivering", "done"],
      userId,
      undefined,
      true,
    );
    if (stockResult.kind !== "updated" || !stockResult.order) {
      throw new LocalCourierReversalError("تعذر إلغاء الطلب وإعادة المخزون");
    }

    const nextSession = await tx.update(cashSessionsTable).set({
      expectedBalanceMinor: expectedBalance,
      updatedAt: new Date(),
    }).where(and(
      eq(cashSessionsTable.id, session.id),
      eq(cashSessionsTable.status, "open"),
    )).returning({ id: cashSessionsTable.id });
    if (!nextSession[0]) throw new LocalCourierReversalError("أُغلق الصندوق أثناء إتمام العكس");

    const finalOrder = await tx.update(ordersTable)
      .set({ paymentStatus: "pending" })
      .where(eq(ordersTable.id, orderId)).returning();
    if (!finalOrder[0]) throw new LocalCourierReversalError("تعذر تثبيت حالة إلغاء الطلب");

    return {
      order: finalOrder[0],
      cashRefundMinor: goodsMinor,
      reversedSale: sales.length === 1,
      reason,
    };
  });
}
