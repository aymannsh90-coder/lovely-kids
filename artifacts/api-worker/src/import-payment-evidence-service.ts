import { bankAccountsTable, financeAccountsTable,
  financeTransactionLinesTable, financeTransactionsTable } from "@workspace/db/schema";
import { eq,inArray } from "drizzle-orm";
import type {openDb} from "./db";
import {
  verifyUsdAdvanceJournal,verifyIlsDirectCostJournal,
  type ImportPaymentFinanceJournal,
} from "./import-payment-journal-evidence";

type Db=Awaited<ReturnType<typeof openDb>>["db"];
export type RecordedImportAdvance={
  paymentId:number;invoiceId:number;bankAccountId:number;
  usdAmountMinor:number;spotRateMicros:number;bankBookIlsMinor:number;
  advanceIlsMinor:number;fxGainIlsMinor:number;fxLossIlsMinor:number;
  financeTransactionId:number|null;
};
export type RecordedImportDirectCost={
  paymentId:number;costType:string;paymentMethod:string;
  amountIlsMinor:number;cashSessionId:number|null;
  settlementFinanceAccountId:number;financeTransactionId:number|null;
};

export async function inspectRecordedImportPayments(
  db:Db,
  advances:RecordedImportAdvance[],
  direct:RecordedImportDirectCost[],
  invoiceSupplierIds:Map<number,number>,
) {
  const ids=[...new Set([...advances,...direct].map(p=>p.financeTransactionId)
    .filter((value):value is number=>value!==null))];
  const bankIds=[...new Set(advances.map(p=>p.bankAccountId))];
  const transactions=ids.length ? await db.select().from(financeTransactionsTable)
    .where(inArray(financeTransactionsTable.id,ids)) : [];
  const lines=ids.length ? await db.select({
    transactionId:financeTransactionLinesTable.transactionId,
    accountId:financeTransactionLinesTable.accountId,
    accountCode:financeAccountsTable.code,
    supplierId:financeTransactionLinesTable.supplierId,
    debitMinor:financeTransactionLinesTable.debitMinor,
    creditMinor:financeTransactionLinesTable.creditMinor,
    currencyCode:financeTransactionLinesTable.currencyCode,
    currencyAmountMinor:financeTransactionLinesTable.currencyAmountMinor,
    exchangeRateMicros:financeTransactionLinesTable.exchangeRateMicros,
  }).from(financeTransactionLinesTable).innerJoin(financeAccountsTable,
    eq(financeTransactionLinesTable.accountId,financeAccountsTable.id))
    .where(inArray(financeTransactionLinesTable.transactionId,ids)) : [];
  const banks=bankIds.length ? await db.select({
    id:bankAccountsTable.id,
    financeAccountId:bankAccountsTable.financeAccountId,
    currencyCode:bankAccountsTable.currencyCode,
  }).from(bankAccountsTable).where(inArray(bankAccountsTable.id,bankIds)): [];
  const banksById=new Map(banks.map(bank=>[bank.id,bank]));
  const byId=new Map<number,ImportPaymentFinanceJournal>();
  for(const t of transactions){
    byId.set(t.id,{
      id:t.id,status:t.status,transactionType:t.transactionType,
      sourceType:t.sourceType,sourceId:t.sourceId,
      sourceEvent:t.sourceEvent,cashSessionId:t.cashSessionId,
      lines:[],
    });
  }
  for(const line of lines){
    byId.get(line.transactionId)?.lines.push(line);
  }
  const advanceChecks=advances.map(p=>{
    const bank=banksById.get(p.bankAccountId);
    const journal=p.financeTransactionId?byId.get(p.financeTransactionId)??null:null;
    const rate=journal?.lines.find(l=>l.accountId===bank?.financeAccountId)?.exchangeRateMicros??0;
    const supplierId=invoiceSupplierIds.get(p.invoiceId);
    const extraErrors:string[]=[];
    if(!bank || bank.currencyCode!=="USD")extraErrors.push("بنك الدولار الأصلي غير موجود أو عملته ليست دولارًا");
    if(!supplierId)extraErrors.push("فاتورة مورد الدفعة غير موجودة");
    const result=verifyUsdAdvanceJournal({
      paymentId:p.paymentId,supplierId:supplierId??0,bankFinanceAccountId:bank?.financeAccountId??0,
      usdAmountMinor:p.usdAmountMinor,
      spotRateMicros:p.spotRateMicros,bankBookIlsMinor:p.bankBookIlsMinor,
      bankBookRateMicros:rate,advanceIlsMinor:p.advanceIlsMinor,
      fxGainIlsMinor:p.fxGainIlsMinor,fxLossIlsMinor:p.fxLossIlsMinor,
    },journal);
    return {paymentId:p.paymentId,verified:result.verified&&extraErrors.length===0,
      errors:[...result.errors,...extraErrors]};
  });
  const directChecks=direct.map(p=>{
    const journal=p.financeTransactionId?byId.get(p.financeTransactionId)??null:null;
    const kind=(["travel","freight","customs","local_transport"].includes(p.costType))
      ? p.costType as "travel"|"freight"|"customs"|"local_transport" : "invalid";
    const method=(p.paymentMethod==="bank"||p.paymentMethod==="cash")
      ? p.paymentMethod:"invalid";
    const result=verifyIlsDirectCostJournal({
      paymentId:p.paymentId,costType:kind==="invalid"?"freight":kind,
      paymentMethod:method==="invalid"?"bank":method,
      amountIlsMinor:p.amountIlsMinor,
      settlementFinanceAccountId:p.settlementFinanceAccountId,
      cashSessionId:p.cashSessionId,
    },journal);
    const errors=[...result.errors];
    if(kind==="invalid"||method==="invalid")errors.push("نوع تكلفة/طريقة صرف غير صالحة");
    return{paymentId:p.paymentId,verified:result.verified&&errors.length===0,errors};
  });
  return{
    advances:advanceChecks,
    directCosts:directChecks,
    allVerified:advanceChecks.every(p=>p.verified)&&directChecks.every(p=>p.verified),
  };
}
