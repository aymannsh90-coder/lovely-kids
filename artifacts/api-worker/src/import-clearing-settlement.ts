/**
 * Preview-only journal plan to settle existing landed inventory purchase
 * liabilities against already-paid supplier advances / freight / travel.
 *
 * CRITICAL: This never posts an inventory debit. The original completed
 * POS purchase remains the unique owner of inventory and product cost.
 * No journal is posted by this module.
 */
export type ImportClearInvoice = {
  invoiceRef: string;
  supplierId: number;
  goodsIlsMinor: number;
  supplierAdvanceIlsMinor: number;
  /** Existing ILS supplier payment vouchers already debited supplier payable. */
  supplierVoucherAlreadyPaidIlsMinor?: number;
  freightAllocatedIlsMinor: number;
  capitalizableTravelIlsMinor: number;
  /**
   * Sum of ALREADY posted and verified POS credit-purchase journals
   * that debit inventory and credit this supplier liability.
   */
  purchaseLiabilityIlsMinor: number;
};
export type ImportClearShipment = {
  shipmentRef: string;
  freightPaidIlsMinor: number;
  freightAllocatedIlsMinor: number;
};
export type ImportClearDraft = {
  caseRef: string;
  invoices: ImportClearInvoice[];
  shipments: ImportClearShipment[];
  totalTravelPaidIlsMinor: number;
  totalTravelDistributedIlsMinor: number;
  travelCapitalizableIlsMinor: number;
};
export type ImportJournalLinePlan = {
  accountCode: string;
  supplierId: number | null;
  debitMinor: number;
  creditMinor: number;
  memo: string;
};
export type ImportSettlementPlan = {
  balanced: boolean;
  ready: boolean;
  blockers: string[];
  debitMinor: number;
  creditMinor: number;
  journalLines: ImportJournalLinePlan[];
  remainingSupplierLiabilityIlsMinor: number;
  recognizedTravelExpenseIlsMinor: number;
  reclassifiedAdvanceIlsMinor: number;
  supplierVouchersAlreadyAppliedIlsMinor: number;
  reclassifiedShipmentFreightIlsMinor: number;
  reclassifiedCapitalizableTravelIlsMinor: number;
};

const MAX = 2_147_483_647;
const valid = (x:unknown):x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x <= MAX;

export function previewImportClearingSettlement(draft:ImportClearDraft):ImportSettlementPlan {
  const blockers:string[] = [];
  const lines:ImportJournalLinePlan[] = [];
  const seen=new Set<string>();
  let advances=0,freight=0,travelCapitalized=0,unpaidSuppliers=0,vouchers=0;
  if (!draft.caseRef || !draft.invoices.length || !draft.shipments.length) {
    blockers.push("ملف الاستيراد غير مكتمل");
  }
  const safe = (n:number,name:string) => {
    if(!valid(n)) blockers.push(name+" غير صالح");
    return valid(n)?n:0;
  };
  const record = (code:string,supplier:number|null,debit:number,credit:number,memo:string) => {
    if(debit===0 && credit===0) return;
    if(debit>MAX||credit>MAX||debit<0||credit<0||(debit>0&&credit>0)){
      blockers.push("سطر قيد غير متوازن أو مبلغ غير صالح "+memo);
      return;
    }
    lines.push({accountCode:code,supplierId:supplier,debitMinor:debit,creditMinor:credit,memo});
  };

  for(const invoice of draft.invoices){
    if(seen.has(invoice.invoiceRef)) blockers.push("فاتورة مكررة: "+invoice.invoiceRef);
    seen.add(invoice.invoiceRef);
    if(!Number.isSafeInteger(invoice.supplierId)||invoice.supplierId<1)
      blockers.push("معرف المورد غير صالح "+invoice.invoiceRef);
    const goods=safe(invoice.goodsIlsMinor,invoice.invoiceRef+" البضاعة");
    const prepaid=safe(invoice.supplierAdvanceIlsMinor,invoice.invoiceRef+" المقدمات");
    const vouchersAlreadyPaid=safe(invoice.supplierVoucherAlreadyPaidIlsMinor??0,
      invoice.invoiceRef+" سندات المورد المدفوعة سابقًا");
    const shipping=safe(invoice.freightAllocatedIlsMinor,invoice.invoiceRef+" الشحن");
    const travel=safe(invoice.capitalizableTravelIlsMinor,invoice.invoiceRef+" السفر المؤهل");
    const existing=safe(invoice.purchaseLiabilityIlsMinor,invoice.invoiceRef+" قيد المخزون");
    if(prepaid>goods || vouchersAlreadyPaid>goods ||
       prepaid+vouchersAlreadyPaid>goods)
      blockers.push("دفعات المورد المسبقة وسنداته ستتجاوز قيمة البضاعة لفاتورة "+invoice.invoiceRef);
    if(existing!==goods+shipping+travel)
      blockers.push("قيد شراء المخزون الحالي لا يطابق تكلفته المؤهلة لفاتورة "+invoice.invoiceRef);
    advances+=prepaid;vouchers+=vouchersAlreadyPaid;freight+=shipping;travelCapitalized+=travel;
    unpaidSuppliers+=Math.max(0,goods-prepaid-vouchersAlreadyPaid);
    const pair = (amount:number,clearingCode:string,description:string) => {
      if(amount<=0)return;
      record("SUPPLIER_PAYABLE_CONTROL",invoice.supplierId,amount,0,
        "تسوية ذمة المورد "+invoice.invoiceRef+" - "+description);
      record(clearingCode,clearingCode==="IMPORT_SUPPLIER_ADVANCES"?invoice.supplierId:null,
        0,amount,"نقل "+description+" من الحساب الوسيط "+draft.caseRef);
    };
    pair(prepaid,"IMPORT_SUPPLIER_ADVANCES","دفعة مقدمة");
    pair(shipping,"IMPORT_SHIPMENT_COST_CLEARING","شحن وتخليص ونقل");
    pair(travel,"IMPORT_TRAVEL_COST_CLEARING","سفر مؤهل للمخزون");
  }
  let paidShipping=0,allocatedShipping=0;
  const seenShipments=new Set<string>();
  for(const sh of draft.shipments){
    if(seenShipments.has(sh.shipmentRef)) blockers.push("شحنة مكررة "+sh.shipmentRef);
    seenShipments.add(sh.shipmentRef);
    const paid=safe(sh.freightPaidIlsMinor,sh.shipmentRef+" مصاريف مدفوعة");
    const allocated=safe(sh.freightAllocatedIlsMinor,sh.shipmentRef+" مصاريف موزعة");
    paidShipping+=paid;allocatedShipping+=allocated;
    if(paid!==allocated) blockers.push("الشحنة "+sh.shipmentRef+" ليست مسواة بالكامل");
  }
  if(freight!==allocatedShipping || paidShipping!==allocatedShipping)
    blockers.push("توزيع الشحن على الموردين لا يطابق مدفوعات الشحن الفعلية");
  const travelPaid=safe(draft.totalTravelPaidIlsMinor,"السفر المدفوع");
  const travelDistributed=safe(draft.totalTravelDistributedIlsMinor,"السفر الموزع");
  const claimedTravel=safe(draft.travelCapitalizableIlsMinor,"السفر المؤهل");
  if(travelPaid!==travelDistributed)
    blockers.push("السفر المدفوع لا يطابق الموزع على فواتير الموردين");
  if(travelCapitalized!==claimedTravel || claimedTravel>travelPaid)
    blockers.push("جزء السفر المؤهل لا يطابق سفر فواتير الموردين");
  const expensed=travelPaid-claimedTravel;
  if(expensed>0){
    record("IMPORT_TRAVEL_OPERATING_EXPENSE",null,expensed,0,
      "تسجيل سفر غير مؤهل للمخزون مرة واحدة فقط");
    record("IMPORT_TRAVEL_COST_CLEARING",null,0,expensed,
      "تسوية السفر غير المؤهل من الحساب الوسيط");
  }
  const debit=lines.reduce((sum,line)=>sum+line.debitMinor,0);
  const credit=lines.reduce((sum,line)=>sum+line.creditMinor,0);
  if(!Number.isSafeInteger(debit)||debit>MAX||!Number.isSafeInteger(credit)||credit>MAX){
    blockers.push("قيمة قيد التسوية تتجاوز حدود الحسابات");
  }
  if(debit!==credit)blockers.push("قيد التسوية غير متوازن");
  if(!valid(unpaidSuppliers)||!valid(advances)||!valid(freight)||!valid(travelCapitalized)){
    blockers.push("إجمالي تسوية الشحنة يتجاوز الحدود");
  }
  return{
    balanced:debit===credit,
    ready:blockers.length===0,
    blockers:[...new Set(blockers)],
    debitMinor:debit,creditMinor:credit,
    journalLines:lines,
    remainingSupplierLiabilityIlsMinor:unpaidSuppliers,
    recognizedTravelExpenseIlsMinor:Math.max(0,expensed),
    reclassifiedAdvanceIlsMinor:advances,
    supplierVouchersAlreadyAppliedIlsMinor:vouchers,
    reclassifiedShipmentFreightIlsMinor:freight,
    reclassifiedCapitalizableTravelIlsMinor:travelCapitalized,
  };
}
