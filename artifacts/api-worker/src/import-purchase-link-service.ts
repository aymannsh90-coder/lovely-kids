import {
  financeAccountsTable, financeTransactionLinesTable, financeTransactionsTable,
  importCostAllocationsTable, importCostCasesTable, importCostInvoicesTable,
  importCostPurchaseLinksTable, posPurchaseItemCostsTable, posPurchaseItemsTable,
  posPurchasesTable, productCostLedgerTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import type { openDb } from "./db";
import { verifyApprovedPurchaseEvidence } from "./import-purchase-evidence";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class ImportPurchaseLinkError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
function id(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new ImportPurchaseLinkError(label + " غير صالح", 400);
  }
  return value;
}
function reference(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100) {
    throw new ImportPurchaseLinkError("مرجع توزيع الإكسل غير صالح",400);
  }
  return value.trim();
}

async function loadEvidence(db: Db | Tx, purchaseId: number) {
  const [purchase] = await db.select().from(posPurchasesTable)
    .where(eq(posPurchasesTable.id,purchaseId)).limit(1);
  if (!purchase) throw new ImportPurchaseLinkError("فاتورة الشراء غير موجودة",404);
  const items = await db.select({
    itemId: posPurchaseItemsTable.id,
    productId: posPurchaseItemsTable.productId,
    entryMode: posPurchaseItemsTable.entryMode,
    receivedQuantity: posPurchaseItemCostsTable.receivedQuantity,
    stockQuantityApplied: posPurchaseItemCostsTable.stockQuantityApplied,
    costTotalMinor: posPurchaseItemCostsTable.costTotalMinor,
    stockCostTotalMinor: posPurchaseItemCostsTable.stockCostTotalMinor,
    historicalSoldQuantity: posPurchaseItemCostsTable.historicalSoldQuantity,
    historicalAllocationPending: posPurchaseItemCostsTable.historicalAllocationPending,
    costQuality: posPurchaseItemCostsTable.costQuality,
  }).from(posPurchaseItemsTable).leftJoin(posPurchaseItemCostsTable,
    eq(posPurchaseItemsTable.id,posPurchaseItemCostsTable.purchaseItemId))
    .where(eq(posPurchaseItemsTable.purchaseId,purchaseId));
  const ledgerRows = await db.select({
    sourceItemRef: productCostLedgerTable.sourceItemRef,
    productId: productCostLedgerTable.productId,
    eventType: productCostLedgerTable.eventType,
    quantityDelta: productCostLedgerTable.quantityDelta,
    inventoryValueDeltaMinor: productCostLedgerTable.inventoryValueDeltaMinor,
  }).from(productCostLedgerTable).where(and(
    eq(productCostLedgerTable.sourceType,"pos_purchase"),
    eq(productCostLedgerTable.sourceRef,String(purchaseId)),
  ));
  const postings = await db.select().from(financeTransactionsTable).where(and(
    eq(financeTransactionsTable.sourceType,"pos_purchase"),
    eq(financeTransactionsTable.sourceId,String(purchaseId)),
    eq(financeTransactionsTable.sourceEvent,"completed"),
  ));
  const financialLines = postings.length === 1 ?
    await db.select({
      accountCode: financeAccountsTable.code,
      supplierId: financeTransactionLinesTable.supplierId,
      debitMinor: financeTransactionLinesTable.debitMinor,
      creditMinor: financeTransactionLinesTable.creditMinor,
    }).from(financeTransactionLinesTable).innerJoin(financeAccountsTable,
      eq(financeTransactionLinesTable.accountId,financeAccountsTable.id))
      .where(eq(financeTransactionLinesTable.transactionId,postings[0]!.id)) : [];
  return {
    purchase, itemCosts:items, ledgerRows, financialLines,
    transactionCount:postings.length,
    transactionStatus:postings.length === 1 ? postings[0]!.status : null,
  };
}

export async function inspectImportPurchaseEvidence(db: Db | Tx, purchaseId: number, supplierId: number) {
  const data = await loadEvidence(db,purchaseId);
  return verifyApprovedPurchaseEvidence(data,supplierId);
}

/**
 * Evidence link only: the existing purchase must have a complete, ILS-only,
 * credit-to-supplier GL posting and exactly corresponding per-SKU cost ledger.
 * Does not create stock, purchase, bank or supplier-payable transactions.
 */
export async function attachApprovedPurchase(
  db: Db,
  input: { caseId: number; allocationRef: string; purchaseId: number; revision: number; actorId: number },
) {
  const caseId = id(input.caseId,"ملف الاستيراد");
  const purchaseId = id(input.purchaseId,"فاتورة الشراء");
  const actorId = id(input.actorId,"المستخدم");
  const expectedRevision = id(input.revision,"إصدار الملف");
  const allocationRef = reference(input.allocationRef);
  return db.transaction(async tx => {
    const [file] = await tx.select().from(importCostCasesTable)
      .where(eq(importCostCasesTable.id,caseId)).for("update").limit(1);
    if (!file || file.status !== "draft") throw new ImportPurchaseLinkError("ملف الاستيراد غير مفتوح");
    if (file.revision !== expectedRevision) throw new ImportPurchaseLinkError("تغير الملف؛ أعد تحميله أولًا");
    const [allocation] = await tx.select().from(importCostAllocationsTable)
      .where(and(eq(importCostAllocationsTable.caseId,caseId),
        eq(importCostAllocationsTable.lineRef,allocationRef))).limit(1);
    if (!allocation) throw new ImportPurchaseLinkError("مجموعة تكلفة الإكسل غير موجودة",404);
    const [invoice] = await tx.select().from(importCostInvoicesTable)
      .where(and(eq(importCostInvoicesTable.id,allocation.invoiceId),
        eq(importCostInvoicesTable.caseId,caseId))).limit(1);
    if (!invoice) throw new ImportPurchaseLinkError("فاتورة المورد غير مرتبطة بالمجموعة");
    const evidence = await inspectImportPurchaseEvidence(tx,purchaseId,invoice.supplierId);
    if (!evidence.valid) throw new ImportPurchaseLinkError(
      "لا يمكن ربط فاتورة الشراء: " + evidence.reasons.join("؛ ")
    );
    const expected = allocation.goodsIlsMinor + allocation.freightIlsMinor +
      allocation.travelCapitalizableIlsMinor;
    const otherLinks = await tx.select({
      purchaseId:importCostPurchaseLinksTable.purchaseId,
    }).from(importCostPurchaseLinksTable)
      .where(eq(importCostPurchaseLinksTable.allocationId,allocation.id));
    const linked = await tx.select().from(posPurchasesTable);
    const amounts = new Map(linked.map(p => [p.id,p.totalMinor]));
    const alreadyAssigned = otherLinks.reduce((sum,l) => sum+(amounts.get(l.purchaseId) ?? 0),0);
    if (!Number.isSafeInteger(expected) || evidence.inventoryCostIlsMinor + alreadyAssigned > expected) {
      throw new ImportPurchaseLinkError("تكاليف فواتير الشراء المرتبطة تتجاوز تكلفة المجموعة المحاسبية من الإكسل");
    }
    const [alreadyLinked] = await tx.select().from(importCostPurchaseLinksTable)
      .where(eq(importCostPurchaseLinksTable.purchaseId,purchaseId)).limit(1);
    if (alreadyLinked) throw new ImportPurchaseLinkError(
      "فاتورة الشراء مستخدمة مسبقًا في ملف استيراد آخر أو مجموعة أخرى");
    const [saved] = await tx.insert(importCostPurchaseLinksTable).values({
      caseId, allocationId:allocation.id, purchaseId, createdByUserId:actorId,
    }).returning();
    if (!saved) throw new ImportPurchaseLinkError("تعذر حفظ الربط");
    await tx.update(importCostCasesTable).set({revision:file.revision+1,updatedAt:new Date()})
      .where(eq(importCostCasesTable.id,caseId));
    return {id:saved.id, purchaseId, allocationRef, evidence};
  });
}

export async function detachApprovedPurchase(db: Db, input: {
  caseId:number; linkId:number; expectedRevision:number;
}) {
  const caseId=id(input.caseId,"ملف الاستيراد"),linkId=id(input.linkId,"الربط");
  const expectedRevision=id(input.expectedRevision,"إصدار الملف");
  return db.transaction(async tx => {
    const [file] = await tx.select().from(importCostCasesTable)
      .where(eq(importCostCasesTable.id,caseId)).for("update").limit(1);
    if (!file || file.status !== "draft") throw new ImportPurchaseLinkError("ملف الاستيراد غير مفتوح");
    if (file.revision !== expectedRevision) throw new ImportPurchaseLinkError("تغير الملف؛ أعد تحميله أولًا");
    const [link] = await tx.select().from(importCostPurchaseLinksTable)
      .where(and(eq(importCostPurchaseLinksTable.id,linkId),
        eq(importCostPurchaseLinksTable.caseId,caseId))).limit(1);
    if (!link) throw new ImportPurchaseLinkError("ربط فاتورة الشراء غير موجود",404);
    await tx.delete(importCostPurchaseLinksTable)
      .where(eq(importCostPurchaseLinksTable.id,linkId));
    await tx.update(importCostCasesTable)
      .set({revision:file.revision+1,updatedAt:new Date()})
      .where(eq(importCostCasesTable.id,caseId));
    return {removed:true,linkId};
  });
}

export async function getPurchaseLinks(db:Db,caseId:number) {
  const rows = await db.select({
    id:importCostPurchaseLinksTable.id,
    purchaseId:importCostPurchaseLinksTable.purchaseId,
    allocationRef:importCostAllocationsTable.lineRef,
    allocationId:importCostAllocationsTable.id,
    invoiceId:importCostAllocationsTable.invoiceId,
    shipmentId:importCostAllocationsTable.shipmentId,
    expectedGoodsIlsMinor:importCostAllocationsTable.goodsIlsMinor,
    expectedFreightIlsMinor:importCostAllocationsTable.freightIlsMinor,
    expectedTravelEligibleIlsMinor:importCostAllocationsTable.travelCapitalizableIlsMinor,
    supplierId:importCostInvoicesTable.supplierId,
  }).from(importCostPurchaseLinksTable)
    .innerJoin(importCostAllocationsTable,eq(importCostPurchaseLinksTable.allocationId,importCostAllocationsTable.id))
    .innerJoin(importCostInvoicesTable,eq(importCostAllocationsTable.invoiceId,importCostInvoicesTable.id))
    .where(eq(importCostPurchaseLinksTable.caseId,caseId));
  const results = [];
  for(const row of rows){
    const evidence = await inspectImportPurchaseEvidence(db,row.purchaseId,row.supplierId);
    results.push({
      ...row, inventoryCostIlsMinor:evidence.inventoryCostIlsMinor,
      receiptQuantity:evidence.receiptQuantity,valid:evidence.valid,
      reasons:evidence.reasons,
    });
  }
  return results;
}
