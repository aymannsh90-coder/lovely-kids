import test from "node:test";
import assert from "node:assert/strict";
import { remainingExchangePayableMinor, netCourierReceivableMinor } from "./delivery-exchange-offset-math.ts";

test("old exchange #241 is excluded because it was accounted in prior Shiply statement", () => {
  assert.equal(remainingExchangePayableMinor(400, 400), 0);
});
test("current exchange #280 is deducted exactly once", () => {
  assert.equal(remainingExchangePayableMinor(3000, 0), 3000);
  assert.equal(netCourierReceivableMinor(1292500, 3000), 1289500);
});
test("after a settlement consumes the negative exchange, it cannot be used twice", () => {
  assert.equal(remainingExchangePayableMinor(3000, 3000), 0);
  assert.equal(netCourierReceivableMinor(0, 0), 0);
});
test("bad ledger input is rejected", () => {
  assert.throws(() => remainingExchangePayableMinor(-1, 0));
  assert.throws(() => netCourierReceivableMinor(100, -1));
});
