import { createHash } from "node:crypto";

/** Deterministic review-token: changes when any verified source payment, purchase,
 * supplier voucher allocation, allocation amount, or supplier GL balance changes.
 * It is NOT a substitute for rechecking all sources under DB locks on post.
 */
export function importClosePlanHash(input:{
  caseId:number;revision:number;
  journalLines:Array<{accountCode:string;supplierId:number|null;debitMinor:number;creditMinor:number}>;
  costGroups:Array<{allocationRef:string;valid:boolean;expectedAccountingIlsMinor:number;linkedAccountingIlsMinor:number}>;
  purchaseLinks:Array<{id:number;purchaseId:number;valid:boolean;inventoryCostIlsMinor:number}>;
  supplierVouchers:Array<{id:number;voucherId:number;verified:boolean;amountIlsMinor:number}>;
  advances:Array<{paymentId:number;financeTransactionId:number|null;journalVerified:boolean;advanceIlsMinor:number}>;
  costs:Array<{paymentId:number;financeTransactionId:number|null;journalVerified:boolean;amountIlsMinor:number}>;
  supplierBalances:Array<{supplierId:number;currentPayableIlsMinor:number;plannedDebitIlsMinor:number}>;
}) {
  const canon=(arr:unknown[])=>arr.map(x=>JSON.stringify(x)).sort();
  const normalized={
    caseId:input.caseId,revision:input.revision,
    journalLines:canon(input.journalLines),
    costGroups:canon(input.costGroups),
    purchaseLinks:canon(input.purchaseLinks),
    supplierVouchers:canon(input.supplierVouchers),
    advances:canon(input.advances),
    costs:canon(input.costs),
    supplierBalances:canon(input.supplierBalances),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function requireCloseReady(input:{
  status:string;
  planHash:string;expectedPlanHash:string;
  canPrepare:boolean;
  journalLines:Array<{accountCode:string;debitMinor:number;creditMinor:number}>;
  accountingReasons:string[];
  travelClassificationConfirmed:boolean;
  hasTravel:boolean;
}) {
  const errors:string[]=[];
  if(input.status!=="draft")errors.push("ملف الاستيراد ليس في حالة مسودة");
  if(!/^[a-f0-9]{64}$/.test(input.expectedPlanHash)||
     input.expectedPlanHash!==input.planHash)errors.push("تغيّرت خطة التسوية؛ راجع المعاينة وأعد الاعتماد");
  if(!input.canPrepare)errors.push("فحص تجميع التكاليف أو دفعات الموردين لم يكتمل");
  if(input.hasTravel && !input.travelClassificationConfirmed)
    errors.push("يجب تأكيد تصنيف مصاريف السفر قبل الإقفال");
  const allowedPending=[
    "قيد تسوية مقدمات المورد والشحن والسفر غير مربوط أو غير مرحل",
    "تصنيف تكاليف السفر بين المخزون والمصاريف يحتاج اعتمادًا",
  ];
  for(const reason of input.accountingReasons){
    if(!allowedPending.includes(reason))errors.push(reason);
  }
  let debit=0,credit=0;
  for(const line of input.journalLines){
    if(line.accountCode==="PURCHASE_INVENTORY" || line.accountCode.startsWith("BANK_") ||
       line.accountCode.startsWith("CASH_")){
      errors.push("قيد الإقفال لا يجوز أن يغير المخزون أو البنك أو الصندوق");
    }
    if(!Number.isSafeInteger(line.debitMinor)||!Number.isSafeInteger(line.creditMinor)||
       line.debitMinor<0||line.creditMinor<0||(line.debitMinor>0&&line.creditMinor>0)){
      errors.push("سطر تسوية غير صالح");
    }
    debit+=line.debitMinor;credit+=line.creditMinor;
  }
  if(!Number.isSafeInteger(debit)||debit>2_147_483_647||debit!==credit)
    errors.push("قيد التسوية غير متوازن أو تجاوز الحد");
  return [...new Set(errors)];
}

/** Source-line reversal is an exact swap of debit and credit amounts. */
export function reverseImportCloseLines(lines:Array<{
  accountId:number;supplierId:number|null;debitMinor:number;creditMinor:number;
}>){
  if(lines.length===0)throw Error("لا يوجد قيد إقفال لعكسه");
  return lines.map(line=>({
    accountId:line.accountId,
    supplierId:line.supplierId,
    debitMinor:line.creditMinor,
    creditMinor:line.debitMinor,
    memo:"عكس تسوية استيراد موثقة",
  }));
}
