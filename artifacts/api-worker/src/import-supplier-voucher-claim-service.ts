import {
  financeAccountsTable, financeTransactionLinesTable, financeTransactionsTable,
  financeVouchersTable, importCostCasesTable, importCostInvoicesTable,
  importCostAllocationsTable, importCostAdvancePaymentsTable,
  importCostSupplierVoucherClaimsTable,
} from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { openDb } from "./db";
import {
  verifyExistingIlsSupplierVoucher, previewVoucherAllocation,
} from "./import-supplier-voucher-claims";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const MAX = 2_147_483_647;

export class ImportSupplierVoucherError extends Error {
  constructor(message:string, readonly status=409) { super(message); }
}
function positive(v:unknown,label:string) {
  if(typeof v!=="number"||!Number.isSafeInteger(v)||v<=0||v>MAX)
    throw new ImportSupplierVoucherError(label+" غير صالح",400);
  return v;
}
function invoiceRefText(v:unknown){
  if(typeof v!=="string"||!v.trim()||v.trim().length>100)
    throw new ImportSupplierVoucherError("رقم مرجع فاتورة المورد غير صالح",400);
  return v.trim();
}
async function inspectVoucher(db:Db|Tx,voucherId:number,supplierId:number) {
  const [voucher]=await db.select().from(financeVouchersTable)
    .where(eq(financeVouchersTable.id,voucherId)).limit(1);
  if(!voucher)throw new ImportSupplierVoucherError("سند صرف المورد غير موجود",404);
  const [journal]=voucher.financeTransactionId
    ? await db.select().from(financeTransactionsTable)
      .where(eq(financeTransactionsTable.id,voucher.financeTransactionId)).limit(1)
    : [undefined];
  const lines=journal ? await db.select({
    accountCode:financeAccountsTable.code,
    accountCurrencyCode:financeAccountsTable.currencyCode,
    supplierId:financeTransactionLinesTable.supplierId,
    debitMinor:financeTransactionLinesTable.debitMinor,
    creditMinor:financeTransactionLinesTable.creditMinor,
  }).from(financeTransactionLinesTable)
    .innerJoin(financeAccountsTable,
      eq(financeTransactionLinesTable.accountId,financeAccountsTable.id))
    .where(eq(financeTransactionLinesTable.transactionId,journal.id)) : [];
  const evidence=verifyExistingIlsSupplierVoucher({
    voucher, journal:journal??null, lines,
  },supplierId);
  return{voucher,evidence};
}

/**
 * Allocate existing supplier-wide voucher to ONE import invoice without
 * touching the financial voucher, inventory, supplier ledger or cash.
 * Lock the voucher row for concurrent claims spanning multiple import files.
 */
export async function assignImportSupplierVoucher(db:Db,input:{
  caseId:number;invoiceRef:string;voucherId:number;amountIlsMinor:number;
  expectedRevision:number;actorId:number;
}){
  const caseId=positive(input.caseId,"ملف الاستيراد");
  const invoiceRef=invoiceRefText(input.invoiceRef);
  const voucherId=positive(input.voucherId,"رقم السند");
  const amountIlsMinor=positive(input.amountIlsMinor,"مبلغ السند المخصص");
  const expectedRevision=positive(input.expectedRevision,"إصدار الاستيراد");
  const actorId=positive(input.actorId,"المستخدم");
  return db.transaction(async tx=>{
    const [theCase]=await tx.select().from(importCostCasesTable)
      .where(eq(importCostCasesTable.id,caseId)).for("update").limit(1);
    if(!theCase||theCase.status!=="draft")
      throw new ImportSupplierVoucherError("ملف الاستيراد غير مفتوح");
    if(theCase.revision!==expectedRevision)
      throw new ImportSupplierVoucherError("ملف الاستيراد تغير؛ أعد التحميل");
    const [invoice]=await tx.select().from(importCostInvoicesTable)
      .where(and(eq(importCostInvoicesTable.caseId,caseId),
        eq(importCostInvoicesTable.lineRef,invoiceRef))).limit(1);
    if(!invoice)throw new ImportSupplierVoucherError("فاتورة المورد ليست ضمن ملف الاستيراد",404);

    // Voucher lock (not case lock alone) is required to serialize allocations
    // from separate import cases to the same existing voucher.
    const [lockedVoucher]=await tx.select({id:financeVouchersTable.id})
      .from(financeVouchersTable)
      .where(eq(financeVouchersTable.id,voucherId)).for("update").limit(1);
    if(!lockedVoucher)throw new ImportSupplierVoucherError("سند المورد غير موجود",404);
    const {voucher,evidence}=await inspectVoucher(tx,voucherId,invoice.supplierId);
    if(!evidence.verified)
      throw new ImportSupplierVoucherError("لا يمكن تخصيص سند غير مطابق: "+evidence.reasons.join("؛ "));

    const old=await tx.select().from(importCostSupplierVoucherClaimsTable)
      .where(eq(importCostSupplierVoucherClaimsTable.voucherId,voucherId));
    if(old.some(claim=>claim.invoiceId===invoice.id))
      throw new ImportSupplierVoucherError("هذا السند مرتبط بالفعل بنفس فاتورة المورد");
    const check=previewVoucherAllocation(voucher.amountMinor,
      old.map(claim=>claim.amountIlsMinor),amountIlsMinor);
    if(!check.valid)throw new ImportSupplierVoucherError(check.error??"تجاوز قيمة سند الصرف");

    const costGroups=await tx.select().from(importCostAllocationsTable)
      .where(eq(importCostAllocationsTable.invoiceId,invoice.id));
    const capTravel=costGroups.reduce((sum,g)=>sum+g.travelCapitalizableIlsMinor,0);
    const freight=costGroups.reduce((sum,g)=>sum+g.freightIlsMinor,0);
    const advance=await tx.select({amount:importCostAdvancePaymentsTable.advanceIlsMinor})
      .from(importCostAdvancePaymentsTable)
      .where(eq(importCostAdvancePaymentsTable.invoiceId,invoice.id));
    const actualAdvances=advance.reduce((sum,a)=>sum+a.amount,0);
    const priorVoucher=await tx.select({amount:importCostSupplierVoucherClaimsTable.amountIlsMinor})
      .from(importCostSupplierVoucherClaimsTable)
      .where(eq(importCostSupplierVoucherClaimsTable.invoiceId,invoice.id));
    const existingVoucher=priorVoucher.reduce((sum,a)=>sum+a.amount,0);
    // A supplier voucher assigned to this imported merchandise may only pay
    // the original goods portion; freight is cleared from separate ILS accounts.
    if(!Number.isSafeInteger(actualAdvances+existingVoucher+amountIlsMinor) ||
       actualAdvances+existingVoucher+amountIlsMinor>invoice.goodsBookedIlsMinor){
      throw new ImportSupplierVoucherError(
        "المقدمات وسندات المورد ستتجاوز قيمة بضاعة الفاتورة؛ راجع الحساب قبل الربط");
    }
    if(!Number.isSafeInteger(invoice.goodsBookedIlsMinor+freight+capTravel))
      throw new ImportSupplierVoucherError("إجمالي تكلفة فاتورة المورد يتجاوز الحد المحاسبي");
    const [row]=await tx.insert(importCostSupplierVoucherClaimsTable).values({
      caseId,invoiceId:invoice.id,voucherId,amountIlsMinor,createdByUserId:actorId,
    }).returning();
    if(!row)throw new ImportSupplierVoucherError("تعذر حفظ تخصيص سند المورد",500);
    await tx.update(importCostCasesTable)
      .set({revision:theCase.revision+1,updatedAt:new Date()})
      .where(eq(importCostCasesTable.id,caseId));
    return{id:row.id,invoiceRef,voucherId,amountIlsMinor,remainingVoucherIlsMinor:check.remainingIlsMinor};
  });
}

/** Removal alters attribution ONLY: it never reverses the payment voucher. */
export async function detachImportSupplierVoucher(db:Db,input:{
  caseId:number;claimId:number;expectedRevision:number;
}){
  const caseId=positive(input.caseId,"ملف الاستيراد");
  const claimId=positive(input.claimId,"ربط السند");
  const revision=positive(input.expectedRevision,"إصدار الملف");
  return db.transaction(async tx=>{
    const [theCase]=await tx.select().from(importCostCasesTable)
      .where(eq(importCostCasesTable.id,caseId)).for("update").limit(1);
    if(!theCase||theCase.status!=="draft")
      throw new ImportSupplierVoucherError("ملف الاستيراد غير مفتوح");
    if(theCase.revision!==revision)
      throw new ImportSupplierVoucherError("ملف الاستيراد تغير؛ أعد التحميل");
    const [claim]=await tx.select().from(importCostSupplierVoucherClaimsTable)
      .where(and(eq(importCostSupplierVoucherClaimsTable.id,claimId),
        eq(importCostSupplierVoucherClaimsTable.caseId,caseId))).limit(1);
    if(!claim)throw new ImportSupplierVoucherError("ربط سند المورد غير موجود",404);
    await tx.delete(importCostSupplierVoucherClaimsTable)
      .where(eq(importCostSupplierVoucherClaimsTable.id,claim.id));
    await tx.update(importCostCasesTable)
      .set({revision:theCase.revision+1,updatedAt:new Date()})
      .where(eq(importCostCasesTable.id,caseId));
    return{removed:true,claimId};
  });
}

/** Always re-read live voucher + GL. A voided/edited voucher counts as zero. */
export async function getImportSupplierVoucherClaims(db:Db,caseId:number){
  const raw=await db.select({
    id:importCostSupplierVoucherClaimsTable.id,
    invoiceId:importCostSupplierVoucherClaimsTable.invoiceId,
    voucherId:importCostSupplierVoucherClaimsTable.voucherId,
    amountIlsMinor:importCostSupplierVoucherClaimsTable.amountIlsMinor,
    invoiceRef:importCostInvoicesTable.lineRef,
    supplierId:importCostInvoicesTable.supplierId,
  }).from(importCostSupplierVoucherClaimsTable)
    .innerJoin(importCostInvoicesTable,
      eq(importCostSupplierVoucherClaimsTable.invoiceId,importCostInvoicesTable.id))
    .where(eq(importCostSupplierVoucherClaimsTable.caseId,caseId));
  const byVoucher=new Map<number,number>();
  const voucherIds=[...new Set(raw.map(r=>r.voucherId))];
  const allClaims=voucherIds.length?await db.select().from(importCostSupplierVoucherClaimsTable)
    .where(inArray(importCostSupplierVoucherClaimsTable.voucherId,voucherIds)):[];
  for(const row of allClaims)
    byVoucher.set(row.voucherId,(byVoucher.get(row.voucherId)??0)+row.amountIlsMinor);
  const results=[];
  for(const row of raw){
    const {voucher,evidence}=await inspectVoucher(db,row.voucherId,row.supplierId);
    const over=byVoucher.get(voucher.id)!>voucher.amountMinor;
    results.push({
      ...row,voucherPublicId:voucher.publicId,
      voucherAmountIlsMinor:voucher.amountMinor,
      verified:evidence.verified&&!over,
      errors:[
        ...evidence.reasons,
        ...(over?["مجموع تخصيصات هذا السند يتجاوز قيمة السند الأصلية"]:[]),
      ],
    });
  }
  return results;
}
