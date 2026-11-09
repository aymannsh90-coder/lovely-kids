/**
 * Read-only evidence checks for the journals backing import payments.
 * A payment record without an exact posted finance transaction cannot be
 * counted as "paid" during a supplier/import close preflight.
 */
export type ImportFinanceLine = {
  accountId:number;
  accountCode:string;
  supplierId:number|null;
  debitMinor:number;
  creditMinor:number;
  currencyCode:string|null;
  currencyAmountMinor:number|null;
  exchangeRateMicros:number|null;
};
export type ImportPaymentFinanceJournal = {
  id:number;
  status:string;
  transactionType:string;
  sourceType:string;
  sourceId:string;
  sourceEvent:string;
  cashSessionId:number|null;
  lines:ImportFinanceLine[];
};
export type ImportAdvanceEvidence = {
  paymentId:number;
  supplierId:number;
  bankFinanceAccountId:number;
  usdAmountMinor:number;
  spotRateMicros:number;
  bankBookIlsMinor:number;
  bankBookRateMicros:number;
  advanceIlsMinor:number;
  fxGainIlsMinor:number;
  fxLossIlsMinor:number;
};
export type ImportDirectEvidence = {
  paymentId:number;
  costType:"travel"|"freight"|"customs"|"local_transport";
  paymentMethod:"bank"|"cash";
  settlementFinanceAccountId:number;
  cashSessionId:number|null;
  amountIlsMinor:number;
};
const converted=(amount:number,rate:number):bigint =>
  (BigInt(amount)*BigInt(rate)+500_000n)/1_000_000n;
const isValid=(value:number):boolean=>Number.isSafeInteger(value)&&value>=0&&value<=2_147_483_647;
const isLine=(line:ImportFinanceLine,amount:number,side:"debit"|"credit") =>
  isValid(amount) && amount>0 &&
  (side==="debit"?line.debitMinor===amount&&line.creditMinor===0:
    line.creditMinor===amount&&line.debitMinor===0);
function shared(journal:ImportPaymentFinanceJournal|null,type:string,id:number) {
  const errors:string[]=[];
  if(!journal || journal.status!=="posted" || journal.transactionType!=="payment" ||
    journal.sourceType!==type || journal.sourceId!==String(id) ||
    journal.sourceEvent!=="posted"){
    errors.push("قيد الدفع الأصلي غير موجود أو غير مرحل بنفس مرجع المصدر");
  }
  return errors;
}

export function verifyUsdAdvanceJournal(
  invoice:ImportAdvanceEvidence,journal:ImportPaymentFinanceJournal|null,
) {
  const errors=shared(journal,"import_cost_advance_payment",invoice.paymentId);
  if (!journal) return {verified:false,errors};
  const lines=journal.lines;
  const advance=lines.filter(l=>l.accountCode==="IMPORT_SUPPLIER_ADVANCES");
  const bank=lines.filter(l=>l.accountId===invoice.bankFinanceAccountId);
  if (advance.length!==1||bank.length!==1) {
    errors.push("قيد دفع المورد لا يحتوي سطر المقدمات أو بنك الدولار لمرة واحدة");
  }
  if (advance.length===1) {
    const line=advance[0]!;
    if(!isLine(line,invoice.advanceIlsMinor,"debit") ||
      line.supplierId!==invoice.supplierId || line.currencyCode!=="USD" ||
      line.currencyAmountMinor!==invoice.usdAmountMinor ||
      line.exchangeRateMicros!==invoice.spotRateMicros ||
      converted(invoice.usdAmountMinor,invoice.spotRateMicros)!==BigInt(invoice.advanceIlsMinor)){
      errors.push("قيمة دفعة مقدم المورد أو سعر الصرف لا يطابق قيد المالية");
    }
  }
  if(bank.length===1){
    const line=bank[0]!;
    if(!isLine(line,invoice.bankBookIlsMinor,"credit")||
      !line.accountCode.startsWith("BANK_")||line.currencyCode!=="USD"||
      line.currencyAmountMinor!==invoice.usdAmountMinor||
      line.exchangeRateMicros!==invoice.bankBookRateMicros||
      converted(invoice.usdAmountMinor,invoice.bankBookRateMicros)!==BigInt(invoice.bankBookIlsMinor)){
      errors.push("خصم بنك الدولار لا يطابق قيمته الدفترية الحقيقية");
    }
  }
  const gains=lines.filter(l=>l.accountCode==="FX_GAIN_REALIZED");
  const losses=lines.filter(l=>l.accountCode==="FX_LOSS_REALIZED");
  if(invoice.fxGainIlsMinor>0 && (gains.length!==1||
      !isLine(gains[0]!,invoice.fxGainIlsMinor,"credit"))) {
    errors.push("ربح فرق الصرف غير مثبت بدقة");
  }
  if(invoice.fxLossIlsMinor>0 && (losses.length!==1||
      !isLine(losses[0]!,invoice.fxLossIlsMinor,"debit"))) {
    errors.push("خسارة فرق الصرف غير مثبتة بدقة");
  }
  if((invoice.fxGainIlsMinor===0 && gains.length>0)||
    (invoice.fxLossIlsMinor===0 && losses.length>0)){
    errors.push("قيد فرق صرف غير متوقع");
  }
  const expected=2+(invoice.fxGainIlsMinor>0?1:0)+(invoice.fxLossIlsMinor>0?1:0);
  if(lines.length!==expected)errors.push("قيد الدفع يحتوي سطورًا مالية إضافية");
  if(invoice.advanceIlsMinor+invoice.fxLossIlsMinor!==
    invoice.bankBookIlsMinor+invoice.fxGainIlsMinor){
    errors.push("دفعة مقدم المورد غير متوازنة");
  }
  return {verified:errors.length===0,errors};
}

export function verifyIlsDirectCostJournal(
  payment:ImportDirectEvidence,journal:ImportPaymentFinanceJournal|null,
) {
  const errors=shared(journal,"import_cost_direct_payment",payment.paymentId);
  if(!journal)return{verified:false,errors};
  const clearingCode=payment.costType==="travel"
    ?"IMPORT_TRAVEL_COST_CLEARING":"IMPORT_SHIPMENT_COST_CLEARING";
  const debits=journal.lines.filter(l=>l.accountCode===clearingCode);
  const credits=journal.lines.filter(l=>l.accountId===payment.settlementFinanceAccountId);
  if(debits.length!==1||!isLine(debits[0]!,payment.amountIlsMinor,"debit")){
    errors.push("مصروف الاستيراد غير مثبت في حساب التجميع الصحيح");
  }
  if(credits.length!==1||!isLine(credits[0]!,payment.amountIlsMinor,"credit")){
    errors.push("مصدر دفع مصاريف الشحنة لا يطابق القيد");
  }
  if(credits.length===1 &&
    (payment.paymentMethod==="cash"
      ? credits[0]!.accountCode!=="CASH_MAIN"
      : !credits[0]!.accountCode.startsWith("BANK_"))){
    errors.push("مصدر الدفع ليس صندوق/بنك الشيكل المتفق عليه");
  }
  if(journal.lines.length!==2)errors.push("قيد مصاريف الاستيراد يحتوي أطرافًا إضافية");
  if((payment.paymentMethod==="cash"&&journal.cashSessionId!==payment.cashSessionId)||
     (payment.paymentMethod==="bank"&&journal.cashSessionId!==null)){
    errors.push("جلسة الصندوق المرتبطة غير مطابقة");
  }
  return{verified:errors.length===0,errors};
}
