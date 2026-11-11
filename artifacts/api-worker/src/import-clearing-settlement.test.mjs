import test from "node:test";
import assert from "node:assert/strict";
import {previewImportClearingSettlement} from "./import-clearing-settlement.ts";

const sample=()=>({
  caseRef:"IMP-001",
  invoices:[
    {invoiceRef:"I1",supplierId:5,goodsIlsMinor:350000,
      supplierAdvanceIlsMinor:350000,freightAllocatedIlsMinor:15000,
      capitalizableTravelIlsMinor:5000,purchaseLiabilityIlsMinor:370000},
    {invoiceRef:"I2",supplierId:6,goodsIlsMinor:175000,
      supplierAdvanceIlsMinor:175000,freightAllocatedIlsMinor:10000,
      capitalizableTravelIlsMinor:2500,purchaseLiabilityIlsMinor:187500},
  ],
  shipments:[{shipmentRef:"S1",freightPaidIlsMinor:25000,freightAllocatedIlsMinor:25000}],
  totalTravelPaidIlsMinor:7500,totalTravelDistributedIlsMinor:7500,
  travelCapitalizableIlsMinor:7500,
});
test("fully paid import with 2 suppliers clears advances, shipping and travel once",()=>{
  const out=previewImportClearingSettlement(sample());
  assert.equal(out.ready,true);
  assert.equal(out.balanced,true);
  assert.equal(out.debitMinor,out.creditMinor);
  assert.equal(out.journalLines.some(x=>x.accountCode==="PURCHASE_INVENTORY"),false);
  assert.equal(out.journalLines.filter(x=>x.accountCode==="SUPPLIER_PAYABLE_CONTROL")
    .reduce((s,l)=>s+l.debitMinor,0),557500);
  assert.equal(out.reclassifiedAdvanceIlsMinor,525000);
  assert.equal(out.reclassifiedShipmentFreightIlsMinor,25000);
  assert.equal(out.reclassifiedCapitalizableTravelIlsMinor,7500);
  assert.equal(out.remainingSupplierLiabilityIlsMinor,0);
});
test("unpaid vendor goods remain as supplier payable, not phantom cash",()=>{
  const data=sample();
  data.invoices[1].supplierAdvanceIlsMinor=75000;
  const out=previewImportClearingSettlement(data);
  assert.equal(out.ready,true);
  assert.equal(out.remainingSupplierLiabilityIlsMinor,100000);
  assert.equal(out.reclassifiedAdvanceIlsMinor,425000);
});
test("non-capitalizable travel flows once to operating expense, not inventory",()=>{
  const data=sample();
  data.invoices[0].capitalizableTravelIlsMinor=0;
  data.invoices[0].purchaseLiabilityIlsMinor=365000;
  data.travelCapitalizableIlsMinor=2500;
  const out=previewImportClearingSettlement(data);
  assert.equal(out.ready,true);
  assert.equal(out.recognizedTravelExpenseIlsMinor,5000);
  assert.equal(out.journalLines.filter(x=>x.accountCode==="IMPORT_TRAVEL_OPERATING_EXPENSE")
    .reduce((s,l)=>s+l.debitMinor,0),5000);
  assert.equal(out.journalLines.some(x=>x.accountCode==="PURCHASE_INVENTORY"),false);
});
test("missing paid freight blocks automated clearing",()=>{
  const data=sample();data.shipments[0].freightPaidIlsMinor=24500;
  const out=previewImportClearingSettlement(data);
  assert.equal(out.ready,false);
  assert.ok(out.blockers.some(x=>x.includes("الشحنة")));
});
test("double loading freight from Excel against supplier receipt is rejected",()=>{
  const data=sample();data.invoices[0].purchaseLiabilityIlsMinor=385000;
  const out=previewImportClearingSettlement(data);
  assert.equal(out.ready,false);
  assert.ok(out.blockers.some(x=>x.includes("قيد شراء المخزون")));
});
test("travel distributed more than actual cash payments blocks settlement",()=>{
  const data=sample();data.totalTravelPaidIlsMinor=6000;
  assert.equal(previewImportClearingSettlement(data).ready,false);
});
test("same supplier invoice cannot be applied twice",()=>{
  const data=sample();data.invoices[1].invoiceRef="I1";
  assert.equal(previewImportClearingSettlement(data).ready,false);
});
test("advance payment must never exceed vendor merchandise cost",()=>{
  const data=sample();data.invoices[0].supplierAdvanceIlsMinor=360000;
  assert.equal(previewImportClearingSettlement(data).ready,false);
});
test("travelling not required for remote shipment",()=>{
  const data=sample();
  data.totalTravelPaidIlsMinor=0;
  data.totalTravelDistributedIlsMinor=0;
  data.travelCapitalizableIlsMinor=0;
  data.invoices[0].capitalizableTravelIlsMinor=0;
  data.invoices[1].capitalizableTravelIlsMinor=0;
  data.invoices[0].purchaseLiabilityIlsMinor=365000;
  data.invoices[1].purchaseLiabilityIlsMinor=185000;
  assert.equal(previewImportClearingSettlement(data).ready,true);
});

test("existing supplier voucher reduces open goods liability but is NOT posted a second time",()=>{
  const data=sample();
  data.invoices[0].supplierAdvanceIlsMinor=200000;
  data.invoices[0].supplierVoucherAlreadyPaidIlsMinor=150000;
  const out=previewImportClearingSettlement(data);
  assert.equal(out.ready,true);
  assert.equal(out.reclassifiedAdvanceIlsMinor,375000);
  assert.equal(out.supplierVouchersAlreadyAppliedIlsMinor,150000);
  assert.equal(out.remainingSupplierLiabilityIlsMinor,0);
  assert.equal(out.journalLines.filter(line=>line.accountCode==="IMPORT_SUPPLIER_ADVANCES")
    .reduce((sum,line)=>sum+line.creditMinor,0),375000);
  assert.equal(out.journalLines.some(line=>line.memo.includes("سند صرف")),false);
});
test("supplier voucher and USD advance together cannot overpay the goods amount",()=>{
  const data=sample();
  data.invoices[0].supplierVoucherAlreadyPaidIlsMinor=100;
  assert.equal(previewImportClearingSettlement(data).ready,false);
});
test("partially settled supplier invoice preserves only genuinely unpaid goods balance",()=>{
  const data=sample();
  data.invoices[0].supplierAdvanceIlsMinor=100000;
  data.invoices[0].supplierVoucherAlreadyPaidIlsMinor=75000;
  const out=previewImportClearingSettlement(data);
  assert.equal(out.ready,true);
  assert.equal(out.remainingSupplierLiabilityIlsMinor,175000);
});
