import {
  cashSessionsTable,
  customersTable,
  financeAccountsTable,
  financeTransactionLinesTable,
  financeTransactionsTable,
  posSaleReturnsTable,
  posSalesTable,
} from "@workspace/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";
import { ensureCustomerReceivableControlAccount } from "./finance-customer-ledger";
import { postFinanceTransaction } from "./finance-posting";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });

class ReturnCorrectionError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

function currentBusinessDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hebron",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

/**
 * Correct CASH -> CUSTOMER settlement only, with no inventory movement.
 * Reverse the cash journal, post the customer receivable credit and restore
 * the cash session in ONE DB transaction. Original return ID/items stay intact.
 */
export async function handleCorrectReturnCashToCustomer(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response> {
  try {
    const user = await getCurrentUser(db, request, env);
    if (!user) return json({ error: "يجب تسجيل الدخول" }, 401);
    if (!user.isAdmin && !user.isOwner) {
      return json({ error: "غير مصرح باستخدام نقطة البيع" }, 403);
    }

    const raw = await request.json().catch(() => null);
    if (!raw || Array.isArray(raw) || typeof raw !== "object") {
      throw new ReturnCorrectionError("بيانات التصحيح غير صالحة", 400);
    }
    const body = raw as Record<string, unknown>;
    const publicId = typeof body.publicId === "string"
      ? body.publicId.trim().toUpperCase()
      : "";
    const customerId = Number(body.customerId);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!/^MRET-[A-Z0-9_-]{1,75}$/.test(publicId)) {
      throw new ReturnCorrectionError("رقم المردود غير صالح", 400);
    }
    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      throw new ReturnCorrectionError("اختر حساب الزبون الصحيح", 400);
    }
    if (reason.length < 3 || reason.length > 300) {
      throw new ReturnCorrectionError("اكتب سبب التصحيح (3-300 حرف)", 400);
    }

    const result = await db.transaction(async (tx) => {
      const [saleReturn] = await tx.select().from(posSaleReturnsTable)
        .where(eq(posSaleReturnsTable.publicId, publicId)).for("update");
      if (!saleReturn) throw new ReturnCorrectionError("المردود غير موجود", 404);
      if (saleReturn.status !== "completed") {
        throw new ReturnCorrectionError("لا يمكن تعديل مردود ملغى أو غير مكتمل");
      }
      if (saleReturn.refundMethod === "customer" &&
          saleReturn.customerId === customerId) {
        return { alreadyCorrected: true, saleReturn };
      }
      if (saleReturn.refundMethod !== "cash") {
        throw new ReturnCorrectionError("التصحيح متاح فقط للمردود النقدي إلى حساب الزبون");
      }
      const [customer] = await tx.select().from(customersTable)
        .where(eq(customersTable.id, customerId)).limit(1);
      if (!customer) throw new ReturnCorrectionError("الزبون غير موجود", 404);

      if (saleReturn.originalSaleId !== null) {
        const [originalSale] = await tx.select({
          customerId: posSalesTable.customerId,
        }).from(posSalesTable)
          .where(eq(posSalesTable.id, saleReturn.originalSaleId)).limit(1);
        if (originalSale?.customerId !== null &&
            originalSale?.customerId !== undefined &&
            originalSale.customerId !== customerId) {
          throw new ReturnCorrectionError("يجب اختيار نفس حساب الزبون المرتبط بالفاتورة");
        }
      }

      const [session] = await tx.select().from(cashSessionsTable)
        .where(and(
          eq(cashSessionsTable.id, saleReturn.cashSessionId),
          eq(cashSessionsTable.status, "open"),
        )).for("update");
      if (!session || session.businessDate !== currentBusinessDate()) {
        throw new ReturnCorrectionError("يُسمح بالتصحيح قبل إغلاق جلسة الصندوق في نفس اليوم فقط");
      }
      if (session.currencyCode !== "ILS") {
        throw new ReturnCorrectionError("جلسة الصندوق ليست بالشيكل");
      }

      const amount = saleReturn.refundAmountMinor;
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new ReturnCorrectionError("مبلغ المردود غير صالح");
      }
      const expectedBefore = session.expectedBalanceMinor ?? session.openingBalanceMinor;
      const expectedAfter = expectedBefore + amount;
      if (!Number.isSafeInteger(expectedAfter) || expectedAfter > 2_147_483_647) {
        throw new ReturnCorrectionError("رصيد الصندوق الناتج غير صالح");
      }

      const [originalCash] = await tx.select().from(financeTransactionsTable)
        .where(and(
          eq(financeTransactionsTable.sourceType, "pos_sale_return"),
          eq(financeTransactionsTable.sourceId, String(saleReturn.id)),
          eq(financeTransactionsTable.sourceEvent, "cash_refund"),
          eq(financeTransactionsTable.status, "posted"),
        )).for("update").limit(1);
      if (!originalCash || originalCash.cashSessionId !== session.id) {
        throw new ReturnCorrectionError("قيد المردود النقدي غير موجود أو لا يتبع جلسة الصندوق");
      }

      const originalLines = await tx.select().from(financeTransactionLinesTable)
        .where(eq(financeTransactionLinesTable.transactionId, originalCash.id))
        .orderBy(asc(financeTransactionLinesTable.lineNumber));
      const [cashAccount] = await tx.select().from(financeAccountsTable)
        .where(eq(financeAccountsTable.code, `CASH_${saleReturn.registerKey.toUpperCase()}`))
        .limit(1);
      if (!cashAccount || originalLines.length !== 2 ||
          originalLines.filter((line) =>
            line.accountId === cashAccount.id &&
            line.creditMinor === amount &&
            line.debitMinor === 0
          ).length !== 1) {
        throw new ReturnCorrectionError("قيد الصندوق لا يطابق مبلغ المردود؛ تم إيقاف التصحيح");
      }

      const customerControl = await ensureCustomerReceivableControlAccount(tx);
      const [salesAccountExisting] = await tx.select().from(financeAccountsTable)
        .where(eq(financeAccountsTable.code, "POS_SALES_ON_ACCOUNT")).limit(1);
      let salesAccount = salesAccountExisting;
      if (!salesAccount) {
        const inserted = await tx.insert(financeAccountsTable).values({
          code: "POS_SALES_ON_ACCOUNT",
          name: "مبيعات نقطة البيع على الحساب",
          accountType: "income",
          currencyCode: "ILS",
          status: "active",
        }).onConflictDoNothing().returning();
        if (inserted[0]) {
          salesAccount = inserted[0];
        } else {
          const [retry] = await tx.select().from(financeAccountsTable)
            .where(eq(financeAccountsTable.code, "POS_SALES_ON_ACCOUNT")).limit(1);
          if (!retry) throw new Error("POS_SALES_ACCOUNT_MISSING");
          salesAccount = retry;
        }
      }

      const now = new Date();
      const journalDate = saleReturn.businessDate;
      await postFinanceTransaction(tx, {
        publicId: `FIN-RET-CORR-${saleReturn.id}-CASH-${randomUUID().slice(0, 8).toUpperCase()}`,
        idempotencyKey: `pos-sale-return:${saleReturn.id}:cash-to-customer:cash-reversal`,
        businessDate: journalDate,
        transactionType: "reversal",
        sourceType: "pos_sale_return",
        sourceId: String(saleReturn.id),
        sourceEvent: "cash_refund_correction_void",
        cashSessionId: session.id,
        createdByUserId: user.id,
        notes: `عكس دفع المردود النقدي ${publicId} لتصحيح الاسترداد إلى حساب الزبون: ${reason}`,
        lines: originalLines.map((line) => ({
          accountId: line.accountId,
          customerId: line.customerId,
          employeeId: line.employeeId,
          supplierId: line.supplierId,
          debitMinor: line.creditMinor,
          creditMinor: line.debitMinor,
          memo: `تصحيح ${publicId}`,
        })),
      });
      await postFinanceTransaction(tx, {
        publicId: `FIN-RET-AR-CORR-${saleReturn.id}-${randomUUID().slice(0, 8).toUpperCase()}`,
        idempotencyKey: `pos-sale-return:${saleReturn.id}:customer-credit`,
        businessDate: journalDate,
        transactionType: "refund",
        sourceType: "pos_sale_return",
        sourceId: String(saleReturn.id),
        sourceEvent: "customer_credit",
        cashSessionId: session.id,
        createdByUserId: user.id,
        notes: `تصحيح مردود ${publicId} إلى حساب الزبون ${customer.name}: ${reason}`,
        lines: [
          { accountId: salesAccount.id, debitMinor: amount, creditMinor: 0,
            memo: `تصحيح طريقة الاسترداد للمردود ${publicId}` },
          { accountId: customerControl.id, customerId: customer.id, debitMinor: 0, creditMinor: amount,
            memo: `رصيد مردود للزبون ${customer.name}` },
        ],
      });

      await tx.update(financeTransactionsTable)
        .set({ status: "reversed", updatedAt: now })
        .where(eq(financeTransactionsTable.id, originalCash.id));
      const updatedSession = await tx.update(cashSessionsTable)
        .set({ expectedBalanceMinor: expectedAfter, updatedAt: now })
        .where(and(eq(cashSessionsTable.id, session.id), eq(cashSessionsTable.status, "open")))
        .returning({ id: cashSessionsTable.id });
      if (!updatedSession[0]) throw new ReturnCorrectionError("جلسة الصندوق أُغلقت أثناء التصحيح");

      const [updatedReturn] = await tx.update(posSaleReturnsTable)
        .set({ refundMethod: "customer", customerId, updatedAt: now })
        .where(and(eq(posSaleReturnsTable.id, saleReturn.id),
          eq(posSaleReturnsTable.status, "completed")))
        .returning();
      if (!updatedReturn) throw new ReturnCorrectionError("تعذر حفظ تصحيح المردود");

      return { alreadyCorrected: false, saleReturn: updatedReturn };
    });

    return json({
      ok: true,
      alreadyCorrected: result.alreadyCorrected,
      publicId: result.saleReturn.publicId,
      refundMethod: result.saleReturn.refundMethod,
      customerId: result.saleReturn.customerId,
      refundAmountMinor: result.saleReturn.refundAmountMinor,
    });
  } catch (error) {
    if (error instanceof ReturnCorrectionError) {
      return json({ error: error.message }, error.status);
    }
    console.error("POS_RETURN_CASH_TO_CUSTOMER_CORRECTION_FAILED", error);
    return json({ error: "تعذر تصحيح طريقة استرداد المردود" }, 500);
  }
}
