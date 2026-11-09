import {
  importCostCasesTable,
  importCostInvoicesTable,
  importCostShipmentsTable,
  importCostAllocationsTable,
  suppliersTable,
} from "@workspace/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "./auth";
import type { openDb, Env } from "./db";
import { previewImportCostSettlement, type ImportCostDraft } from "./import-cost-reconciliation";

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

async function insertChildren(tx: Tx, caseId: number, draft: DraftInput) {
  const invoiceIds = new Map<string, number>();
  const shipmentIds = new Map<string, number>();
  for (const invoice of draft.invoices) {
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

async function detail(db: Db, id: number) {
  const [found] = await db.select().from(importCostCasesTable)
    .where(eq(importCostCasesTable.id, id)).limit(1);
  if (!found) throw new ImportDraftError("ملف الاستيراد غير موجود", 404);
  const invoices = await db.select().from(importCostInvoicesTable)
    .where(eq(importCostInvoicesTable.caseId, id));
  const shipments = await db.select().from(importCostShipmentsTable)
    .where(eq(importCostShipmentsTable.caseId, id));
  const lines = await db.select().from(importCostAllocationsTable)
    .where(eq(importCostAllocationsTable.caseId, id));
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
    invoices: draft.invoices.map((i) => ({
      id: i.lineRef, supplierId: i.supplierId,
      goodsBookedIlsMinor: i.goodsBookedIlsMinor,
      prepaidIlsMinor: 0, // NOT a ledger claim; advance posting integration is pending.
    })),
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
  return {
    case: { id: found.id, publicId: found.publicId, revision: found.revision, status: found.status, createdAt: found.createdAt },
    draft,
    preview: {
      ...comparison,
      // These amounts are user-entered draft figures, not posted financial balances.
      ledgerVerified: false,
      canPost: false,
      paymentStatus: "not_connected",
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
  const collection = path === "/api/pos/import-costs";
  if (!collection && !single) return null;
  if (!["GET", "POST", "PUT"].includes(request.method)) {
    return json({ error: "عملية غير متاحة في مسودات الاستيراد" }, 405);
  }
  const user: User | null = await getCurrentUser(db, request, env);
  if (!user) return json({ error: "يجب تسجيل الدخول" }, 401);
  if (!user.isOwner) return json({ error: "ملفات الاستيراد متاحة للمالك فقط" }, 403);
  try {
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
      return json({ cases: rows, accountingEnabled: false });
    }
    const caseId = single ? normalizeId(single[1]!) : null;
    if (single && !caseId) throw new ImportDraftError("رقم الملف غير صالح");
    if (request.method === "GET" && caseId) return json(await detail(db, caseId));
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
      return json(await detail(db, created), 201);
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
        await assertSuppliers(tx, draft.invoices);
        // Delete children in FK order; all within one rollback-safe transaction.
        await tx.delete(importCostAllocationsTable).where(eq(importCostAllocationsTable.caseId, caseId));
        await tx.delete(importCostInvoicesTable).where(eq(importCostInvoicesTable.caseId, caseId));
        await tx.delete(importCostShipmentsTable).where(eq(importCostShipmentsTable.caseId, caseId));
        await insertChildren(tx, caseId, draft);
        await tx.update(importCostCasesTable).set({
          title: draft.title, businessDate: draft.businessDate, withTravel: draft.withTravel,
          travelRecordedIlsMinor: draft.travelRecordedIlsMinor, notes: draft.notes,
          revision: locked.revision + 1, updatedAt: new Date(),
        }).where(eq(importCostCasesTable.id, caseId));
      });
      return json(await detail(db, caseId));
    }
    return json({ error: "العملية غير مدعومة" }, 405);
  } catch (error) {
    if (error instanceof ImportDraftError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ error: "صيغة البيانات غير صالحة" }, 400);
    console.error("IMPORT_COST_DRAFT_FAILED", error);
    return json({ error: "تعذر حفظ مسودة الاستيراد" }, 500);
  }
}
