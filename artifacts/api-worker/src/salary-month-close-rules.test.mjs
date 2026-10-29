import test from "node:test";
import assert from "node:assert/strict";
import { planSalaryAdvanceOffset } from "./salary-month-close-rules.ts";

const input = (monthlyAdvancesMinor, salaryAccrualMinor, outstandingAdvanceMinor=monthlyAdvancesMinor,
  outstandingPayableMinor=salaryAccrualMinor) => ({
  monthlyAdvancesMinor, salaryAccrualMinor, outstandingAdvanceMinor, outstandingPayableMinor,
});

test("equal salary and advances offset to zero remaining payable", () => {
  assert.deepEqual(planSalaryAdvanceOffset(input(80000,80000)),
    { offsetMinor:80000, remainingSalaryMinor:0, issue:null });
});

test("salary greater than advances only offsets withdrawn amount", () => {
  assert.deepEqual(planSalaryAdvanceOffset(input(80000,100000)),
    { offsetMinor:80000, remainingSalaryMinor:20000, issue:null });
});

test("unaccrued salary blocks closing despite existing advance", () => {
  assert.match(planSalaryAdvanceOffset(input(50000,0)).issue, /استحقاق/);
});

test("salary below withdrawals blocks instead of clearing partial advance silently", () => {
  assert.match(planSalaryAdvanceOffset(input(90000,80000)).issue, /أقل/);
});

test("existing advance balance smaller than month amount must block", () => {
  assert.match(planSalaryAdvanceOffset(input(80000,80000,70000,80000)).issue, /الأرصدة/);
});

test("existing salary payable smaller than offset must block", () => {
  assert.match(planSalaryAdvanceOffset(input(80000,80000,80000,70000)).issue, /الأرصدة/);
});

test("negative net month advances from repayments require review", () => {
  assert.match(planSalaryAdvanceOffset(input(-1000,10000,0,10000)).issue, /تسديد/);
});

test("salary accrual without withdrawals is not a cash movement", () => {
  assert.deepEqual(planSalaryAdvanceOffset(input(0,30000,0,30000)),
    { offsetMinor:0, remainingSalaryMinor:30000, issue:null });
});

test("unsafe fractional or overflow amounts are never offset", () => {
  assert.match(planSalaryAdvanceOffset(input(1.25,100)).issue, /غير صالحة/);
  assert.match(planSalaryAdvanceOffset(input(Number.MAX_SAFE_INTEGER+1,10)).issue, /غير صالحة/);
});
