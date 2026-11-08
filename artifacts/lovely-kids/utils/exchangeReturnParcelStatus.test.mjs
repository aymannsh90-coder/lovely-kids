import assert from "node:assert/strict";
import test from "node:test";
import {
  getExchangeReturnParcelState,
  countExchangeReturnParcels,
} from "./exchangeReturnParcelStatus.ts";

const receipt = {
  exchangePublicId: "EXC-20261103-42E6B805EDDD",
  exchangeFinancialCompletedAt: "2026-11-04T16:02:23Z",
  exchangeReturnReceivedAt: "2026-11-08T14:17:37Z",
};

test("a received old parcel is not counted as pending even if replacement was delivered", () => {
  assert.equal(getExchangeReturnParcelState(receipt), "received");
  assert.deepEqual(countExchangeReturnParcels([receipt]), {
    pending: 0, received: 1, awaiting_delivery: 0,
  });
});

test("not yet physically received after financial completion is pending follow-up", () => {
  const pending = { ...receipt, exchangeReturnReceivedAt: null };
  assert.equal(getExchangeReturnParcelState(pending), "pending");
  assert.deepEqual(countExchangeReturnParcels([receipt, pending]), {
    pending: 1, received: 1, awaiting_delivery: 0,
  });
});

test("uncompleted replacement exchange is not counted as waiting at courier", () => {
  const unsent = { ...receipt, exchangeReturnReceivedAt: null, exchangeFinancialCompletedAt: null };
  assert.equal(getExchangeReturnParcelState(unsent), "awaiting_delivery");
  assert.deepEqual(countExchangeReturnParcels([unsent]), {
    pending: 0, received: 0, awaiting_delivery: 1,
  });
});

test("ordinary orders and merged rows do not inflate counts", () => {
  const pending = { ...receipt, exchangeReturnReceivedAt: null };
  assert.equal(getExchangeReturnParcelState({ exchangePublicId: null }), null);
  assert.deepEqual(countExchangeReturnParcels([
    { exchangePublicId: null, exchangeReturnReceivedAt: null },
    receipt,
    { ...pending, mergedIntoOrderId: 50 },
    pending,
    { ...receipt, exchangePublicId: "  " },
  ]), { pending: 1, received: 1, awaiting_delivery: 0 });
});

test("once receipt is confirmed, it moves to received and pending decreases", () => {
  const before = { ...receipt, exchangeReturnReceivedAt: null };
  const after = { ...before, exchangeReturnReceivedAt: receipt.exchangeReturnReceivedAt };
  assert.equal(countExchangeReturnParcels([before]).pending, 1);
  assert.equal(countExchangeReturnParcels([after]).pending, 0);
  assert.equal(countExchangeReturnParcels([after]).received, 1);
});
