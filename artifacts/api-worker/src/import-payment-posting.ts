import {
  bankAccountsTable,
  financeAccountsTable,
  financeTransactionLinesTable,
  importCostCasesTable,
  importCostInvoicesTable,
  importCostAdvancePaymentsTable,
  suppliersTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { openDb, Env } from "./db";
import { postFinanceTransaction, type FinancePostingLineInput } from "./finance-posting";
import { planUsdSupplierAdvance, type UsdAdvancePlan } from "./import-payment-rules";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const MAX = 2_147_483_647;

export class ImportAdvanceError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function numberField(v: unknown, label: string, max = MAX): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > max) {
    throw new ImportAdvanceError(label + " غير صالح");
  }
  return v;
}

function requiredText(v: unknown, label: string, min: number, max: number): string {
  if (typeof v !== "string" || v.trim().length < min || v.trim().length > max) {
    throw new ImportAdvanceError(label + " غير صالح");
  }
  return v.trim();
}

export type SupplierAdvanceRequest = {
  caseId: number;
  invoiceRef: string;
  bankAccountId: number;
  usdAmountMinor: number;
  spotRateMicros: number;
  businessDate: string;
  idempotencyKey: string;
};
export function parseSupplierAdvanceRequest(body: unknown, caseId: number): SupplierAdvanceRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ImportAdvanceError("طلب دفعة المورد غير صالح");
  }
  const x = body as Record<string, unknown>;
  const date = requiredText(x.businessDate, "تاريخ الدفع", 10, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date + "T00:00:00Z")) ||
      new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) {
    throw new ImportAdvanceError("تاريخ الدفع غير صالح");
  }
  const spotRateMicros = numberField(x.spotRateMicros, "سعر صرف الدفع");
  if (spotRateMicros < 100_000 || spotRateMicros > 50_000_000) {
    throw new ImportAdvanceError("سعر صرف الدولار خارج النطاق المسموح");
  }
  return {
    caseId: numberField(caseId, "رقم الاستيراد"),
    invoiceRef: requiredText(x.invoiceRef, "مرجع فاتورة المورد", 1, 100),
    bankAccountId: numberField(x.bankAccountId, "الحساب البنكي"),
    usdAmountMinor: numberField(x.usdAmountMinor, "الدولارات المدفوعة"),
    spotRateMicros,
    businessDate: date,
    idempotencyKey: requiredText(x.idempotencyKey, "مفتاح منع تكرار الدفع", 8, 120),
  };
}

/**
 * The foreign USD bank must have a complete auditable ledger, and its
 * ILS book-value must equal the sum of debit minus credit across USD lines.
 * A missing currency triple is never guessed.
 */
async function usdBankBookBalances(tx: Tx, financeAccountId: number) {
  const rows = await tx.select({
    debitMinor: financeTransactionLinesTable.debitMinor,
    creditMinor: financeTransactionLinesTable.creditMinor,
    currencyCode: financeTransactionLinesTable.currencyCode,
    currencyAmountMinor: financeTransactionLinesTable.currencyAmountMinor,
    exchangeRateMicros: financeTransactionLinesTable.exchangeRateMicros,
  }).from(financeTransactionLinesTable)
    .where(eq(financeTransactionLinesTable.accountId, financeAccountId));
  let usd = 0n;
  let ils = 0n;
  for (const line of rows) {
    const base = line.debitMinor > 0 ? line.debitMinor : line.creditMinor;
    if (base === 0) continue;
    if (line.currencyCode !== "USD" || !line.currencyAmountMinor ||
        !line.exchangeRateMicros || line.currencyAmountMinor <= 0 ||
        line.exchangeRateMicros <= 0 ||
        ((BigInt(line.currencyAmountMinor) * BigInt(line.exchangeRateMicros) + 500000n) / 1000000n) !==
          BigInt(base)) {
      throw new ImportAdvanceError("سجل بنك الدولار غير مكتمل أو به حركة صرف غير متطابقة؛ لا يمكن تسجيل دفعة بأمان", 409);
    }
    const sign = line.debitMinor > 0 ? 1n : -1n;
    usd += sign * BigInt(line.currencyAmountMinor);
    ils += sign * BigInt(base);
  }
  if (usd <= 0n || ils <= 0n || usd > BigInt(MAX) || ils > BigInt(MAX)) {
    throw new ImportAdvanceError("الرصيد الدفتري المتاح للدولار غير صالح أو غير كافٍ", 409);
  }
  return { sourceUsdBalanceMinor: Number(usd), sourceIlsBookBalanceMinor: Number(ils) };
}

async function ensureIlsAccount(tx: Tx, code: string, name: string, accountType: "asset"|"income"|"expense") {
  const [existing] = await tx.select().from(financeAccountsTable)
    .where(eq(financeAccountsTable.code, code)).limit(1);
  if (existing) {
    if (existing.accountType !== accountType || existing.currencyCode !== "ILS" ||
      existing.status !== "active" || existing.linkedEntityId !== null) {
      throw new ImportAdvanceError("حساب " + name + " غير متوافق مع العملية", 409);
    }
    return existing;
  }
  await tx.insert(financeAccountsTable).values({
    code, name, accountType, currencyCode: "ILS", status: "active",
    notes: "حساب متعلق باستيراد البضاعة",
  }).onConflictDoNothing();
  const [created] = await tx.select().from(financeAccountsTable)
    .where(eq(financeAccountsTable.code, code)).limit(1);
  if (!created || created.accountType !== accountType || created.currencyCode !== "ILS" ||
      created.status !== "active") {
    throw new ImportAdvanceError("تعذر إنشاء حساب " + name, 409);
  }
  return created;
}

function ensureExactPlan(amountUsdMinor: number, bankBookIlsMinor: number, plan: UsdAdvancePlan) {
  // Freeze native USD and ILS bank movements from the same transfer.
  if (plan.paymentUsdMinor !== amountUsdMinor || plan.bankBookCreditIlsMinor !== bankBookIlsMinor ||
      plan.supplierAdvanceDebitIlsMinor + plan.realizedFxLossDebitIlsMinor !==
        plan.bankBookCreditIlsMinor + plan.realizedFxGainCreditIlsMinor) {
    throw new ImportAdvanceError("قيد الدولار غير متوازن", 409);
  }
}

/**
 * Protected posting endpoint service. Requires deployment-time feature flag.
 * BANK ONLY, USD ONLY. No cash session changes. No duplicate inventory entry.
 */
export async function postImportUsdSupplierAdvance(
  db: Db, env: Env, actorId: number, request: SupplierAdvanceRequest,
) {
  if (env.POS_IMPORT_FINANCIAL_POSTING_ENABLED !== "true") {
    throw new ImportAdvanceError("ترحيل دفعات الاستيراد غير مفعل بعد", 503);
  }

  return db.transaction(async (tx) => {
    const [theCase] = await tx.select().from(importCostCasesTable)
      .where(eq(importCostCasesTable.id, request.caseId)).for("update").limit(1);
    if (!theCase || theCase.status !== "draft") {
      throw new ImportAdvanceError("ملف الاستيراد غير موجود أو غير مفتوح", 409);
    }
    const [invoice] = await tx.select().from(importCostInvoicesTable)
      .where(and(eq(importCostInvoicesTable.caseId, request.caseId),
        eq(importCostInvoicesTable.lineRef, request.invoiceRef))).limit(1);
    if (!invoice) throw new ImportAdvanceError("فاتورة المورد غير موجودة في هذا الملف", 404);
    const [supplier] = await tx.select({ id: suppliersTable.id })
      .from(suppliersTable).where(eq(suppliersTable.id, invoice.supplierId)).limit(1);
    if (!supplier) throw new ImportAdvanceError("المورد غير موجود", 409);

    const [sameKey] = await tx.select().from(importCostAdvancePaymentsTable)
      .where(eq(importCostAdvancePaymentsTable.idempotencyKey, request.idempotencyKey)).limit(1);
    if (sameKey) {
      if (sameKey.caseId !== request.caseId || sameKey.invoiceId !== invoice.id ||
          sameKey.bankAccountId !== request.bankAccountId ||
          sameKey.usdAmountMinor !== request.usdAmountMinor ||
          sameKey.spotRateMicros !== request.spotRateMicros ||
          sameKey.businessDate !== request.businessDate ||
          !sameKey.financeTransactionId) {
        throw new ImportAdvanceError("مفتاح الدفع مستخدم لعملية مختلفة", 409);
      }
      return { ...sameKey, alreadyPosted: true };
    }

    // Serializes import payments to this bank. Independent bank writers are
    // separately guarded by their own account validation paths.
    const [bank] = await tx.select().from(bankAccountsTable)
      .where(and(eq(bankAccountsTable.id, request.bankAccountId),
        eq(bankAccountsTable.status, "active"))).for("update").limit(1);
    if (!bank || bank.currencyCode !== "USD") {
      throw new ImportAdvanceError("اختر حساب بنك فعّال بالدولار", 409);
    }
    const [bankGl] = await tx.select().from(financeAccountsTable)
      .where(and(eq(financeAccountsTable.id, bank.financeAccountId),
        eq(financeAccountsTable.status, "active"))).limit(1);
    if (!bankGl || bankGl.accountType !== "asset" || bankGl.currencyCode !== "USD" ||
        bankGl.linkedEntityType !== "bank_account" || bankGl.linkedEntityId !== bank.id) {
      throw new ImportAdvanceError("الحساب المالي للبنك لا يطابق حساب الدولار المختار", 409);
    }

    const history = await tx.select({
      usdAmountMinor: importCostAdvancePaymentsTable.usdAmountMinor,
    }).from(importCostAdvancePaymentsTable)
      .where(eq(importCostAdvancePaymentsTable.invoiceId, invoice.id));
    const totalPaid = history.reduce((sum, row) => sum + row.usdAmountMinor, 0);
    if (!Number.isSafeInteger(totalPaid) || totalPaid + request.usdAmountMinor > invoice.goodsUsdMinor) {
      throw new ImportAdvanceError("الدفعات ستتجاوز إجمالي فاتورة المورد بالدولار", 409);
    }

    const bankBalances = await usdBankBookBalances(tx, bank.financeAccountId);
    let plan: UsdAdvancePlan;
    try {
      plan = planUsdSupplierAdvance({
        ...bankBalances,
        paymentUsdMinor: request.usdAmountMinor,
        paymentSpotRateMicros: request.spotRateMicros,
      });
    } catch(error) {
      throw new ImportAdvanceError(
        error instanceof Error ? error.message : "تعذر احتساب القيمة الدفترية الصحيحة للدولار", 409,
      );
    }
    ensureExactPlan(request.usdAmountMinor, plan.bankBookCreditIlsMinor, plan);

    const advanceAccount = await ensureIlsAccount(tx, "IMPORT_SUPPLIER_ADVANCES", "دفعات مقدمة لموردي الاستيراد", "asset");
    const gainAccount = plan.realizedFxGainCreditIlsMinor > 0
      ? await ensureIlsAccount(tx, "FX_GAIN_REALIZED", "أرباح فروقات العملة المحققة", "income") : null;
    const lossAccount = plan.realizedFxLossDebitIlsMinor > 0
      ? await ensureIlsAccount(tx, "FX_LOSS_REALIZED", "خسائر فروقات العملة المحققة", "expense") : null;

    const [payment] = await tx.insert(importCostAdvancePaymentsTable).values({
      caseId: request.caseId, invoiceId: invoice.id,
      idempotencyKey: request.idempotencyKey,
      bankAccountId: bank.id,
      businessDate: request.businessDate,
      usdAmountMinor: request.usdAmountMinor,
      spotRateMicros: request.spotRateMicros,
      bankBookIlsMinor: plan.bankBookCreditIlsMinor,
      advanceIlsMinor: plan.supplierAdvanceDebitIlsMinor,
      fxGainIlsMinor: plan.realizedFxGainCreditIlsMinor,
      fxLossIlsMinor: plan.realizedFxLossDebitIlsMinor,
      createdByUserId: actorId,
    }).returning();
    if (!payment) throw new ImportAdvanceError("تعذر إنشاء سجل دفعة المورد", 500);

    const lines: FinancePostingLineInput[] = [
      {
        accountId: advanceAccount.id,
        supplierId: invoice.supplierId,
        debitMinor: plan.supplierAdvanceDebitIlsMinor,
        currencyCode: "USD",
        currencyAmountMinor: request.usdAmountMinor,
        exchangeRateMicros: plan.paymentSpotExchangeRateMicros,
        memo: "دفعة مقدمة للمورد " + invoice.invoiceNumber,
      },
      {
        accountId: bank.financeAccountId,
        creditMinor: plan.bankBookCreditIlsMinor,
        currencyCode: "USD",
        currencyAmountMinor: request.usdAmountMinor,
        exchangeRateMicros: plan.bankBookExchangeRateMicros,
        memo: "صرف دولار من البنك لدفعة المورد",
      },
    ];
    if (gainAccount) lines.push({
      accountId: gainAccount.id,
      creditMinor: plan.realizedFxGainCreditIlsMinor,
      memo: "ربح صرف محقق عند دفع المورد",
    });
    if (lossAccount) lines.push({
      accountId: lossAccount.id,
      debitMinor: plan.realizedFxLossDebitIlsMinor,
      memo: "خسارة صرف محققة عند دفع المورد",
    });

    const posting = await postFinanceTransaction(tx, {
      publicId: "FIN-" + request.businessDate.replaceAll("-", "") + "-" +
        randomUUID().slice(0, 8).toUpperCase(),
      idempotencyKey: "import:advance:" + payment.id + ":posted",
      businessDate: request.businessDate,
      transactionType: "payment",
      sourceType: "import_cost_advance_payment",
      sourceId: String(payment.id),
      sourceEvent: "posted",
      notes: "دفعة مقدمة للاستيراد " + theCase.publicId + "، فاتورة " + invoice.invoiceNumber,
      createdByUserId: actorId,
      lines,
    });
    if (posting.alreadyPosted) throw new ImportAdvanceError("دفعة المورد مرحلة مسبقًا", 409);
    const [updated] = await tx.update(importCostAdvancePaymentsTable)
      .set({ financeTransactionId: posting.transaction.id })
      .where(eq(importCostAdvancePaymentsTable.id, payment.id)).returning();
    if (!updated) throw new ImportAdvanceError("تعذر ربط دفعة المورد بقيدها", 500);
    return { ...updated, alreadyPosted: false };
  });
}
