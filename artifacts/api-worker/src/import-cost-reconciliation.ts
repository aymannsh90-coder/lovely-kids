/**
 * Preview-only landed-cost reconciliation for import purchase batches.
 *
 * This module MUST NOT post cash, supplier, inventory or cost-ledger entries.
 * Purchase approval already posts to PURCHASE_INVENTORY in pos-purchase-routes;
 * callers must integrate with that exact posting path before enabling close.
 * All amounts are integer ILS agorot, with supplier advance valuations
 * fixed from the underlying prepayment dates (not today's USD spot rate).
 */

export type ImportInvoiceCost = {
  id: string;
  supplierId: number;
  goodsBookedIlsMinor: number;
  prepaidIlsMinor: number;
};

export type ImportShipmentCost = {
  id: string;
  freightClearingIlsMinor: number;
};

export type ImportAllocatedCost = {
  id: string;
  invoiceId: string;
  shipmentId: string;
  goodsIlsMinor: number;
  freightIlsMinor: number;
  travelManagerialIlsMinor: number;
  travelCapitalizableIlsMinor: number;
  excelLandedIlsMinor: number;
};

export type ImportCostDraft = {
  invoices: ImportInvoiceCost[];
  shipments: ImportShipmentCost[];
  travelRecordedIlsMinor: number;
  lines: ImportAllocatedCost[];
};

export type ImportCostPreview = {
  balanced: boolean;
  errors: string[];
  goodsBookedIlsMinor: number;
  supplierAdvancesIlsMinor: number;
  unpaidSupplierIlsMinor: number;
  freightClearingIlsMinor: number;
  travelRecordedIlsMinor: number;
  travelCapitalizableIlsMinor: number;
  travelExpenseIlsMinor: number;
  excelManagerialCostIlsMinor: number;
  inventoryAccountingCostIlsMinor: number;
  shipments: Array<{
    id: string;
    inventoryAccountingCostIlsMinor: number;
    excelManagerialCostIlsMinor: number;
  }>;
};

const MAX_POSTING_MINOR = 2_147_483_647;
const MAX_LINES = 5000;

function validMoney(amount: unknown): amount is number {
  return typeof amount === "number" &&
    Number.isSafeInteger(amount) &&
    amount >= 0 && amount <= MAX_POSTING_MINOR;
}

function validId(id: unknown): id is string {
  return typeof id === "string" &&
    id.trim() === id &&
    id.length >= 1 &&
    id.length <= 100;
}

function safeAmount(value: unknown, label: string, errors: string[]): number {
  if (!validMoney(value)) {
    errors.push(label + ": مبلغ غير صالح، يجب أن يكون عدد أغورات صحيحًا غير سالب");
    return 0;
  }
  return value;
}

function checkTotal(amount: number, label: string, errors: string[]): void {
  if (!Number.isSafeInteger(amount) || amount > MAX_POSTING_MINOR) {
    errors.push(label + ": الإجمالي يتجاوز الحد المحاسبي المسموح");
  }
}

/**
 * Checks sums already distributed by the user's Excel.
 * Never allocates freight/travel a second time; never posts any journal.
 * 'balanced' means arithmetic reconciliation only, NOT approval to post.
 */
export function previewImportCostSettlement(
  draft: ImportCostDraft,
): ImportCostPreview {
  const errors: string[] = [];
  if (
    !draft ||
    !Array.isArray(draft.invoices) ||
    !Array.isArray(draft.shipments) ||
    !Array.isArray(draft.lines)
  ) {
    throw new Error("INVALID_IMPORT_DRAFT");
  }
  if (draft.invoices.length === 0) errors.push("يجب تسجيل فاتورة مورد واحدة على الأقل");
  if (draft.shipments.length === 0) errors.push("يجب تسجيل شحنة واحدة على الأقل");
  if (draft.lines.length === 0) errors.push("لا يوجد توزيع تكلفة من الإكسل");
  if (
    draft.invoices.length > MAX_LINES ||
    draft.shipments.length > MAX_LINES ||
    draft.lines.length > MAX_LINES
  ) {
    errors.push("عدد السطور يتجاوز الحد المسموح");
  }

  const invoices = new Map<string, { goods: number; prepaid: number; allocated: number }>();
  const shipments = new Map<string, {
    freight: number;
    allocatedFreight: number;
    inventory: number;
    managerial: number;
  }>();

  for (const invoice of draft.invoices) {
    if (!validId(invoice.id) || invoices.has(invoice.id)) {
      errors.push("رقم فاتورة مورد فارغ أو مكرر");
      continue;
    }
    if (!Number.isSafeInteger(invoice.supplierId) || invoice.supplierId <= 0) {
      errors.push("فاتورة " + invoice.id + ": المورد غير صالح");
    }
    const goods = safeAmount(invoice.goodsBookedIlsMinor, "فاتورة " + invoice.id, errors);
    const prepaid = safeAmount(invoice.prepaidIlsMinor, "دفعات فاتورة " + invoice.id, errors);
    if (prepaid > goods) {
      errors.push("فاتورة " + invoice.id + ": الدفعات المقدمة تتجاوز قيمة البضاعة؛ تحتاج تسوية مستقلة");
    }
    invoices.set(invoice.id, { goods, prepaid, allocated: 0 });
  }

  for (const shipment of draft.shipments) {
    if (!validId(shipment.id) || shipments.has(shipment.id)) {
      errors.push("رقم شحنة فارغ أو مكرر");
      continue;
    }
    shipments.set(shipment.id, {
      freight: safeAmount(shipment.freightClearingIlsMinor, "الشحنة " + shipment.id, errors),
      allocatedFreight: 0,
      inventory: 0,
      managerial: 0,
    });
  }

  const travelRecorded = safeAmount(draft.travelRecordedIlsMinor, "مصاريف الرحلة", errors);
  const allocations = new Set<string>();
  let distributedTravel = 0;
  let capitalizedTravel = 0;
  let excelTotal = 0;
  let inventoryTotal = 0;

  for (const line of draft.lines) {
    if (!validId(line.id) || allocations.has(line.id)) {
      errors.push("مرجع سطر تكلفة الإكسل فارغ أو مكرر");
      continue;
    }
    allocations.add(line.id);
    const invoice = invoices.get(line.invoiceId);
    const shipment = shipments.get(line.shipmentId);
    if (!invoice || !shipment) {
      errors.push("سطر " + line.id + ": فاتورة المورد أو الشحنة غير موجودة");
      continue;
    }

    const goods = safeAmount(line.goodsIlsMinor, "بضاعة السطر " + line.id, errors);
    const freight = safeAmount(line.freightIlsMinor, "نقل السطر " + line.id, errors);
    const travel = safeAmount(line.travelManagerialIlsMinor, "سفر السطر " + line.id, errors);
    const eligibleTravel = safeAmount(
      line.travelCapitalizableIlsMinor,
      "سفر مؤهل للمخزون " + line.id,
      errors,
    );
    const excel = safeAmount(line.excelLandedIlsMinor, "تكلفة الإكسل " + line.id, errors);

    if (eligibleTravel > travel) {
      errors.push("سطر " + line.id + ": السفر المؤهل أكبر من السفر المحمّل");
    }
    if (excel !== goods + freight + travel) {
      errors.push("سطر " + line.id + ": تكلفة الإكسل لا تساوي البضاعة + النقل + السفر");
    }

    invoice.allocated += goods;
    shipment.allocatedFreight += freight;
    distributedTravel += travel;
    capitalizedTravel += eligibleTravel;
    excelTotal += excel;

    const accounting = goods + freight + eligibleTravel;
    inventoryTotal += accounting;
    shipment.inventory += accounting;
    shipment.managerial += excel;
  }

  for (const [id, invoice] of invoices) {
    if (invoice.allocated !== invoice.goods) {
      errors.push("فاتورة " + id + ": قيمة الأصناف الموزعة لا تطابق قيمة شراء البضاعة");
    }
  }
  for (const [id, shipment] of shipments) {
    if (shipment.allocatedFreight !== shipment.freight) {
      errors.push("الشحنة " + id + ": توزيع الشحن والتخليص لا يطابق الدفعات المسجلة");
    }
  }
  if (distributedTravel !== travelRecorded) {
    errors.push("توزيع مصاريف السفر على جميع الموردين لا يطابق المصروف المسجل للرحلة");
  }

  const goodsTotal = Array.from(invoices.values()).reduce((sum, value) => sum + value.goods, 0);
  const prepaidTotal = Array.from(invoices.values()).reduce((sum, value) => sum + value.prepaid, 0);
  const freightTotal = Array.from(shipments.values()).reduce((sum, value) => sum + value.freight, 0);
  const travelExpense = travelRecorded - capitalizedTravel;

  checkTotal(goodsTotal, "إجمالي البضاعة", errors);
  checkTotal(prepaidTotal, "إجمالي الدفعات المقدمة", errors);
  checkTotal(freightTotal, "إجمالي الشحن والتخليص", errors);
  checkTotal(excelTotal, "إجمالي الإكسل", errors);
  checkTotal(inventoryTotal, "تكلفة المخزون المحاسبية", errors);
  if (travelExpense < 0) errors.push("تكاليف السفر المؤهلة أكبر من المدفوعة");

  return {
    balanced: errors.length === 0,
    errors,
    goodsBookedIlsMinor: goodsTotal,
    supplierAdvancesIlsMinor: prepaidTotal,
    unpaidSupplierIlsMinor: goodsTotal - prepaidTotal,
    freightClearingIlsMinor: freightTotal,
    travelRecordedIlsMinor: travelRecorded,
    travelCapitalizableIlsMinor: capitalizedTravel,
    travelExpenseIlsMinor: travelExpense,
    excelManagerialCostIlsMinor: excelTotal,
    inventoryAccountingCostIlsMinor: inventoryTotal,
    shipments: Array.from(shipments, ([id, amount]) => ({
      id,
      inventoryAccountingCostIlsMinor: amount.inventory,
      excelManagerialCostIlsMinor: amount.managerial,
    })),
  };
}
