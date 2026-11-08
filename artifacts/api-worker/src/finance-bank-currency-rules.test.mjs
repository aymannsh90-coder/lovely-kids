import test from "node:test";
import assert from "node:assert/strict";
import {
  bankDisplayBalanceMinor,
  ensureBankPostingCurrency,
} from "./finance-bank-currency-rules.ts";

test("ILS balance ignores missing currency metadata and agrees with ledger", () => {
  assert.equal(bankDisplayBalanceMinor("ILS", -8882, 57553), -8882);
  assert.equal(bankDisplayBalanceMinor("ILS", 179373, -131233), 179373);
  assert.equal(bankDisplayBalanceMinor("ILS", 0, 98765), 0);
});

test("foreign bank balance retains its currency amount", () => {
  assert.equal(bankDisplayBalanceMinor("USD", 36500, 10000), 10000);
});

test("an ILS bank line without currency metadata is normalized", () => {
  const line = {
    accountId: 32, debitMinor: 0, creditMinor: 78722,
    currencyCode: null, currencyAmountMinor: null, exchangeRateMicros: null,
  };
  const normalized = ensureBankPostingCurrency(line, "ILS");
  assert.deepEqual(
    [normalized.currencyCode, normalized.currencyAmountMinor, normalized.exchangeRateMicros],
    ["ILS", 78722, 1_000_000],
  );
  assert.equal(normalized.debitMinor, 0);
  assert.equal(normalized.creditMinor, 78722);
  assert.equal(line.currencyAmountMinor, null);
});

test("non-bank lines are left untouched", () => {
  const line = {
    accountId: 3, debitMinor: 1000, creditMinor: 0,
    currencyCode: null, currencyAmountMinor: null, exchangeRateMicros: null,
  };
  assert.equal(ensureBankPostingCurrency(line, null), line);
});

test("incomplete, foreign, or contradictory ILS metadata is rejected", () => {
  const base = {
    accountId: 32, debitMinor: 500, creditMinor: 0,
    currencyCode: "ILS", currencyAmountMinor: 500, exchangeRateMicros: 1_000_000,
  };
  for (const override of [
    {currencyCode: "USD"},
    {currencyAmountMinor: 499},
    {exchangeRateMicros: 999999},
    {currencyAmountMinor: null},
  ]) {
    assert.throws(
      () => ensureBankPostingCurrency({...base, ...override}, "ILS"),
      /BANK_LEDGER_CURRENCY_METADATA_INVALID/,
    );
  }
});

test("foreign currency bank requires complete matching currency data", () => {
  const line = {
    accountId: 42, debitMinor: 37500, creditMinor: 0,
    currencyCode: "USD", currencyAmountMinor: 10000, exchangeRateMicros: 3_750_000,
  };
  assert.equal(ensureBankPostingCurrency(line, "USD"), line);
  assert.throws(
    () => ensureBankPostingCurrency({...line, currencyCode: null}, "USD"),
    /BANK_LEDGER_CURRENCY_METADATA_INVALID/,
  );
});
