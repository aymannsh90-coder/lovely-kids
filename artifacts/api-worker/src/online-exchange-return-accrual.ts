import {
  exchangeDocumentsTable,
  exchangeReturnItemsTable,
  exchangeReturnItemCostsTable,
  orderItemCostsTable,
  ordersTable,
  financeAccountsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";

/**
 * This is a cost subledger. Physical inventory stays unchanged until the
 * returned parcel is actually received. Historical amounts are snapshotted
 * at the replacement order's financial completion, not recomputed later.
 */
export const ONLINE_RETURN_IN_TRANSIT = "ONLINE_EXCHANGE_RETURNS_IN_TRANSIT";
export const ONLINE_RETURN_CLEARING = "ONLINE_EXCHANGE_RETURN_COST_CLEARING";
export const PHYSICAL_INVENTORY_ACCOUNT = "PURCHASE_INVENTORY";

export class OnlineReturnCostError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export async function ensureOnlineReturnAccount(
  tx: any,
  code: string,
  name: string,
): Promise<number> {
  const existing = (await tx.select({ id: financeAccountsTable.id })
    .from(financeAccountsTable)
    .where(eq(financeAccountsTable.code, code)).limit(1))[0];
  if (existing) return existing.id;
  const inserted = (await tx.insert(financeAccountsTable).values({
    code, name, accountType: "asset", currencyCode: "ILS", status: "active",
  }).onConflictDoNothing().returning({ id: financeAccountsTable.id }))[0];
  if (inserted) return inserted.id;
  const retry = (await tx.select({ id: financeAccountsTable.id })
    .from(financeAccountsTable).where(eq(financeAccountsTable.code, code)).limit(1))[0];
  if (!retry) throw new OnlineReturnCostError("تعذر العثور على حساب البضاعة المرتجعة");
  return retry.id;
}

/** Pro-rata allocation across multiple exchanges of the same original line. */
export function allocatedReturnCost(
  originalCostMinor: number,
  originalQuantity: number,
  before: number,
  returnedQuantity: number,
): number {
  if (!Number.isSafeInteger(originalCostMinor) || originalCostMinor < 0 ||
      !Number.isSafeInteger(originalQuantity) || originalQuantity <= 0 ||
      !Number.isSafeInteger(before) || before < 0 ||
      !Number.isSafeInteger(returnedQuantity) || returnedQuantity <= 0 ||
      before + returnedQuantity > originalQuantity) {
    throw new OnlineReturnCostError("كمية أو تكلفة المرتجع غير متطابقة مع فاتورة البيع الأصلية");
  }
  const portion = (qty: number) =>
    qty === originalQuantity
      ? originalCostMinor
      : Number(BigInt(originalCostMinor) * BigInt(qty) / BigInt(originalQuantity));
  return portion(before + returnedQuantity) - portion(before);
}

export async function accrueOnlineExchangeReturnCosts(
  tx: any,
  exchange: typeof exchangeDocumentsTable.$inferSelect,
): Promise<number> {
  if (exchange.sourceType !== "online_order" || !exchange.originalOrderId) {
    throw new OnlineReturnCostError("التبديل غير مرتبط بفاتورة بيع أصلية");
  }
  // Serialize allocations for parallel exchanges of the same original order.
  const original = (await tx.select({ id: ordersTable.id }).from(ordersTable)
    .where(eq(ordersTable.id, exchange.originalOrderId)).for("update"))[0];
  if (!original) throw new OnlineReturnCostError("فاتورة البيع القديمة غير موجودة");

  const returnItems = await tx.select().from(exchangeReturnItemsTable)
    .where(eq(exchangeReturnItemsTable.exchangeId, exchange.id));
  if (!returnItems.length) throw new OnlineReturnCostError("لا توجد أصناف مرتجعة لعملية التبديل");

  const returnIds = returnItems.map((item: typeof exchangeReturnItemsTable.$inferSelect) => item.id);
  const duplicates = await tx.select({ id: exchangeReturnItemCostsTable.returnItemId })
    .from(exchangeReturnItemCostsTable)
    .where(inArray(exchangeReturnItemCostsTable.returnItemId, returnIds));
  if (duplicates.length) throw new OnlineReturnCostError("تم تثبيت تكلفة المرتجع مسبقًا");

  const originalCostRows = await tx.select().from(orderItemCostsTable)
    .where(eq(orderItemCostsTable.orderId, exchange.originalOrderId));
  const originalCostByLine = new Map<number, typeof orderItemCostsTable.$inferSelect>(
    originalCostRows.map((cost: typeof orderItemCostsTable.$inferSelect) => [cost.lineNumber, cost]),
  );

  const priorDocs = await tx.select({ id: exchangeDocumentsTable.id })
    .from(exchangeDocumentsTable).where(and(
      eq(exchangeDocumentsTable.sourceType, "online_order"),
      eq(exchangeDocumentsTable.originalOrderId, exchange.originalOrderId),
      eq(exchangeDocumentsTable.status, "completed"),
      isNotNull(exchangeDocumentsTable.financialCompletedAt),
      ne(exchangeDocumentsTable.id, exchange.id),
    ));
  const priorIds = priorDocs.map((row: { id: number }) => row.id);
  const priorItems: Array<typeof exchangeReturnItemsTable.$inferSelect> = priorIds.length
    ? await tx.select().from(exchangeReturnItemsTable)
      .where(inArray(exchangeReturnItemsTable.exchangeId, priorIds))
    : [];
  const priorByLine = new Map<number, number>();
  for (const item of priorItems) {
    if (item.originalOrderLineNumber === null) continue;
    priorByLine.set(item.originalOrderLineNumber,
      (priorByLine.get(item.originalOrderLineNumber) ?? 0) + item.quantity);
  }

  let total = 0;
  const rows: Array<typeof exchangeReturnItemCostsTable.$inferInsert> = [];
  const inThisExchange = new Map<number, number>();
  for (const item of [...returnItems].sort((a, b) => a.lineNumber - b.lineNumber)) {
    const line = item.originalOrderLineNumber;
    if (item.productId === null || line === null) {
      throw new OnlineReturnCostError("القطعة المرتجعة لا تطابق سطرًا أصليًا");
    }
    const historical = originalCostByLine.get(line);
    if (!historical || historical.productId !== item.productId ||
        historical.costQuality !== "confirmed") {
      throw new OnlineReturnCostError(
        "تكلفة القطعة المرتجعة غير مؤكدة في البيع الأصلي؛ يلزم مراجعتها قبل اعتماد التبديل ماليًا",
      );
    }
    const before = (priorByLine.get(line) ?? 0) + (inThisExchange.get(line) ?? 0);
    const amount = allocatedReturnCost(
      historical.costTotalMinor, historical.quantity, before, item.quantity,
    );
    if (!Number.isSafeInteger(total + amount) || total + amount > 2_147_483_647) {
      throw new OnlineReturnCostError("تكلفة الطرد المرتجع تتجاوز الحد المحاسبي");
    }
    rows.push({
      returnItemId: item.id, productId: item.productId,
      quantity: item.quantity,
      unitCostMinor: Math.round(amount / item.quantity),
      costTotalMinor: amount, costQuality: historical.costQuality,
    });
    total += amount;
    inThisExchange.set(line, (inThisExchange.get(line) ?? 0) + item.quantity);
  }
  await tx.insert(exchangeReturnItemCostsTable).values(rows);
  return total;
}
