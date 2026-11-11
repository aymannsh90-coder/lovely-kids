import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyExistingIlsSupplierVoucher, previewVoucherAllocation,
} from "./import-supplier-voucher-claims.ts";

const fixture=()=>({
  voucher:{
    id:42,voucherType:"payment",voucherPurpose:"supplier_payment",
    partyType:"supplier",partyId:12,currencyCode:"ILS",amountMinor:20000,
    status:"posted",financeTransactionId:87,
  },
  journal:{
    id:87,status:"posted",transactionType:"payment",sourceType:"finance_voucher",
    sourceId:"42",sourceEvent:"payment",
  },
  lines:[
    {accountCode:"SUPPLIER_PAYABLE_CONTROL",accountCurrencyCode:"ILS",
     supplierId:12,debitMinor:20000,creditMinor:0},
    {accountCode:"CASH_MAIN",accountCurrencyCode:"ILS",
     supplierId:null,debitMinor:0,creditMinor:20000},
  ],
});

test("original posted ILS supplier payment voucher is valid evidence, not a new payment",()=>{
  assert.deepEqual(verifyExistingIlsSupplierVoucher(fixture(),12),
    {verified:true,reasons:[]});
});
test("must never attribute a voucher to another supplier",()=>{
  assert.equal(verifyExistingIlsSupplierVoucher(fixture(),13).verified,false);
});
test("voided voucher or reversed finance transaction is not payment evidence",()=>{
  const x=fixture();x.voucher.status="voided";
  assert.equal(verifyExistingIlsSupplierVoucher(x,12).verified,false);
  x.voucher.status="posted";x.journal.status="reversed";
  assert.equal(verifyExistingIlsSupplierVoucher(x,12).verified,false);
});
test("source id and voucher financial transaction must match",()=>{
  const x=fixture();x.journal.sourceId="43";
  assert.equal(verifyExistingIlsSupplierVoucher(x,12).verified,false);
  x.journal.sourceId="42";x.voucher.financeTransactionId=9;
  assert.equal(verifyExistingIlsSupplierVoucher(x,12).verified,false);
});
test("rejected bank source with incorrect currency or missing supplier liability line",()=>{
  const x=fixture();x.lines[1].accountCurrencyCode="USD";
  assert.equal(verifyExistingIlsSupplierVoucher(x,12).verified,false);
  x.lines[1].accountCurrencyCode="ILS";x.lines[0].debitMinor=19900;
  assert.equal(verifyExistingIlsSupplierVoucher(x,12).verified,false);
});
test("voucher is divisible across two invoices but total cannot exceed its amount",()=>{
  assert.deepEqual(previewVoucherAllocation(20000,[7000],13000),
    {valid:true,remainingIlsMinor:0,error:null});
  assert.equal(previewVoucherAllocation(20000,[7000],13001).valid,false);
  assert.equal(previewVoucherAllocation(20000,[7000,13000],1).valid,false);
});
test("invalid, floating, negative voucher claims are always refused",()=>{
  for(const amount of [0,-1,1.5,Number.MAX_SAFE_INTEGER]){
    assert.equal(previewVoucherAllocation(20000,[],amount).valid,false);
  }
});
