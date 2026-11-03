import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertPostedSaleCashMatches,
  buildPosCashEditLines,
  cashAccountNetMinor,
  cashEditEvent,
  cashEditRevisionFromEvent,
  cashEditVoidEvent,
  reverseCashJournalLines,
} from "./pos-sale-cash-adjustment-rules.ts";

const CASH = 3;
const INCOME = 34;
const makeCashSale = amount => [
  { accountId: CASH, debitMinor: amount, creditMinor: 0 },
  { accountId: INCOME, debitMinor: 0, creditMinor: amount },
];
const netIncome = lines =>
  lines.reduce((sum, line) => sum + (line.accountId === INCOME ? line.creditMinor - line.debitMinor : 0), 0);

test("newly edited invoice: an added product creates balanced +60 cash and sales income", () => {
  const lines = buildPosCashEditLines(CASH, INCOME, 15000, 9000);
  assert.deepEqual(lines, makeCashSale(6000));
  assert.equal(cashAccountNetMinor(lines, CASH), 6000);
  assert.equal(netIncome(lines), 6000);
  const all = [...makeCashSale(9000), ...lines];
  assertPostedSaleCashMatches(15000, cashAccountNetMinor(all, CASH), netIncome(all));
});

test("newly edited invoice: price discount creates -10 in BOTH cash and sales income", () => {
  const lines = buildPosCashEditLines(CASH, INCOME, 15000, 16000);
  assert.deepEqual(lines, [
    { accountId: INCOME, debitMinor: 1000, creditMinor: 0 },
    { accountId: CASH, debitMinor: 0, creditMinor: 1000 },
  ]);
  assert.equal(cashAccountNetMinor(lines, CASH), -1000);
  const all = [...makeCashSale(16000), ...lines];
  assertPostedSaleCashMatches(15000, cashAccountNetMinor(all, CASH), netIncome(all));
});

test("several edits have independent unique events, and void reverses ALL journals", () => {
  const original = makeCashSale(9000);
  const addition = buildPosCashEditLines(CASH, INCOME, 15000, 9000);
  const refund = buildPosCashEditLines(CASH, INCOME, 14000, 15000);
  assert.equal(cashEditEvent(15), "cash_edit:15");
  assert.equal(cashEditEvent(16), "cash_edit:16");
  assert.equal(cashEditVoidEvent(15), "cash_edit_void:15");
  assert.equal(cashEditRevisionFromEvent("cash_edit:16"), 16);
  assert.equal(cashEditRevisionFromEvent("cash_edit_void:16"), null);
  const active = [...original, ...addition, ...refund];
  assertPostedSaleCashMatches(14000, cashAccountNetMinor(active, CASH), netIncome(active));
  const all = [
    ...active,
    ...reverseCashJournalLines(original),
    ...reverseCashJournalLines(addition),
    ...reverseCashJournalLines(refund),
  ];
  assert.equal(cashAccountNetMinor(all, CASH), 0);
  assert.equal(netIncome(all), 0);
});

test("color-only changes do not change journal or main cash a second time", () => {
  assert.deepEqual(buildPosCashEditLines(CASH, INCOME, 5000, 5000), []);
});

test("unreconciled legacy sale is explicitly refused before either edit or void", () => {
  assert.throws(() => assertPostedSaleCashMatches(15000, 9000, 9000), /POS_CASH_LEDGER_OUT_OF_SYNC/);
  assert.throws(() => assertPostedSaleCashMatches(2000, 0, 0), /POS_CASH_LEDGER_OUT_OF_SYNC/);
  assert.throws(() => assertPostedSaleCashMatches(15000, 15000, 16000), /POS_CASH_LEDGER_OUT_OF_SYNC/);
});

test("disallow invalid monetary inputs, revision IDs and duplicate account mapping", () => {
  assert.throws(() => buildPosCashEditLines(CASH, CASH, 150, 100), /INVALID/);
  assert.throws(() => buildPosCashEditLines(CASH, INCOME, -1, 100), /INVALID/);
  assert.throws(() => cashEditEvent(0), /INVALID_REVISION/);
  assert.equal(cashEditRevisionFromEvent("cash_edit:0"), null);
});

// Wiring regression: ensure production handlers call both the accounting guard
// and post/reversal inside their existing DB transaction, not just display deltas.
const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
test("save handler posts cash edits with a revision-specific idempotency key", () => {
  const source = read("pos-sale-edit.ts");
  assert.match(source, /inspectPostedSaleCashLedger\(tx, sale\)/);
  assert.match(source, /sourceEvent: cashEditEvent\(revision.id\)/);
  assert.match(source, /postFinanceTransaction\(tx, \{/);
  assert.match(source, /balanceDifference !== 0/);
});

test("void handler reverses the original plus each posted revision, atomically", () => {
  const source = read("pos-sale-routes.ts");
  assert.match(source, /inspectPostedSaleCashLedger\(tx, sale\)/);
  assert.match(source, /for \(const \{ transaction, lines \} of postedCashEditJournals\)/);
  assert.match(source, /sourceEvent: cashEditVoidEvent\(revisionId\)/);
  assert.match(source, /cash-edit:\$\{revisionId\}:void/);
});
