/**
 * Verify that an EXISTING ILS purchase is the only GL/inventory owner.
 * No state changes. An accepted purchase is usable as an evidence link to
 * Excel cost allocations; it cannot be booked or re-booked here.
 */
export type PurchaseInventoryEvidence = {
  purchase: {
    id: number;
    supplierId: number;
    status: string;
    currencyCode: string;
    paymentMethod: string;
    totalMinor: number;
    paidMinor: number;
    dueMinor: number;
  };
  itemCosts: Array<{
    itemId: number;
    productId: number | null;
    entryMode: string;
    receivedQuantity: number | null;
    stockQuantityApplied: number | null;
    costTotalMinor: number | null;
    stockCostTotalMinor: number | null;
    historicalSoldQuantity: number | null;
    historicalAllocationPending: boolean | null;
    costQuality: string | null;
  }>;
  ledgerRows: Array<{
    sourceItemRef: string | null;
    productId: number;
    eventType: string;
    quantityDelta: number;
    inventoryValueDeltaMinor: number;
  }>;
  financialLines: Array<{
    accountCode: string;
    supplierId: number | null;
    debitMinor: number;
    creditMinor: number;
  }>;
  transactionStatus: string | null;
  transactionCount: number;
};

export type VerifiedPurchaseEvidence = {
  valid: boolean;
  reasons: string[];
  inventoryCostIlsMinor: number;
  receiptQuantity: number;
  ledgerInventoryIlsMinor: number;
  supplierPayableIlsMinor: number;
};

export function verifyApprovedPurchaseEvidence(
  data: PurchaseInventoryEvidence,
  expectedSupplierId: number,
): VerifiedPurchaseEvidence {
  const reasons: string[] = [];
  const p = data.purchase;
  if (!Number.isSafeInteger(p.id) || p.id < 1) reasons.push("معرف فاتورة الشراء غير صالح");
  if (p.supplierId !== expectedSupplierId) reasons.push("المورد لا يطابق فاتورة المورد في ملف الاستيراد");
  if (p.status !== "completed") reasons.push("فاتورة المشتريات غير معتمدة أو ملغاة");
  if (p.currencyCode !== "ILS") reasons.push("فاتورة المشتريات ليست مقيمة بالشيكل");
  // A cash purchase would deduct money again on top of USD advances already posted.
  if (p.paymentMethod !== "credit" || p.paidMinor !== 0 || p.dueMinor !== p.totalMinor) {
    reasons.push("فاتورة المشتريات يجب أن تكون على الحساب دون خصم نقدي إضافي");
  }
  if (!Number.isSafeInteger(p.totalMinor) || p.totalMinor <= 0) {
    reasons.push("قيمة فاتورة المشتريات غير صالحة");
  }
  if (!data.itemCosts.length) reasons.push("فاتورة المشتريات بلا أصناف مثبتة التكلفة");
  const seenItems = new Set<number>();
  let totalCost = 0;
  let totalQty = 0;
  for (const item of data.itemCosts) {
    if (seenItems.has(item.itemId)) reasons.push("سطر تكلفة شراء مكرر");
    seenItems.add(item.itemId);
    if (item.entryMode !== "stock_receipt" || item.historicalAllocationPending ||
        item.costQuality !== "confirmed" || item.productId == null ||
        item.receivedQuantity === null || item.receivedQuantity <= 0 ||
        item.stockQuantityApplied !== item.receivedQuantity ||
        item.historicalSoldQuantity !== 0 ||
        item.stockCostTotalMinor !== item.costTotalMinor ||
        item.costTotalMinor == null || !Number.isSafeInteger(item.costTotalMinor) ||
        item.costTotalMinor < 0) {
      reasons.push("سطر " + item.itemId + ": لا توجد تكلفة مؤكدة واستلام مخزون جديد مطابق");
      continue;
    }
    totalCost += item.costTotalMinor;
    totalQty += item.receivedQuantity;
  }
  if (!Number.isSafeInteger(totalCost) || totalCost !== p.totalMinor) {
    reasons.push("إجمالي تكلفة الأصناف لا يطابق قيمة فاتورة الشراء");
  }
  const ledgerByItem = new Map<string, PurchaseInventoryEvidence["ledgerRows"]>();
  for (const row of data.ledgerRows) {
    const key = row.sourceItemRef ?? "";
    ledgerByItem.set(key, [...(ledgerByItem.get(key) ?? []), row]);
  }
  let ledgerTotal = 0;
  for (const item of data.itemCosts) {
    const records = ledgerByItem.get(String(item.itemId)) ?? [];
    if (records.length !== 1 ||
        records[0]!.eventType !== "purchase" ||
        records[0]!.productId !== item.productId ||
        records[0]!.quantityDelta !== item.receivedQuantity ||
        records[0]!.inventoryValueDeltaMinor !== item.stockCostTotalMinor) {
      reasons.push("سطر " + item.itemId + ": سجل تكلفة المخزون الفعلي غير مطابق");
    } else ledgerTotal += records[0]!.inventoryValueDeltaMinor;
  }
  if (data.ledgerRows.length !== data.itemCosts.length) {
    reasons.push("عدد سجلات تكلفة المخزون يختلف عن أصناف فاتورة الشراء");
  }
  if (ledgerTotal !== p.totalMinor) reasons.push("قيمة محرك تكلفة المخزون لا تساوي قيمة الشراء");
  if (data.transactionCount !== 1 || data.transactionStatus !== "posted") {
    reasons.push("قيد الشراء المالي الأصلي غير موجود أو ليس مرحلًا مرة واحدة");
  }
  const inventoryDebits = data.financialLines.filter(line => line.accountCode === "PURCHASE_INVENTORY");
  const supplierCredits = data.financialLines.filter(line =>
    line.accountCode === "SUPPLIER_PAYABLE_CONTROL" && line.supplierId === expectedSupplierId);
  const inventory = inventoryDebits.reduce((s,line) => s+line.debitMinor-line.creditMinor,0);
  const payable = supplierCredits.reduce((s,line) => s+line.creditMinor-line.debitMinor,0);
  if (inventory !== p.totalMinor || payable !== p.totalMinor ||
      data.financialLines.some(line =>
        line.accountCode.startsWith("CASH_") || line.accountCode.startsWith("BANK_"))) {
    reasons.push("الشراء يجب أن يسجل المخزون مرة واحدة مقابل ذمة المورد دون دفعة ثانية");
  }
  if (data.financialLines.length !== 2 || inventoryDebits.length !== 1 || supplierCredits.length !== 1) {
    reasons.push("قيد الشراء يحتوي أطرافًا أخرى لا يمكن تسويتها آليًا");
  }
  return {
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    inventoryCostIlsMinor: totalCost,
    receiptQuantity: totalQty,
    ledgerInventoryIlsMinor: ledgerTotal,
    supplierPayableIlsMinor: payable,
  };
}
