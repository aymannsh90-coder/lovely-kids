/** Pure, money-in-minor-units salary-to-advance reconciliation. */
export function planSalaryAdvanceOffset(input: {
  monthlyAdvancesMinor: number;
  salaryAccrualMinor: number;
  outstandingAdvanceMinor: number;
  outstandingPayableMinor: number;
}): { offsetMinor: number; remainingSalaryMinor: number; issue: string | null } {
  const { monthlyAdvancesMinor, salaryAccrualMinor,
    outstandingAdvanceMinor, outstandingPayableMinor } = input;
  const values = [monthlyAdvancesMinor, salaryAccrualMinor,
    outstandingAdvanceMinor, outstandingPayableMinor];
  if (!values.every(Number.isSafeInteger)) {
    return { offsetMinor: 0, remainingSalaryMinor: 0, issue: "مبالغ الحساب غير صالحة" };
  }
  const offsetMinor = Math.max(0, Math.min(monthlyAdvancesMinor, salaryAccrualMinor));
  let issue: string | null = null;
  if (monthlyAdvancesMinor < 0) issue = "تسديد السلف خلال الشهر يتجاوز المسحوبات؛ يلزم تدقيق";
  else if (monthlyAdvancesMinor > 0 && salaryAccrualMinor <= 0)
    issue = "يجب تسجيل استحقاق راتب لهذا الحساب قبل الإغلاق";
  else if (monthlyAdvancesMinor > salaryAccrualMinor)
    issue = "الاستحقاق أقل من مسحوبات الشهر؛ عدّل الاستحقاق قبل الإغلاق";
  else if (outstandingAdvanceMinor < offsetMinor || outstandingPayableMinor < offsetMinor)
    issue = "الأرصدة الحالية لا تكفي للمقاصة؛ راجع الحركات السابقة";
  return {
    offsetMinor,
    remainingSalaryMinor: salaryAccrualMinor - offsetMinor,
    issue,
  };
}
