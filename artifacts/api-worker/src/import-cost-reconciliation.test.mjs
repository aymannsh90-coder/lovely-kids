import test from "node:test";
import assert from "node:assert/strict";
import { previewImportCostSettlement } from "./import-cost-reconciliation.ts";

function sample() {
  return {
    invoices: [
      { id: "INV-A", supplierId: 1, goodsBookedIlsMinor: 300000, prepaidIlsMinor: 300000 },
      { id: "INV-B", supplierId: 2, goodsBookedIlsMinor: 200000, prepaidIlsMinor: 100000 },
    ],
    shipments: [
      { id: "SHIP-1", freightClearingIlsMinor: 40000 },
      { id: "SHIP-2", freightClearingIlsMinor: 10000 },
    ],
    travelRecordedIlsMinor: 30000,
    lines: [
      { id: "L1", invoiceId: "INV-A", shipmentId: "SHIP-1",
        goodsIlsMinor: 300000, freightIlsMinor: 20000,
        travelManagerialIlsMinor: 18000, travelCapitalizableIlsMinor: 0,
        excelLandedIlsMinor: 338000 },
      { id: "L2", invoiceId: "INV-B", shipmentId: "SHIP-1",
        goodsIlsMinor: 100000, freightIlsMinor: 20000,
        travelManagerialIlsMinor: 6000, travelCapitalizableIlsMinor: 0,
        excelLandedIlsMinor: 126000 },
      { id: "L3", invoiceId: "INV-B", shipmentId: "SHIP-2",
        goodsIlsMinor: 100000, freightIlsMinor: 10000,
        travelManagerialIlsMinor: 6000, travelCapitalizableIlsMinor: 0,
        excelLandedIlsMinor: 116000 },
    ],
  };
}

test("one trip shared by two suppliers and separate shipment charges", () => {
  const result = previewImportCostSettlement(sample());
  assert.equal(result.balanced, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.goodsBookedIlsMinor, 500000);
  assert.equal(result.supplierAdvancesIlsMinor, 400000);
  assert.equal(result.unpaidSupplierIlsMinor, 100000);
  assert.equal(result.freightClearingIlsMinor, 50000);
  assert.equal(result.travelRecordedIlsMinor, 30000);
  assert.equal(result.travelExpenseIlsMinor, 30000);
  assert.equal(result.excelManagerialCostIlsMinor, 580000);
  assert.equal(result.inventoryAccountingCostIlsMinor, 550000);
  assert.deepEqual(result.shipments, [
    { id: "SHIP-1", inventoryAccountingCostIlsMinor: 440000, excelManagerialCostIlsMinor: 464000 },
    { id: "SHIP-2", inventoryAccountingCostIlsMinor: 110000, excelManagerialCostIlsMinor: 116000 },
  ]);
});

test("no trip does not invent any travel charge", () => {
  const draft = sample();
  draft.travelRecordedIlsMinor = 0;
  for (const line of draft.lines) {
    line.excelLandedIlsMinor -= line.travelManagerialIlsMinor;
    line.travelManagerialIlsMinor = 0;
  }
  const result = previewImportCostSettlement(draft);
  assert.equal(result.balanced, true);
  assert.equal(result.excelManagerialCostIlsMinor, 550000);
  assert.equal(result.inventoryAccountingCostIlsMinor, 550000);
  assert.equal(result.travelExpenseIlsMinor, 0);
});

test("eligible trip component is capitalized only once", () => {
  const draft = sample();
  draft.lines[0].travelCapitalizableIlsMinor = 10000;
  const result = previewImportCostSettlement(draft);
  assert.equal(result.balanced, true);
  assert.equal(result.inventoryAccountingCostIlsMinor, 560000);
  assert.equal(result.travelExpenseIlsMinor, 20000);
  assert.equal(
    result.inventoryAccountingCostIlsMinor + result.travelExpenseIlsMinor,
    result.excelManagerialCostIlsMinor,
  );
});

test("reject Excel totals that add freight again", () => {
  const draft = sample();
  draft.lines[0].excelLandedIlsMinor += 20000;
  const result = previewImportCostSettlement(draft);
  assert.equal(result.balanced, false);
  assert.ok(result.errors.some((error) => error.includes("تكلفة الإكسل")));
});

test("reject freight payments not matching shipment allocation", () => {
  const draft = sample();
  draft.shipments[0].freightClearingIlsMinor = 50000;
  const result = previewImportCostSettlement(draft);
  assert.equal(result.balanced, false);
  assert.ok(result.errors.some((error) => error.includes("توزيع الشحن")));
});

test("reject cross-supplier travel distributions that do not reconcile", () => {
  const draft = sample();
  draft.travelRecordedIlsMinor = 31000;
  const result = previewImportCostSettlement(draft);
  assert.equal(result.balanced, false);
  assert.ok(result.errors.some((error) => error.includes("جميع الموردين")));
});

test("reject duplicate item allocation references", () => {
  const draft = sample();
  draft.lines[2].id = "L1";
  const result = previewImportCostSettlement(draft);
  assert.equal(result.balanced, false);
  assert.ok(result.errors.some((error) => error.includes("مكرر")));
});

test("reject unknown supplier invoice or shipment references", () => {
  const draft = sample();
  draft.lines[1].shipmentId = "NOT-A-SHIPMENT";
  assert.equal(previewImportCostSettlement(draft).balanced, false);
});

test("reject overpaid advance rather than silently clear it", () => {
  const draft = sample();
  draft.invoices[1].prepaidIlsMinor = 210000;
  const result = previewImportCostSettlement(draft);
  assert.equal(result.balanced, false);
  assert.ok(result.errors.some((error) => error.includes("الدفعات المقدمة تتجاوز")));
});

test("reject travel capitalization larger than allocated travel", () => {
  const draft = sample();
  draft.lines[1].travelCapitalizableIlsMinor = 10000;
  const result = previewImportCostSettlement(draft);
  assert.equal(result.balanced, false);
  assert.ok(result.errors.some((error) => error.includes("السفر المؤهل أكبر")));
});
