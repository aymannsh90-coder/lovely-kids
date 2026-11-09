import test from "node:test";
import assert from "node:assert/strict";
import { previewImportClosing } from "./import-close-readiness.ts";

const ready = () => ({
  excelBalanced: true, excelErrors: [],
  invoices: [
    { ref:"A",goodsUsdMinor:100000,goodsBookedIlsMinor:350000,
      paidUsdMinor:100000,advanceIlsMinor:350000,
      remainingPayableIlsMinor:0,payableJournalVerified:false },
    { ref:"B",goodsUsdMinor:50000,goodsBookedIlsMinor:180000,
      paidUsdMinor:50000,advanceIlsMinor:180000,
      remainingPayableIlsMinor:0,payableJournalVerified:false },
  ],
  shipments: [
    { ref:"S1",freightIlsMinor:15000,customsIlsMinor:6000,localTransportIlsMinor:1000,
      paidFreightIlsMinor:15000,paidCustomsIlsMinor:6000,paidLocalTransportIlsMinor:1000,
      hasInventoryReceipt:true,purchasePostingMatched:true },
  ],
  travelRecordedIlsMinor:10000,travelPaidIlsMinor:10000,
  travelClassificationApproved:true,inventoryCostEngineReconciled:true,
  settlementJournalVerified:true,
});

test("only a complete reconciled case is eligible for accounting close", () => {
  const out = previewImportClosing(ready());
  assert.equal(out.canCloseAccounting,true);
  assert.equal(out.reasons.length,0);
  assert.equal(out.totalUsdMinor,150000);
  assert.equal(out.recordedSupplierAdvanceIlsMinor,530000);
  assert.equal(out.directCostPlannedIlsMinor,22000);
});

test("unpaid shipping blocks closing independently of Excel", () => {
  const sample=ready();
  sample.shipments[0].paidCustomsIlsMinor=0;
  const out=previewImportClosing(sample);
  assert.equal(out.canCloseAccounting,false);
  assert.ok(out.reasons.some(x=>x.includes("التخليص")));
});

test("unverified inventory posting blocks double-capitalization", () => {
  const sample=ready();
  sample.shipments[0].purchasePostingMatched=false;
  sample.inventoryCostEngineReconciled=false;
  const out=previewImportClosing(sample);
  assert.equal(out.canCloseAccounting,false);
  assert.ok(out.reasons.some(x=>x.includes("قيد شراء المخزون")));
});

test("trip may legitimately be absent", () => {
  const sample=ready();
  sample.travelRecordedIlsMinor=0; sample.travelPaidIlsMinor=0;
  sample.travelClassificationApproved=false;
  assert.equal(previewImportClosing(sample).canCloseAccounting,true);
});

test("trip must be paid and classified, not automatically capitalized", () => {
  const sample=ready();
  sample.travelClassificationApproved=false;
  sample.travelPaidIlsMinor=8000;
  const out=previewImportClosing(sample);
  assert.equal(out.canCloseAccounting,false);
  assert.ok(out.reasons.some(x=>x.includes("تصنيف")));
});

test("missing USD supplier payment may close only if actual payable journal exists", () => {
  const sample=ready();
  sample.invoices[1].paidUsdMinor=0;
  sample.invoices[1].advanceIlsMinor=0;
  sample.invoices[1].remainingPayableIlsMinor=180000;
  sample.invoices[1].payableJournalVerified=false;
  assert.equal(previewImportClosing(sample).canCloseAccounting,false);
  sample.invoices[1].payableJournalVerified=true;
  assert.equal(previewImportClosing(sample).canCloseAccounting,true);
});

test("fully prepaid invoices cannot leave a phantom supplier liability", () => {
  const sample=ready();
  sample.invoices[0].remainingPayableIlsMinor=2000;
  assert.equal(previewImportClosing(sample).canCloseAccounting,false);
});

test("Excel inconsistency blocks close even when all money paid", () => {
  const sample=ready();
  sample.excelBalanced=false;
  assert.equal(previewImportClosing(sample).canCloseAccounting,false);
});

test("reversed or missing inventory receipt must block close", () => {
  const sample=ready();
  sample.shipments[0].hasInventoryReceipt=false;
  assert.equal(previewImportClosing(sample).canCloseAccounting,false);
});

test("cost ledger match alone is NOT permission to close before clearing accounts are settled", () => {
  const sample=ready();
  sample.settlementJournalVerified=false;
  const out=previewImportClosing(sample);
  assert.equal(out.canCloseAccounting,false);
  assert.ok(out.reasons.some(x=>x.includes("قيد تسوية")));
});
