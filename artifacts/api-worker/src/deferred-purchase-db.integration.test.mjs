/**
 * Disposable DB-backed integration test of the real Drizzle accounting helpers.
 * Never connect to production; CI supplies its own throwaway PostgreSQL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import {
  usersTable, suppliersTable, cashSessionsTable,
  productsTable, posPurchasesTable, posPurchaseItemsTable,
  posSalesTable, posSaleItemsTable,
  posSaleReturnsTable, posSaleReturnItemsTable,
  posSaleItemCostsTable, posSaleReturnItemCostsTable,
  productCostStateTable, deferredPurchaseSaleCostsTable,
} from "@workspace/db/schema";
import {
  recordDeferredPurchasePosSale,
  loadDeferredPurchaseCostSales,
  hasPendingDeferredCostForSaleItem,
  hasPendingDeferredCostForSale,
  settleDeferredPurchasePosSale,
} from "./deferred-purchase-sale-cost.ts";
import {
  addExactProductCostOrInitialize,
  consumeProductCost,
} from "./inventory-cost-engine.ts";
import { allocateDeferredPurchaseCost } from "./deferred-purchase-cost-math.ts";
import { getProductQuantity } from "./product-quantity.ts";

const url = process.env.DATABASE_URL;
assert.ok(url && /localhost|127\.0\.0\.1/.test(url),
  "Deferred integration tests must use LOCAL PostgreSQL only");

const businessDate = "2026-11-15";
test("old cost closes, new 60 stock sold, returned, return voided, and invoice approved", async () => {
  const client = new Client({ connectionString: url });
  await client.connect();
  const db = drizzle(client);
  try {
    const [user] = await db.insert(usersTable)
      .values({ name: "Test worker" }).returning();
    const [supplier] = await db.insert(suppliersTable)
      .values({ code: "CI_DRAFT", name: "CI supplier",
        createdByUserId: user.id }).returning();
    const [session] = await db.insert(cashSessionsTable)
      .values({ businessDate, openedByUserId: user.id,
        openingBalanceMinor: 0, expectedBalanceMinor: 0 }).returning();
    const [product] = await db.insert(productsTable).values({
      name: "CI newborn socks", nameAr: "جرابات اختبار",
      productCode: "CI0607", price: 12, image: "ci-fixture",
      category: "baby", ageGroup: "0-3",
      stock: null,
      colorVariants: [{
        color: "blue", hex: "#00f", sizes: [{
          size: "ONE SIZE", stock: 64, outOfStock: false,
        }],
      }],
    }).returning();

    // Legacy 4 physical units with approved cost coexist with a
    // supplier receipt of 60 units entered physically.
    await db.transaction(async tx => {
      await addExactProductCostOrInitialize(tx, {
        productId: product.id, quantity: 4, costTotalMinor: 2456,
        costQuality: "confirmed", eventType: "opening",
        sourceType: "ci", sourceRef: "opening", sourceItemRef: "old",
      });
      const old = await consumeProductCost(tx, {
        productId: product.id, quantity: 4, eventType: "pos_sale",
        sourceType: "ci", sourceRef: "old-sale",
        sourceItemRef: "old", businessDate,
      });
      assert.equal(old.tracked, true);
      assert.equal(old.costTotalMinor, 2456);
      await tx.update(productsTable).set({
        colorVariants: [{
          color: "blue", hex: "#00f", sizes: [{
            size: "ONE SIZE", stock: 60, outOfStock: false,
          }],
        }],
      }).where(eq(productsTable.id, product.id));
    });

    const [draft] = await db.insert(posPurchasesTable).values({
      publicId: "DRAFT-20261115-CITEST",
      idempotencyKey: "purchase-draft-ci-fixture",
      supplierId: supplier.id,
      businessDate, enteredByUserId: user.id, warehouseKey: "main",
      status: "draft", paymentMethod: "credit",
      subtotalMinor: 35580, totalMinor: 35580, dueMinor: 35580,
    }).returning();
    await db.insert(posPurchaseItemsTable).values({
      purchaseId: draft.id, lineNumber: 1, productId: product.id,
      productNameAr: "جرابات اختبار", quantity: 60, freeQuantity: 0,
      unitCostMinor: 593, lineTotalMinor: 35580,
      entryMode: "stock_receipt",
    });

    let saleItemId = 0;
    await db.transaction(async tx => {
      const [sale] = await tx.insert(posSalesTable).values({
        publicId: "POS-20261115-CI1", idempotencyKey: "ci-sale-unique-1",
        cashSessionId: session.id, cashierUserId: user.id,
        businessDate, registerKey: "main", status: "completed",
        paymentMethod: "cash", subtotalMinor: 1200, totalMinor: 1200,
        paidMinor: 1200,
      }).returning();
      const [item] = await tx.insert(posSaleItemsTable).values({
        saleId: sale.id, lineNumber: 1, productId: product.id,
        productNameAr: "جرابات اختبار", color: "blue", size: "ONE SIZE",
        quantity: 1, websiteUnitPriceMinor: 1200,
        soldUnitPriceMinor: 1200, lineTotalMinor: 1200,
        variantStockBefore: 60, variantStockAfter: 59,
      }).returning();
      saleItemId = item.id;
      await tx.update(productsTable).set({
        colorVariants: [{
          color: "blue", hex: "#00f", sizes: [{
            size: "ONE SIZE", stock: 59, outOfStock: false,
          }],
        }],
      }).where(eq(productsTable.id, product.id));
      const unpriced = await consumeProductCost(tx, {
        productId: product.id, quantity: 1, eventType: "pos_sale",
        sourceType: "pos_sale", sourceRef: String(sale.id),
        sourceItemRef: String(item.id), businessDate,
      });
      assert.equal(unpriced.tracked, false);
      await recordDeferredPurchasePosSale(tx, {
        productId: product.id, items: [{
          saleItemId: item.id, quantity: 1,
        }],
      });
      assert.equal(await hasPendingDeferredCostForSaleItem(tx, item.id), true);
      assert.equal(await hasPendingDeferredCostForSale(tx, [item.id]), true);
      const pending = await loadDeferredPurchaseCostSales(tx, {
        draftPublicId: draft.publicId, productId: product.id,
      });
      assert.equal(pending.netSoldQuantity, 1);
    });

    let returnItemId = 0;
    await db.transaction(async tx => {
      const [returnHead] = await tx.insert(posSaleReturnsTable).values({
        publicId: "RETURN-20261115-CI1",
        idempotencyKey: "ci-return-unique-1",
        originalSaleId: (await tx.select({ saleId: posSaleItemsTable.saleId })
          .from(posSaleItemsTable).where(eq(posSaleItemsTable.id, saleItemId)))[0].saleId,
        cashSessionId: session.id, cashierUserId: user.id, registerKey: "main",
        businessDate, status: "completed", refundMethod: "cash",
        grossAmountMinor: 1200, discountAmountMinor: 0,
        refundAmountMinor: 1200, reason: "CI return",
      }).returning();
      const [returned] = await tx.insert(posSaleReturnItemsTable).values({
        returnId: returnHead.id, originalSaleItemId: saleItemId,
        lineNumber: 1, productId: product.id, productNameAr: "جرابات اختبار",
        color: "blue", size: "ONE SIZE", quantity: 1,
        soldUnitPriceMinor: 1200, grossAmountMinor: 1200,
        allocatedDiscountMinor: 0, refundAmountMinor: 1200,
      }).returning();
      returnItemId = returned.id;
      await tx.update(productsTable).set({
        colorVariants: [{ color: "blue", hex: "#00f",
          sizes: [{ size: "ONE SIZE", stock: 60, outOfStock: false }] }],
      }).where(eq(productsTable.id, product.id));
      const pending = await loadDeferredPurchaseCostSales(tx, {
        draftPublicId: draft.publicId, productId: product.id,
      });
      assert.equal(pending.netSoldQuantity, 0);
      assert.equal(pending.sales[0].returns.length, 1);
      assert.equal((await tx.select().from(posSaleReturnItemCostsTable)).length, 0);
      await tx.update(posSaleReturnsTable).set({
        status: "voided", voidedAt: new Date(), voidedByUserId: user.id,
        voidReason: "CI reversed return",
      }).where(eq(posSaleReturnsTable.id, returnHead.id));
      await tx.update(productsTable).set({
        colorVariants: [{ color: "blue", hex: "#00f",
          sizes: [{ size: "ONE SIZE", stock: 59, outOfStock: false }] }],
      }).where(eq(productsTable.id, product.id));
      const afterVoid = await loadDeferredPurchaseCostSales(tx, {
        draftPublicId: draft.publicId, productId: product.id,
      });
      assert.equal(afterVoid.netSoldQuantity, 1);
      assert.deepEqual(afterVoid.sales[0].returns, []);
    });

    await db.transaction(async tx => {
      const pending = await loadDeferredPurchaseCostSales(tx, {
        draftPublicId: draft.publicId, productId: product.id,
      });
      const allocation = allocateDeferredPurchaseCost({
        receivedQuantity: 60, receiptCostTotalMinor: 35580,
        sales: pending.sales,
      });
      assert.equal(allocation.stockQuantityApplied, 59);
      assert.equal(allocation.netSoldCostTotalMinor, 593);
      assert.equal(allocation.stockCostTotalMinor, 34987);
      assert.equal(allocation.stockCostTotalMinor +
        allocation.netSoldCostTotalMinor, 35580);
      await addExactProductCostOrInitialize(tx, {
        productId: product.id,
        quantity: allocation.stockQuantityApplied,
        costTotalMinor: allocation.stockCostTotalMinor,
        costQuality: "confirmed", eventType: "purchase",
        sourceType: "pos_purchase", sourceRef: String(draft.id),
        sourceItemRef: "ci-approved", businessDate,
      });
      await tx.insert(posSaleItemCostsTable).values({
        saleItemId, productId: product.id, quantity: 1,
        unitCostMinor: 593, costTotalMinor: 593, costQuality: "confirmed",
      });
      await settleDeferredPurchasePosSale(tx, {
        draftPublicId: draft.publicId, productId: product.id,
        purchaseId: draft.id, saleItemIds: [saleItemId],
      });
      await tx.delete(posPurchasesTable).where(eq(posPurchasesTable.id, draft.id));
    });
    const [cost] = await db.select().from(productCostStateTable)
      .where(eq(productCostStateTable.productId, product.id));
    assert.equal(cost.quantityOnHand, 59);
    assert.equal(cost.inventoryValueMinor, 34987);
    const [p] = await db.select().from(productsTable)
      .where(eq(productsTable.id, product.id));
    assert.equal(getProductQuantity(p), 59);
    const [deferred] = await db.select().from(deferredPurchaseSaleCostsTable)
      .where(eq(deferredPurchaseSaleCostsTable.saleItemId, saleItemId));
    assert.equal(deferred.status, "settled");
    const [snapshot] = await db.select().from(posSaleItemCostsTable)
      .where(eq(posSaleItemCostsTable.saleItemId, saleItemId));
    assert.equal(snapshot.costTotalMinor, 593);
    const returnRows = await db.select().from(posSaleReturnItemCostsTable)
      .where(eq(posSaleReturnItemCostsTable.returnItemId, returnItemId));
    assert.equal(returnRows.length, 0);
    assert.equal(await hasPendingDeferredCostForSaleItem(db, saleItemId), false);
    assert.equal((await db.select().from(posPurchasesTable)
      .where(eq(posPurchasesTable.id, draft.id))).length, 0);
  } finally {
    await client.end();
  }
});
