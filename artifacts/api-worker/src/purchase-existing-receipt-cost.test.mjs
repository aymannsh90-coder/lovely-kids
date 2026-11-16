import assert from "node:assert/strict";
import { test } from "node:test";
import { proveExistingReceiptCost as prove } from "./purchase-existing-receipt-cost.ts";

function example(receivedQuantity=32, unitCost=191, sold=1) {
  return {
    receivedQuantity, receiptCostTotalMinor:receivedQuantity*unitCost,
    pendingReceiptQuantity:receivedQuantity, deferredSoldQuantity:0,
    physicalQuantity:receivedQuantity-sold, costQuantity:receivedQuantity-sold,
    costValueMinor:(receivedQuantity-sold)*unitCost,
    referenceUnitCostMinor:unitCost, costQuality:"confirmed",
    ledger:[
      {sourceType:"manual_opening",eventType:"opening",quantityDelta:receivedQuantity,
        inventoryValueDeltaMinor:receivedQuantity*unitCost,costQuality:"confirmed"},
      ...(sold?[{sourceType:"online_order",eventType:"online_order",quantityDelta:-sold,
        inventoryValueDeltaMinor:-sold*unitCost,costQuality:"confirmed"}]:[])
    ]
  };
}

test("Dondolar socks: reuse 31 already-costed units, link one frozen sale",()=>{
  const result=prove(example());
  assert.deepEqual(result,{stockQuantityApplied:31,stockCostTotalMinor:5921,
    historicalSoldQuantity:1,historicalSoldCostTotalMinor:191});
});

test("fully precosted product does not add inventory again",()=>{
  const result=prove(example(12,2261,0));
  assert.equal(result?.stockQuantityApplied,12);
  assert.equal(result?.historicalSoldQuantity,0);
  assert.equal(result?.stockCostTotalMinor,27132);
});

test("rejects unmatched opening unit cost",()=>{
  const x=example();x.ledger[0].inventoryValueDeltaMinor+=1;
  assert.equal(prove(x),null);
});

test("rejects product with historical purchase or return",()=>{
  const x=example();x.ledger.push({sourceType:"pos_purchase",eventType:"purchase",
    quantityDelta:1,inventoryValueDeltaMinor:191,costQuality:"confirmed"});
  assert.equal(prove(x),null);
});

test("rejects quantity already in a different pending draft",()=>{
  const x=example();x.pendingReceiptQuantity+=1;
  assert.equal(prove(x),null);
});

test("rejects simultaneous deferred sale requiring a different workflow",()=>{
  const x=example();x.deferredSoldQuantity=1;
  assert.equal(prove(x),null);
});

test("rejects stale physical/engine quantity or stale value",()=>{
  const a=example();a.physicalQuantity+=1;assert.equal(prove(a),null);
  const b=example();b.costValueMinor+=1;assert.equal(prove(b),null);
});

test("rejects discounted invoice and estimated opening",()=>{
  const a=example();a.receiptCostTotalMinor-=1;assert.equal(prove(a),null);
  const b=example();b.costQuality="estimated";assert.equal(prove(b),null);
});

test("rejects unsupported sale types rather than silently losing COGS",()=>{
  const x=example();x.ledger[1].sourceType="online_order_edit";
  assert.equal(prove(x),null);
});
