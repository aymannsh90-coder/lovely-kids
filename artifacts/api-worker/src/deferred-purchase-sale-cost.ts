import {
  deferredPurchaseSaleCostsTable,
  posPurchaseItemsTable,
  posPurchasesTable,
  posSaleItemCostsTable,
  posSaleItemsTable,
  posSalesTable,
  posSaleReturnItemCostsTable,
  posSaleReturnItemsTable,
  posSaleReturnsTable,
  productCostStateTable,
  productsTable,
} from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getProductQuantity } from "./product-quantity";
import type { DeferredSale } from "./deferred-purchase-cost-math";

export class DeferredPurchaseCostError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export async function hasPendingDeferredCostForSaleItem(tx: any, saleItemId: number) {
  const rows = await tx.select({ id: deferredPurchaseSaleCostsTable.id })
    .from(deferredPurchaseSaleCostsTable)
    .where(and(eq(deferredPurchaseSaleCostsTable.saleItemId, saleItemId),
      eq(deferredPurchaseSaleCostsTable.status, "pending")))
    .limit(1);
  return rows.length > 0;
}

export async function hasPendingDeferredCostForSale(tx: any, saleItemIds: number[]) {
  if (saleItemIds.length === 0) return false;
  const rows = await tx.select({ id: deferredPurchaseSaleCostsTable.id })
    .from(deferredPurchaseSaleCostsTable)
    .where(and(inArray(deferredPurchaseSaleCostsTable.saleItemId, saleItemIds),
      eq(deferredPurchaseSaleCostsTable.status, "pending")))
    .limit(1);
  return rows.length > 0;
}

/** Strictly validate every uncosted sale and its linked, uncosted returns. */
export async function loadDeferredPurchaseCostSales(
  tx: any,
  input: { draftPublicId: string; productId: number },
): Promise<{ sales: DeferredSale[]; netSoldQuantity: number }> {
  const rows = await tx.select().from(deferredPurchaseSaleCostsTable)
    .where(and(eq(deferredPurchaseSaleCostsTable.draftPublicId, input.draftPublicId),
      eq(deferredPurchaseSaleCostsTable.productId, input.productId),
      eq(deferredPurchaseSaleCostsTable.status, "pending")))
    .orderBy(deferredPurchaseSaleCostsTable.saleItemId);
  if (!rows.length) return { sales: [], netSoldQuantity: 0 };
  const ids = rows.map((r: { saleItemId: number }) => r.saleItemId);
  const saleItems = await tx.select({
    id: posSaleItemsTable.id, saleId: posSaleItemsTable.saleId,
    productId: posSaleItemsTable.productId, quantity: posSaleItemsTable.quantity,
    saleStatus: posSalesTable.status,
  }).from(posSaleItemsTable)
    .innerJoin(posSalesTable, eq(posSalesTable.id, posSaleItemsTable.saleId))
    .where(inArray(posSaleItemsTable.id, ids));
  const itemById = new Map<number, any>(saleItems.map((item: any) => [item.id, item]));
  const existingCosts = await tx.select({ saleItemId: posSaleItemCostsTable.saleItemId })
    .from(posSaleItemCostsTable)
    .where(inArray(posSaleItemCostsTable.saleItemId, ids));
  if (existingCosts.length) throw new DeferredPurchaseCostError(
    "وجدت تكلفة بيع معتمدة مسبقًا لنفس عملية البيع المعلقة. أوقف الاعتماد للمراجعة.",
  );
  const returnItems = await tx.select({
    id: posSaleReturnItemsTable.id,
    originalSaleItemId: posSaleReturnItemsTable.originalSaleItemId,
    quantity: posSaleReturnItemsTable.quantity,
  }).from(posSaleReturnItemsTable)
    .innerJoin(posSaleReturnsTable, eq(posSaleReturnsTable.id, posSaleReturnItemsTable.returnId))
    .where(and(inArray(posSaleReturnItemsTable.originalSaleItemId, ids),
      eq(posSaleReturnsTable.status, "completed")));
  if (returnItems.length) {
    const existingReturnCosts = await tx.select({ id: posSaleReturnItemCostsTable.returnItemId })
      .from(posSaleReturnItemCostsTable)
      .where(inArray(posSaleReturnItemCostsTable.returnItemId,
        returnItems.map((item: any) => item.id)));
    if (existingReturnCosts.length) throw new DeferredPurchaseCostError(
      "يوجد مرتجع سبق تسعيره للصنف المعلّق. يلزم فحص تكلفة المرتجع قبل اعتماد الشراء.",
    );
  }
  const sales: DeferredSale[] = [];
  let netSoldQuantity = 0;
  for (const row of rows) {
    const item = itemById.get(row.saleItemId);
    if (!item || item.productId !== input.productId || item.quantity !== row.quantity)
      throw new DeferredPurchaseCostError(
        "تم تعديل أو حذف سطر بيع معلّق قبل اعتماد فاتورة المورد. يلزم مطابقة يدوية.",
      );
    if (item.saleStatus === "voided") {
      await tx.update(deferredPurchaseSaleCostsTable)
        .set({ status: "voided", updatedAt: new Date() })
        .where(eq(deferredPurchaseSaleCostsTable.id, row.id));
      continue;
    }
    if (item.saleStatus !== "completed") throw new DeferredPurchaseCostError(
      "حالة الفاتورة المعلقة غير صالحة للمحاسبة",
    );
    const returns = returnItems.filter((r: any) => r.originalSaleItemId === row.saleItemId)
      .map((r: any) => ({ returnItemId: r.id, quantity: r.quantity }));
    const returned = returns.reduce((sum: number, r: {quantity: number}) => sum + r.quantity, 0);
    if (returned > row.quantity) throw new DeferredPurchaseCostError(
      "كمية مرتجعات البيع المعلّق تتجاوز كمية البيع",
    );
    netSoldQuantity += row.quantity - returned;
    sales.push({ saleItemId: row.saleItemId, quantity: row.quantity, returns });
  }
  return { sales, netSoldQuantity };
}

/**
 * Record *only* when cost engine cannot price a physically fulfilled POS sale.
 * The transaction has already locked the product and reduced physical stock.
 * No provisional inventory cost or artificial gross profit is invented.
 */
export async function recordDeferredPurchasePosSale(
  tx: any,
  input: { productId: number; items: { saleItemId: number; quantity: number }[] },
) {
  const drafts = await tx.select({
    publicId: posPurchasesTable.publicId,
    quantity: posPurchaseItemsTable.quantity,
    freeQuantity: posPurchaseItemsTable.freeQuantity,
  }).from(posPurchaseItemsTable)
    .innerJoin(posPurchasesTable, eq(posPurchasesTable.id, posPurchaseItemsTable.purchaseId))
    .where(and(eq(posPurchaseItemsTable.productId, input.productId),
      eq(posPurchasesTable.status, "draft"),
      eq(posPurchaseItemsTable.entryMode, "stock_receipt")));
  if (drafts.length !== 1) throw new DeferredPurchaseCostError(
    "لا يمكن بيع كمية غير معتمدة مرتبطة بأكثر من فاتورة مورد أو بدون فاتورة استلام واضحة.",
  );
  const draft = drafts[0]!;
  const receiptQuantity = draft.quantity + draft.freeQuantity;
  const state = await tx.select({ quantity: productCostStateTable.quantityOnHand })
    .from(productCostStateTable)
    .where(eq(productCostStateTable.productId, input.productId)).limit(1);
  const accounted = state[0]?.quantity ?? 0;
  if (accounted !== 0) throw new DeferredPurchaseCostError(
    "هذا الصنف لديه مخزون محاسبي قديم إلى جانب الاستلام الجديد. يجب تسويته قبل البيع غير المعتمد.",
  );
  const existing = await loadDeferredPurchaseCostSales(
    tx, { draftPublicId: draft.publicId, productId: input.productId },
  );
  const currentSaleQuantity = input.items.reduce((sum, item) => sum + item.quantity, 0);
  const remaining = receiptQuantity - existing.netSoldQuantity;
  if (!Number.isSafeInteger(currentSaleQuantity) || currentSaleQuantity < 1 ||
      currentSaleQuantity > remaining) throw new DeferredPurchaseCostError(
    "كمية البيع تتجاوز البضاعة المستلمة المعلقة في فاتورة المورد.",
  );
  const productRows = await tx.select().from(productsTable)
    .where(eq(productsTable.id, input.productId)).limit(1);
  const physicalAfter = productRows[0] ? getProductQuantity(productRows[0]) : null;
  if (physicalAfter === null ||
      physicalAfter + currentSaleQuantity !== receiptQuantity - existing.netSoldQuantity) {
    throw new DeferredPurchaseCostError(
      "مخزون الصنف الفعلي لا يطابق الكمية المحاسبية ومسودة المورد. تمت حماية البيع من فرق جرد.",
    );
  }
  for (const item of input.items) {
    await tx.insert(deferredPurchaseSaleCostsTable).values({
      draftPublicId: draft.publicId, productId: input.productId,
      saleItemId: item.saleItemId, quantity: item.quantity, status: "pending",
    });
  }
}

export async function voidDeferredPurchasePosSale(
  tx: any, saleItemId: number,
): Promise<boolean> {
  const rows = await tx.update(deferredPurchaseSaleCostsTable)
    .set({ status: "voided", updatedAt: new Date() })
    .where(and(eq(deferredPurchaseSaleCostsTable.saleItemId, saleItemId),
      eq(deferredPurchaseSaleCostsTable.status, "pending")))
    .returning({ id: deferredPurchaseSaleCostsTable.id });
  return rows.length > 0;
}

export async function settleDeferredPurchasePosSale(
  tx: any, input: { draftPublicId: string; productId: number; purchaseId: number; saleItemIds: number[] },
) {
  if (!input.saleItemIds.length) return;
  const rows = await tx.update(deferredPurchaseSaleCostsTable)
    .set({ status: "settled", approvedPurchaseId: input.purchaseId, updatedAt: new Date() })
    .where(and(eq(deferredPurchaseSaleCostsTable.draftPublicId, input.draftPublicId),
      eq(deferredPurchaseSaleCostsTable.productId, input.productId),
      eq(deferredPurchaseSaleCostsTable.status, "pending"),
      inArray(deferredPurchaseSaleCostsTable.saleItemId, input.saleItemIds)))
    .returning({ id: deferredPurchaseSaleCostsTable.id });
  if (rows.length !== input.saleItemIds.length) throw new DeferredPurchaseCostError(
    "تغيرت مبيعات فاتورة المورد أثناء تسوية التكلفة؛ لم يتم الاعتماد.",
  );
}
