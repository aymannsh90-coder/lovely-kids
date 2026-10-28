import {
  cashSessionsTable,
  financeAccountsTable,
  financeTransactionsTable,
  ordersTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { openDb } from "./db";
import { postFinanceTransaction } from "./finance-posting";
import { LOCAL_NABLUS_DELIVERY_LABEL } from "./order-service";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

export const LOCAL_COURIER_CASH_EVENT = "local_courier_cash_handover";
export const LOCAL_COURIER_ADVANCE_ACCOUNT = "LOCAL_NABLUS_COURIER_CASH_ADVANCE";

export class LocalCourierCashError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

function businessDate(): string {
  const fields = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const v = Object.fromEntries(fields.map(({ type, value }) => [type, value]));
  return `${v.year}-${v.month}-${v.day}`;
}

export async function getLocalCourierCashReceipt(
  tx: any,
  orderId: number,
): Promise<typeof financeTransactionsTable.$inferSelect | null> {
  const matches = await tx
    .select()
    .from(financeTransactionsTable)
    .where(and(
      eq(financeTransactionsTable.sourceType, "web_order"),
      eq(financeTransactionsTable.sourceId, String(orderId)),
      eq(financeTransactionsTable.sourceEvent, LOCAL_COURIER_CASH_EVENT),
      eq(financeTransactionsTable.status, "posted"),
    ))
    .limit(1);
  return matches[0] ?? null;
}

/**
 * Courier hands over the value of GOODS, not the customer's delivery fee.
 * The money is an advance until the parcel is actually delivered:
 *   Dr CASH_MAIN / Cr LOCAL_NABLUS_COURIER_CASH_ADVANCE.
 *
 * The subsequent delivery completion clears the advance against the sale.
 * No second cash movement is created at completion. The order row lock and
 * source-event uniqueness prevent duplicate cash receipts.
 */
export async function recordLocalCourierCashHandover(
  db: Db,
  orderId: number,
  actorId: number,
) {
  return db.transaction(async (tx) => {
    const orderRows = await tx
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .for("update");
    const order = orderRows[0];
    if (!order) throw new LocalCourierCashError("الطلب غير موجود", 404);

    const existing = await getLocalCourierCashReceipt(tx, orderId);
    if (existing) {
      return {
        alreadyReceived: true,
        amountMinor: (order.totalPrice - (order.shippingCost ?? 0)) * 100,
        receivedAt: existing.createdAt.toISOString(),
      };
    }

    if (order.shippingZone !== LOCAL_NABLUS_DELIVERY_LABEL ||
        (order.paymentMethod !== "cod" && order.paymentMethod !== "local_store_cash") ||
        !["confirmed", "delivering"].includes(order.status) ||
        order.mergedIntoOrderId !== null) {
      throw new LocalCourierCashError(
        "قبض المندوب النقدي متاح لطلبات ديلفري نابلس المؤكدة وغير المسلّمة فقط",
      );
    }

    // A null courier cost means the final rate has not been approved.
    if (order.deliveryCompanyCost === null ||
        !Number.isSafeInteger(order.deliveryCompanyCost) ||
        order.deliveryCompanyCost < 0) {
      throw new LocalCourierCashError("أكد أجرة المندوب وسعر الديلفري أولاً");
    }

    const products = order.totalPrice - (order.shippingCost ?? 0);
    if (!Number.isSafeInteger(products) || products <= 0) {
      throw new LocalCourierCashError("قيمة البضاعة النقدية غير صالحة");
    }
    const amountMinor = products * 100;
    if (!Number.isSafeInteger(amountMinor) || amountMinor > 2_147_483_647) {
      throw new LocalCourierCashError("مبلغ القبض خارج الحد المسموح");
    }

    const date = businessDate();
    const sessions = await tx
      .select()
      .from(cashSessionsTable)
      .where(and(
        eq(cashSessionsTable.registerKey, "main"),
        eq(cashSessionsTable.status, "open"),
      ))
      .for("update");
    const session = sessions[0];
    if (!session || session.businessDate !== date || session.currencyCode !== "ILS") {
      throw new LocalCourierCashError(
        "افتح جلسة الصندوق الرئيسي لليوم الحالي بالشيكل قبل تسجيل قبض المندوب",
      );
    }

    const currentBalance = session.expectedBalanceMinor ?? session.openingBalanceMinor;
    const expectedBalance = currentBalance + amountMinor;
    if (!Number.isSafeInteger(expectedBalance) || expectedBalance > 2_147_483_647) {
      throw new LocalCourierCashError("رصيد الصندوق الناتج غير صالح");
    }

    const ensureAccount = async (code: string, name: string, accountType: "asset" | "liability") => {
      const prior = await tx.select().from(financeAccountsTable)
        .where(eq(financeAccountsTable.code, code)).limit(1);
      if (prior[0]) return prior[0];
      const inserted = await tx.insert(financeAccountsTable).values({
        code, name, accountType, currencyCode: "ILS", status: "active",
      }).onConflictDoNothing().returning();
      if (inserted[0]) return inserted[0];
      const retried = await tx.select().from(financeAccountsTable)
        .where(eq(financeAccountsTable.code, code)).limit(1);
      if (!retried[0]) throw new Error("LOCAL_COURIER_ACCOUNT_CREATION_FAILED");
      return retried[0];
    };

    const cash = await ensureAccount("CASH_MAIN", "الصندوق الرئيسي", "asset");
    const advance = await ensureAccount(
      LOCAL_COURIER_ADVANCE_ACCOUNT,
      "مبالغ مندوب ديلفري نابلس المقبوضة مقدماً",
      "liability",
    );

    const posted = await postFinanceTransaction(tx, {
      publicId: `FIN-${date.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
      idempotencyKey: `order:${orderId}:local-courier-cash`,
      businessDate: date,
      transactionType: "receipt",
      sourceType: "web_order",
      sourceId: String(orderId),
      sourceEvent: LOCAL_COURIER_CASH_EVENT,
      cashSessionId: session.id,
      createdByUserId: actorId,
      notes: `قبض قيمة البضاعة فقط من مندوب ديلفري نابلس - طلب #${orderId}`,
      lines: [
        { accountId: cash.id, debitMinor: amountMinor,
          memo: `نقد من مندوب ديلفري نابلس للطلب #${orderId}` },
        { accountId: advance.id, creditMinor: amountMinor,
          memo: `عربون بضاعة طلب ديلفري نابلس #${orderId}` },
      ],
    });

    // This is not expected under the order row lock, but avoid ever adding
    // a cash balance for an idempotent duplicate transaction.
    if (posted.alreadyPosted) {
      return {
        alreadyReceived: true,
        amountMinor,
        receivedAt: posted.transaction.createdAt.toISOString(),
      };
    }

    const updated = await tx.update(cashSessionsTable).set({
      expectedBalanceMinor: expectedBalance,
      updatedAt: new Date(),
    }).where(and(
      eq(cashSessionsTable.id, session.id),
      eq(cashSessionsTable.status, "open"),
    )).returning({ id: cashSessionsTable.id });

    if (!updated[0]) throw new LocalCourierCashError("جلسة الصندوق أُغلقت قبل تثبيت القبض");

    return {
      alreadyReceived: false,
      amountMinor,
      receivedAt: posted.transaction.createdAt.toISOString(),
    };
  });
}
