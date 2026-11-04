import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomerReceiptDiscountLines,
  buildDiscountNoteLines,
  validatedReceiptSettlement,
} from "./finance-discount-rules.ts";

const sum = (lines, field) => lines.reduce((total, line) => total + line[field], 0);
const reversed = lines => lines.map(line => ({ ...line, debitMinor: line.creditMinor, creditMinor: line.debitMinor }));

test("710 debt: 700 cash and 10 discount clear the debt, but cash increases only by 700", () => {
  const settled = validatedReceiptSettlement(70000, 1000, 71000);
  assert.equal(settled, 71000);
  const lines = buildCustomerReceiptDiscountLines(
    { accountId: 10, debitMinor: 70000, creditMinor: 0, memo: "cash" },
    { accountId: 20, customerId: 45, debitMinor: 0, creditMinor: 70000 },
    30, 1000,
  );
  assert.deepEqual(lines.map(x => [x.accountId, x.debitMinor, x.creditMinor]), [
    [10, 70000, 0], [30, 1000, 0], [20, 0, 71000],
  ]);
  assert.equal(sum(lines, "debitMinor"), sum(lines, "creditMinor"));
  assert.equal(lines.filter(x => x.accountId === 10).reduce((a, x) => a + x.debitMinor - x.creditMinor, 0), 70000);
  assert.equal(lines[2].customerId, 45);
  const voidLines = reversed(lines);
  assert.equal(sum([...lines, ...voidLines], "debitMinor"), sum([...lines, ...voidLines], "creditMinor"));
  assert.equal([...lines, ...voidLines].reduce((a, x) => a + x.debitMinor - x.creditMinor, 0), 0);
});

test("ordinary receipt without discount stays two-line and unchanged", () => {
  const lines = buildCustomerReceiptDiscountLines(
    { accountId: 10, debitMinor: 10000, creditMinor: 0 },
    { accountId: 20, customerId: 4, debitMinor: 0, creditMinor: 10000 },
    null, 0,
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[1].creditMinor, 10000);
});

test("standalone customer credit note reduces receivable and does not post cash", () => {
  const lines = buildDiscountNoteLines("customer_credit", 1000, 30, 20, 45);
  assert.deepEqual(lines.map(x => [x.accountId, x.debitMinor, x.creditMinor]), [
    [30, 1000, 0], [20, 0, 1000],
  ]);
  assert.equal(lines[1].customerId, 45);
  assert.equal(sum(lines, "debitMinor"), sum(lines, "creditMinor"));
});

test("customer debit note raises receivable, supplier earned discount lowers payable", () => {
  const debtor = buildDiscountNoteLines("customer_debit", 1000, 32, 20, 45);
  assert.equal(debtor[1].debitMinor, 1000);
  const supplier = buildDiscountNoteLines("supplier_earned", 500, 33, 22, 3);
  assert.equal(supplier[1].supplierId, 3);
  assert.equal(supplier[1].creditMinor, 500);
  assert.equal(sum(supplier, "debitMinor"), sum(supplier, "creditMinor"));
});

test("refuse settlement discount larger than receivable, overflow or duplicate account", () => {
  assert.throws(() => validatedReceiptSettlement(70000, 1001, 71000), /DISCOUNT_EXCEEDS_CUSTOMER_BALANCE/);
  assert.throws(() => validatedReceiptSettlement(70000, -1, 71000), /INVALID/);
  assert.throws(() => validatedReceiptSettlement(2147483600, 100, 2147483647), /OVERFLOW/);
  assert.throws(() => buildDiscountNoteLines("customer_credit", 100, 5, 5, 1), /DUPLICATE/);
  assert.throws(() => buildCustomerReceiptDiscountLines(
    { accountId: 10, debitMinor: 100, creditMinor: 0 },
    { accountId: 20, debitMinor: 0, creditMinor: 100 }, null, 5), /ACCOUNT_REQUIRED/);
});
