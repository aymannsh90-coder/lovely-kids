import assert from "node:assert/strict";
import { test } from "node:test";
import { allocateDeferredPurchaseCost as allocate } from "./deferred-purchase-cost-math.ts";

test("60 received, one sold before invoice, no inventory duplication", () => {
  const r = allocate({ receivedQuantity: 60, receiptCostTotalMinor: 36000,
    sales: [{ saleItemId: 11, quantity: 1, returns: [] }] });
  assert.equal(r.stockQuantityApplied, 59);
  assert.equal(r.netSoldQuantity, 1);
  assert.equal(r.stockCostTotalMinor, 35400);
  assert.equal(r.netSoldCostTotalMinor, 600);
  assert.equal(r.stockCostTotalMinor + r.netSoldCostTotalMinor, 36000);
});

test("return before approval restores stock and offsets sale cost", () => {
  const r = allocate({ receivedQuantity: 60, receiptCostTotalMinor: 35600,
    sales: [{ saleItemId: 11, quantity: 3,
      returns: [{ returnItemId: 9, quantity: 2 }] }] });
  assert.equal(r.stockQuantityApplied, 59);
  assert.equal(r.allocations[0].returns[0].costTotalMinor, 1186);
  assert.equal(r.stockCostTotalMinor + r.netSoldCostTotalMinor, 35600);
});

test("same item can be sold again after return, exact COGS remains conserved", () => {
  const r = allocate({ receivedQuantity: 2, receiptCostTotalMinor: 203,
    sales: [{ saleItemId: 1, quantity: 2,
      returns: [{ returnItemId: 1, quantity: 2 }] },
      { saleItemId: 2, quantity: 2, returns: [] }] });
  assert.equal(r.stockQuantityApplied, 0);
  assert.equal(r.netSoldCostTotalMinor, 203);
  assert.equal(r.stockCostTotalMinor, 0);
});

test("all returned yields original inventory cost", () => {
  const r = allocate({ receivedQuantity: 5, receiptCostTotalMinor: 1099,
    sales: [{ saleItemId: 7, quantity: 3,
      returns: [{ returnItemId: 4, quantity: 1 }, { returnItemId: 6, quantity: 2 }] }] });
  assert.equal(r.stockQuantityApplied, 5);
  assert.equal(r.netSoldCostTotalMinor, 0);
  assert.equal(r.stockCostTotalMinor, 1099);
});

test("rejects sale beyond received quantity", () => {
  assert.throws(() => allocate({receivedQuantity: 2,receiptCostTotalMinor:100,
    sales:[{saleItemId:1,quantity:3,returns:[]}]}),/Sale exceeds receipt/);
});

test("rejects returns exceeding sale quantity", () => {
  assert.throws(() => allocate({receivedQuantity: 2,receiptCostTotalMinor:100,
    sales:[{saleItemId:1,quantity:1,returns:[{returnItemId:1,quantity:2}]}]}),/Return exceeds sale/);
});
