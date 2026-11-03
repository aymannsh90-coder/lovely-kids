import {
  financeAccountsTable,
  financeTransactionLinesTable,
  financeTransactionsTable,
  inventoryMovementsTable,
  posPurchaseItemCostsTable,
  posPurchaseItemsTable,
  productBarcodesTable,
  posPurchaseReturnItemsTable,
  posPurchaseReturnsTable,
  posPurchasesTable,
  productsTable,
  suppliersTable,
  type ColorVariant,
} from "@workspace/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";
import { ensureSupplierPayableControlAccount } from "./finance-supplier-ledger";
import { postFinanceTransaction } from "./finance-posting";
import { consumeProductCost, restoreExactProductCost, type CostQuality } from "./inventory-cost-engine";
import { getProductQuantity } from "./product-quantity";
import { allocateMinor as allocate, splitAmount, computeReturnRefundMinor } from "./purchase-return-rules";
import { isPurchaseWriteEnabled, purchaseWritesDisabledResponse } from "./purchase-feature";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const MAX_MINOR = 2_000_000_000;
const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });

class ReturnError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const validKey = (value: unknown) =>
  typeof value === "string" && /^[a-zA-Z0-9:_-]{8,120}$/.test(value) ? value : null;
const positiveId = (value: unknown) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ReturnError("رقم السطر غير صالح");
  return n;
};
const businessDate = () => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return values.year + "-" + values.month + "-" + values.day;
};
const normalizeDimension = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;

async function requireOwner(request: Request, db: Db, env: Env) {
  const user = await getCurrentUser(db, request, env);
  if (!user) return { user: null, response: json({ error: "يجب تسجيل الدخول" }, 401) };
  if (!user.isOwner) return { user: null, response: json({ error: "مردودات المشتريات للمالك فقط" }, 403) };
  return { user, response: null };
}

async function ensureAccount(tx: Tx, code: string, name: string, accountType: "asset" | "expense") {
  const existing = await tx.select().from(financeAccountsTable).where(eq(financeAccountsTable.code, code)).limit(1);
  if (existing[0]) return existing[0];
  const created = await tx.insert(financeAccountsTable).values({
    code, name, accountType, currencyCode: "ILS", status: "active",
  }).onConflictDoNothing().returning();
  if (created[0]) return created[0];
  const retry = await tx.select().from(financeAccountsTable).where(eq(financeAccountsTable.code, code)).limit(1);
  if (!retry[0]) throw new ReturnError("تعذر تجهيز حسابات مردود المشتريات", 409);
  return retry[0];
}

type PurchaseLine = typeof posPurchaseItemsTable.$inferSelect;
function lineValues(items: PurchaseLine[], invoiceDiscount: number) {
  const ordered = [...items].sort((a, b) => a.lineNumber - b.lineNumber || a.id - b.id);
  const gross = ordered.reduce((n, i) => n + (i.lineTotalMinor ?? 0), 0);
  if (ordered.some(i => i.lineTotalMinor === null)) throw new ReturnError("تكلفة بعض بنود الفاتورة غير محددة", 409);
  let accumGross = 0, prevAllocated = 0;
  const values = new Map<number, number>();
  for (const item of ordered) {
    accumGross += item.lineTotalMinor ?? 0;
    const next = gross ? allocate(invoiceDiscount, accumGross, gross) : 0;
    values.set(item.id, (item.lineTotalMinor ?? 0) - (next - prevAllocated));
    prevAllocated = next;
  }
  return values;
}

async function existingReturnAmounts(tx: Db | Tx, purchaseId: number) {
  const returns = await tx.select({ id: posPurchaseReturnsTable.id })
    .from(posPurchaseReturnsTable)
    .where(and(eq(posPurchaseReturnsTable.purchaseId, purchaseId), eq(posPurchaseReturnsTable.status, "completed")));
  const amounts = new Map<number, { quantity: number; refund: number }>();
  if (!returns.length) return amounts;
  const rows = await tx.select().from(posPurchaseReturnItemsTable)
    .where(inArray(posPurchaseReturnItemsTable.returnId, returns.map(r => r.id)));
  for (const row of rows) {
    const p = amounts.get(row.purchaseItemId) ?? { quantity: 0, refund: 0 };
    p.quantity += row.quantity;
    p.refund += row.refundAmountMinor;
    amounts.set(row.purchaseItemId, p);
  }
  return amounts;
}

function stockOptions(product: typeof productsTable.$inferSelect) {
  const variants = (product.colorVariants as ColorVariant[] | null) ?? [];
  const options = variants.flatMap(variant =>
    (variant.sizes ?? []).map(s => ({ color: variant.color, size: s.size, stock: s.stock ?? null })),
  );
  return options.length ? options : [{ color: null, size: null, stock: product.stock ?? null }];
}

async function loadPurchase(db: Db, publicId: string) {
  const rows = await db.select().from(posPurchasesTable).where(eq(posPurchasesTable.publicId, publicId)).limit(1);
  const purchase = rows[0];
  if (!purchase || purchase.status !== "completed") throw new ReturnError("فاتورة المشتريات غير موجودة أو غير معتمدة", 404);
  if (purchase.currencyCode !== "ILS") throw new ReturnError("المردودات بعملة غير الشيكل تحتاج تسوية عملات مستقلة", 409);
  const [items, suppliers, previous] = await Promise.all([
    db.select().from(posPurchaseItemsTable).where(eq(posPurchaseItemsTable.purchaseId, purchase.id)).orderBy(asc(posPurchaseItemsTable.lineNumber)),
    db.select().from(suppliersTable).where(eq(suppliersTable.id, purchase.supplierId)).limit(1),
    existingReturnAmounts(db, purchase.id),
  ]);
  const values = lineValues(items, purchase.discountMinor);
  const productIds = [...new Set(items.map(i => i.productId).filter((n): n is number => n !== null))];
  const [products, barcodeRows] = await Promise.all([
    productIds.length ? db.select().from(productsTable).where(inArray(productsTable.id, productIds)) : Promise.resolve([]),
    productIds.length ? db.select({
      productId: productBarcodesTable.productId,
      barcode: productBarcodesTable.barcode,
      color: productBarcodesTable.color,
      size: productBarcodesTable.size,
    }).from(productBarcodesTable).where(inArray(productBarcodesTable.productId, productIds)) : Promise.resolve([]),
  ]);
  const productsById = new Map(products.map(p => [p.id, p]));
  const barcodesByProductId = new Map<number, typeof barcodeRows>();
  for (const row of barcodeRows) {
    const existing = barcodesByProductId.get(row.productId) ?? [];
    existing.push(row);
    barcodesByProductId.set(row.productId, existing);
  }
  const lines = items.map(item => {
    const p = item.productId ? productsById.get(item.productId) : null;
    const knownBarcodes = item.productId ? barcodesByProductId.get(item.productId) ?? [] : [];
    // A color-specific purchase line must not appear for a barcode belonging to another color.
    const searchableBarcodes = knownBarcodes.filter(row =>
      (!item.color || row.color === item.color) &&
      (!item.size || row.size === item.size)
    );
    const prior = previous.get(item.id) ?? { quantity: 0, refund: 0 };
    const originalQuantity = item.quantity + item.freeQuantity;
    const value = values.get(item.id) ?? 0;
    return {
      id: item.id,
      productId: item.productId,
      productName: item.productNameAr,
      productImage: item.productImage,
      productCode: item.productCode ?? p?.productCode ?? null,
      barcode: item.barcode,
      barcodes: [...new Set(
        [item.barcode, p?.barcode, ...searchableBarcodes.map(row => row.barcode)]
          .filter((barcode): barcode is string => typeof barcode === "string" && barcode.length > 0)
      )],
      color: item.color,
      size: item.size,
      entryMode: item.entryMode,
      originalQuantity,
      returnedQuantity: prior.quantity,
      availableToReturn: Math.max(0, originalQuantity - prior.quantity),
      originalAmountMinor: value,
      remainingAmountMinor: Math.max(0, value - prior.refund),
      stock: p ? getProductQuantity(p) : null,
      // Invoice lines that specify a color/size cannot return other variants.
      options: p ? stockOptions(p).filter(option =>
        (!item.color || option.color === item.color) &&
        (!item.size || option.size === item.size)
      ).map(option => ({
        ...option,
        barcode: knownBarcodes.find(row =>
          row.color === option.color && row.size === option.size
        )?.barcode ?? null,
      })) : [],
    };
  });
  return { purchase: { id: purchase.id, publicId: purchase.publicId, businessDate: purchase.businessDate, supplierId: purchase.supplierId, supplierName: suppliers[0]?.name ?? "", totalMinor: purchase.totalMinor }, lines };
}

async function detail(db: Db | Tx, id: number) {
  const rows = await db.select().from(posPurchaseReturnsTable).where(eq(posPurchaseReturnsTable.id, id)).limit(1);
  const purchaseReturn = rows[0];
  if (!purchaseReturn) throw new ReturnError("المردود غير موجود", 404);
  const items = await db.select().from(posPurchaseReturnItemsTable)
    .where(eq(posPurchaseReturnItemsTable.returnId, id)).orderBy(asc(posPurchaseReturnItemsTable.id));
  const sourceItems = items.length ? await db.select({
    id: posPurchaseItemsTable.id,
    name: posPurchaseItemsTable.productNameAr,
  }).from(posPurchaseItemsTable).where(inArray(posPurchaseItemsTable.id, [...new Set(items.map(item => item.purchaseItemId))])) : [];
  const names = new Map(sourceItems.map(item => [item.id, item.name]));
  const purchaseInfo = await db.select({
    publicId: posPurchasesTable.publicId,
    supplierInvoiceNumber: posPurchasesTable.supplierInvoiceNumber,
    supplierName: suppliersTable.name,
  }).from(posPurchasesTable)
    .innerJoin(suppliersTable, eq(suppliersTable.id, posPurchasesTable.supplierId))
    .where(eq(posPurchasesTable.id, purchaseReturn.purchaseId)).limit(1);
  const purchase = purchaseInfo[0];
  if (!purchase) throw new ReturnError("فاتورة المشتريات الأصلية غير موجودة", 409);
  return {
    purchaseReturn,
    purchase: {
      publicId: purchase.publicId,
      supplierName: purchase.supplierName,
      supplierInvoiceNumber: purchase.supplierInvoiceNumber,
    },
    items: items.map(item => ({
      ...item, productName: names.get(item.purchaseItemId) ?? "صنف غير معروف",
    })),
  };
}

async function handleCreate(request: Request, db: Db, env: Env) {
  const auth = await requireOwner(request, db, env);
  if (!auth.user) return auth.response!;
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || Array.isArray(payload)) return json({ error: "بيانات المردود غير صالحة" }, 400);
  try {
    const purchasePublicId = normalizeDimension(payload.purchasePublicId);
    const idempotencyKey = validKey(payload.idempotencyKey);
    const reason = normalizeDimension(payload.reason);
    const notes = normalizeDimension(payload.notes);
    if (!purchasePublicId || !idempotencyKey || !reason || reason.length < 2 || reason.length > 500 || (notes && notes.length > 1000))
      throw new ReturnError("رقم الفاتورة ومعرف العملية وسبب المردود مطلوبة");
    const rawLines = payload.lines;
    if (!Array.isArray(rawLines) || !rawLines.length || rawLines.length > 100) throw new ReturnError("اختر أصناف المردود");
    const wanted = rawLines.map((v: unknown) => {
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new ReturnError("سطر مردود غير صالح");
      const line = v as Record<string, unknown>;
      const quantity = positiveId(line.quantity);
      if (quantity > 99999) throw new ReturnError("كمية المردود كبيرة جدًا");
      return { purchaseItemId: positiveId(line.purchaseItemId), color: normalizeDimension(line.color), size: normalizeDimension(line.size), quantity };
    });
    const seen = new Set<string>();
    for (const row of wanted) {
      const key = JSON.stringify([row.purchaseItemId, row.color, row.size]);
      if (seen.has(key)) throw new ReturnError("نفس اللون والنمرة مكررين في المردود");
      seen.add(key);
    }
    const earlier = await db.select().from(posPurchaseReturnsTable).where(eq(posPurchaseReturnsTable.idempotencyKey, idempotencyKey)).limit(1);
    if (earlier[0]) {
      const result = await detail(db, earlier[0].id);
      return json({ ...result, alreadyCreated: true });
    }
    const result = await db.transaction(async tx => {
      const pRows = await tx.select().from(posPurchasesTable).where(eq(posPurchasesTable.publicId, purchasePublicId)).for("update");
      const purchase = pRows[0];
      if (!purchase || purchase.status !== "completed") throw new ReturnError("لا يمكن عمل مردود لفاتورة غير معتمدة", 409);
      if (purchase.currencyCode !== "ILS") throw new ReturnError("المردودات بعملة غير الشيكل تحتاج تسوية مستقلة", 409);
      const items = await tx.select().from(posPurchaseItemsTable).where(eq(posPurchaseItemsTable.purchaseId, purchase.id));
      const itemsById = new Map(items.map(i => [i.id, i]));
      const values = lineValues(items, purchase.discountMinor);
      const previous = await existingReturnAmounts(tx, purchase.id);
      const qtyByLine = new Map<number, number>();
      for (const row of wanted) {
        const item = itemsById.get(row.purchaseItemId);
        if (!item || item.productId === null) throw new ReturnError("الصنف غير مرتبط بفاتورة المشتريات", 409);
        if (item.color && item.color !== row.color || item.size && item.size !== row.size)
          throw new ReturnError("اللون أو النمرة لا يطابقان سطر فاتورة الشراء", 409);
        qtyByLine.set(item.id, (qtyByLine.get(item.id) ?? 0) + row.quantity);
      }
      const refundByLine = new Map<number, number>();
      for (const [itemId, quantity] of qtyByLine) {
        const item = itemsById.get(itemId)!;
        const originalQuantity = item.quantity + item.freeQuantity;
        const prior = previous.get(itemId) ?? { quantity: 0, refund: 0 };
        const totalValue = values.get(itemId) ?? 0;
        if (prior.quantity + quantity > originalQuantity)
          throw new ReturnError("المردود يتجاوز الكمية المتبقية من فاتورة الشراء للصنف " + item.productNameAr, 409);
        refundByLine.set(itemId, computeReturnRefundMinor({
          originalAmountMinor: totalValue, originalQuantity,
          previouslyReturnedQuantity: prior.quantity,
          previouslyRefundedMinor: prior.refund, returnQuantity: quantity,
        }));
      }
      const requestedProductIds = [...new Set(wanted.map(w => itemsById.get(w.purchaseItemId)!.productId!))].sort((a, b) => a - b);
      const products = await tx.select().from(productsTable)
        .where(inArray(productsTable.id, requestedProductIds)).orderBy(asc(productsTable.id)).for("update");
      const productsById = new Map(products.map(p => [p.id, p]));
      if (products.length !== requestedProductIds.length) throw new ReturnError("أحد الأصناف لم يعد موجودًا", 409);
      const stockChanges: Array<{
        productId: number; purchaseItemId: number; quantity: number; color: string | null; size: string | null;
        generalStockBefore: number | null; generalStockAfter: number | null;
        variantStockBefore: number | null; variantStockAfter: number | null;
      }> = [];
      const pendingProducts = new Map(productsById);
      for (const row of wanted) {
        const original = itemsById.get(row.purchaseItemId)!;
        const productId = original.productId!;
        const product = pendingProducts.get(productId)!;
        const variants = (product.colorVariants as ColorVariant[] | null) ?? [];
        const hasVariants = variants.some(v => (v.sizes ?? []).length > 0);
        let variantStockBefore: number | null = null;
        let variantStockAfter: number | null = null;
        let changedVariants = variants;
        if (hasVariants) {
          if (!row.color || !row.size) throw new ReturnError("حدد اللون والنمرة للصنف " + product.nameAr);
          const vi = variants.findIndex(v => v.color === row.color);
          if (vi < 0) throw new ReturnError("اللون غير موجود للصنف " + product.nameAr, 409);
          const si = variants[vi]!.sizes.findIndex(s => s.size === row.size);
          if (si < 0) throw new ReturnError("النمرة غير موجودة للصنف " + product.nameAr, 409);
          const current = variants[vi]!.sizes[si]!;
          if (current.stock == null || current.stock < row.quantity) throw new ReturnError("المخزون الفعلي غير كاف للون/النمرة " + product.nameAr, 409);
          variantStockBefore = current.stock;
          variantStockAfter = current.stock - row.quantity;
          changedVariants = variants.map((variant, index) => index !== vi ? variant : {
            ...variant, sizes: variant.sizes.map((s, i) => i === si ? { ...s, stock: variantStockAfter, outOfStock: variantStockAfter === 0 } : s),
          });
        } else if (row.color || row.size) {
          throw new ReturnError("هذا الصنف لا يحتوي على متغيرات لون ونمرة", 409);
        }
        const generalStockBefore = product.stock ?? null;
        if (generalStockBefore !== null && generalStockBefore < row.quantity) throw new ReturnError("مخزون الموديل غير كاف للصنف " + product.nameAr, 409);
        const generalStockAfter = generalStockBefore === null ? null : generalStockBefore - row.quantity;
        if (!hasVariants && generalStockBefore === null) throw new ReturnError("الكمية الفعلية للصنف غير محددة", 409);
        pendingProducts.set(productId, { ...product, stock: generalStockAfter, colorVariants: changedVariants });
        stockChanges.push({ productId, purchaseItemId: row.purchaseItemId, color: row.color, size: row.size, quantity: row.quantity,
          generalStockBefore, generalStockAfter, variantStockBefore, variantStockAfter });
      }
      // Every quantity is checked on a FOR UPDATE product snapshot before writing.
      for (const product of pendingProducts.values()) {
        await tx.update(productsTable).set({ stock: product.stock, colorVariants: product.colorVariants })
          .where(eq(productsTable.id, product.id));
      }

      const perProductCosts = new Map<number, { total: number; quality: CostQuality }>();
      for (const productId of requestedProductIds) {
        const quantity = stockChanges.filter(s => s.productId === productId).reduce((s, r) => s + r.quantity, 0);
        const consumed = await consumeProductCost(tx, {
          productId, quantity, eventType: "purchase_return", sourceType: "pos_purchase_return",
          sourceRef: idempotencyKey, sourceItemRef: "product:" + productId,
          businessDate: businessDate(), note: "Purchase return physical stock out", createdByUserId: auth.user!.id,
        });
        if (!consumed.tracked) throw new ReturnError("تكلفة المخزون غير جاهزة لهذا المردود. راجع تكلفة الموديل قبل الإرجاع (الصنف " + productId + ")", 409);
        perProductCosts.set(productId, { total: consumed.costTotalMinor, quality: consumed.costQuality });
      }

      const refundRows: number[] = [];
      for (const row of wanted) {
        const group = wanted.filter(w => w.purchaseItemId === row.purchaseItemId);
        const groupIndex = group.indexOf(row);
        const amounts = splitAmount(refundByLine.get(row.purchaseItemId) ?? 0, group.map(r => r.quantity));
        refundRows.push(amounts[groupIndex] ?? 0);
      }
      const costRows = stockChanges.map((s, index) => {
        const group = stockChanges.filter(x => x.productId === s.productId);
        const groupIndex = group.indexOf(s);
        return splitAmount(perProductCosts.get(s.productId)!.total, group.map(x => x.quantity))[groupIndex] ?? 0;
      });
      const refundAmountMinor = refundRows.reduce((s, n) => s + n, 0);
      const inventoryCostMinor = costRows.reduce((s, n) => s + n, 0);
      if (![refundAmountMinor, inventoryCostMinor].every(n => Number.isSafeInteger(n) && n >= 0 && n <= MAX_MINOR))
        throw new ReturnError("قيمة المردود خارج الحد المسموح", 409);
      const inserted = await tx.insert(posPurchaseReturnsTable).values({
        publicId: "PRET-" + businessDate().replaceAll("-", "") + "-" + randomUUID().slice(0, 8).toUpperCase(),
        idempotencyKey, purchaseId: purchase.id, supplierId: purchase.supplierId,
        businessDate: businessDate(), status: "completed",
        refundAmountMinor, inventoryCostMinor, reason, notes, createdByUserId: auth.user!.id,
      }).returning();
      const purchaseReturn = inserted[0]!;
      for (let index = 0; index < stockChanges.length; index++) {
        const row = stockChanges[index]!;
        const original = itemsById.get(row.purchaseItemId)!;
        const recorded = await tx.insert(posPurchaseReturnItemsTable).values({
          returnId: purchaseReturn.id, purchaseItemId: row.purchaseItemId, productId: row.productId,
          color: row.color, size: row.size, quantity: row.quantity, refundAmountMinor: refundRows[index]!,
          inventoryCostMinor: costRows[index]!, costQuality: perProductCosts.get(row.productId)!.quality,
          generalStockBefore: row.generalStockBefore, generalStockAfter: row.generalStockAfter,
          variantStockBefore: row.variantStockBefore, variantStockAfter: row.variantStockAfter,
        }).returning();
        await tx.insert(inventoryMovementsTable).values({
          productId: row.productId, barcode: original.barcode, productCode: original.productCode,
          productNameAr: original.productNameAr, color: row.color, size: row.size,
          movementType: "purchase_return", quantityDelta: -row.quantity,
          generalStockBefore: row.generalStockBefore, generalStockAfter: row.generalStockAfter,
          variantStockBefore: row.variantStockBefore, variantStockAfter: row.variantStockAfter,
          sourceType: "pos_purchase_return", sourceId: purchaseReturn.id, sourceItemId: recorded[0]!.id,
          sourcePublicId: purchaseReturn.publicId,
          eventKey: "pos-purchase-return:" + purchaseReturn.id + ":item:" + recorded[0]!.id + ":completed",
          occurredAt: new Date(),
        });
      }
      if (refundAmountMinor > 0 || inventoryCostMinor > 0) {
        const supplierAccount = await ensureSupplierPayableControlAccount(tx);
        const inventoryAccount = await ensureAccount(tx, "PURCHASE_INVENTORY", "المشتريات / المخزون", "asset");
        const difference = refundAmountMinor - inventoryCostMinor;
        const lines: Array<{accountId: number; supplierId?: number; debitMinor: number; creditMinor: number; memo: string}> = [];
        if (refundAmountMinor > 0) lines.push({ accountId: supplierAccount.id, supplierId: purchase.supplierId, debitMinor: refundAmountMinor, creditMinor: 0, memo: "مردود مشتريات إلى حساب المورد" });
        if (inventoryCostMinor > 0) lines.push({ accountId: inventoryAccount.id, debitMinor: 0, creditMinor: inventoryCostMinor, memo: "إخراج تكلفة البضاعة المرتجعة" });
        if (difference !== 0) {
          const variance = await ensureAccount(tx, "PURCHASE_RETURN_VARIANCE", "فروقات مردودات المشتريات", "expense");
          lines.push({ accountId: variance.id, debitMinor: difference < 0 ? -difference : 0, creditMinor: difference > 0 ? difference : 0, memo: "فرق قيمة المورد عن متوسط تكلفة المخزون" });
        }
        await postFinanceTransaction(tx, {
          publicId: "FIN-" + businessDate().replaceAll("-", "") + "-" + randomUUID().slice(0, 8).toUpperCase(),
          idempotencyKey: "purchase-return:" + purchaseReturn.id + ":completed",
          businessDate: purchaseReturn.businessDate, transactionType: "refund",
          sourceType: "pos_purchase_return", sourceId: String(purchaseReturn.id), sourceEvent: "completed",
          notes: "مردود مشتريات " + purchaseReturn.publicId + " لفاتورة " + purchase.publicId,
          createdByUserId: auth.user!.id, lines,
        });
      }
      return detail(tx, purchaseReturn.id);
    });
    return json({ ...result, alreadyCreated: false }, 201);
  } catch (error) {
    if (error instanceof ReturnError) return json({ error: error.message }, error.status);
    console.error("POS_PURCHASE_RETURN_CREATE_FAILED", error);
    return json({ error: "تعذر حفظ مردود المشتريات" }, 500);
  }
}

async function handleVoid(request: Request, db: Db, env: Env) {
  const auth = await requireOwner(request, db, env);
  if (!auth.user) return auth.response!;
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const publicId = normalizeDimension(payload?.publicId);
    const reason = normalizeDimension(payload?.reason);
    if (!publicId || !reason || reason.length < 2 || reason.length > 500) throw new ReturnError("رقم المردود وسبب الإلغاء مطلوبان");
    const result = await db.transaction(async tx => {
      const initialRows = await tx.select().from(posPurchaseReturnsTable).where(eq(posPurchaseReturnsTable.publicId, publicId)).limit(1);
      const initial = initialRows[0];
      if (!initial) throw new ReturnError("المردود غير موجود", 404);
      // Consistent lock order: original purchase before its return, as in create.
      await tx.select().from(posPurchasesTable).where(eq(posPurchasesTable.id, initial.purchaseId)).for("update");
      const lockedRows = await tx.select().from(posPurchaseReturnsTable).where(eq(posPurchaseReturnsTable.id, initial.id)).for("update");
      const purchaseReturn = lockedRows[0]!;
      if (purchaseReturn.status === "voided") return { ...(await detail(tx, purchaseReturn.id)), alreadyVoided: true };
      const items = await tx.select().from(posPurchaseReturnItemsTable)
        .where(eq(posPurchaseReturnItemsTable.returnId, purchaseReturn.id)).orderBy(asc(posPurchaseReturnItemsTable.productId), asc(posPurchaseReturnItemsTable.id));
      const productIds = [...new Set(items.map(i => i.productId))];
      const products = await tx.select().from(productsTable)
        .where(inArray(productsTable.id, productIds)).orderBy(asc(productsTable.id)).for("update");
      if (products.length !== productIds.length) throw new ReturnError("تعذر استرجاع أحد أصناف المردود", 409);
      const pendingProducts = new Map(products.map(p => [p.id, p]));
      for (const row of items) {
        const product = pendingProducts.get(row.productId)!;
        const variants = (product.colorVariants as ColorVariant[] | null) ?? [];
        let variantStockBefore: number | null = null, variantStockAfter: number | null = null;
        let updatedVariants = variants;
        if (row.color !== null && row.size !== null) {
          const vi = variants.findIndex(v => v.color === row.color);
          if (vi < 0) throw new ReturnError("لون المردود لم يعد موجودًا", 409);
          const si = variants[vi]!.sizes.findIndex(s => s.size === row.size);
          if (si < 0 || variants[vi]!.sizes[si]!.stock == null) throw new ReturnError("نمرة المردود لم تعد موجودة", 409);
          variantStockBefore = variants[vi]!.sizes[si]!.stock!;
          variantStockAfter = variantStockBefore + row.quantity;
          updatedVariants = variants.map((v, i) => i === vi ? {
            ...v, sizes: v.sizes.map((s, j) => j === si ? { ...s, stock: variantStockAfter, outOfStock: false } : s),
          } : v);
        }
        const generalStockBefore = product.stock ?? null;
        const generalStockAfter = generalStockBefore === null ? null : generalStockBefore + row.quantity;
        pendingProducts.set(row.productId, { ...product, stock: generalStockAfter, colorVariants: updatedVariants });
        const restored = await restoreExactProductCost(tx, {
          productId: row.productId, quantity: row.quantity, costTotalMinor: row.inventoryCostMinor,
          costQuality: row.costQuality as CostQuality, eventType: "purchase_return_void",
          sourceType: "pos_purchase_return", sourceRef: String(purchaseReturn.id), sourceItemRef: String(row.id),
          businessDate: businessDate(), note: "Void purchase return", createdByUserId: auth.user!.id,
        });
        if (!restored.tracked) throw new ReturnError("تعذر استرجاع تكلفة المخزون للمردود", 409);
        const originalRows = await tx.select().from(posPurchaseItemsTable).where(eq(posPurchaseItemsTable.id, row.purchaseItemId)).limit(1);
        const original = originalRows[0]!;
        await tx.insert(inventoryMovementsTable).values({
          productId: row.productId, barcode: original.barcode, productCode: original.productCode,
          productNameAr: original.productNameAr, color: row.color, size: row.size,
          movementType: "purchase_return_void", quantityDelta: row.quantity,
          generalStockBefore, generalStockAfter, variantStockBefore, variantStockAfter,
          sourceType: "pos_purchase_return", sourceId: purchaseReturn.id, sourceItemId: row.id,
          sourcePublicId: purchaseReturn.publicId, eventKey: "pos-purchase-return:" + purchaseReturn.id + ":item:" + row.id + ":voided",
          occurredAt: new Date(),
        });
      }
      for (const product of pendingProducts.values()) {
        await tx.update(productsTable).set({ stock: product.stock, colorVariants: product.colorVariants }).where(eq(productsTable.id, product.id));
      }
      const originals = await tx.select().from(financeTransactionsTable).where(and(
        eq(financeTransactionsTable.sourceType, "pos_purchase_return"),
        eq(financeTransactionsTable.sourceId, String(purchaseReturn.id)),
        eq(financeTransactionsTable.sourceEvent, "completed"),
        eq(financeTransactionsTable.status, "posted"),
      )).for("update");
      if (originals[0]) {
        const original = originals[0];
        const lines = await tx.select().from(financeTransactionLinesTable).where(eq(financeTransactionLinesTable.transactionId, original.id));
        await postFinanceTransaction(tx, {
          publicId: "FIN-" + businessDate().replaceAll("-", "") + "-" + randomUUID().slice(0, 8).toUpperCase(),
          idempotencyKey: "purchase-return:" + purchaseReturn.id + ":voided",
          businessDate: businessDate(), transactionType: "reversal",
          sourceType: "pos_purchase_return", sourceId: String(purchaseReturn.id), sourceEvent: "voided",
          notes: "إلغاء مردود " + purchaseReturn.publicId + ": " + reason, createdByUserId: auth.user!.id,
          lines: lines.map(l => ({ accountId: l.accountId, supplierId: l.supplierId, customerId: l.customerId,
            employeeId: l.employeeId, debitMinor: l.creditMinor, creditMinor: l.debitMinor,
            memo: "عكس مردود المشتريات" })),
        });
        await tx.update(financeTransactionsTable).set({ status: "reversed", updatedAt: new Date() }).where(eq(financeTransactionsTable.id, original.id));
      }
      await tx.update(posPurchaseReturnsTable).set({ status: "voided", voidedAt: new Date(), voidedByUserId: auth.user!.id, voidReason: reason, updatedAt: new Date() })
        .where(eq(posPurchaseReturnsTable.id, purchaseReturn.id));
      return { ...(await detail(tx, purchaseReturn.id)), alreadyVoided: false };
    });
    return json(result);
  } catch (error) {
    if (error instanceof ReturnError) return json({ error: error.message }, error.status);
    console.error("POS_PURCHASE_RETURN_VOID_FAILED", error);
    return json({ error: "تعذر إلغاء مردود المشتريات" }, 500);
  }
}

export async function handlePosPurchaseReturnRequest(request: Request, db: Db, env: Env): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  if (!path.startsWith("/api/pos/purchase-returns")) return null;
  if (!["GET", "POST"].includes(request.method)) return json({ error: "طريقة الطلب غير مدعومة" }, 405);
  if (request.method === "POST" && !isPurchaseWriteEnabled(env)) return purchaseWritesDisabledResponse();
  if (request.method === "POST" && path === "/api/pos/purchase-returns") return handleCreate(request, db, env);
  if (request.method === "POST" && path === "/api/pos/purchase-returns/void") return handleVoid(request, db, env);
  const auth = await requireOwner(request, db, env);
  if (!auth.user) return auth.response!;
  try {
    if (path === "/api/pos/purchase-returns/preview" && request.method === "GET") {
      const publicId = url.searchParams.get("purchasePublicId")?.trim() ?? "";
      if (!publicId) throw new ReturnError("أدخل رقم فاتورة المشتريات");
      return json(await loadPurchase(db, publicId));
    }
    if (path === "/api/pos/purchase-returns/history" && request.method === "GET") {
      const purchasePublicId = url.searchParams.get("purchasePublicId");
      const rows = purchasePublicId
        ? await db.select().from(posPurchasesTable).where(eq(posPurchasesTable.publicId, purchasePublicId)).limit(1)
        : [];
      if (purchasePublicId && !rows[0]) throw new ReturnError("فاتورة المشتريات غير موجودة", 404);
      const result = await db.select().from(posPurchaseReturnsTable)
        .where(rows[0] ? eq(posPurchaseReturnsTable.purchaseId, rows[0].id) : undefined)
        .orderBy(desc(posPurchaseReturnsTable.id)).limit(60);
      return json({ returns: result });
    }
    if (path === "/api/pos/purchase-returns/detail" && request.method === "GET") {
      const publicId = url.searchParams.get("publicId") ?? "";
      const rows = await db.select().from(posPurchaseReturnsTable).where(eq(posPurchaseReturnsTable.publicId, publicId)).limit(1);
      if (!rows[0]) throw new ReturnError("المردود غير موجود", 404);
      return json(await detail(db, rows[0].id));
    }
    return json({ error: "المسار غير موجود" }, 404);
  } catch (error) {
    if (error instanceof ReturnError) return json({ error: error.message }, error.status);
    console.error("POS_PURCHASE_RETURN_READ_FAILED", error);
    return json({ error: "تعذر قراءة مردود المشتريات" }, 500);
  }
}
