import {
  financeAccountsTable, financeTransactionLinesTable, financeTransactionsTable,
  importCostCasesTable, importCostClosuresTable, importCostPurchaseLinksTable,
  importCostSupplierVoucherClaimsTable, posPurchasesTable, financeVouchersTable,
} from "@workspace/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { openDb, Env } from "./db";
import { postFinanceTransaction } from "./finance-posting";
import { requireCloseReady, reverseImportCloseLines } from "./import-closing-rules";
import type { ImportSettlementPlan } from "./import-clearing-settlement";

type Db=Awaited<ReturnType<typeof openDb>>["db"];
type Tx=Parameters<Parameters<Db["transaction"]>[0]>[0];
const LIMIT=2_147_483_647;
const allowedAccounts:Record<string,"asset"|"liability"|"expense">={
  SUPPLIER_PAYABLE_CONTROL:"liability",
  IMPORT_SUPPLIER_ADVANCES:"asset",
  IMPORT_SHIPMENT_COST_CLEARING:"asset",
  IMPORT_TRAVEL_COST_CLEARING:"asset",
  IMPORT_TRAVEL_OPERATING_EXPENSE:"expense",
};
export class ImportCloseError extends Error{
  constructor(message:string,readonly status=409){super(message);}
}
function positive(v:unknown,label:string):number{
  if(typeof v!=="number"||!Number.isSafeInteger(v)||v<=0||v>LIMIT)
    throw new ImportCloseError(label+" غير صالح",400);
  return v;
}
function key(v:unknown):string{
  if(typeof v!=="string"||v.trim().length<8||v.trim().length>120)
    throw new ImportCloseError("مفتاح منع التكرار غير صالح",400);
  return v.trim();
}
function date(v:unknown):string{
  if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v)||
    Number.isNaN(Date.parse(v+"T00:00:00Z"))||
    new Date(v+"T00:00:00Z").toISOString().slice(0,10)!==v)
    throw new ImportCloseError("تاريخ إقفال الشحنة غير صالح",400);
  return v;
}
export type ImportCloseRequest={
  caseId:number;expectedRevision:number;
  expectedPlanHash:string;
  travelClassificationConfirmed:boolean;
  businessDate:string;idempotencyKey:string;
};
export function parseImportClose(raw:unknown,caseId:number):ImportCloseRequest{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
    throw new ImportCloseError("بيانات إقفال الشحنة غير صالحة",400);
  const v=raw as Record<string,unknown>;
  return{
    caseId:positive(caseId,"ملف الاستيراد"),
    expectedRevision:positive(v.expectedRevision,"إصدار الملف"),
    expectedPlanHash:typeof v.expectedPlanHash==="string"?v.expectedPlanHash:"",
    travelClassificationConfirmed:v.travelClassificationConfirmed===true,
    businessDate:date(v.businessDate),
    idempotencyKey:key(v.idempotencyKey),
  };
}
export type ImportReverseRequest={
  caseId:number;expectedRevision:number;businessDate:string;
  idempotencyKey:string;reason:string;
};
export function parseImportReversal(raw:unknown,caseId:number):ImportReverseRequest{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
    throw new ImportCloseError("بيانات عكس التسوية غير صالحة",400);
  const v=raw as Record<string,unknown>;
  if(typeof v.reason!=="string"||v.reason.trim().length<5||v.reason.trim().length>500)
    throw new ImportCloseError("سبب عكس إقفال الاستيراد مطلوب",400);
  return{
    caseId:positive(caseId,"ملف الاستيراد"),
    expectedRevision:positive(v.expectedRevision,"إصدار الملف"),
    businessDate:date(v.businessDate),
    idempotencyKey:key(v.idempotencyKey),
    reason:v.reason.trim(),
  };
}

type ReadModel={
  case:{id:number;revision:number;status:string};
  draft:{withTravel:boolean};
  closePlanHash:string;
  closePreview:{reasons:string[]};
  clearingPreview:ImportSettlementPlan&{ready:boolean;canExecute:boolean};
};
type ReadModelFunction=(tx:Tx,id:number,env:Env)=>Promise<ReadModel>;

async function lockRelevantRows(tx:Tx,caseId:number){
  const purchases=await tx.select({id:importCostPurchaseLinksTable.purchaseId})
    .from(importCostPurchaseLinksTable)
    .where(eq(importCostPurchaseLinksTable.caseId,caseId));
  for(const id of [...new Set(purchases.map(p=>p.id))].sort((a,b)=>a-b)){
    await tx.select({id:posPurchasesTable.id}).from(posPurchasesTable)
      .where(eq(posPurchasesTable.id,id)).for("update").limit(1);
  }
  const vouchers=await tx.select({id:importCostSupplierVoucherClaimsTable.voucherId})
    .from(importCostSupplierVoucherClaimsTable)
    .where(eq(importCostSupplierVoucherClaimsTable.caseId,caseId));
  for(const id of [...new Set(vouchers.map(v=>v.id))].sort((a,b)=>a-b)){
    await tx.select({id:financeVouchersTable.id}).from(financeVouchersTable)
      .where(eq(financeVouchersTable.id,id)).for("update").limit(1);
  }
  await tx.select({id:financeAccountsTable.id})
    .from(financeAccountsTable)
    .where(inArray(financeAccountsTable.code,Object.keys(allowedAccounts)))
    .orderBy(asc(financeAccountsTable.code)).for("update");
}

async function resolveCloseAccounts(tx:Tx,plan:ImportSettlementPlan){
  const needed=[...new Set(plan.journalLines.map(line=>line.accountCode))];
  if(needed.some(code=>!(code in allowedAccounts)))
    throw new ImportCloseError("خطة الإقفال تحتوي حسابات غير مسموحة");
  let accounts=needed.length?await tx.select().from(financeAccountsTable)
    .where(inArray(financeAccountsTable.code,needed)):[];
  if(needed.includes("IMPORT_TRAVEL_OPERATING_EXPENSE") &&
     !accounts.some(a=>a.code==="IMPORT_TRAVEL_OPERATING_EXPENSE")){
    await tx.insert(financeAccountsTable).values({
      code:"IMPORT_TRAVEL_OPERATING_EXPENSE",name:"مصاريف سفر شراء بضاعة غير قابلة للرسملة",
      accountType:"expense",currencyCode:"ILS",status:"active",
      notes:"سفر لا يستوفي شروط إدراجه في المخزون، يظهر مرة واحدة عند إقفال الاستيراد",
    }).onConflictDoNothing();
    accounts=await tx.select().from(financeAccountsTable)
      .where(inArray(financeAccountsTable.code,needed));
  }
  const map=new Map(accounts.map(a=>[a.code,a]));
  for(const code of needed){
    const account=map.get(code);
    if(!account||account.accountType!==allowedAccounts[code]||
       account.currencyCode!=="ILS"||account.status!=="active"||
       account.linkedEntityId!==null||account.linkedEntityType!==null){
      throw new ImportCloseError("حساب إقفال الاستيراد "+code+" ليس حسابًا محاسبيًا صالحًا");
    }
  }
  // Never clear more than the actual credit balance of each asset account.
  const accountIds=accounts.filter(a=>a.accountType==="asset").map(a=>a.id);
  const rows=accountIds.length?await tx.select({
    accountId:financeTransactionLinesTable.accountId,
    debit:financeTransactionLinesTable.debitMinor,
    credit:financeTransactionLinesTable.creditMinor,
  }).from(financeTransactionLinesTable).where(inArray(financeTransactionLinesTable.accountId,accountIds)):[];
  for(const account of accounts.filter(a=>a.accountType==="asset")){
    const available=rows.filter(r=>r.accountId===account.id)
      .reduce((sum,r)=>sum+BigInt(r.debit)-BigInt(r.credit),0n);
    const toCredit=plan.journalLines.filter(line=>line.accountCode===account.code)
      .reduce((sum,line)=>sum+BigInt(line.creditMinor),0n);
    if(toCredit>available)
      throw new ImportCloseError("رصيد حساب تجميع الاستيراد "+account.code+" أقل من المطلوب تصفيته");
  }
  const payable=map.get("SUPPLIER_PAYABLE_CONTROL");
  if(payable){
    const rows=await tx.select({
      supplierId:financeTransactionLinesTable.supplierId,
      debit:financeTransactionLinesTable.debitMinor,
      credit:financeTransactionLinesTable.creditMinor,
    }).from(financeTransactionLinesTable)
      .where(eq(financeTransactionLinesTable.accountId,payable.id));
    const suppliers=[...new Set(plan.journalLines.filter(l=>
      l.accountCode==="SUPPLIER_PAYABLE_CONTROL").map(l=>l.supplierId))];
    for(const supplierId of suppliers){
      const existing=rows.filter(r=>r.supplierId===supplierId)
        .reduce((sum,r)=>sum+BigInt(r.credit)-BigInt(r.debit),0n);
      const required=plan.journalLines.filter(l=>
        l.accountCode==="SUPPLIER_PAYABLE_CONTROL"&&l.supplierId===supplierId)
        .reduce((sum,l)=>sum+BigInt(l.debitMinor),0n);
      if(existing<required)
        throw new ImportCloseError("رصيد الذمة الرقابية للمورد #"+supplierId+
          " لا يكفي لتسوية هذه الشحنة. راجع السندات والدفعات السابقة");
    }
  }
  return map;
}

export async function postImportAccountingClose(
  db:Db,env:Env,actorId:number,input:ImportCloseRequest,read:ReadModelFunction,
){
  if(env.POS_IMPORT_CLOSING_ENABLED!=="true")
    throw new ImportCloseError("إقفال الاستيراد المالي غير مفعل في النظام الحالي",503);
  return db.transaction(async tx=>{
    const [file]=await tx.select().from(importCostCasesTable)
      .where(eq(importCostCasesTable.id,input.caseId)).for("update").limit(1);
    if(!file)throw new ImportCloseError("ملف الاستيراد غير موجود",404);
    const [sameKey]=await tx.select().from(importCostClosuresTable)
      .where(eq(importCostClosuresTable.idempotencyKey,input.idempotencyKey)).limit(1);
    if(sameKey){
      if(sameKey.caseId!==input.caseId||sameKey.status!=="posted" ||
         sameKey.planHash!==input.expectedPlanHash ||
         sameKey.businessDate!==input.businessDate ||
         sameKey.travelClassificationApproved!==(input.travelClassificationConfirmed || !file.withTravel))
        throw new ImportCloseError("مفتاح الإقفال مستخدم لعملية مختلفة");
      return{closureId:sameKey.id,financeTransactionId:sameKey.financeTransactionId,alreadyPosted:true};
    }
    if(file.status!=="draft"||file.revision!==input.expectedRevision)
      throw new ImportCloseError("الملف تغيّر أو أُقفل؛ افتح معاينة جديدة قبل الاعتماد");
    await lockRelevantRows(tx,input.caseId);
    const review=await read(tx,input.caseId,env);
    const issues=requireCloseReady({
      status:review.case.status,
      planHash:review.closePlanHash,expectedPlanHash:input.expectedPlanHash,
      canPrepare:review.clearingPreview.ready,
      journalLines:review.clearingPreview.journalLines,
      accountingReasons:review.closePreview.reasons,
      travelClassificationConfirmed:input.travelClassificationConfirmed,
      hasTravel:review.draft.withTravel,
    });
    if(issues.length)throw new ImportCloseError("الإقفال مرفوض: "+issues.join("؛ "));
    const plan=review.clearingPreview;
    if(!plan.balanced||!plan.ready)throw new ImportCloseError("خطة الإقفال المالي غير متوازنة");
    const accounts=await resolveCloseAccounts(tx,plan);
    const [closure]=await tx.insert(importCostClosuresTable).values({
      caseId:input.caseId,idempotencyKey:input.idempotencyKey,
      planHash:input.expectedPlanHash,status:"posted",businessDate:input.businessDate,
      debitIlsMinor:plan.debitMinor,closedByUserId:actorId,
      travelClassificationApproved:input.travelClassificationConfirmed || !review.draft.withTravel,
    }).returning();
    if(!closure)throw new ImportCloseError("تعذر توثيق إقفال الاستيراد",500);
    let financeTransactionId:number|null=null;
    if(plan.journalLines.length){
      const posted=await postFinanceTransaction(tx,{
        publicId:"FIN-"+input.businessDate.replaceAll("-","")+"-"+randomUUID().slice(0,8).toUpperCase(),
        idempotencyKey:"import:closure:"+closure.id+":posted",
        businessDate:input.businessDate,transactionType:"adjustment",
        sourceType:"import_cost_closure",sourceId:String(closure.id),sourceEvent:"posted",
        notes:"تسوية استيراد "+file.publicId+" بدون ترحيل مخزون أو صرف مكرر",
        createdByUserId:actorId,
        lines:plan.journalLines.map(line=>{
          const account=accounts.get(line.accountCode);
          if(!account)throw new ImportCloseError("حساب تسوية مفقود: "+line.accountCode);
          return{
            accountId:account.id,supplierId:line.supplierId,
            debitMinor:line.debitMinor,creditMinor:line.creditMinor,memo:line.memo,
          };
        }),
      });
      if(posted.alreadyPosted)throw new ImportCloseError("قيد إقفال الاستيراد مُرحّل سابقًا");
      financeTransactionId=posted.transaction.id;
      await tx.update(importCostClosuresTable).set({financeTransactionId})
        .where(eq(importCostClosuresTable.id,closure.id));
    }
    const [updated]=await tx.update(importCostCasesTable)
      .set({status:"closed",revision:file.revision+1,updatedAt:new Date()})
      .where(and(eq(importCostCasesTable.id,input.caseId),eq(importCostCasesTable.status,"draft")))
      .returning({id:importCostCasesTable.id});
    if(!updated)throw new ImportCloseError("ملف الاستيراد تغير أثناء الإقفال");
    return{closureId:closure.id,financeTransactionId,alreadyPosted:false};
  },{isolationLevel:"serializable"});
}

export async function reverseImportAccountingClose(
  db:Db,env:Env,actorId:number,input:ImportReverseRequest,
){
  if(env.POS_IMPORT_CLOSING_ENABLED!=="true")
    throw new ImportCloseError("عكس إقفال الاستيراد المالي غير مفعل بعد",503);
  return db.transaction(async tx=>{
    const [file]=await tx.select().from(importCostCasesTable)
      .where(eq(importCostCasesTable.id,input.caseId)).for("update").limit(1);
    if(!file)throw new ImportCloseError("ملف الاستيراد غير موجود",404);
    const [oldReverse]=await tx.select().from(importCostClosuresTable)
      .where(eq(importCostClosuresTable.reversalKey,input.idempotencyKey)).limit(1);
    if(oldReverse){
      if(oldReverse.caseId!==input.caseId||oldReverse.status!=="reversed" ||
         oldReverse.reversalReason!==input.reason ||
         oldReverse.reversalBusinessDate!==input.businessDate)
        throw new ImportCloseError("مفتاح العكس مستخدم لملف أو عملية أخرى");
      return{closureId:oldReverse.id,financeTransactionId:oldReverse.reversalFinanceTransactionId,alreadyReversed:true};
    }
    if(file.status!=="closed"||file.revision!==input.expectedRevision)
      throw new ImportCloseError("تغير ملف الاستيراد أو أنه ليس مقفلًا");
    const [closure]=await tx.select().from(importCostClosuresTable)
      .where(and(eq(importCostClosuresTable.caseId,input.caseId),
        eq(importCostClosuresTable.status,"posted"))).for("update").limit(1);
    if(!closure)throw new ImportCloseError("قيد الإقفال الأصلي غير موجود");
    const [original]=closure.financeTransactionId?await tx.select()
      .from(financeTransactionsTable)
      .where(eq(financeTransactionsTable.id,closure.financeTransactionId)).for("update").limit(1):[undefined];
    if(closure.debitIlsMinor>0 && (!original||original.status!=="posted"||
      original.sourceType!=="import_cost_closure"||
      original.sourceId!==String(closure.id)||original.sourceEvent!=="posted")){
      throw new ImportCloseError("قيد الإقفال تغير أو عُكس خارج ملف الاستيراد");
    }
    if(closure.debitIlsMinor===0 && closure.financeTransactionId!==null)
      throw new ImportCloseError("قيد الإقفال الصفري غير مطابق");
    let reversalFinanceTransactionId:number|null=null;
    if(original){
      const rows=await tx.select().from(financeTransactionLinesTable)
        .where(eq(financeTransactionLinesTable.transactionId,original.id))
        .orderBy(asc(financeTransactionLinesTable.lineNumber));
      const sumDebit=rows.reduce((sum,row)=>sum+row.debitMinor,0);
      const sumCredit=rows.reduce((sum,row)=>sum+row.creditMinor,0);
      if(rows.length<2||sumDebit!==closure.debitIlsMinor||sumCredit!==closure.debitIlsMinor)
        throw new ImportCloseError("سطور قيد الإقفال الأصلي لا تطابق المبلغ الموثق");
      const accounts=await tx.select().from(financeAccountsTable)
        .where(inArray(financeAccountsTable.id,rows.map(row=>row.accountId)));
      const byId=new Map(accounts.map(a=>[a.id,a]));
      for(const row of rows){
        const account=byId.get(row.accountId);
        if(!account||!(account.code in allowedAccounts)||account.currencyCode!=="ILS"||
          (account.accountType!==allowedAccounts[account.code])){
          throw new ImportCloseError("قيد الإقفال الأصلي يحتوي حسابًا غير مسموح بعكسه");
        }
      }
      const posted=await postFinanceTransaction(tx,{
        publicId:"FIN-"+input.businessDate.replaceAll("-","")+"-"+randomUUID().slice(0,8).toUpperCase(),
        idempotencyKey:"import:closure:"+closure.id+":reversed",
        businessDate:input.businessDate,transactionType:"reversal",
        sourceType:"import_cost_closure",sourceId:String(closure.id),sourceEvent:"reversed",
        notes:"عكس تسوية الاستيراد "+file.publicId+": "+input.reason,
        createdByUserId:actorId,
        lines:reverseImportCloseLines(rows.map(row=>({
          accountId:row.accountId,supplierId:row.supplierId,
          debitMinor:row.debitMinor,creditMinor:row.creditMinor,
        }))),
      });
      if(posted.alreadyPosted)throw new ImportCloseError("عكس قيد الاستيراد مُرحّل بالفعل");
      reversalFinanceTransactionId=posted.transaction.id;
      const [reversed]=await tx.update(financeTransactionsTable)
        .set({status:"reversed",updatedAt:new Date()})
        .where(and(eq(financeTransactionsTable.id,original.id),
          eq(financeTransactionsTable.status,"posted")))
        .returning({id:financeTransactionsTable.id});
      if(!reversed)throw new ImportCloseError("تغير قيد الإقفال قبل العكس");
    }
    await tx.update(importCostClosuresTable).set({
      status:"reversed",reversalKey:input.idempotencyKey,
      reversalReason:input.reason,reversalBusinessDate:input.businessDate,
      reversalFinanceTransactionId,
      reversedByUserId:actorId,reversedAt:new Date(),
    }).where(eq(importCostClosuresTable.id,closure.id));
    const [updated]=await tx.update(importCostCasesTable)
      .set({status:"draft",revision:file.revision+1,updatedAt:new Date()})
      .where(and(eq(importCostCasesTable.id,input.caseId),
        eq(importCostCasesTable.status,"closed")))
      .returning({id:importCostCasesTable.id});
    if(!updated)throw new ImportCloseError("تغير ملف الاستيراد قبل إتمام العكس");
    return{closureId:closure.id,financeTransactionId:reversalFinanceTransactionId,alreadyReversed:false};
  },{isolationLevel:"serializable"});
}
