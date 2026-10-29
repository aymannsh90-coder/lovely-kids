import {
  and, asc, eq, inArray,
} from "drizzle-orm";
import {
  exchangeDocumentsTable,
  exchangeReturnItemCostsTable,
  exchangeReturnItemsTable,
  orderItemCostsTable,
  posSaleItemCostsTable,
  posSaleReturnItemCostsTable,
  posSaleReturnItemsTable,
  posSaleReturnsTable,
  productsTable,
  productCostLedgerTable,
  productCostStateTable,
} from "@workspace/db/schema";

import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import { getProductQuantity } from "./product-quantity";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
const json = (data: unknown, status = 200) => Response.json(data, {
  status,
  headers: { "Access-Control-Allow-Origin": "*" },
});

type Source = { publicId: string; quantity: number; costMinor: number };

// Owner attests the actual unit cost, NOT the identity of the original sale.
// No sales/returns/stock snapshots or financial values are rewritten here.
export async function handleOwnerCostQualityAttestation(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response> {
  const auth = await getCurrentUser(db, request, env);
  if (!auth?.isOwner) return json({ error: "هذه العملية للمالك فقط" }, 403);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "البيانات غير صالحة" }, 400);
  }
  const input = body as Record<string, unknown>;
  const productId = Number(input.productId);
  const unitCostMinor = Number(input.unitCostMinor);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const expectedSources = input.sourcePublicIds;
  if (!Number.isSafeInteger(productId) || productId <= 0 ||
      !Number.isSafeInteger(unitCostMinor) || unitCostMinor < 0 ||
      !Array.isArray(expectedSources) || expectedSources.length < 1 ||
      expectedSources.length > 100 ||
      !expectedSources.every((id) => typeof id === "string" && id.length > 0 && id.length <= 100) ||
      new Set(expectedSources).size !== expectedSources.length ||
      reason.length < 12 || reason.length > 1000) {
    return json({ error: "يلزم تحديد الصنف والتكلفة وكل المرتجعات وسبب توثيق واضح" }, 400);
  }

  const ownerId = Number(auth.id);
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
    return json({ error: "حساب المالك غير صالح" }, 403);
  }

  const result = await db.transaction(async (tx) => {
    const product = (await tx.select({
      id: productsTable.id,
      stock: productsTable.stock,
      colorVariants: productsTable.colorVariants,
      deletedAt: productsTable.deletedAt,
    }).from(productsTable).where(eq(productsTable.id, productId)).limit(1).for("update"))[0];

    const state = (await tx.select().from(productCostStateTable)
      .where(eq(productCostStateTable.productId, productId)).limit(1).for("update"))[0];

    if (!product || product.deletedAt !== null || !state) {
      return { ok: false as const, status: 404, error: "الصنف أو تكلفة المخزون غير موجودين" };
    }
    if (state.costQuality === "confirmed") {
      return { ok: false as const, status: 409, error: "تكلفة الصنف مؤكدة أصلًا؛ لا حاجة لتسوية جديدة" };
    }
    if (state.costQuality !== "mixed" || state.referenceUnitCostMinor !== unitCostMinor) {
      return { ok: false as const, status: 409, error: "تكلفة الصنف أو حالتها تغيرت؛ أعد تحميل التقرير" };
    }
    const physicalQuantity = getProductQuantity({
      stock: product.stock, colorVariants: product.colorVariants,
    });
    if (physicalQuantity === null || physicalQuantity !== state.quantityOnHand ||
        BigInt(state.quantityOnHand) * BigInt(unitCostMinor) !== BigInt(state.inventoryValueMinor)) {
      return { ok: false as const, status: 409, error: "كمية المخزون أو قيمته لا تتطابق مع التكلفة؛ ألغيت التسوية" };
    }

    const [ledger, exchangeReturns, posReturns, posSales, onlineSales] = await Promise.all([
      tx.select({
        eventType: productCostLedgerTable.eventType,
        sourceType: productCostLedgerTable.sourceType,
        quantityAfter: productCostLedgerTable.quantityAfter,
        valueAfterMinor: productCostLedgerTable.inventoryValueAfterMinor,
      }).from(productCostLedgerTable).where(eq(productCostLedgerTable.productId, productId))
        .orderBy(asc(productCostLedgerTable.id)),
      tx.select({
        publicId: exchangeDocumentsTable.publicId,
        quantity: exchangeReturnItemCostsTable.quantity,
        costMinor: exchangeReturnItemCostsTable.costTotalMinor,
      }).from(exchangeReturnItemCostsTable)
        .innerJoin(exchangeReturnItemsTable, eq(exchangeReturnItemCostsTable.returnItemId, exchangeReturnItemsTable.id))
        .innerJoin(exchangeDocumentsTable, eq(exchangeReturnItemsTable.exchangeId, exchangeDocumentsTable.id))
        .where(and(eq(exchangeReturnItemCostsTable.productId, productId),
          eq(exchangeReturnItemCostsTable.costQuality, "estimated"),
          eq(exchangeDocumentsTable.status, "completed"))),
      tx.select({
        publicId: posSaleReturnsTable.publicId,
        quantity: posSaleReturnItemCostsTable.quantity,
        costMinor: posSaleReturnItemCostsTable.costTotalMinor,
      }).from(posSaleReturnItemCostsTable)
        .innerJoin(posSaleReturnItemsTable, eq(posSaleReturnItemCostsTable.returnItemId, posSaleReturnItemsTable.id))
        .innerJoin(posSaleReturnsTable, eq(posSaleReturnItemsTable.returnId, posSaleReturnsTable.id))
        .where(and(eq(posSaleReturnItemCostsTable.productId, productId),
          eq(posSaleReturnItemCostsTable.costQuality, "estimated"),
          eq(posSaleReturnsTable.status, "completed"))),
      tx.select({
        quantity: posSaleItemCostsTable.quantity,
        unitCostMinor: posSaleItemCostsTable.unitCostMinor,
        totalMinor: posSaleItemCostsTable.costTotalMinor,
      }).from(posSaleItemCostsTable).where(eq(posSaleItemCostsTable.productId, productId)),
      tx.select({
        quantity: orderItemCostsTable.quantity,
        unitCostMinor: orderItemCostsTable.unitCostMinor,
        totalMinor: orderItemCostsTable.costTotalMinor,
      }).from(orderItemCostsTable).where(eq(orderItemCostsTable.productId, productId)),
    ]);

    if (!ledger.some((row) => row.eventType === "opening") ||
        ledger.some((row) => BigInt(row.quantityAfter) * BigInt(unitCostMinor) !== BigInt(row.valueAfterMinor))) {
      return { ok: false as const, status: 409, error: "وجدت حركة بتكلفة مختلفة؛ يلزم مراجعة تاريخ الصنف قبل التأكيد" };
    }
    const sources: Source[] = [...exchangeReturns, ...posReturns];
    const ids = sources.map((source) => source.publicId).sort();
    if (sources.length === 0 ||
        ids.length !== expectedSources.length ||
        ids.some((id, i) => id !== [...expectedSources].sort()[i])) {
      return { ok: false as const, status: 409, error: "قائمة المرتجعات تغيرت؛ أعد تحميل التقرير وراجع الحركات الجديدة" };
    }
    if (sources.some((source) => source.quantity <= 0 ||
      BigInt(source.quantity) * BigInt(unitCostMinor) !== BigInt(source.costMinor))) {
      return { ok: false as const, status: 409, error: "أحد المرتجعات يحمل تكلفة مختلفة عن المبلغ الذي أكّدته" };
    }
    if ([...posSales, ...onlineSales].some((snapshot) =>
      snapshot.unitCostMinor !== unitCostMinor ||
      BigInt(snapshot.quantity) * BigInt(unitCostMinor) !== BigInt(snapshot.totalMinor))) {
      return { ok: false as const, status: 409, error: "توجد لقطة بيع بتكلفة مختلفة؛ لا يمكن تأكيد المجموعة تلقائيًا" };
    }

    await tx.update(productCostStateTable).set({
      costQuality: "confirmed",
      updatedAt: new Date(),
    }).where(eq(productCostStateTable.productId, productId));

    const eventKey = crypto.randomUUID();
    await tx.insert(productCostLedgerTable).values({
      productId,
      eventType: "correction",
      sourceType: "owner_cost_quality_attestation",
      sourceRef: String(productId),
      sourceItemRef: eventKey,
      quantityDelta: 0,
      inventoryValueDeltaMinor: 0,
      quantityAfter: state.quantityOnHand,
      inventoryValueAfterMinor: state.inventoryValueMinor,
      costQuality: "confirmed",
      note: `Owner verified unit cost ${unitCostMinor} minor units without claiming original sale linkage. Returns: ${ids.join(", ")}. Reason: ${reason}`,
      createdByUserId: ownerId,
    });

    return {
      ok: true as const,
      productId: String(productId),
      unitCostMinor,
      sourcePublicIds: ids,
      auditEvent: eventKey,
      quantityUnchanged: state.quantityOnHand,
      inventoryValueUnchangedMinor: state.inventoryValueMinor,
      historicSnapshotsUnchanged: true,
    };
  });

  if (!result.ok) return json({ error: result.error }, result.status);
  return json(result);
}
