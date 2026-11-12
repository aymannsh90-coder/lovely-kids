import test from "node:test";
import assert from "node:assert/strict";
import { historicalReturnProfitShiftMinor } from "./historical-exchange-reconciliation.ts";

test("legacy October exchange received in November shifts only the period preview", () => {
  assert.equal(historicalReturnProfitShiftMinor("2026-10-01", "2026-10-31", "2026-10-30", "2026-11-01", 6541), 6541);
  assert.equal(historicalReturnProfitShiftMinor("2026-11-01", "2026-11-30", "2026-10-30", "2026-11-01", 6541), -6541);
});
test("an exchange received in the same month changes daily but not monthly profit", () => {
  assert.equal(historicalReturnProfitShiftMinor("2026-10-01", "2026-10-31", "2026-10-14", "2026-10-18", 10105), 0);
  assert.equal(historicalReturnProfitShiftMinor("2026-10-14", "2026-10-14", "2026-10-14", "2026-10-18", 10105), 10105);
  assert.equal(historicalReturnProfitShiftMinor("2026-10-18", "2026-10-18", "2026-10-14", "2026-10-18", 10105), -10105);
});
test("unrelated dates and same-date recognition do not shift profit", () => {
  assert.equal(historicalReturnProfitShiftMinor("2026-12-01", "2026-12-31", "2026-10-30", "2026-11-01", 6541), 0);
  assert.equal(historicalReturnProfitShiftMinor("2026-10-30", "2026-10-30", "2026-10-30", "2026-10-30", 6541), 0);
});
test("unsafe costs are never included in a historical adjustment preview", () => {
  assert.throws(() => historicalReturnProfitShiftMinor("2026-11-01", "2026-11-30", "2026-10-30", "2026-11-01", NaN), RangeError);
  assert.throws(() => historicalReturnProfitShiftMinor("2026-11-01", "2026-11-30", "2026-10-30", "2026-11-01", -1), RangeError);
});
