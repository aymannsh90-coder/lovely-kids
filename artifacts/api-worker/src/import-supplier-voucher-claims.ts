/**
 * Strictly inspect pre-existing supplier payment vouchers before attributing
 * an ILS supplier-wide payment to a specific imported purchase invoice.
 *
 * IMPORTANT: This does not post a second payment. Attribution is evidence only.
 */
export type SupplierVoucherEvidenceInput = {
  voucher: {
    id: number;
    voucherType: string;
    voucherPurpose: string | null;
    partyType: string | null;
    partyId: number | null;
    currencyCode: string;
    amountMinor: number;
    status: string;
    financeTransactionId: number | null;
  };
  journal: {
    id: number;
    status: string;
    transactionType: string;
    sourceType: string;
    sourceId: string;
    sourceEvent: string;
  } | null;
  lines: Array<{
    accountCode: string;
    accountCurrencyCode: string;
    supplierId: number | null;
    debitMinor: number;
    creditMinor: number;
  }>;
};
export function verifyExistingIlsSupplierVoucher(
  x: SupplierVoucherEvidenceInput,
  expectedSupplierId: number,
) {
  const reasons:string[]=[];
  const v=x.voucher, j=x.journal;
  if(!Number.isSafeInteger(expectedSupplierId)||expectedSupplierId<=0 ||
    v.partyType!=="supplier" || v.partyId!==expectedSupplierId ||
    v.voucherType!=="payment" || v.voucherPurpose!=="supplier_payment") {
    reasons.push("سند الصرف لا يخص المورد المطلوب");
  }
  if(v.status!=="posted" || v.currencyCode!=="ILS" ||
    !Number.isSafeInteger(v.amountMinor) || v.amountMinor<=0 ||
    v.amountMinor>2_147_483_647){
    reasons.push("السند ليس مدفوعًا صحيحًا بالشيكل");
  }
  if(!j || v.financeTransactionId!==j.id || j.status!=="posted" ||
    j.transactionType!=="payment" || j.sourceType!=="finance_voucher" ||
    j.sourceId!==String(v.id) || j.sourceEvent!=="payment"){
    reasons.push("سند صرف المورد لا يرتبط بقيد مالي أصلي ومرحّل");
  }
  const debit=x.lines.filter(l=>l.accountCode==="SUPPLIER_PAYABLE_CONTROL");
  const credit=x.lines.filter(l=>l.accountCode.startsWith("CASH_")||l.accountCode.startsWith("BANK_"));
  if(x.lines.length!==2 || debit.length!==1 || credit.length!==1 ||
    debit[0]?.supplierId!==expectedSupplierId ||
    debit[0]?.debitMinor!==v.amountMinor || debit[0]?.creditMinor!==0 ||
    debit[0]?.accountCurrencyCode!=="ILS" ||
    credit[0]?.creditMinor!==v.amountMinor || credit[0]?.debitMinor!==0 ||
    credit[0]?.accountCurrencyCode!=="ILS"){
    reasons.push("قيد السند لا يطابق تسديد ذمة المورد مقابل بنك/صندوق الشيكل مرة واحدة");
  }
  return {verified:reasons.length===0,reasons};
}

/**
 * Prevent attributing a voucher more than once across all imports/invoices.
 * Compare using sums of actual posted voucher amounts, NEVER count a payment
 * merely because the customer clicked an attachment button.
 */
export function previewVoucherAllocation(
  voucherAmountIlsMinor:number,
  existingClaimAmounts:number[],
  requestedIlsMinor:number,
) {
  const invalid=(v:number)=>!Number.isSafeInteger(v)||v<0||v>2_147_483_647;
  if(invalid(voucherAmountIlsMinor)||voucherAmountIlsMinor<=0||
    invalid(requestedIlsMinor)||requestedIlsMinor<=0||
    existingClaimAmounts.some(invalid)){
    return {valid:false,remainingIlsMinor:0,error:"مبلغ السند أو التخصيص غير صالح"};
  }
  const used=existingClaimAmounts.reduce((a,b)=>a+b,0);
  if(!Number.isSafeInteger(used)||used>voucherAmountIlsMinor ||
    used+requestedIlsMinor>voucherAmountIlsMinor){
    return {valid:false,remainingIlsMinor:Math.max(0,voucherAmountIlsMinor-used),
      error:"تم استعمال مبلغ السند في فاتورة أخرى أو أنه أكبر من رصيد السند المتبقي"};
  }
  return {valid:true,remainingIlsMinor:voucherAmountIlsMinor-used-requestedIlsMinor,
    error:null};
}
