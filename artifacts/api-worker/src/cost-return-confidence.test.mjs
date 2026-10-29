import assert from "node:assert/strict";
import test from "node:test";
import { isStableApprovedReturnCost } from "./cost-return-confidence.ts";

const UNIT = 1572;
const event = (eventType, quantityAfter, options = {}) => ({
  eventType,
  sourceType: null,
  costQuality: "confirmed",
  quantityAfter,
  valueAfterMinor: quantityAfter * UNIT,
  note: null,
  ...options,
});

test("approved opening cost survives sales and same-cost purchases", () => {
  const events = [
    event("purchase", 12),
    event("pos_sale", 7),
    event("purchase", 8),
    event("opening", 2),
  ];
  assert.equal(isStableApprovedReturnCost(events, UNIT, true), true);
});

test("stable approved opening cost works without repeated owner confirmation", () => {
  assert.equal(isStableApprovedReturnCost([event("opening", 10)], UNIT, true), true);
});

test("different cost batch must not be inferred from a current average", () => {
  const events = [
    event("purchase", 10, { valueAfterMinor: 16000 }),
    event("opening", 5),
  ];
  assert.equal(isStableApprovedReturnCost(events, 1600, true), false);
});

test("earlier mixed or estimated return is not silently reclassified", () => {
  const events = [
    event("pos_sale", 4, { costQuality: "mixed" }),
    event("pos_mobile_return", 5, { costQuality: "mixed" }),
    event("opening", 4),
  ];
  assert.equal(isStableApprovedReturnCost(events, UNIT, true), false);
});

test("a costless empty opening does not establish purchase cost", () => {
  assert.equal(isStableApprovedReturnCost([event("opening", 0)], UNIT, true), false);
});

test("owner-attested fixed cost permits later ordinary sales and same-cost purchase", () => {
  const owner = event("correction", 8, {
    sourceType: "owner_cost_quality_attestation",
    note: "Owner verified unit cost 1572 minor units without claiming original sale linkage. Returns: R1. Reason: Verified invoices.",
  });
  const events = [
    event("purchase", 15),
    event("pos_sale", 10),
    owner,
    event("pos_return", 8, { costQuality: "mixed" }),
  ];
  assert.equal(isStableApprovedReturnCost(events, UNIT, true), true);
});

test("unverified new return after owner attestation invalidates the proof", () => {
  const owner = event("correction", 8, {
    sourceType: "owner_cost_quality_attestation",
    note: "Owner verified unit cost 1572 minor units without claiming original sale linkage.",
  });
  const events = [
    event("exchange_return", 9, { costQuality: "mixed" }),
    owner,
    event("pos_return", 8, { costQuality: "mixed" }),
  ];
  assert.equal(isStableApprovedReturnCost(events, UNIT, true), false);
});

test("a subsequent manual cost correction requires re-evaluation", () => {
  const owner = event("correction", 8, {
    sourceType: "owner_cost_quality_attestation",
    note: "Owner verified unit cost 1572 minor units without claiming original sale linkage.",
  });
  assert.equal(isStableApprovedReturnCost([
    event("correction", 8, { sourceType: "opening_cost_correction" }),
    owner,
  ], UNIT, true), false);
});

test("incomplete history is never enough to certify cost", () => {
  assert.equal(isStableApprovedReturnCost([event("opening", 10)], UNIT, false), false);
});

test("an unrelated note without an approved opening is not certification", () => {
  const events = [
    event("correction", 10, { note: "Owner confirmed amount", sourceType: "owner_cost_quality_attestation" }),
  ];
  assert.equal(isStableApprovedReturnCost(events, UNIT, true), false);
});
