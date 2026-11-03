import assert from "node:assert/strict";
import test from "node:test";
import { allocateMinor, computeReturnRefundMinor, distributeFullReturn, splitAmount } from "./purchase-return-rules.ts";

test("12 pieces split between three colors: partial 2 white + 2 pink, leaves 8 physical", () => {
  const options = [ { stock: 4 }, { stock: 4 }, { stock: 4 } ];
  const selected = [2, 2, 0];
  assert.equal(selected.reduce((a,b)=>a+b,0),4);
  assert.deepEqual(options.map((o,i) => o.stock - selected[i]), [2,2,4]);
  assert.deepEqual(distributeFullReturn(12, options), [4,4,4]);
  assert.deepEqual(distributeFullReturn(4, options), [4,0,0]);
});

test("partial refunds sum exactly to original invoice amount incl final penny", () => {
  const originalAmountMinor = 100;
  let qty = 0, refund = 0;
  for (const toReturn of [1, 1, 1]) {
    const amount = computeReturnRefundMinor({
      originalAmountMinor, originalQuantity: 3,
      previouslyReturnedQuantity: qty, previouslyRefundedMinor: refund, returnQuantity: toReturn,
    });
    qty += toReturn; refund += amount;
  }
  assert.equal(qty,3);
  assert.equal(refund,100);
});

test("bulk refund splits deterministically by color and size with no lost pennies", () => {
  assert.deepEqual(splitAmount(100, [2, 2, 4]), [25, 25, 50]);
  assert.deepEqual(splitAmount(101, [1,1,1]), [33,34,34]);
  assert.equal(splitAmount(101, [2, 3, 4]).reduce((a,b)=>a+b,0),101);
  assert.deepEqual(splitAmount(0, [1, 2]), [0, 0]);
});

test("no return larger than invoice remainder or physical stock", () => {
  assert.throws(() => computeReturnRefundMinor({
    originalAmountMinor: 1200, originalQuantity: 12, previouslyReturnedQuantity: 10,
    previouslyRefundedMinor: 1000, returnQuantity: 3,
  }), /PURCHASE_RETURN_EXCEEDS_ORIGINAL/);
  assert.throws(() => distributeFullReturn(5, [{ stock: 2 }, { stock: 2 }]), /INSUFFICIENT_PHYSICAL_STOCK/);
  assert.deepEqual(distributeFullReturn(4, [{ stock: 4, allowed: false }, { stock: 4 }]), [0, 4]);
});

test("full remaining uses unrefunded balance instead of duplicate accounting", () => {
  assert.equal(computeReturnRefundMinor({
    originalAmountMinor: 101, originalQuantity: 3, previouslyReturnedQuantity: 2,
    previouslyRefundedMinor: 66, returnQuantity: 1,
  }), 35);
  assert.equal(computeReturnRefundMinor({
    originalAmountMinor: 0, originalQuantity: 5, previouslyReturnedQuantity: 0,
    previouslyRefundedMinor: 0, returnQuantity: 5,
  }), 0);
  assert.equal(allocateMinor(1300, 2, 4),650);
});
