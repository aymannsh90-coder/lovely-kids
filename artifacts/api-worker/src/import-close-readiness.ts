/**
 * Reconciliation gate before attempting to close any import shipment.
 * Pure preview. This module cannot write accounts or inventory.
 *
 * Partial supplier payments are allowed when remaining liability has
 * a separate evidenced accounting posting.
 */
export type ImportCloseInvoice = {
  ref: string;
  goodsUsdMinor: number;
  goodsBookedIlsMinor: number;
  paidUsdMinor: number;
  advanceIlsMinor: number;
  remainingPayableIlsMinor: number;
  payableJournalVerified: boolean;
};
export type ImportCloseShipment = {
  ref: string;
  freightIlsMinor: number;
  customsIlsMinor: number;
  localTransportIlsMinor: number;
  paidFreightIlsMinor: number;
  paidCustomsIlsMinor: number;
  paidLocalTransportIlsMinor: number;
  hasInventoryReceipt: boolean;
  purchasePostingMatched: boolean;
};
export type ImportCloseState = {
  excelBalanced: boolean;
  excelErrors: string[];
  invoices: ImportCloseInvoice[];
  shipments: ImportCloseShipment[];
  travelRecordedIlsMinor: number;
  travelPaidIlsMinor: number;
  travelClassificationApproved: boolean;
  /** Used only after source POS purchase posting ownership is proven. */
  inventoryCostEngineReconciled: boolean;
  /** All advance/direct clearing balances must be reclassified exactly once. */
  settlementJournalVerified: boolean;
};
export type ImportClosePreview = {
  canCloseAccounting: boolean;
  reasons: string[];
  totalUsdMinor: number;
  paidUsdMinor: number;
  unPaidUsdMinor: number;
  totalGoodsIlsMinor: number;
  recordedSupplierAdvanceIlsMinor: number;
  directCostPlannedIlsMinor: number;
  directCostPaidIlsMinor: number;
  travelPlannedIlsMinor: number;
  travelPaidIlsMinor: number;
};

export function previewImportClosing(state: ImportCloseState): ImportClosePreview {
  const reasons: string[] = [];
  const isMoney = (v: number) => Number.isSafeInteger(v) && v >= 0 && v <= 2_147_483_647;
  const check = (value: number, label: string) => {
    if (!isMoney(value)) reasons.push(label + " غير صالح");
    return isMoney(value) ? value : 0;
  };
  if (!state.excelBalanced || state.excelErrors.length) {
    reasons.push("توزيع الإكسل لم يُطابق جميع الفواتير والشحنات بعد");
  }
  if (!state.invoices.length) reasons.push("لا يوجد فواتير موردين");
  if (!state.shipments.length) reasons.push("لا توجد شحنات");

  let usdTotal=0, usdPaid=0, goodsIls=0, advancesIls=0, shippingTotal=0, shippingPaid=0;
  for (const inv of state.invoices) {
    const goodsUsd = check(inv.goodsUsdMinor, inv.ref + " قيمة الدولار");
    const paidUsd = check(inv.paidUsdMinor, inv.ref + " مدفوع الدولار");
    const bookedIls = check(inv.goodsBookedIlsMinor, inv.ref + " قيمة البضاعة بالشيكل");
    const paidIls = check(inv.advanceIlsMinor, inv.ref + " قيمة المقدمات");
    const liability = check(inv.remainingPayableIlsMinor, inv.ref + " الذمة المتبقية");
    if (paidUsd > goodsUsd) reasons.push("فاتورة " + inv.ref + ": دفعات الدولار تتجاوز إجمالي الشراء");
    if (paidIls > bookedIls) reasons.push("فاتورة " + inv.ref + ": المدفوع الدفتري يتجاوز قيمة الفاتورة");
    if (paidIls + liability !== bookedIls) {
      reasons.push("فاتورة " + inv.ref + ": المقدمات والذمة لا يساويان قيمة البضاعة بالشيكل");
    }
    if (paidUsd < goodsUsd && !inv.payableJournalVerified) {
      reasons.push("فاتورة " + inv.ref + ": قيمة المورد المتبقية لم تُرحّل على الذمم");
    }
    if (paidUsd === goodsUsd && liability !== 0) {
      reasons.push("فاتورة " + inv.ref + ": دفعت بالكامل وما زال لها رصيد مورد مسجل");
    }
    usdTotal+=goodsUsd; usdPaid+=paidUsd; goodsIls+=bookedIls; advancesIls+=paidIls;
  }
  for (const shipment of state.shipments) {
    const kinds = [
      ["الشحن",shipment.freightIlsMinor,shipment.paidFreightIlsMinor],
      ["التخليص",shipment.customsIlsMinor,shipment.paidCustomsIlsMinor],
      ["النقل",shipment.localTransportIlsMinor,shipment.paidLocalTransportIlsMinor],
    ] as const;
    for (const [kind, plannedRaw, paidRaw] of kinds) {
      const planned = check(plannedRaw, shipment.ref + " " + kind);
      const paid = check(paidRaw, shipment.ref + " مدفوع " + kind);
      shippingTotal+=planned; shippingPaid+=paid;
      if (paid !== planned) {
        reasons.push("الشحنة " + shipment.ref + ": مصاريف " + kind + " المسجلة لم تُسوَّ بالكامل");
      }
    }
    if (!shipment.hasInventoryReceipt) reasons.push("الشحنة " + shipment.ref + ": استلام أصناف المخزون غير مثبت");
    if (!shipment.purchasePostingMatched) reasons.push("الشحنة " + shipment.ref + ": قيد شراء المخزون الأصلي غير مرتبط بالمطابقة");
  }
  const travelPlanned = check(state.travelRecordedIlsMinor, "السفر المخطط");
  const travelPaid = check(state.travelPaidIlsMinor, "السفر المدفوع");
  if (travelPaid !== travelPlanned) reasons.push("مدفوعات السفر لا تطابق مصاريف الرحلة الموزعة");
  if (travelPlanned > 0 && !state.travelClassificationApproved) {
    reasons.push("تصنيف تكاليف السفر بين المخزون والمصاريف يحتاج اعتمادًا");
  }
  if (!state.settlementJournalVerified) {
    reasons.push("قيد تسوية مقدمات المورد والشحن والسفر غير مربوط أو غير مرحل");
  }
  if (!state.inventoryCostEngineReconciled) {
    reasons.push("قيمة المخزون في محرك التكلفة لم تُطابق قيد الأستاذ بعد");
  }
  for (const [label,v] of [
    ["إجمالي الدولار", usdTotal],["مدفوع الدولار",usdPaid],["تكلفة البضاعة",goodsIls],
    ["مدفوع المقدمات",advancesIls],["التكاليف المباشرة",shippingTotal],["مدفوع التكاليف",shippingPaid],
  ] as const) check(v,label);
  return {
    canCloseAccounting: reasons.length===0,
    reasons: [...new Set(reasons)],
    totalUsdMinor: usdTotal,
    paidUsdMinor: usdPaid,
    unPaidUsdMinor: Math.max(0,usdTotal-usdPaid),
    totalGoodsIlsMinor: goodsIls,
    recordedSupplierAdvanceIlsMinor: advancesIls,
    directCostPlannedIlsMinor: shippingTotal,
    directCostPaidIlsMinor: shippingPaid,
    travelPlannedIlsMinor: travelPlanned,
    travelPaidIlsMinor: travelPaid,
  };
}
