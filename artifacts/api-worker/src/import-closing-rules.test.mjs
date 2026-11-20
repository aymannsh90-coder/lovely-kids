import test from "node:test";
import assert from "node:assert/strict";
import { importClosePlanHash, requireCloseReady, reverseImportCloseLines } from "./import-closing-rules.ts";

const plan=()=>({
  caseId:4,revision:2,
  journalLines:[
    {accountCode:"SUPPLIER_PAYABLE_CONTROL",supplierId:5,debitMinor:3000,creditMinor:0},
    {accountCode:"IMPORT_SUPPLIER_ADVANCES",supplierId:5,debitMinor:0,creditMinor:3000},
  ],
  costGroups:[{allocationRef:"A",expectedAccountingIlsMinor:3000,linkedAccountingIlsMinor:3000,valid:true}],
  purchaseLinks:[{id:1,purchaseId:10,valid:true,inventoryCostIlsMinor:3000}],
  supplierVouchers:[{id:2,voucherId:20,verified:true,amountIlsMinor:1000}],
  advances:[{paymentId:3,financeTransactionId:77,journalVerified:true,advanceIlsMinor:3000}],
  costs:[],
  supplierBalances:[{supplierId:5,currentPayableIlsMinor:5000,plannedDebitIlsMinor:3000}],
});
const approval=(overrides={})=>{
  const data=plan();
  return {
    status:"draft",planHash:importClosePlanHash(data),expectedPlanHash:importClosePlanHash(data),
    canPrepare:true,journalLines:data.journalLines,accountingReasons:[
      "قيد تسوية مقدمات المورد والشحن والسفر غير مربوط أو غير مرحل",
      "تصنيف تكاليف السفر بين المخزون والمصاريف يحتاج اعتمادًا",
    ],travelClassificationConfirmed:true,hasTravel:true,...overrides,
  };
};
test("plan fingerprint insensitive to row ordering but sensitive to source payment edit",()=>{
  const base=plan();
  const first=importClosePlanHash(base);
  const other=plan();
  other.journalLines.reverse();
  assert.equal(importClosePlanHash(other),first);
  other.supplierVouchers[0].amountIlsMinor++;
  assert.notEqual(importClosePlanHash(other),first);
});
test("an approved balanced non-stock settlement passes preparation",()=>{
  assert.deepEqual(requireCloseReady(approval()),[]);
});
test("travel requires explicit classification approval, never implicit",()=>{
  assert.ok(requireCloseReady(approval({travelClassificationConfirmed:false})).some(x=>x.includes("السفر")));
});
test("stale review token / GL source changes cannot close",()=>{
  assert.ok(requireCloseReady(approval({expectedPlanHash:"0".repeat(64)})).length>0);
  assert.ok(requireCloseReady(approval({canPrepare:false})).length>0);
});
test("actual journal must never post an additional inventory debit or bank/cash credit",()=>{
  for(const accountCode of ["PURCHASE_INVENTORY","BANK_ILS","CASH_MAIN"]){
    const draft=approval({
      journalLines:[
        {accountCode,supplierId:null,debitMinor:10,creditMinor:0},
        {accountCode:"IMPORT_SUPPLIER_ADVANCES",supplierId:null,debitMinor:0,creditMinor:10},
      ],
    });
    assert.ok(requireCloseReady(draft).some(x=>x.includes("المخزون")));
  }
});
test("unexplained accounting failure blocks even when plan internally balances",()=>{
  assert.ok(requireCloseReady(approval({accountingReasons:["فاتورة مورد ملغاة"]})).length>0);
});
test("reversal mirrors exact original ledger lines with same account and supplier",()=>{
  const x=reverseImportCloseLines([
    {accountId:11,supplierId:5,debitMinor:3000,creditMinor:0},
    {accountId:19,supplierId:5,debitMinor:0,creditMinor:3000},
  ]);
  assert.equal(x[0].creditMinor,3000);
  assert.equal(x[1].debitMinor,3000);
  assert.equal(x[1].supplierId,5);
});
