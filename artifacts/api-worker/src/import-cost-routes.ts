import {
  importCostCasesTable,
  importCostInvoicesTable,
  importCostShipmentsTable,
  importCostAllocationsTable,
  importCostAdvancePaymentsTable,
  importCostDirectPaymentsTable,
  importCostPurchaseLinksTable,
  financeTransactionsTable,
  suppliersTable,
} from "@workspace/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "./auth";
import type { openDb, Env } from "./db";
import { previewImportCostSettlement, type ImportCostDraft } from "./import-cost-reconciliation";
import { ImportAdvanceError, parseSupplierAdvanceRequest, postImportUsdSupplierAdvance } from "./import-payment-posting";
import { parseImportDirectCostRequest, postImportDirectCost } from "./import-direct-payment-posting";
import { previewImportClosing } from "./import-close-readiness";
import { previewImportClearingSettlement } from "./import-clearing-settlement";
import { attachApprovedPurchase,detachApprovedPurchase,getPurchaseLinks,ImportPurchaseLinkError } from "./import-purchase-link-service";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
const LIMIT_MINOR = 2_147_483_647;
const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

class ImportDraftError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

interface InvoiceInput {
  lineRef: string;
  supplierId: number;
  invoiceNumber: string;
  goodsUsdMinor: number;
  goodsBookedIlsMinor: number;
}
interface ShipmentInput {
  lineRef: string;
  trackingNumber: string | null;
  freightIlsMinor: number;
  customsIlsMinor: number;
  localTransportIlsMinor: number;
  freightClearingIlsMinor: number;
}
interface AllocationInput {
  lineRef: string;
  invoiceRef: string;
  shipmentRef: string;
  goodsIlsMinor: number;
  freightIlsMinor: number;
  travelManagerialIlsMinor: number;
  travelCapitalizableIlsMinor: number;
  excelLandedIlsMinor: number;
}
interface DraftInput {
  title: string;
  businessDate: string;
  withTravel: boolean;
  travelRecordedIlsMinor: number;
  notes: string | null;
  invoices: InvoiceInput[];
  shipments: ShipmentInput[];
  allocations: AllocationInput[];
}

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ImportDraftError(label + " غير صالح");
  }
  return value as Record<string, unknown>;
};

const stringField = (value: unknown, label: string, max: number) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new ImportDraftError(label + " مطلوب أو طويل جدًا");
  }
  return value.trim();
};
const optionalString = (value: unknown, label: string, max: number): string | null =>
  value == null || value === "" ? null : stringField(value, label, max);
const money = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > LIMIT_MINOR) {
    throw new ImportDraftError(label + " يجب أن يكون قيمة صحيحة بالأغورات");
  }
  return value;
};
const positive = (value: unknown, label: string): number => {
  const n = money(value, label);
  if (n === 0) throw new ImportDraftError(label + " مطلوب");
  return n;
};

function distinct<T extends { lineRef: string }>(rows: T[], label: string) {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.lineRef)) throw new ImportDraftError("مرجع " + label + " مكرر: " + row.lineRef);
    ids.add(row.lineRef);
  }
}
function parseDraft(raw: unknown): DraftInput {
  const input = record(raw, "بيانات ملف الاستيراد");
  const date = stringField(input.businessDate, "تاريخ الملف", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date + "T00:00:00Z")) ||
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) {
    throw new ImportDraftError("التاريخ غير صالح");
  }
  if (typeof input.withTravel !== "boolean") throw new ImportDraftError("اختيار السفر غير صالح");
  const withTravel = input.withTravel;
  const travelRecordedIlsMinor = money(input.travelRecordedIlsMinor, "مصاريف السفر");
  if (!withTravel && travelRecordedIlsMinor !== 0) {
    throw new ImportDraftError("لا يمكن تسجيل سفر في ملف بدون رحلة شراء");
  }
  const array = (value: unknown, label: string, max: number): unknown[] => {
    if (!Array.isArray(value) || value.length > max) throw new ImportDraftError(label + " غير صالح");
    return value;
  };
  const invoices = array(input.invoices, "فواتير الموردين", 100).map((r): InvoiceInput => {
    const a = record(r, "فاتورة مورد");
    return {
      lineRef: stringField(a.lineRef, "مرجع الفاتورة", 100),
      supplierId: positive(a.supplierId, "المورد"),
      invoiceNumber: stringField(a.invoiceNumber, "رقم فاتورة المورد", 100),
      goodsUsdMinor: money(a.goodsUsdMinor, "قيمة الفاتورة بالدولار"),
      goodsBookedIlsMinor: money(a.goodsBookedIlsMinor, "قيمة البضاعة الدفترية بالشيكل"),
    };
  });
  const shipments = array(input.shipments, "الشحنات", 100).map((r): ShipmentInput => {
    const a = record(r, "شحنة");
    const freightIlsMinor = money(a.freightIlsMinor, "أجور الشحن");
    const customsIlsMinor = money(a.customsIlsMinor, "أجور التخليص");
    const localTransportIlsMinor = money(a.localTransportIlsMinor, "تكلفة النقل المحلي");
    const total = freightIlsMinor + customsIlsMinor + localTransportIlsMinor;
    if (!Number.isSafeInteger(total) || total > LIMIT_MINOR) throw new ImportDraftError("إجمالي مصاريف الشحنة كبير جدًا");
    return {
      lineRef: stringField(a.lineRef, "مرجع الشحنة", 100),
      trackingNumber: optionalString(a.trackingNumber, "رقم الشحن", 100),
      freightIlsMinor, customsIlsMinor, localTransportIlsMinor,
      freightClearingIlsMinor: total,
    };
  });
  const allocations = array(input.allocations, "توزيع تكاليف الإكسل", 5000).map((r): AllocationInput => {
    const a = record(r, "سطر توزيع");
    const result = {
      lineRef: stringField(a.lineRef, "مرجع سطر الإكسل", 100),
      invoiceRef: stringField(a.invoiceRef, "مرجع فاتورة المورد", 100),
      shipmentRef: stringField(a.shipmentRef, "مرجع الشحنة", 100),
      goodsIlsMinor: money(a.goodsIlsMinor, "بضاعة السطر"),
      freightIlsMinor: money(a.freightIlsMinor, "شحن السطر"),
      travelManagerialIlsMinor: money(a.travelManagerialIlsMinor, "سفر السطر"),
      travelCapitalizableIlsMinor: money(a.travelCapitalizableIlsMinor, "سفر قابل للرسملة"),
      excelLandedIlsMinor: money(a.excelLandedIlsMinor, "تكلفة الإكسل"),
    };
    if (result.travelCapitalizableIlsMinor > result.travelManagerialIlsMinor) {
      throw new ImportDraftError("السفر المؤهل لا يتجاوز السفر الإجمالي");
    }
    if (
      result.goodsIlsMinor + result.freightIlsMinor + result.travelManagerialIlsMinor !==
      result.excelLandedIlsMinor
    ) {
      throw new ImportDraftError("تكلفة سطر الإكسل لا تطابق البضاعة + الشحن + السفر");
    }
    return result;
  });
  distinct(invoices, "الفاتورة");
  distinct(shipments, "الشحنة");
  distinct(allocations, "التوزيع");
  const invoiceRefs = new Set(invoices.map((r) => r.lineRef));
  const shipmentRefs = new Set(shipments.map((r) => r.lineRef));
  for (const line of allocations) {
    if (!invoiceRefs.has(line.invoiceRef) || !shipmentRefs.has(line.shipmentRef)) {
      throw new ImportDraftError("سطر الإكسل مرتبط بفاتورة أو شحنة غير موجودة");
    }
  }
  const pairs = new Set<string>();
  for (const invoice of invoices) {
    const key = invoice.supplierId + ":" + invoice.invoiceNumber;
    if (pairs.has(key)) throw new ImportDraftError("لا يجوز تكرار فاتورة نفس المورد داخل الملف");
    pairs.add(key);
  }
  return {
    title: stringField(input.title, "عنوان ملف الاستيراد", 150),
    businessDate: date,
    withTravel,
    travelRecordedIlsMinor,
    notes: optionalString(input.notes, "ملاحظات", 2000),
    invoices, shipments, allocations,
  };
}

async function assertSuppliers(tx: Tx, invoices: InvoiceInput[]): Promise<void> {
  const ids = [...new Set(invoices.map((line) => line.supplierId))];
  if (ids.length === 0) return;
  const suppliers = await tx.select({ id: suppliersTable.id })
    .from(suppliersTable).where(inArray(suppliersTable.id, ids));
  if (suppliers.length !== ids.length) throw new ImportDraftError("مورد واحد على الأقل غير موجود", 409);
}

async function insertChildren(
  tx: Tx, caseId: number, draft: DraftInput,
  protectedInvoices = new Map<string, number>(),
  protectedShipments = new Map<string, number>(),
) {
  const invoiceIds = new Map<string, number>();
  const shipmentIds = new Map<string, number>();
  for (const invoice of draft.invoices) {
    const existingId = protectedInvoices.get(invoice.lineRef);
    if (existingId) {
      await tx.update(importCostInvoicesTable).set({
        goodsBookedIlsMinor: invoice.goodsBookedIlsMinor,
      }).where(eq(importCostInvoicesTable.id, existingId));
      invoiceIds.set(invoice.lineRef, existingId);
      continue;
    }
    const [inserted] = await tx.insert(importCostInvoicesTable).values({
      caseId,
      lineRef: invoice.lineRef,
      supplierId: invoice.supplierId,
      invoiceNumber: invoice.invoiceNumber,
      goodsUsdMinor: invoice.goodsUsdMinor,
      goodsBookedIlsMinor: invoice.goodsBookedIlsMinor,
    }).returning({ id: importCostInvoicesTable.id });
    if (!inserted) throw new ImportDraftError("تعذر حفظ فاتورة المورد", 500);
    invoiceIds.set(invoice.lineRef, inserted.id);
  }
  for (const shipment of draft.shipments) {
    const existingId = protectedShipments.get(shipment.lineRef);
    if (existingId) {
      await tx.update(importCostShipmentsTable).set({
        trackingNumber: shipment.trackingNumber,
        freightIlsMinor: shipment.freightIlsMinor,
        customsIlsMinor: shipment.customsIlsMinor,
        localTransportIlsMinor: shipment.localTransportIlsMinor,
        freightClearingIlsMinor: shipment.freightClearingIlsMinor,
      }).where(eq(importCostShipmentsTable.id, existingId));
      shipmentIds.set(shipment.lineRef, existingId);
      continue;
    }
    const [inserted] = await tx.insert(importCostShipmentsTable).values({
      caseId, lineRef: shipment.lineRef,
      trackingNumber: shipment.trackingNumber,
      freightIlsMinor: shipment.freightIlsMinor,
      customsIlsMinor: shipment.customsIlsMinor,
      localTransportIlsMinor: shipment.localTransportIlsMinor,
      freightClearingIlsMinor: shipment.freightClearingIlsMinor,
    }).returning({ id: importCostShipmentsTable.id });
    if (!inserted) throw new ImportDraftError("تعذر حفظ الشحنة", 500);
    shipmentIds.set(shipment.lineRef, inserted.id);
  }
  // Every line must point to invoice and shipment rows created in this exact case.
  for (const line of draft.allocations) {
    const invoiceId = invoiceIds.get(line.invoiceRef);
    const shipmentId = shipmentIds.get(line.shipmentRef);
    if (!invoiceId || !shipmentId) throw new ImportDraftError("مرجع توزيع غير موجود");
    await tx.insert(importCostAllocationsTable).values({
      caseId, lineRef: line.lineRef, invoiceId, shipmentId,
      goodsIlsMinor: line.goodsIlsMinor,
      freightIlsMinor: line.freightIlsMinor,
      travelManagerialIlsMinor: line.travelManagerialIlsMinor,
      travelCapitalizableIlsMinor: line.travelCapitalizableIlsMinor,
      excelLandedIlsMinor: line.excelLandedIlsMinor,
    });
  }
}

async function detail(db: Db, id: number, env: Env) {
  const [found] = await db.select().from(importCostCasesTable)
    .where(eq(importCostCasesTable.id, id)).limit(1);
  if (!found) throw new ImportDraftError("ملف الاستيراد غير موجود", 404);
  const invoices = await db.select().from(importCostInvoicesTable)
    .where(eq(importCostInvoicesTable.caseId, id));
  const shipments = await db.select().from(importCostShipmentsTable)
    .where(eq(importCostShipmentsTable.caseId, id));
  const lines = await db.select().from(importCostAllocationsTable)
    .where(eq(importCostAllocationsTable.caseId, id));
  const paymentRecords = await db.select({
    paymentId: importCostAdvancePaymentsTable.id,
    invoiceId: importCostAdvancePaymentsTable.invoiceId,
    usdAmountMinor: importCostAdvancePaymentsTable.usdAmountMinor,
    advanceIlsMinor: importCostAdvancePaymentsTable.advanceIlsMinor,
    bankBookIlsMinor: importCostAdvancePaymentsTable.bankBookIlsMinor,
    fxGainIlsMinor: importCostAdvancePaymentsTable.fxGainIlsMinor,
    fxLossIlsMinor: importCostAdvancePaymentsTable.fxLossIlsMinor,
    financeTransactionId: importCostAdvancePaymentsTable.financeTransactionId,
    financeStatus: financeTransactionsTable.status,
  }).from(importCostAdvancePaymentsTable)
    .innerJoin(financeTransactionsTable, eq(
      importCostAdvancePaymentsTable.financeTransactionId, financeTransactionsTable.id,
    )).where(eq(importCostAdvancePaymentsTable.caseId, id));
  const directRecords = await db.select({
    paymentId: importCostDirectPaymentsTable.id,
    shipmentId: importCostDirectPaymentsTable.shipmentId,
    costType: importCostDirectPaymentsTable.costType,
    paymentMethod: importCostDirectPaymentsTable.paymentMethod,
    amountIlsMinor: importCostDirectPaymentsTable.amountIlsMinor,
    financeTransactionId: importCostDirectPaymentsTable.financeTransactionId,
    financeStatus: financeTransactionsTable.status,
  }).from(importCostDirectPaymentsTable)
    .innerJoin(financeTransactionsTable, eq(
      importCostDirectPaymentsTable.financeTransactionId, financeTransactionsTable.id,
    )).where(eq(importCostDirectPaymentsTable.caseId, id));
  const paidByInvoiceId = new Map<number, number>();
  for (const payment of paymentRecords) {
    if (payment.financeStatus !== "posted") continue;
    paidByInvoiceId.set(payment.invoiceId,
      (paidByInvoiceId.get(payment.invoiceId) ?? 0) + payment.advanceIlsMinor);
  }
  const invById = new Map(invoices.map((i) => [i.id, i.lineRef]));
  const shipById = new Map(shipments.map((i) => [i.id, i.lineRef]));
  const draft: DraftInput = {
    title: found.title, businessDate: found.businessDate, withTravel: found.withTravel,
    travelRecordedIlsMinor: found.travelRecordedIlsMinor, notes: found.notes,
    invoices: invoices.map((i) => ({
      lineRef: i.lineRef, supplierId: i.supplierId, invoiceNumber: i.invoiceNumber,
      goodsUsdMinor: i.goodsUsdMinor, goodsBookedIlsMinor: i.goodsBookedIlsMinor,
    })),
    shipments: shipments.map((s) => ({
      lineRef: s.lineRef, trackingNumber: s.trackingNumber,
      freightIlsMinor: s.freightIlsMinor,
      customsIlsMinor: s.customsIlsMinor,
      localTransportIlsMinor: s.localTransportIlsMinor,
      freightClearingIlsMinor: s.freightClearingIlsMinor,
    })),
    allocations: lines.map((l) => ({
      lineRef: l.lineRef,
      invoiceRef: invById.get(l.invoiceId) ?? "",
      shipmentRef: shipById.get(l.shipmentId) ?? "",
      goodsIlsMinor: l.goodsIlsMinor,
      freightIlsMinor: l.freightIlsMinor,
      travelManagerialIlsMinor: l.travelManagerialIlsMinor,
      travelCapitalizableIlsMinor: l.travelCapitalizableIlsMinor,
      excelLandedIlsMinor: l.excelLandedIlsMinor,
    })),
  };
  const previewDraft: ImportCostDraft = {
    invoices: draft.invoices.map((i) => {
      const stored = invoices.find((record) => record.lineRef === i.lineRef);
      return {
        id: i.lineRef, supplierId: i.supplierId,
        goodsBookedIlsMinor: i.goodsBookedIlsMinor,
        prepaidIlsMinor: stored ? (paidByInvoiceId.get(stored.id) ?? 0) : 0,
      };
    }),
    shipments: draft.shipments.map((s) => ({
      id: s.lineRef, freightClearingIlsMinor: s.freightClearingIlsMinor,
    })),
    travelRecordedIlsMinor: draft.travelRecordedIlsMinor,
    lines: draft.allocations.map((a) => ({
      id: a.lineRef, invoiceId: a.invoiceRef, shipmentId: a.shipmentRef,
      goodsIlsMinor: a.goodsIlsMinor, freightIlsMinor: a.freightIlsMinor,
      travelManagerialIlsMinor: a.travelManagerialIlsMinor,
      travelCapitalizableIlsMinor: a.travelCapitalizableIlsMinor,
      excelLandedIlsMinor: a.excelLandedIlsMinor,
    })),
  };
  const comparison = previewImportCostSettlement(previewDraft);
  const purchaseLinks = await getPurchaseLinks(db,id);
  const linkedByGroup = new Map<string, {cost:number;valid:boolean;count:number}>();
  for (const link of purchaseLinks) {
    const existing = linkedByGroup.get(link.allocationRef) ?? {cost:0,valid:true,count:0};
    existing.cost += link.inventoryCostIlsMinor;
    existing.valid = existing.valid && link.valid;
    existing.count++;
    linkedByGroup.set(link.allocationRef,existing);
  }
  const groupReady = (group: DraftInput["allocations"][number]) => {
    const links = linkedByGroup.get(group.lineRef);
    const cost = group.goodsIlsMinor + group.freightIlsMinor + group.travelCapitalizableIlsMinor;
    return !!links && links.valid && links.count > 0 && links.cost === cost;
  };
  const allGroupsMatched = draft.allocations.length > 0 && draft.allocations.every(groupReady);
  const clearingCandidate = previewImportClearingSettlement({
    caseRef:found.publicId,
    invoices:draft.invoices.map(inv=>{
      const rows=draft.allocations.filter(a=>a.invoiceRef===inv.lineRef);
      const stored=invoices.find(i=>i.lineRef===inv.lineRef);
      return {
        invoiceRef:inv.lineRef,supplierId:inv.supplierId,
        goodsIlsMinor:inv.goodsBookedIlsMinor,
        supplierAdvanceIlsMinor:stored?(paidByInvoiceId.get(stored.id)??0):0,
        freightAllocatedIlsMinor:rows.reduce((sum,a)=>sum+a.freightIlsMinor,0),
        capitalizableTravelIlsMinor:rows.reduce((sum,a)=>sum+a.travelCapitalizableIlsMinor,0),
        purchaseLiabilityIlsMinor:rows.reduce((sum,a)=>
          sum+(linkedByGroup.get(a.lineRef)?.cost??0),0),
      };
    }),
    shipments:draft.shipments.map(sh=>{
      const stored=shipments.find(row=>row.lineRef===sh.lineRef);
      const paid=stored ? directRecords.filter(row=>
        row.shipmentId===stored.id && row.costType!=="travel" &&
        row.financeStatus==="posted").reduce((sum,row)=>sum+row.amountIlsMinor,0) :0;
      return {
        shipmentRef:sh.lineRef,
        freightPaidIlsMinor:paid,
        freightAllocatedIlsMinor:sh.freightClearingIlsMinor,
      };
    }),
    totalTravelPaidIlsMinor:directRecords.filter(row=>
      row.costType==="travel" && row.financeStatus==="posted")
        .reduce((sum,row)=>sum+row.amountIlsMinor,0),
    totalTravelDistributedIlsMinor:draft.travelRecordedIlsMinor,
    travelCapitalizableIlsMinor:draft.allocations.reduce((sum,a)=>
      sum+a.travelCapitalizableIlsMinor,0),
  });
  const clearingPreview={
    ...clearingCandidate,
    ready:clearingCandidate.ready && allGroupsMatched && comparison.balanced,
    blockers:[
      ...clearingCandidate.blockers,
      ...(!allGroupsMatched ? ["سجلات تكلفة المشتريات المعتمدة لا تطابق جميع مجموعات الإكسل"] : []),
      ...(!comparison.balanced ? ["توزيع الإكسل لم يطابق فواتير الموردين والشحنات"] : []),
    ],
    /** NOT an accounting posting or permission to close. */
    journalPosted:false,
    canExecute:false,
  };
  const closePreview = previewImportClosing({
    excelBalanced: comparison.balanced,
    excelErrors: comparison.errors,
    invoices: invoices.map((invoice) => {
      const paid = paymentRecords.filter((payment) =>
        payment.invoiceId === invoice.id && payment.financeStatus === "posted");
      const advanceIlsMinor = paid.reduce((sum,payment) => sum + payment.advanceIlsMinor, 0);
      return {
        ref: invoice.lineRef,
        goodsUsdMinor: invoice.goodsUsdMinor,
        goodsBookedIlsMinor: invoice.goodsBookedIlsMinor,
        paidUsdMinor: paid.reduce((sum,payment) => sum + payment.usdAmountMinor, 0),
        advanceIlsMinor,
        remainingPayableIlsMinor: Math.max(0, invoice.goodsBookedIlsMinor - advanceIlsMinor),
        // No supplier payable integration on import invoices yet.
        payableJournalVerified: false,
      };
    }),
    shipments: shipments.map((shipment) => {
      const paid = (kind: string) => directRecords
        .filter((payment) => payment.shipmentId === shipment.id &&
          payment.costType === kind && payment.financeStatus === "posted")
        .reduce((sum,payment) => sum + payment.amountIlsMinor, 0);
      return {
        ref: shipment.lineRef,
        freightIlsMinor: shipment.freightIlsMinor,
        customsIlsMinor: shipment.customsIlsMinor,
        localTransportIlsMinor: shipment.localTransportIlsMinor,
        paidFreightIlsMinor: paid("freight"),
        paidCustomsIlsMinor: paid("customs"),
        paidLocalTransportIlsMinor: paid("local_transport"),
        hasInventoryReceipt: draft.allocations.some(a=>a.shipmentRef===shipment.lineRef)
          && draft.allocations.filter(a=>a.shipmentRef===shipment.lineRef).every(groupReady),
        purchasePostingMatched: draft.allocations.some(a=>a.shipmentRef===shipment.lineRef)
          && draft.allocations.filter(a=>a.shipmentRef===shipment.lineRef).every(groupReady),
      };
    }),
    travelRecordedIlsMinor: found.travelRecordedIlsMinor,
    travelPaidIlsMinor: directRecords
      .filter((payment) => payment.costType === "travel" && payment.financeStatus === "posted")
      .reduce((sum,payment) => sum + payment.amountIlsMinor, 0),
    travelClassificationApproved: found.travelRecordedIlsMinor === 0,
    inventoryCostEngineReconciled: allGroupsMatched,
    settlementJournalVerified: false, // financial clearing journal is NOT wired yet
  });
  return {
    case: { id: found.id, publicId: found.publicId, revision: found.revision, status: found.status, createdAt: found.createdAt },
    advancePostingEnabled: env.POS_IMPORT_FINANCIAL_POSTING_ENABLED === "true",
    draft,
    purchaseLinks,
    clearingPreview,
    costGroupMatching: draft.allocations.map(a=>({
      allocationRef:a.lineRef,
      expectedAccountingIlsMinor:a.goodsIlsMinor+a.freightIlsMinor+a.travelCapitalizableIlsMinor,
      linkedAccountingIlsMinor:linkedByGroup.get(a.lineRef)?.cost ?? 0,
      valid:groupReady(a),
    })),
    closePreview,
    directPayments: directRecords.map((payment) => ({
      ...payment,
      shipmentRef: shipments.find((shipment) => shipment.id === payment.shipmentId)?.lineRef ?? null,
    })),
    advances: paymentRecords.map((payment) => ({
      ...payment,
      invoiceRef: invById.get(payment.invoiceId) ?? "",
    })),
    preview: {
      ...comparison,
      // Supplier advances shown above are linked to actual posted journal IDs;
      // freight and travel costs still have no payment links, hence no close.
      ledgerVerified: false,
      canPost: false,
      paymentStatus:
        paymentRecords.length && directRecords.length ? "mixed_payments_posted" :
        directRecords.length ? "costs_posted" :
        paymentRecords.length ? "advances_posted" : "not_connected",
      paidShipmentCostsIlsMinor: directRecords.filter((payment) =>
        payment.costType !== "travel" && payment.financeStatus === "posted"
      ).reduce((sum, payment) => sum + payment.amountIlsMinor, 0),
      paidTravelIlsMinor: directRecords.filter((payment) =>
        payment.costType === "travel" && payment.financeStatus === "posted"
      ).reduce((sum, payment) => sum + payment.amountIlsMinor, 0),
    },
  };
}

function normalizeId(value: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n <= LIMIT_MINOR ? n : null;
}

/**
 * Owner-only non-posting draft API:
 * GET /api/pos/import-costs
 * POST /api/pos/import-costs
 * GET /api/pos/import-costs/:id
 * PUT /api/pos/import-costs/:id
 * Strictly no ledger writes. No "close" endpoint until invoice posting integration.
 */
export async function handleImportCostRequest(request: Request, db: Db, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const single = /^\/api\/pos\/import-costs\/([1-9]\d*)$/.exec(path);
  const advancePath = /^\/api\/pos\/import-costs\/([1-9]\d*)\/advance-payment$/.exec(path);
  const directPaymentPath = /^\/api\/pos\/import-costs\/([1-9]\d*)\/direct-payment$/.exec(path);
  const linkCollection = /^\/api\/pos\/import-costs\/([1-9]\d*)\/purchase-links$/.exec(path);
  const linkSingle = /^\/api\/pos\/import-costs\/([1-9]\d*)\/purchase-links\/([1-9]\d*)$/.exec(path);
  const collection = path === "/api/pos/import-costs";
  if (!collection && !single && !advancePath && !directPaymentPath && !linkCollection && !linkSingle) return null;
  if (!["GET", "POST", "PUT", "DELETE"].includes(request.method)) {
    return json({ error: "عملية غير متاحة في مسودات الاستيراد" }, 405);
  }
  const user: User | null = await getCurrentUser(db, request, env);
  if (!user) return json({ error: "يجب تسجيل الدخول" }, 401);
  if (!user.isOwner) return json({ error: "ملفات الاستيراد متاحة للمالك فقط" }, 403);
  try {
    if (linkCollection && request.method === "POST") {
      const linkCaseId=normalizeId(linkCollection[1]!);
      if (!linkCaseId) throw new ImportDraftError("ملف الاستيراد غير صالح");
      const body=record(await request.json(),"ربط فاتورة المشتريات");
      await attachApprovedPurchase(db,{
        caseId:linkCaseId,
        allocationRef:stringField(body.allocationRef,"مجموعة التكلفة",100),
        purchaseId:positive(body.purchaseId,"معرف فاتورة المشتريات"),
        revision:positive(body.expectedRevision,"إصدار ملف الاستيراد"),
        actorId:user.id,
      });
      return json(await detail(db,linkCaseId,env),201);
    }
    if (linkSingle && request.method === "DELETE") {
      const linkCaseId=normalizeId(linkSingle[1]!);
      const linkId=normalizeId(linkSingle[2]!);
      if (!linkCaseId || !linkId) throw new ImportDraftError("معرف الرابط غير صالح");
      const body=record(await request.json(),"فصل فاتورة المشتريات");
      await detachApprovedPurchase(db,{
        caseId:linkCaseId,linkId,
        expectedRevision:positive(body.expectedRevision,"إصدار ملف الاستيراد"),
      });
      return json(await detail(db,linkCaseId,env));
    }
    if (directPaymentPath && request.method === "POST") {
      const paymentCaseId = normalizeId(directPaymentPath[1]!);
      if (!paymentCaseId) throw new ImportDraftError("رقم الاستيراد غير صالح");
      const paymentRequest = parseImportDirectCostRequest(await request.json(), paymentCaseId);
      const payment = await postImportDirectCost(db, env, user.id, paymentRequest);
      return json({ payment, accountingPosted: true });
    }
    if (advancePath && request.method === "POST") {
      const paymentCaseId = normalizeId(advancePath[1]!);
      if (!paymentCaseId) throw new ImportDraftError("رقم الاستيراد غير صالح");
      const paymentRequest = parseSupplierAdvanceRequest(await request.json(), paymentCaseId);
      const payment = await postImportUsdSupplierAdvance(db, env, user.id, paymentRequest);
      return json({ payment, accountingPosted: true });
    }
    if (request.method === "GET" && collection) {
      const rows = await db.select({
        id: importCostCasesTable.id,
        publicId: importCostCasesTable.publicId,
        title: importCostCasesTable.title,
        businessDate: importCostCasesTable.businessDate,
        withTravel: importCostCasesTable.withTravel,
        revision: importCostCasesTable.revision,
        updatedAt: importCostCasesTable.updatedAt,
      }).from(importCostCasesTable).orderBy(desc(importCostCasesTable.id)).limit(100);
      return json({ cases: rows, accountingEnabled: false,
        advancePostingEnabled: env.POS_IMPORT_FINANCIAL_POSTING_ENABLED === "true" });
    }
    const caseId = single ? normalizeId(single[1]!) : null;
    if (single && !caseId) throw new ImportDraftError("رقم الملف غير صالح");
    if (request.method === "GET" && caseId) return json(await detail(db, caseId, env));
    if (request.method === "POST" && collection) {
      const payload = record(await request.json(), "مسودة الاستيراد");
      const idempotencyKey = stringField(payload.idempotencyKey, "مفتاح منع التكرار", 120);
      if (idempotencyKey.length < 8) throw new ImportDraftError("مفتاح منع التكرار قصير");
      const draft = parseDraft(payload);
      const created = await db.transaction(async (tx) => {
        const [duplicate] = await tx.select().from(importCostCasesTable)
          .where(eq(importCostCasesTable.idempotencyKey, idempotencyKey)).limit(1);
        if (duplicate) return duplicate.id;
        await assertSuppliers(tx, draft.invoices);
        const [row] = await tx.insert(importCostCasesTable).values({
          publicId: "IMP-" + randomUUID().slice(0, 12).toUpperCase(),
          idempotencyKey, title: draft.title, businessDate: draft.businessDate,
          withTravel: draft.withTravel, travelRecordedIlsMinor: draft.travelRecordedIlsMinor,
          notes: draft.notes, createdByUserId: user.id,
        }).returning({ id: importCostCasesTable.id });
        if (!row) throw new ImportDraftError("تعذر إنشاء الملف", 500);
        await insertChildren(tx, row.id, draft);
        return row.id;
      });
      return json(await detail(db, created, env), 201);
    }
    if (request.method === "PUT" && caseId) {
      const payload = record(await request.json(), "مسودة الاستيراد");
      const expectedRevision = positive(payload.expectedRevision, "إصدار المسودة");
      const draft = parseDraft(payload);
      await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(importCostCasesTable)
          .where(eq(importCostCasesTable.id, caseId)).for("update").limit(1);
        if (!locked) throw new ImportDraftError("ملف الاستيراد غير موجود", 404);
        if (locked.status !== "draft") throw new ImportDraftError("ملف معتمد لا يمكن تعديله", 409);
        if (locked.revision !== expectedRevision) throw new ImportDraftError("تغير الملف في جلسة أخرى، أعد التحميل", 409);
        const links = await tx.select({id:importCostPurchaseLinksTable.id})
          .from(importCostPurchaseLinksTable)
          .where(eq(importCostPurchaseLinksTable.caseId,caseId)).limit(1);
        if (links.length) throw new ImportDraftError(
          "هناك فواتير مشتريات مرتبطة بهذا الملف؛ افصل الروابط أولًا قبل تعديل توزيع الإكسل",409);
        await assertSuppliers(tx, draft.invoices);
        // Keep invoices having real posted advances: payments are immutable
        // and incoming/editing of other invoices/shipments must remain possible.
        const oldInvoices = await tx.select().from(importCostInvoicesTable)
          .where(eq(importCostInvoicesTable.caseId, caseId));
        const postedAdvances = await tx.select({
          invoiceId: importCostAdvancePaymentsTable.invoiceId,
        }).from(importCostAdvancePaymentsTable)
          .where(eq(importCostAdvancePaymentsTable.caseId, caseId));
        const lockedInvoiceIds = new Set(postedAdvances.map((payment) => payment.invoiceId));
        const protectedInvoices = new Map<string, number>();
        for (const invoice of oldInvoices) {
          if (!lockedInvoiceIds.has(invoice.id)) continue;
          const requested = draft.invoices.find((item) => item.lineRef === invoice.lineRef);
          if (!requested ||
              requested.supplierId !== invoice.supplierId ||
              requested.invoiceNumber !== invoice.invoiceNumber ||
              requested.goodsUsdMinor !== invoice.goodsUsdMinor) {
            throw new ImportDraftError("لا يمكن تغيير أو حذف فاتورة تم دفع مبلغ مقدم عليها؛ يلزم إجراء تصحيح موثق", 409);
          }
          protectedInvoices.set(invoice.lineRef, invoice.id);
        }
        await tx.delete(importCostAllocationsTable).where(eq(importCostAllocationsTable.caseId, caseId));
        for (const invoice of oldInvoices) {
          if (protectedInvoices.has(invoice.lineRef)) continue;
          await tx.delete(importCostInvoicesTable).where(eq(importCostInvoicesTable.id, invoice.id));
        }
        const oldShipments = await tx.select().from(importCostShipmentsTable)
          .where(eq(importCostShipmentsTable.caseId, caseId));
        const directPayments = await tx.select().from(importCostDirectPaymentsTable)
          .where(eq(importCostDirectPaymentsTable.caseId, caseId));
        const protectedShipmentIds = new Set(directPayments
          .map((payment) => payment.shipmentId)
          .filter((value): value is number => value !== null));
        const protectedShipments = new Map<string, number>();
        for (const shipment of oldShipments) {
          if (!protectedShipmentIds.has(shipment.id)) continue;
          const requested = draft.shipments.find((item) => item.lineRef === shipment.lineRef);
          if (!requested) throw new ImportDraftError("لا يمكن حذف شحنة تحتوي مصاريف مدفوعة", 409);
          const paid = (kind: "freight"|"customs"|"local_transport") =>
            directPayments.filter((payment) => payment.shipmentId === shipment.id &&
              payment.costType === kind).reduce((sum, payment) => sum + payment.amountIlsMinor, 0);
          if (paid("freight") > requested.freightIlsMinor ||
              paid("customs") > requested.customsIlsMinor ||
              paid("local_transport") > requested.localTransportIlsMinor) {
            throw new ImportDraftError("لا يمكن تقليل تكلفة الشحنة دون المبالغ المدفوعة بالفعل", 409);
          }
          protectedShipments.set(shipment.lineRef, shipment.id);
        }
        const paidTravel = directPayments
          .filter((payment) => payment.costType === "travel")
          .reduce((sum, payment) => sum + payment.amountIlsMinor, 0);
        if (paidTravel > draft.travelRecordedIlsMinor) {
          throw new ImportDraftError("مصاريف السفر الموزعة أقل من الدفعات المسجلة", 409);
        }
        for (const shipment of oldShipments) {
          if (protectedShipments.has(shipment.lineRef)) continue;
          await tx.delete(importCostShipmentsTable).where(eq(importCostShipmentsTable.id, shipment.id));
        }
        await insertChildren(tx, caseId, draft, protectedInvoices, protectedShipments);
        await tx.update(importCostCasesTable).set({
          title: draft.title, businessDate: draft.businessDate, withTravel: draft.withTravel,
          travelRecordedIlsMinor: draft.travelRecordedIlsMinor, notes: draft.notes,
          revision: locked.revision + 1, updatedAt: new Date(),
        }).where(eq(importCostCasesTable.id, caseId));
      });
      return json(await detail(db, caseId, env));
    }
    return json({ error: "العملية غير مدعومة" }, 405);
  } catch (error) {
    if (error instanceof ImportDraftError) return json({ error: error.message }, error.status);
    if (error instanceof ImportAdvanceError) return json({ error: error.message }, error.status);
    if (error instanceof ImportPurchaseLinkError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ error: "صيغة البيانات غير صالحة" }, 400);
    console.error("IMPORT_COST_DRAFT_FAILED", error);
    return json({ error: "تعذر حفظ مسودة الاستيراد" }, 500);
  }
}
