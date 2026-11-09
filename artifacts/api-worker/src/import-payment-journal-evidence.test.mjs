import test from "node:test";
import assert from "node:assert/strict";
import {verifyUsdAdvanceJournal,verifyIlsDirectCostJournal} from "./import-payment-journal-evidence.ts";

const line=(code,accountId,supplierId,debitMinor,creditMinor,currencyCode=null,currencyAmountMinor=null,exchangeRateMicros=null)=>({
  accountCode:code,accountId,supplierId,debitMinor,creditMinor,currencyCode,currencyAmountMinor,exchangeRateMicros,
});
const prepayment=()=>({
  paymentId:77,supplierId:5,bankFinanceAccountId:9,usdAmountMinor:10000,
  spotRateMicros:3600000,bankBookIlsMinor:35000,bankBookRateMicros:3500000,
  advanceIlsMinor:36000,fxGainIlsMinor:1000,fxLossIlsMinor:0,
});
const advanceJournal=()=>({
  id:302,status:"posted",transactionType:"payment",sourceType:"import_cost_advance_payment",
  sourceId:"77",sourceEvent:"posted",cashSessionId:null,
  lines:[
    line("IMPORT_SUPPLIER_ADVANCES",4,5,36000,0,"USD",10000,3600000),
    line("BANK_USD_FIRST",9,null,0,35000,"USD",10000,3500000),
    line("FX_GAIN_REALIZED",3,null,0,1000),
  ],
});
const directPayment=()=>({
  paymentId:88,costType:"freight",paymentMethod:"cash",
  settlementFinanceAccountId:2,cashSessionId:1,amountIlsMinor:5000,
});
const directJournal=()=>({
  id:401,status:"posted",transactionType:"payment",sourceType:"import_cost_direct_payment",
  sourceId:"88",sourceEvent:"posted",cashSessionId:1,
  lines:[
    line("IMPORT_SHIPMENT_COST_CLEARING",15,null,5000,0),
    line("CASH_MAIN",2,null,0,5000),
  ],
});
test("correct original USD bank payment with separate FX gain is verified",()=>{
  assert.deepEqual(verifyUsdAdvanceJournal(prepayment(),advanceJournal()),
    {verified:true,errors:[]});
});
test("wrong USD bank book credit, foreign amount, rate or supplier is rejected",()=>{
  for(const issue of ["bankBook","currency","supplier","rate"]){
    const x=advanceJournal();
    if(issue==="bankBook")x.lines[1].creditMinor=36000;
    if(issue==="currency")x.lines[1].currencyAmountMinor=9000;
    if(issue==="supplier")x.lines[0].supplierId=9;
    if(issue==="rate")x.lines[0].exchangeRateMicros=3500000;
    assert.equal(verifyUsdAdvanceJournal(prepayment(),x).verified,false,issue);
  }
});
test("reversed or foreign-reference journal cannot count as paid",()=>{
  const x=advanceJournal();x.status="reversed";
  assert.equal(verifyUsdAdvanceJournal(prepayment(),x).verified,false);
  x.status="posted";x.sourceId="99";
  assert.equal(verifyUsdAdvanceJournal(prepayment(),x).verified,false);
});
test("unexpected extra journal line is rejected even if headline amounts match",()=>{
  const x=advanceJournal();x.lines.push(line("OTHER",10,null,0,10));
  assert.equal(verifyUsdAdvanceJournal(prepayment(),x).verified,false);
});
test("actual ILS cash freight posting with matching cash session is verified",()=>{
  assert.equal(verifyIlsDirectCostJournal(directPayment(),directJournal()).verified,true);
});
test("cash cost cannot be relabeled as bank cost",()=>{
  const x=directPayment();x.paymentMethod="bank";x.cashSessionId=null;
  assert.equal(verifyIlsDirectCostJournal(x,directJournal()).verified,false);
});
test("travel clearing requires a different GL account",()=>{
  const x=directPayment();x.costType="travel";
  assert.equal(verifyIlsDirectCostJournal(x,directJournal()).verified,false);
});
test("reversed shipping payment is ignored",()=>{
  const x=directJournal();x.status="reversed";
  assert.equal(verifyIlsDirectCostJournal(directPayment(),x).verified,false);
});
