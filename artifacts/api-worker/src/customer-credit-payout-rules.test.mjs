import test from "node:test";
import assert from "node:assert/strict";
import { isCustomerCreditPayoutWithinBalance } from "./customer-credit-payout-rules.ts";

test("credit of 65 shekels can be settled in full or in part", () => {
  assert.equal(isCustomerCreditPayoutWithinBalance(-6500, 6500), true);
  assert.equal(isCustomerCreditPayoutWithinBalance(-6500, 2500), true);
  assert.equal(isCustomerCreditPayoutWithinBalance(-6500, 6501), false);
});

test("cannot pay out on a settled or debit customer balance", () => {
  assert.equal(isCustomerCreditPayoutWithinBalance(0, 100), false);
  assert.equal(isCustomerCreditPayoutWithinBalance(100, 100), false);
  assert.equal(isCustomerCreditPayoutWithinBalance(-100, 101), false);
});

test("payouts require positive whole minor units", () => {
  assert.equal(isCustomerCreditPayoutWithinBalance(-6500, 0), false);
  assert.equal(isCustomerCreditPayoutWithinBalance(-6500, -100), false);
  assert.equal(isCustomerCreditPayoutWithinBalance(-6500, 0.5), false);
  assert.equal(isCustomerCreditPayoutWithinBalance(NaN, 1), false);
});
