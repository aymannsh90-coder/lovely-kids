import {
  employeesTable, financeTransactionsTable, financeVouchersTable,
} from "@workspace/db/schema";
import { and, asc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "./auth";
import type { openDb, Env } from "./db";
import {
  employeeBalancesAll, ensureEmployeeAdvanceControlAccount,
  ensureEmployeePayableControlAccount,
} from "./finance-employee-ledger";
import { postFinanceTransaction } from "./finance-posting";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Access-Control-Allow-Origin": "*" },
});

export const MONTH_CLOSE_SOURCE_TYPE = "employee_salary_month_close";
export const MONTH_CLOSE_EVENT = "advance_offset";

export function salaryMonthRange(period: string): { start: string; end: string } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return null;
  const [year, month] = period.split("-").map(Number);
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!Number.isSafeInteger(year) || year < 2020 || year > 2099 || dayCount < 28) return null;
  return { start: period + "-01", end: period + "-" + String(dayCount).padStart(2, "0") };
}

function localToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (key: string) => parts.find((p) => p.type === key)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export interface EmployeeCloseRow {
  employeeId: number;
  employeeName: string;
  monthlyAdvancesMinor: number;
  salaryAccrualMinor: number;
  outstandingAdvanceMinor: number;
  outstandingPayableMinor: number;
  offsetMinor: number;
  payableRemainderMinor: number;
  issue: string | null;
}

type MonthClosePreview = {
  period: string;
  periodEnd: string;
  closed: boolean;
  canClose: boolean;
  closeAvailable: boolean;
  closedTransactionId: number | null;
  employees: EmployeeCloseRow[];
  totalOffsetMinor: number;
  totalSalaryMinor: number;
  message: string | null;
};

async function buildPreview(db: Db, period: string): Promise<MonthClosePreview> {
  const range = salaryMonthRange(period);
  if (!range) throw new Error("شهر الإغلاق غير صالح");
  const [employees, vouchers, balances, existing] = await Promise.all([
    db.select({ id: employeesTable.id, name: employeesTable.name })
      .from(employeesTable).orderBy(asc(employeesTable.id)),
    db.select({
      partyId: financeVouchersTable.partyId,
      voucherType: financeVouchersTable.voucherType,
      amountMinor: financeVouchersTable.amountMinor,
      businessDate: financeVouchersTable.businessDate,
      referencePeriod: financeVouchersTable.referencePeriod,
    }).from(financeVouchersTable)
      .where(and(
        eq(financeVouchersTable.partyType, "employee"),
        eq(financeVouchersTable.status, "posted"),
        inArray(financeVouchersTable.voucherType,
          ["employee_advance", "employee_repayment", "salary_accrual"]),
        or(
          and(gte(financeVouchersTable.businessDate, range.start),
            lte(financeVouchersTable.businessDate, range.end)),
          eq(financeVouchersTable.referencePeriod, period),
        ),
      )),
    employeeBalancesAll(db),
    db.select({ id: financeTransactionsTable.id })
      .from(financeTransactionsTable)
      .where(and(eq(financeTransactionsTable.sourceType, MONTH_CLOSE_SOURCE_TYPE),
        eq(financeTransactionsTable.sourceId, period),
        eq(financeTransactionsTable.sourceEvent, MONTH_CLOSE_EVENT),
        eq(financeTransactionsTable.status, "posted"))).limit(1),
  ]);
  const advances = new Map<number, number>(), salaries = new Map<number, number>();
  for (const v of vouchers) {
    if (v.partyId === null) continue;
    if (v.voucherType === "salary_accrual" && v.referencePeriod === period) {
      salaries.set(v.partyId, (salaries.get(v.partyId) ?? 0) + v.amountMinor);
    }
    if ((v.voucherType === "employee_advance" || v.voucherType === "employee_repayment") &&
        v.businessDate >= range.start && v.businessDate <= range.end) {
      const sign = v.voucherType === "employee_advance" ? 1 : -1;
      advances.set(v.partyId, (advances.get(v.partyId) ?? 0) + sign * v.amountMinor);
    }
  }
  const rows: EmployeeCloseRow[] = [];
  for (const e of employees) {
    const monthlyAdvancesMinor = advances.get(e.id) ?? 0;
    const salaryAccrualMinor = salaries.get(e.id) ?? 0;
    if (monthlyAdvancesMinor === 0 && salaryAccrualMinor === 0) continue;
    const current = balances.get(e.id) ?? { advanceMinor: 0, payableMinor: 0 };
    const offsetMinor = Math.max(0, Math.min(monthlyAdvancesMinor, salaryAccrualMinor));
    let issue: string | null = null;
    if (monthlyAdvancesMinor < 0) issue = "تسديد السلف خلال الشهر يتجاوز المسحوبات؛ يلزم تدقيق";
    else if (monthlyAdvancesMinor > 0 && salaryAccrualMinor <= 0)
      issue = "يجب تسجيل استحقاق راتب لهذا الحساب قبل الإغلاق";
    else if (monthlyAdvancesMinor > salaryAccrualMinor)
      issue = "الاستحقاق أقل من مسحوبات الشهر؛ عدّل الاستحقاق قبل الإغلاق";
    else if (current.advanceMinor < offsetMinor || current.payableMinor < offsetMinor)
      issue = "الأرصدة الحالية لا تكفي للمقاصة؛ راجع الحركات السابقة";
    rows.push({
      employeeId: e.id, employeeName: e.name,
      monthlyAdvancesMinor, salaryAccrualMinor,
      outstandingAdvanceMinor: current.advanceMinor,
      outstandingPayableMinor: current.payableMinor,
      offsetMinor,
      payableRemainderMinor: salaryAccrualMinor - offsetMinor,
      issue,
    });
  }
  const closeAvailable = localToday() >= range.end;
  const closed = existing.length > 0;
  const totalOffsetMinor = rows.reduce((sum, x) => sum + x.offsetMinor, 0);
  const canClose = !closed && closeAvailable && rows.length > 0 &&
    rows.every((row) => row.issue === null) && totalOffsetMinor > 0;
  return {
    period, periodEnd: range.end, closed, canClose, closeAvailable,
    closedTransactionId: existing[0]?.id ?? null, employees: rows,
    totalOffsetMinor,
    totalSalaryMinor: rows.reduce((sum, x) => sum + x.salaryAccrualMinor, 0),
    message: closed ? "هذا الشهر مغلق مسبقًا. لن يتم تسجيل المقاصة مرة ثانية."
      : !closeAvailable ? "الإغلاق متاح في آخر يوم من الشهر أو بعده."
      : rows.length === 0 ? "لا توجد مسحوبات أو استحقاقات للشهر المحدد."
      : rows.some((row) => row.issue) ? "توجد حسابات تحتاج معالجة قبل الإغلاق."
      : totalOffsetMinor === 0 ? "لا توجد سلف يمكن مقاصتها؛ لا حاجة لقيد إغلاق."
      : null,
  };
}

/** Read-only preview and explicitly confirmed owner-only atomic monthly offset. */
export async function handleEmployeeMonthClose(
  request: Request, db: Db, env: Env,
): Promise<Response> {
  const user = await getCurrentUser(db, request, env);
  if (!user?.isOwner) return json({ error: "تسوية رواتب الشهر متاحة للمالك فقط" }, 403);
  const data = request.method === "POST" ? await request.json().catch(() => null) : null;
  const input = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown> : null;
  const period = request.method === "GET"
    ? new URL(request.url).searchParams.get("period") ?? ""
    : typeof input?.period === "string" ? input.period : "";
  if (!salaryMonthRange(period)) return json({ error: "اختر شهرًا صالحًا للإغلاق" }, 400);
  if (request.method === "GET") {
    try { return json(await buildPreview(db, period)); }
    catch (error) {
      console.error("EMPLOYEE_MONTH_CLOSE_PREVIEW_FAILED", error);
      return json({ error: "تعذر تجهيز معاينة الإغلاق" }, 500);
    }
  }
  if (request.method !== "POST") return json({ error: "الطريقة غير مدعومة" }, 405);
  const expected = input?.expected;
  if (input?.confirmed !== true || !Array.isArray(expected) || expected.length > 100 ||
      !expected.every((item) => item && typeof item === "object" &&
        Number.isSafeInteger(item.employeeId) && Number.isSafeInteger(item.offsetMinor) &&
        Number.isSafeInteger(item.salaryAccrualMinor) && Number.isSafeInteger(item.monthlyAdvancesMinor))) {
    return json({ error: "يرجى معاينة وتسوية الشهر والتأكيد قبل التنفيذ" }, 400);
  }
  try {
    const result = await db.transaction(async (tx) => {
      // Serializes this month's closes with salary accruals; the expected
      // balances are rechecked AFTER acquiring the lock.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"salary_month_close:" + period}))`);
      const preview = await buildPreview(tx as unknown as Db, period);
      if (preview.closed) return { alreadyClosed: true, preview };
      if (!preview.canClose) throw new Error(preview.message || "المقاصة غير مسموحة لهذه الفترة");
      const expectedRows = (expected as Array<Pick<EmployeeCloseRow,
        "employeeId" | "offsetMinor" | "salaryAccrualMinor" | "monthlyAdvancesMinor">>)
        .map(x => [x.employeeId, x.offsetMinor, x.salaryAccrualMinor, x.monthlyAdvancesMinor].join(":")).sort();
      const actualRows = preview.employees.map(x =>
        [x.employeeId, x.offsetMinor, x.salaryAccrualMinor, x.monthlyAdvancesMinor].join(":")).sort();
      if (JSON.stringify(expectedRows) !== JSON.stringify(actualRows))
        throw new Error("تغيرت حركات السلف أو الاستحقاقات. حدّث المعاينة قبل الإغلاق.");
      const advance = await ensureEmployeeAdvanceControlAccount(tx);
      const payable = await ensureEmployeePayableControlAccount(tx);
      const lines = preview.employees.flatMap(e => e.offsetMinor <= 0 ? [] : [
        { accountId: payable.id, employeeId: e.employeeId, debitMinor: e.offsetMinor,
          creditMinor: 0, memo: `مقاصة استحقاق راتب ${period} - ${e.employeeName}` },
        { accountId: advance.id, employeeId: e.employeeId, debitMinor: 0,
          creditMinor: e.offsetMinor, memo: `تسوية سلف ${period} - ${e.employeeName}` },
      ]);
      const result = await postFinanceTransaction(tx, {
        publicId: `FIN-${preview.periodEnd.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
        idempotencyKey: `employee:month_close:${period}`,
        businessDate: preview.periodEnd,
        transactionType: "transfer",
        sourceType: MONTH_CLOSE_SOURCE_TYPE, sourceId: period, sourceEvent: MONTH_CLOSE_EVENT,
        cashSessionId: null, createdByUserId: user.id,
        notes: `مقاصة سلف الموظفين مع الرواتب المستحقة لشهر ${period}، بدون دفع نقدي أو خصم راتب جديد`,
        lines,
      });
      if (result.alreadyPosted) throw new Error("تم إغلاق الشهر مسبقًا");
      return { alreadyClosed: false, transaction: result.transaction, preview };
    });
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر إغلاق الشهر";
    console.error("EMPLOYEE_MONTH_CLOSE_FAILED", error);
    return json({ error: message }, 409);
  }
}
