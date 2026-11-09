import test from "node:test";
import assert from "node:assert/strict";
import { planUsdSupplierAdvance } from "./import-payment-rules.ts";

const base = {
  paymentUsdMinor: 100000,
  sourceUsdBalanceMinor: 200000,
  sourceIlsBookBalanceMinor: 700000,
  paymentSpotRateMicros: 3500000,
};

test("USD advance uses weighted book cost and posts no expense at unchanged FX", () => {
  const p = planUsdSupplierAdvance(base);
  assert.equal(p.paymentUsdMinor, 100000);
  assert.equal(p.bankBookCreditIlsMinor, 350000);
  assert.equal(p.supplierAdvanceDebitIlsMinor, 350000);
  assert.equal(p.realizedFxGainCreditIlsMinor, 0);
  assert.equal(p.realizedFxLossDebitIlsMinor, 0);
  assert.equal(p.bankBookExchangeRateMicros, 3500000);
});

test("USD rises after purchase -> realized FX gain, not inflated bank credit", () => {
  const p = planUsdSupplierAdvance({ ...base, paymentSpotRateMicros: 3600000 });
  assert.equal(p.supplierAdvanceDebitIlsMinor, 360000);
  assert.equal(p.bankBookCreditIlsMinor, 350000);
  assert.equal(p.realizedFxGainCreditIlsMinor, 10000);
  assert.equal(p.realizedFxLossDebitIlsMinor, 0);
  assert.equal(p.supplierAdvanceDebitIlsMinor + p.realizedFxLossDebitIlsMinor,
    p.bankBookCreditIlsMinor + p.realizedFxGainCreditIlsMinor);
});

test("USD falls -> FX loss in P&L separate from inventory prepayment", () => {
  const p = planUsdSupplierAdvance({ ...base, paymentSpotRateMicros: 3400000 });
  assert.equal(p.supplierAdvanceDebitIlsMinor, 340000);
  assert.equal(p.realizedFxLossDebitIlsMinor, 10000);
  assert.equal(p.realizedFxGainCreditIlsMinor, 0);
});

test("full withdrawal clears USD and its ILS book balance", () => {
  const p = planUsdSupplierAdvance({ ...base, paymentUsdMinor: 200000 });
  assert.equal(p.bankBookCreditIlsMinor, 700000);
  assert.equal(p.supplierAdvanceDebitIlsMinor, 700000);
});

test("partial withdrawal preserves weighted average and exact rate", () => {
  const p = planUsdSupplierAdvance({
    paymentUsdMinor: 75000,
    sourceUsdBalanceMinor: 300000,
    sourceIlsBookBalanceMinor: 1110000,
    paymentSpotRateMicros: 3750000,
  });
  assert.equal(p.bankBookCreditIlsMinor, 277500);
  assert.equal(p.supplierAdvanceDebitIlsMinor, 281250);
  assert.equal(p.realizedFxGainCreditIlsMinor, 3750);
  assert.equal(p.bankBookExchangeRateMicros, 3700000);
});

test("cannot spend more dollars than bank owns", () => {
  assert.throws(() => planUsdSupplierAdvance({ ...base, paymentUsdMinor: 200001 }), /INSUFFICIENT_USD/);
});

test("do not accept zero, negative, floating-point or unsafe money", () => {
  for (const amount of [0, -1, 2.1, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => planUsdSupplierAdvance({ ...base, paymentUsdMinor: amount }));
  }
});

test("reject incomplete source book valuation", () => {
  assert.throws(() => planUsdSupplierAdvance({ ...base, sourceIlsBookBalanceMinor: 0 }), /SOURCE_ILS_BOOK_BALANCE/);
});

test("do not silently round an impossible bank ledger rate", () => {
  // Very small USD amount can have an ILS book credit whose exact micro rate
  // cannot reproduce the already-rounded source posting.
  assert.throws(() => planUsdSupplierAdvance({
    paymentUsdMinor: 1,
    sourceUsdBalanceMinor: 2,
    sourceIlsBookBalanceMinor: 1,
    paymentSpotRateMicros: 3500000,
  }));
});
