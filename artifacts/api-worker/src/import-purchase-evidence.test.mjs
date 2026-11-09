import test from "node:test";
import assert from "node:assert/strict";
import {verifyApprovedPurchaseEvidence} from "./import-purchase-evidence.ts";

function sample() {
  return {
    purchase: {id:132,supplierId:8,status:"completed",currencyCode:"ILS",
      paymentMethod:"credit",totalMinor:25000,paidMinor:0,dueMinor:25000},
    itemCosts: [
      {itemId:301,productId:10,entryMode:"stock_receipt",receivedQuantity:2,
       stockQuantityApplied:2,costTotalMinor:15000,stockCostTotalMinor:15000,
       historicalSoldQuantity:0,historicalAllocationPending:false,costQuality:"confirmed"},
      {itemId:302,productId:11,entryMode:"stock_receipt",receivedQuantity:1,
       stockQuantityApplied:1,costTotalMinor:10000,stockCostTotalMinor:10000,
       historicalSoldQuantity:0,historicalAllocationPending:false,costQuality:"confirmed"},
    ],
    ledgerRows:[
      {sourceItemRef:"301",productId:10,eventType:"purchase",quantityDelta:2,inventoryValueDeltaMinor:15000},
      {sourceItemRef:"302",productId:11,eventType:"purchase",quantityDelta:1,inventoryValueDeltaMinor:10000},
    ],
    transactionStatus:"posted",
    transactionCount:1,
    financialLines:[
      {accountCode:"PURCHASE_INVENTORY",supplierId:null,debitMinor:25000,creditMinor:0},
      {accountCode:"SUPPLIER_PAYABLE_CONTROL",supplierId:8,debitMinor:0,creditMinor:25000},
    ],
  };
}
test("existing ILS purchase with confirmed cost snapshots and one GL entry links safely",()=>{
  const x=verifyApprovedPurchaseEvidence(sample(),8);
  assert.equal(x.valid,true);
  assert.equal(x.inventoryCostIlsMinor,25000);
  assert.equal(x.ledgerInventoryIlsMinor,25000);
  assert.equal(x.supplierPayableIlsMinor,25000);
  assert.equal(x.receiptQuantity,3);
});
test("must not link vendor invoice to a different supplier",()=>{
  const d=sample(); assert.equal(verifyApprovedPurchaseEvidence(d,11).valid,false);
});
test("voided or foreign-currency purchase is rejected",()=>{
  const d=sample();d.purchase.status="voided";assert.equal(verifyApprovedPurchaseEvidence(d,8).valid,false);
  d.purchase.status="completed";d.purchase.currencyCode="USD";
  assert.equal(verifyApprovedPurchaseEvidence(d,8).valid,false);
});
test("cash or mixed purchase would pay supplier a second time",()=>{
  const d=sample();d.purchase.paymentMethod="cash";d.purchase.paidMinor=25000;d.purchase.dueMinor=0;
  assert.equal(verifyApprovedPurchaseEvidence(d,8).valid,false);
});
test("purchase without a posted GL journal is rejected",()=>{
  const d=sample();d.transactionStatus="reversed";
  assert.equal(verifyApprovedPurchaseEvidence(d,8).valid,false);
  d.transactionStatus="posted";d.transactionCount=2;
  assert.equal(verifyApprovedPurchaseEvidence(d,8).valid,false);
});
test("missing or duplicated cost ledger entry blocks proof of stock receipt",()=>{
  const d=sample();d.ledgerRows.pop();
  assert.equal(verifyApprovedPurchaseEvidence(d,8).valid,false);
  d.ledgerRows.push(d.ledgerRows[0]);
  assert.equal(verifyApprovedPurchaseEvidence(d,8).valid,false);
});
test("a historical, estimated or partly sold batch cannot silently pass",()=>{
  const d=sample();d.itemCosts[0].entryMode="historical";
  assert.equal(verifyApprovedPurchaseEvidence(d,8).valid,false);
  d.itemCosts[0].entryMode="stock_receipt";d.itemCosts[0].costQuality="mixed";
  assert.equal(verifyApprovedPurchaseEvidence(d,8).valid,false);
});
test("total inventory, supplier payable and inventory engine must match",()=>{
  const d=sample();d.financialLines[0].debitMinor=24000;
  assert.equal(verifyApprovedPurchaseEvidence(d,8).valid,false);
  d.financialLines[0].debitMinor=25000;d.itemCosts[0].costTotalMinor=14000;
  assert.equal(verifyApprovedPurchaseEvidence(d,8).valid,false);
});
test("unexpected cash/bank line or equity bridge is not an import receipt",()=>{
  const d=sample();d.financialLines.push({accountCode:"CASH_MAIN",supplierId:null,debitMinor:0,creditMinor:100});
  assert.equal(verifyApprovedPurchaseEvidence(d,8).valid,false);
});
