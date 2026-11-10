import assert from "node:assert/strict";
import test from "node:test";
import { hasAuditableWeightedCostHistory } from "./weighted-cost-attestation.ts";

const ledger = [
  { eventType: "opening", sourceType: "manual_opening", quantityDelta: 1,
    valueDeltaMinor: 2302, quantityAfter: 1, valueAfterMinor: 2302, costQuality: "confirmed" },
  { eventType: "adjustment_in", sourceType: "manual_stock", quantityDelta: 8,
    valueDeltaMinor: 17264, quantityAfter: 9, valueAfterMinor: 19566, costQuality: "confirmed" },
  { eventType: "online_order", sourceType: "online_order", quantityDelta: -1,
    valueDeltaMinor: -2174, quantityAfter: 8, valueAfterMinor: 17392, costQuality: "confirmed" },
  { eventType: "exchange_return", sourceType: "exchange", quantityDelta: 1,
    valueDeltaMinor: 2174, quantityAfter: 9, valueAfterMinor: 19566, costQuality: "mixed" },
  { eventType: "online_order", sourceType: "online_order", quantityDelta: -1,
    valueDeltaMinor: -2174, quantityAfter: 8, valueAfterMinor: 17392, costQuality: "mixed" },
];
const check = (rows, qty = 8, value = 17392, unit = 2174) =>
  hasAuditableWeightedCostHistory(rows, unit, qty, value);
const modify = (index, patch) => ledger.map((row, i) => i === index ? { ...row, ...patch } : row);

test("allows verified batches 1 x 23.02 and 8 x 21.58 at frozen weighted cost 21.74", () => {
  assert.equal(check(ledger), true);
});

test("does not require historical opening batches to equal the new average", () => {
  assert.equal(check(ledger.slice(0, 2), 9, 19566), true);
  assert.equal(check(ledger, 8, 17392, 2302), false);
});

test("rejects missing or altered quantity/value movements", () => {
  assert.equal(check(modify(1, { valueDeltaMinor: 17263 })), false);
  assert.equal(check(modify(2, { quantityDelta: -2 })), false);
  assert.equal(check(modify(3, { valueAfterMinor: 19567 })), false);
});

test("rejects an unapproved batch or unexpected cost source", () => {
  assert.equal(check(modify(1, { costQuality: "estimated" })), false);
  assert.equal(check(modify(1, { sourceType: "unknown" })), false);
  assert.equal(check(modify(1, { eventType: "mystery" })), false);
});

test("rejects a change of cost after the latest acquisition", () => {
  assert.equal(check(modify(3, { valueDeltaMinor: 2175, valueAfterMinor: 19567 })), false);
  assert.equal(check(modify(4, { valueDeltaMinor: -2173, valueAfterMinor: 17394 })), false);
});

test("rejects a cost correction that has not been audited via owner attestation", () => {
  assert.equal(check([...ledger, {
    eventType: "correction", sourceType: "unknown", quantityDelta: 0,
    valueDeltaMinor: 0, quantityAfter: 8, valueAfterMinor: 17392, costQuality: "confirmed",
  }]), false);
});

test("allows a zero-value owner attestation event", () => {
  assert.equal(check([...ledger, {
    eventType: "correction", sourceType: "owner_cost_quality_attestation",
    quantityDelta: 0, valueDeltaMinor: 0, quantityAfter: 8,
    valueAfterMinor: 17392, costQuality: "confirmed",
  }]), true);
});

test("rejects a partial ledger, mismatched stock or non-matching unit cost", () => {
  assert.equal(check(ledger.slice(1)), false);
  assert.equal(check(ledger, 7, 17392), false);
  assert.equal(check(ledger, 8, 17393), false);
  assert.equal(check(ledger, 8, 17392, 0), false);
});

test("does not allow late purchase at a new price to pass with the old average", () => {
  assert.equal(check([...ledger, {
    eventType: "purchase", sourceType: "pos_purchase", quantityDelta: 1,
    valueDeltaMinor: 2302, quantityAfter: 9, valueAfterMinor: 19694,
    costQuality: "confirmed",
  }], 9, 19694), false);
});
