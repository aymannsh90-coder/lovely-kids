import {
  bankAccountsTable, cashSessionsTable, financeAccountsTable,
  financeTransactionLinesTable, importCostCasesTable,
  importCostShipmentsTable, importCostDirectPaymentsTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { openDb, Env } from "./db";
import { postFinanceTransaction } from "./finance-posting";
import { ImportAdvanceError } from "./import-payment-posting";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const MAX = 2_147_483_647;
type Kind = "freight" | "customs" | "local_transport" | "travel";
type Settlement = "bank" | "cash";
export type ImportDirectCostRequest = {
  caseId: number;
  shipmentRef: string | null;
  costType: Kind;
  paymentMethod: Settlement;
  bankAccountId: number | null;
  registerKey: string | null;
  businessDate: string;
  amountIlsMinor: number;
  idempotencyKey: string;
};

function positive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > MAX) {
    throw new ImportAdvanceError(field + " غير صالح");
  }
  return value;
}

export function parseImportDirectCostRequest(raw: unknown, caseId: number): ImportDirectCostRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ImportAdvanceError("بيانات دفعة الشحن أو السفر غير صالحة");
  }
  const body = raw as Record<string, unknown>;
  if (!["freight","customs","local_transport","travel"].includes(String(body.costType))) {
    throw new ImportAdvanceError("نوع المصروف غير مدعوم");
  }
  const costType = body.costType as Kind;
  const shipmentRef = costType === "travel"
    ? null
    : typeof body.shipmentRef === "string" && body.shipmentRef.trim().length > 0 &&
      body.shipmentRef.trim().length <= 100 ? body.shipmentRef.trim() : null;
  if (costType !== "travel" && !shipmentRef) throw new ImportAdvanceError("الشحنة مطلوبة للمصروف");
  if (costType === "travel" && body.shipmentRef != null) {
    throw new ImportAdvanceError("السفر يتبع ملف الاستيراد وليس شحنة معينة");
  }
  if (body.paymentMethod !== "cash" && body.paymentMethod !== "bank") {
    throw new ImportAdvanceError("طريقة دفع المصروف غير مدعومة");
  }
  const paymentMethod = body.paymentMethod;
  const bankAccountId = paymentMethod === "bank"
    ? positive(body.bankAccountId, "بنك الشيكل") : null;
  const registerKey = paymentMethod === "cash"
    ? body.registerKey === "main" ? "main" : null : null;
  if (paymentMethod === "cash" && !registerKey) {
    throw new ImportAdvanceError("الصرف النقدي متاح بالصندوق الرئيسي بالشيكل فقط");
  }
  if ((paymentMethod === "bank" && body.registerKey != null) ||
      (paymentMethod === "cash" && body.bankAccountId != null)) {
    throw new ImportAdvanceError("لا يمكن الصرف من بنك وصندوق بنفس الدفعة");
  }
  const businessDate = body.businessDate;
  if (typeof businessDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) ||
      Number.isNaN(Date.parse(businessDate + "T00:00:00Z")) ||
      new Date(businessDate + "T00:00:00Z").toISOString().slice(0,10) !== businessDate) {
    throw new ImportAdvanceError("تاريخ الدفعة غير صالح");
  }
  if (typeof body.idempotencyKey !== "string" || body.idempotencyKey.trim().length < 8 ||
      body.idempotencyKey.trim().length > 120) {
    throw new ImportAdvanceError("مفتاح منع التكرار غير صالح");
  }
  return {
    caseId: positive(caseId, "ملف الاستيراد"), shipmentRef,
    costType, paymentMethod, bankAccountId, registerKey,
    businessDate, amountIlsMinor: positive(body.amountIlsMinor, "مبلغ الدفعة"),
    idempotencyKey: body.idempotencyKey.trim(),
  };
}

async function ensureClearingAccount(tx: Tx, type: Kind) {
  const travel = type === "travel";
  const code = travel ? "IMPORT_TRAVEL_COST_CLEARING" : "IMPORT_SHIPMENT_COST_CLEARING";
  const name = travel ? "مصاريف سفر استيراد قيد التسوية" : "مصاريف شحن وتخليص ونقل قيد التسوية";
  let [found] = await tx.select().from(financeAccountsTable)
    .where(eq(financeAccountsTable.code, code)).limit(1);
  if (!found) {
    await tx.insert(financeAccountsTable).values({
      code, name, accountType: "asset", currencyCode: "ILS", status: "active",
      notes: "تكاليف استيراد لا تُسجل كمصروف مكرر قبل اعتماد المخزون",
    }).onConflictDoNothing();
    [found] = await tx.select().from(financeAccountsTable)
      .where(eq(financeAccountsTable.code, code)).limit(1);
  }
  if (!found || found.accountType !== "asset" || found.currencyCode !== "ILS" ||
      found.status !== "active" || found.linkedEntityId !== null) {
    throw new ImportAdvanceError("حساب تجميع تكاليف الشحنة غير صالح", 409);
  }
  return found;
}

async function bankSource(tx: Tx, bankAccountId: number, amountIlsMinor: number) {
  const [bank] = await tx.select().from(bankAccountsTable)
    .where(and(eq(bankAccountsTable.id, bankAccountId),
      eq(bankAccountsTable.status, "active"))).for("update").limit(1);
  if (!bank || bank.currencyCode !== "ILS") {
    throw new ImportAdvanceError("حساب البنك ليس حساب شيكل فعّالًا", 409);
  }
  const [account] = await tx.select().from(financeAccountsTable)
    .where(eq(financeAccountsTable.id, bank.financeAccountId)).limit(1);
  if (!account || account.status !== "active" || account.currencyCode !== "ILS" ||
      account.accountType !== "asset" || account.linkedEntityType !== "bank_account" ||
      account.linkedEntityId !== bank.id) {
    throw new ImportAdvanceError("الدفتر المحاسبي للبنك غير صالح", 409);
  }
  const lines = await tx.select({
    debit: financeTransactionLinesTable.debitMinor,
    credit: financeTransactionLinesTable.creditMinor,
  }).from(financeTransactionLinesTable)
    .where(eq(financeTransactionLinesTable.accountId, account.id));
  const balance = lines.reduce((sum, line) => sum + BigInt(line.debit) - BigInt(line.credit), 0n);
  if (balance < BigInt(amountIlsMinor)) {
    throw new ImportAdvanceError("رصيد بنك الشيكل غير كافٍ لدفع مصروف الشحنة", 409);
  }
  return { accountId: account.id, cashSessionId: null as number | null,
    cashSession: null as typeof cashSessionsTable.$inferSelect | null };
}

async function cashSource(tx: Tx, businessDate: string, amountIlsMinor: number) {
  const [session] = await tx.select().from(cashSessionsTable)
    .where(and(eq(cashSessionsTable.registerKey,"main"),
      eq(cashSessionsTable.status,"open"))).for("update").limit(1);
  if (!session || session.currencyCode !== "ILS" || session.businessDate !== businessDate) {
    throw new ImportAdvanceError("يجب فتح جلسة صندوق الشيكل لنفس تاريخ الدفعة", 409);
  }
  const balance = session.expectedBalanceMinor ?? session.openingBalanceMinor;
  if (balance < amountIlsMinor) throw new ImportAdvanceError("الصندوق لا يكفي لتسجيل هذا المصروف", 409);
  const [account] = await tx.select().from(financeAccountsTable)
    .where(eq(financeAccountsTable.code, "CASH_MAIN")).limit(1);
  if (!account || account.accountType !== "asset" ||
      account.currencyCode !== "ILS" || account.status !== "active") {
    throw new ImportAdvanceError("حساب الصندوق الرئيسي المحاسبي غير صالح", 409);
  }
  return { accountId: account.id, cashSessionId: session.id, cashSession: session };
}

/** Feature-gated actual ILS payment; never calls inventory cost or POS purchase posting. */
export async function postImportDirectCost(
  db: Db, env: Env, actorId: number, request: ImportDirectCostRequest,
) {
  if (env.POS_IMPORT_FINANCIAL_POSTING_ENABLED !== "true") {
    throw new ImportAdvanceError("ترحيل مصاريف الاستيراد غير مفعل بعد", 503);
  }
  return db.transaction(async (tx) => {
    const [theCase] = await tx.select().from(importCostCasesTable)
      .where(eq(importCostCasesTable.id, request.caseId)).for("update").limit(1);
    if (!theCase || theCase.status !== "draft") throw new ImportAdvanceError("ملف الاستيراد غير مفتوح", 409);

    const [sameKey] = await tx.select().from(importCostDirectPaymentsTable)
      .where(eq(importCostDirectPaymentsTable.idempotencyKey, request.idempotencyKey)).limit(1);
    if (sameKey) {
      const [sameShipment] = request.shipmentRef
        ? await tx.select({ id: importCostShipmentsTable.id }).from(importCostShipmentsTable)
            .where(and(eq(importCostShipmentsTable.caseId, request.caseId),
              eq(importCostShipmentsTable.lineRef, request.shipmentRef))).limit(1)
        : [null];
      if (sameKey.shipmentId !== (sameShipment?.id ?? null)) {
        throw new ImportAdvanceError("مفتاح الدفع مرتبط بشحنة أخرى", 409);
      }
      if (sameKey.caseId !== request.caseId ||
        sameKey.costType !== request.costType ||
        sameKey.paymentMethod !== request.paymentMethod ||
        sameKey.amountIlsMinor !== request.amountIlsMinor ||
        sameKey.businessDate !== request.businessDate ||
        (request.paymentMethod === "bank" && sameKey.bankAccountId !== request.bankAccountId) ||
        (request.paymentMethod === "cash" && sameKey.cashSessionId == null) ||
        !sameKey.financeTransactionId) {
        throw new ImportAdvanceError("مفتاح الدفع مستخدم في عملية أخرى", 409);
      }
      return { ...sameKey, alreadyPosted: true };
    }

    let shipmentId: number | null = null;
    let allowed: number;
    if (request.costType === "travel") {
      if (!theCase.withTravel) throw new ImportAdvanceError("ملف الاستيراد لا يحتوي سفرًا", 409);
      allowed = theCase.travelRecordedIlsMinor;
    } else {
      const [shipment] = await tx.select().from(importCostShipmentsTable)
        .where(and(eq(importCostShipmentsTable.caseId,request.caseId),
          eq(importCostShipmentsTable.lineRef,request.shipmentRef!))).limit(1);
      if (!shipment) throw new ImportAdvanceError("الشحنة غير موجودة", 404);
      shipmentId = shipment.id;
      allowed = request.costType === "freight" ? shipment.freightIlsMinor :
        request.costType === "customs" ? shipment.customsIlsMinor : shipment.localTransportIlsMinor;
    }
    const previous = await tx.select({
      amount: importCostDirectPaymentsTable.amountIlsMinor,
      shipmentId: importCostDirectPaymentsTable.shipmentId,
      costType: importCostDirectPaymentsTable.costType,
    }).from(importCostDirectPaymentsTable).where(eq(importCostDirectPaymentsTable.caseId,request.caseId));
    const paid = previous.filter((p) => p.costType === request.costType &&
      p.shipmentId === shipmentId).reduce((sum, p) => sum + p.amount, 0);
    if (paid + request.amountIlsMinor > allowed) {
      throw new ImportAdvanceError("المبلغ المدفوع يتجاوز مصاريف السفر أو الشحنة المسجلة", 409);
    }

    const settlement = request.paymentMethod === "bank"
      ? await bankSource(tx, request.bankAccountId!, request.amountIlsMinor)
      : await cashSource(tx, request.businessDate, request.amountIlsMinor);
    const clearingAccount = await ensureClearingAccount(tx, request.costType);

    const [payment] = await tx.insert(importCostDirectPaymentsTable).values({
      caseId: request.caseId, shipmentId, idempotencyKey: request.idempotencyKey,
      costType: request.costType, paymentMethod: request.paymentMethod,
      bankAccountId: request.bankAccountId, cashSessionId: settlement.cashSessionId,
      settlementFinanceAccountId: settlement.accountId,
      businessDate: request.businessDate, amountIlsMinor: request.amountIlsMinor,
      createdByUserId: actorId,
    }).returning();
    if (!payment) throw new ImportAdvanceError("تعذر إنشاء دفعة الشحنة", 500);

    const posting = await postFinanceTransaction(tx, {
      publicId: "FIN-" + request.businessDate.replaceAll("-","") + "-" +
        randomUUID().slice(0,8).toUpperCase(),
      idempotencyKey: "import:direct:" + payment.id + ":posted",
      transactionType: "payment", sourceType: "import_cost_direct_payment",
      sourceId: String(payment.id), sourceEvent: "posted",
      businessDate: request.businessDate,
      cashSessionId: settlement.cashSessionId,
      notes: "تكاليف " + request.costType + " لاستيراد " + theCase.publicId,
      createdByUserId: actorId,
      lines: [
        { accountId: clearingAccount.id, debitMinor: request.amountIlsMinor,
          memo: "مصروف مباشر لاستيراد قيد التسوية" },
        { accountId: settlement.accountId, creditMinor: request.amountIlsMinor,
          memo: "دفع مصروف الاستيراد من " + request.paymentMethod },
      ],
    });
    if (posting.alreadyPosted) throw new ImportAdvanceError("دفعة الشحنة مرحلة مسبقًا", 409);
    if (settlement.cashSession) {
      const oldBalance = settlement.cashSession.expectedBalanceMinor ??
        settlement.cashSession.openingBalanceMinor;
      const [updatedSession] = await tx.update(cashSessionsTable).set({
        expectedBalanceMinor: oldBalance - request.amountIlsMinor, updatedAt: new Date(),
      }).where(and(eq(cashSessionsTable.id,settlement.cashSession.id),
        eq(cashSessionsTable.status, "open"))).returning({ id: cashSessionsTable.id });
      if (!updatedSession) throw new ImportAdvanceError("تغيرت حالة الصندوق أثناء تسجيل الدفع", 409);
    }
    const [updated] = await tx.update(importCostDirectPaymentsTable).set({
      financeTransactionId: posting.transaction.id,
    }).where(eq(importCostDirectPaymentsTable.id,payment.id)).returning();
    if (!updated) throw new ImportAdvanceError("تعذر ربط مصروف الاستيراد بالقيد", 500);
    return { ...updated, alreadyPosted: false };
  });
}
