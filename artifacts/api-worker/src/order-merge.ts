import {
  appSettingsTable,
  exchangeDocumentsTable,
  orderItemCostsTable,
  orderPromotionsTable,
  ordersTable,
  securityAuditLogsTable,
} from "@workspace/db/schema";
import {
  asc,
  eq,
  inArray,
  or,
} from "drizzle-orm";

import type { openDb } from "./db";
import {
  resolveShippingCost,
  resolveShippingZone,
  STORE_PICKUP_LABEL,
  LOCAL_NABLUS_DELIVERY_LABEL,
} from "./order-service";

type Db = Awaited<
  ReturnType<typeof openDb>
>["db"];

type StoredOrderItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  rewardForPromotionId?: number;
  promotionDiscountMinor?: number;
  promotionAllocations?: Array<{
    promotionId: number;
    promotionName: string;
    groupKey: string;
    discountMinor: number;
  }>;
  invoiceDiscountMinor?: number;
  image?: string;
  size?: string;
  color?: string;
};

export class OrderMergeError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function normalizePhoneIdentity(value: string) {
  const digits = value
    .replace(/[^0-9]/g, "")
    .replace(/^00/, "");

  return digits.length >= 9
    ? digits.slice(-9)
    : digits;
}

function parseStoredItems(
  value: unknown,
  orderId: number,
): StoredOrderItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new OrderMergeError(
      `الطلب #${orderId} لا يحتوي منتجات صالحة للدمج`,
      409,
    );
  }

  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new OrderMergeError(
        `بيانات الصنف رقم ${index + 1} في الطلب #${orderId} غير صالحة`,
        409,
      );
    }

    const item = raw as Record<string, unknown>;
    const id = String(item.id ?? "");
    const name = String(item.name ?? "");
    const price = Number(item.price);
    const quantity = Number(item.quantity);

    if (
      !id ||
      !name ||
      !Number.isSafeInteger(price) ||
      price < 0 ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0
    ) {
      throw new OrderMergeError(
        `بيانات الصنف رقم ${index + 1} في الطلب #${orderId} غير صالحة`,
        409,
      );
    }

    const invoiceDiscountMinor =
      item.invoiceDiscountMinor === undefined
        ? undefined
        : Number(item.invoiceDiscountMinor);

    const promotionDiscountMinor =
      item.promotionDiscountMinor === undefined
        ? undefined
        : Number(item.promotionDiscountMinor);

    if (
      invoiceDiscountMinor !== undefined &&
      (
        !Number.isSafeInteger(invoiceDiscountMinor) ||
        invoiceDiscountMinor < 0
      )
    ) {
      throw new OrderMergeError(
        `خصم الصنف رقم ${index + 1} في الطلب #${orderId} غير صالح`,
        409,
      );
    }

    if (
      promotionDiscountMinor !== undefined &&
      (
        !Number.isSafeInteger(promotionDiscountMinor) ||
        promotionDiscountMinor < 0 ||
        promotionDiscountMinor >
          price * quantity * 100
      )
    ) {
      throw new OrderMergeError(
        `خصم العرض للصنف رقم ${index + 1} في الطلب #${orderId} غير صالح`,
        409,
      );
    }

    const rewardForPromotionId =
      item.rewardForPromotionId === undefined
        ? undefined
        : Number(item.rewardForPromotionId);

    if (
      rewardForPromotionId !== undefined &&
      (
        !Number.isSafeInteger(rewardForPromotionId) ||
        rewardForPromotionId <= 0
      )
    ) {
      throw new OrderMergeError(
        `بيانات مكافأة الصنف رقم ${index + 1} في الطلب #${orderId} غير صالحة`,
        409,
      );
    }

    const promotionAllocations =
      Array.isArray(item.promotionAllocations)
        ? item.promotionAllocations
            .map((rawAllocation) => {
              if (
                !rawAllocation ||
                typeof rawAllocation !== "object" ||
                Array.isArray(rawAllocation)
              ) {
                return null;
              }

              const allocation =
                rawAllocation as Record<string, unknown>;

              const promotionId =
                Number(allocation.promotionId);
              const discountMinor =
                Number(allocation.discountMinor);
              const promotionName =
                typeof allocation.promotionName === "string"
                  ? allocation.promotionName.trim()
                  : "";
              const groupKey =
                typeof allocation.groupKey === "string"
                  ? allocation.groupKey.trim()
                  : "";

              if (
                !Number.isSafeInteger(promotionId) ||
                promotionId <= 0 ||
                !promotionName ||
                !groupKey ||
                !Number.isSafeInteger(discountMinor) ||
                discountMinor < 0
              ) {
                return null;
              }

              return {
                promotionId,
                promotionName,
                groupKey,
                discountMinor,
              };
            })
            .filter(
              (
                allocation,
              ): allocation is NonNullable<typeof allocation> =>
                allocation !== null,
            )
        : undefined;

    return {
      id,
      name,
      price,
      quantity,
      ...(rewardForPromotionId === undefined
        ? {}
        : { rewardForPromotionId }),
      ...(promotionDiscountMinor === undefined
        ? {}
        : { promotionDiscountMinor }),
      ...(promotionAllocations === undefined
        ? {}
        : { promotionAllocations }),
      ...(invoiceDiscountMinor === undefined
        ? {}
        : { invoiceDiscountMinor }),
      ...(typeof item.image === "string"
        ? { image: item.image }
        : {}),
      ...(typeof item.size === "string"
        ? { size: item.size }
        : {}),
      ...(typeof item.color === "string"
        ? { color: item.color }
        : {}),
    };
  });
}

function allocateDiscountMinor(
  items: StoredOrderItem[],
  discountMinor: number,
): number[] {
  if (discountMinor === 0) {
    return items.map(() => 0);
  }

  const grossMinorByLine = items.map((item) => {
    const grossMinor =
      item.price *
      item.quantity *
      100 -
      (item.promotionDiscountMinor ?? 0);

    if (!Number.isSafeInteger(grossMinor) || grossMinor < 0) {
      throw new OrderMergeError(
        "تعذر احتساب قيمة منتجات الطلب المدمج",
        409,
      );
    }

    return grossMinor;
  });

  const totalGrossMinor = grossMinorByLine.reduce(
    (sum, value) => sum + value,
    0,
  );

  if (
    !Number.isSafeInteger(totalGrossMinor) ||
    totalGrossMinor <= 0 ||
    discountMinor > totalGrossMinor
  ) {
    throw new OrderMergeError(
      "تعذر توزيع خصم الطلب المدمج",
      409,
    );
  }

  let remaining = discountMinor;

  return grossMinorByLine.map((grossMinor, index) => {
    if (index === grossMinorByLine.length - 1) {
      return remaining;
    }

    const allocated = Math.min(
      grossMinor,
      Math.floor(
        (discountMinor * grossMinor) /
          totalGrossMinor,
      ),
    );

    remaining -= allocated;
    return allocated;
  });
}

function appendMergeNote(
  current: string | null,
  line: string,
) {
  const clean = current?.trim() ?? "";

  return clean
    ? `${clean}\n${line}`
    : line;
}

export async function mergeOnlineOrders(
  db: Db,
  rawOrderIds: unknown,
  actorUserId: number,
) {
  if (!Array.isArray(rawOrderIds)) {
    throw new OrderMergeError(
      "اختر طلبين أو أكثر للدمج",
    );
  }

  const orderIds = Array.from(
    new Set(
      rawOrderIds.map((value) => Number(value)),
    ),
  );

  if (
    orderIds.length < 2 ||
    orderIds.length > 10 ||
    orderIds.some(
      (id) =>
        !Number.isSafeInteger(id) ||
        id <= 0,
    )
  ) {
    throw new OrderMergeError(
      "يمكن دمج من طلبين إلى 10 طلبات في العملية الواحدة",
    );
  }

  return db.transaction(async (tx) => {
    const orders = await tx
      .select()
      .from(ordersTable)
      .where(inArray(ordersTable.id, orderIds))
      .orderBy(asc(ordersTable.id))
      .for("update");

    if (orders.length !== orderIds.length) {
      throw new OrderMergeError(
        "أحد الطلبات المحددة غير موجود",
        404,
      );
    }

    for (const order of orders) {
      if (
        order.mergedIntoOrderId !== null ||
        order.status === "merged"
      ) {
        throw new OrderMergeError(
          `الطلب #${order.id} مدمج مسبقًا`,
          409,
        );
      }

      if (
        order.status !== "new" &&
        order.status !== "confirmed"
      ) {
        throw new OrderMergeError(
          `الطلب #${order.id} حالته لا تسمح بالدمج. الدمج متاح للجديد أو المؤكد فقط.`,
          409,
        );
      }

      if (order.paymentMethod !== "cod") {
        throw new OrderMergeError(
          "الدمج الحالي متاح لطلبات الدفع عند الاستلام فقط",
          409,
        );
      }
    }

    const exchangeLinks = await tx
      .select({
        id: exchangeDocumentsTable.id,
      })
      .from(exchangeDocumentsTable)
      .where(
        or(
          inArray(
            exchangeDocumentsTable.originalOrderId,
            orderIds,
          ),
          inArray(
            exchangeDocumentsTable.replacementOrderId,
            orderIds,
          ),
        ),
      )
      .limit(1);

    if (exchangeLinks[0]) {
      throw new OrderMergeError(
        "لا يمكن دمج طلب مرتبط بعملية تبديل",
        409,
      );
    }

    const phoneIdentity =
      normalizePhoneIdentity(
        orders[0]!.customerPhone,
      );

    if (
      !phoneIdentity ||
      orders.some(
        (order) =>
          normalizePhoneIdentity(
            order.customerPhone,
          ) !== phoneIdentity,
      )
    ) {
      throw new OrderMergeError(
        "يجب أن تكون الطلبات لنفس رقم هاتف الزبون",
        409,
      );
    }

    const shippingZone =
      orders[0]!.shippingZone?.trim() ??
      "";

    if (
      !shippingZone ||
      orders.some(
        (order) =>
          (order.shippingZone?.trim() ?? "") !==
          shippingZone,
      )
    ) {
      throw new OrderMergeError(
        "يجب أن تكون جميع الطلبات على نفس منطقة التوصيل أو نفس طريقة الاستلام",
        409,
      );
    }

    if (shippingZone === LOCAL_NABLUS_DELIVERY_LABEL) {
      throw new OrderMergeError(
        "دمج طلبات ديلفري نابلس غير مسموح حتى لا تضيع التسعيرات اليدوية للمندوب",
        409,
      );
    }

    const settingsRows = await tx
      .select({
        data: appSettingsTable.data,
      })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.id, 1))
      .limit(1);

    const settingsData =
      settingsRows[0]?.data;

    let shipping;

    try {
      shipping = resolveShippingZone(
        settingsData,
        shippingZone,
      );
    } catch {
      throw new OrderMergeError(
        "منطقة التوصيل في الطلبات غير صالحة",
        409,
      );
    }

    const sourceCostRows = await tx
      .select()
      .from(orderItemCostsTable)
      .where(
        inArray(
          orderItemCostsTable.orderId,
          orderIds,
        ),
      )
      .orderBy(
        asc(orderItemCostsTable.orderId),
        asc(orderItemCostsTable.lineNumber),
      );

    const costByOrderLine =
      new Map(
        sourceCostRows.map((row) => [
          `${row.orderId}:${row.lineNumber}`,
          row,
        ]),
      );

    const sourcePromotionRows =
      await tx
        .select()
        .from(orderPromotionsTable)
        .where(
          inArray(
            orderPromotionsTable.orderId,
            orderIds,
          ),
        )
        .orderBy(
          asc(orderPromotionsTable.orderId),
          asc(orderPromotionsTable.id),
        );

    const mergedItems: StoredOrderItem[] = [];
    const mergedCostRows: Array<{
      lineNumber: number;
      productId: number;
      color: string | null;
      size: string | null;
      quantity: number;
      unitCostMinor: number;
      costTotalMinor: number;
      costQuality: string;
    }> = [];

    const sourceProductNetById =
      new Map<number, number>();

    let mergedProductsNet = 0;
    let mergedPromotionDiscountMinor = 0;
    let nextLineNumber = 1;

    for (const order of orders) {
      const items = parseStoredItems(
        order.items,
        order.id,
      );

      const productsGross =
        items.reduce(
          (sum, item) => {
            const lineTotal =
              item.price *
              item.quantity;

            if (
              !Number.isSafeInteger(lineTotal) ||
              lineTotal < 0
            ) {
              throw new OrderMergeError(
                `إجمالي منتجات الطلب #${order.id} غير صالح`,
                409,
              );
            }

            const next = sum + lineTotal;

            if (!Number.isSafeInteger(next)) {
              throw new OrderMergeError(
                `إجمالي منتجات الطلب #${order.id} غير صالح`,
                409,
              );
            }

            return next;
          },
          0,
        );

      const sourceShipping =
        order.shippingCost ?? 0;

      if (
        !Number.isSafeInteger(sourceShipping) ||
        sourceShipping < 0 ||
        !Number.isSafeInteger(order.totalPrice) ||
        order.totalPrice < sourceShipping
      ) {
        throw new OrderMergeError(
          `إجمالي الطلب #${order.id} غير صالح للدمج`,
          409,
        );
      }

      const productsNet =
        order.totalPrice -
        sourceShipping;

      const discount =
        productsGross -
        productsNet;

      if (
        !Number.isSafeInteger(discount) ||
        discount < 0 ||
        discount > productsGross
      ) {
        throw new OrderMergeError(
          `خصم الطلب #${order.id} غير صالح للدمج`,
          409,
        );
      }

      const expectedDiscountMinor =
        discount * 100;

      const sourcePromotionDiscountMinor =
        items.reduce(
          (sum, item) =>
            sum +
            (item.promotionDiscountMinor ?? 0),
          0,
        );

      if (
        sourcePromotionDiscountMinor >
        expectedDiscountMinor
      ) {
        throw new OrderMergeError(
          `خصم العرض في الطلب #${order.id} أكبر من الخصم الفعلي`,
          409,
        );
      }

      const expectedInvoiceDiscountMinor =
        expectedDiscountMinor -
        sourcePromotionDiscountMinor;

      const currentInvoiceDiscountMinor =
        items.reduce(
          (sum, item) =>
            sum +
            (item.invoiceDiscountMinor ?? 0),
          0,
        );

      const discountAllocations =
        currentInvoiceDiscountMinor ===
        expectedInvoiceDiscountMinor
          ? items.map(
              (item) =>
                item.invoiceDiscountMinor ??
                0,
            )
          : allocateDiscountMinor(
              items,
              expectedInvoiceDiscountMinor,
            );

      mergedPromotionDiscountMinor +=
        sourcePromotionDiscountMinor;

      if (
        !Number.isSafeInteger(
          mergedPromotionDiscountMinor,
        )
      ) {
        throw new OrderMergeError(
          "إجمالي خصومات العروض في الطلب المدمج غير صالح",
          409,
        );
      }

      sourceProductNetById.set(
        order.id,
        productsNet,
      );

      mergedProductsNet +=
        productsNet;

      if (
        !Number.isSafeInteger(
          mergedProductsNet,
        )
      ) {
        throw new OrderMergeError(
          "إجمالي الطلبات المدمجة أكبر من الحد المسموح",
          409,
        );
      }

      items.forEach(
        (item, index) => {
          const lineNumber =
            nextLineNumber++;

          mergedItems.push({
            ...item,
            invoiceDiscountMinor:
              discountAllocations[index] ??
              0,
          });

          const cost =
            costByOrderLine.get(
              `${order.id}:${index + 1}`,
            );

          if (cost) {
            mergedCostRows.push({
              lineNumber,
              productId:
                cost.productId,
              color:
                cost.color,
              size:
                cost.size,
              quantity:
                cost.quantity,
              unitCostMinor:
                cost.unitCostMinor,
              costTotalMinor:
                cost.costTotalMinor,
              costQuality:
                cost.costQuality,
            });
          }
        },
      );
    }

    const hasNonStackingDiscount =
      orders.some(
        (order) =>
          typeof order.discountCode === "string" &&
          order.discountCode.trim().length > 0 &&
          order.discountCodeStacksWithShippingPromotion ===
            false,
      ) ||
      sourcePromotionRows.some(
        (row) => {
          const snapshot =
            typeof row.snapshot === "object" &&
            row.snapshot !== null
              ? row.snapshot as Record<string, unknown>
              : {};

          return (
            snapshot.stackWithShippingPromotion ===
            false
          );
        },
      );

    const mergedShippingCost =
      shipping.label ===
      STORE_PICKUP_LABEL
        ? 0
        : hasNonStackingDiscount
          ? shipping.cost
          : resolveShippingCost(
              settingsData,
              shipping,
              mergedProductsNet,
            );

    const shippingOriginalCost =
      shipping.label ===
      STORE_PICKUP_LABEL
        ? 0
        : shipping.cost;

    const shippingPromotionDiscount =
      Math.max(
        0,
        shippingOriginalCost -
          mergedShippingCost,
      );

    const mergedTotal =
      mergedProductsNet +
      mergedShippingCost;

    if (
      !Number.isSafeInteger(mergedTotal) ||
      mergedTotal < 0
    ) {
      throw new OrderMergeError(
        "إجمالي الطلب المدمج غير صالح",
        409,
      );
    }

    const detailSource =
      orders[orders.length - 1]!;

    const sourceIdsLabel =
      orders
        .map((order) => `#${order.id}`)
        .join("، ");

    const mergedAt =
      new Date();

    const masterRows = await tx
      .insert(ordersTable)
      .values({
        userId:
          detailSource.userId,
        customerName:
          detailSource.customerName,
        customerPhone:
          detailSource.customerPhone,
        customerAddress:
          detailSource.customerAddress,
        items:
          mergedItems,
        totalPrice:
          mergedTotal,
        shippingZone:
          shipping.label,
        shippingCost:
          mergedShippingCost,
        shippingOriginalCost,
        shippingPromotionDiscount,
        promotionDiscountAmount:
          mergedPromotionDiscountMinor /
          100,

        // The source orders keep their original coupon snapshots
        // for campaign reporting. The master preserves the actual
        // line-level discounts instead of attributing all merged
        // merchandise to a single coupon.
        discountCodeId: null,
        discountCode: null,
        discountCodeLabel: null,
        discountCodePercent: null,
        discountCodeAmount: null,
        discountCodeStacksWithShippingPromotion: null,

        fulfillmentMethod:
          shipping.label ===
          STORE_PICKUP_LABEL
            ? "pickup"
            : null,
        deliveryCompanyId: null,
        deliveryCompanyCost:
          shipping.label ===
          STORE_PICKUP_LABEL
            ? 0
            : null,

        status:
          orders.some(
            (order) =>
              order.status ===
              "confirmed",
          )
            ? "confirmed"
            : "new",
        notes:
          appendMergeNote(
            detailSource.notes,
            `طلب مدمج من الطلبات: ${sourceIdsLabel}`,
          ),
        paymentMethod: "cod",
        paymentStatus: "pending",
        paymentProof: null,
      })
      .returning();

    const master =
      masterRows[0];

    if (!master) {
      throw new Error(
        "ORDER_MERGE_MASTER_INSERT_FAILED",
      );
    }

    if (
      mergedPromotionDiscountMinor %
        100 !==
      0
    ) {
      throw new OrderMergeError(
        "خصم العرض في الطلب المدمج يجب أن يبقى بقيمة شيكل كاملة",
        409,
      );
    }

    if (
      sourcePromotionRows.length >
      0
    ) {
      await tx
        .insert(orderPromotionsTable)
        .values(
          sourcePromotionRows.map(
            (row) => {
              const snapshot =
                typeof row.snapshot === "object" &&
                row.snapshot !== null
                  ? row.snapshot as Record<string, unknown>
                  : {};

              return {
                orderId:
                  master.id,
                promotionId:
                  row.promotionId,
                promotionName:
                  row.promotionName,
                promotionKind:
                  row.promotionKind,
                discountMinor:
                  row.discountMinor,
                applicationCount:
                  row.applicationCount,
                snapshot: {
                  ...snapshot,
                  mergedFromOrderId:
                    row.orderId,
                },
              };
            },
          ),
        );
    }

    if (mergedCostRows.length > 0) {
      await tx
        .insert(orderItemCostsTable)
        .values(
          mergedCostRows.map(
            (row) => ({
              orderId:
                master.id,
              lineNumber:
                row.lineNumber,
              productId:
                row.productId,
              color:
                row.color,
              size:
                row.size,
              quantity:
                row.quantity,
              unitCostMinor:
                row.unitCostMinor,
              costTotalMinor:
                row.costTotalMinor,
              costQuality:
                row.costQuality,
            }),
          ),
        );
    }

    for (const order of orders) {
      const sourceProductsNet =
        sourceProductNetById.get(
          order.id,
        );

      if (
        sourceProductsNet ===
        undefined
      ) {
        throw new Error(
          "ORDER_MERGE_SOURCE_TOTAL_MISSING",
        );
      }

      await tx
        .update(ordersTable)
        .set({
          status:
            "merged",
          mergedIntoOrderId:
            master.id,
          mergedAt,
          mergedByUserId:
            actorUserId,

          // These source orders are no longer separate shipments.
          // Keep merchandise/coupon snapshots for audit and campaign
          // reporting, but move all delivery charging to the master.
          totalPrice:
            sourceProductsNet,
          shippingCost: 0,
          shippingOriginalCost: 0,
          shippingPromotionDiscount: 0,
          fulfillmentMethod: null,
          deliveryCompanyId: null,
          deliveryCompanyCost: null,
          notes:
            appendMergeNote(
              order.notes,
              `تم دمج هذا الطلب في الطلب الرئيسي #${master.id}`,
            ),
        })
        .where(
          eq(
            ordersTable.id,
            order.id,
          ),
        );
    }

    await tx
      .insert(
        securityAuditLogsTable,
      )
      .values({
        actorUserId,
        targetUserId:
          detailSource.userId,
        action:
          "online_orders_merged",
        details: {
          masterOrderId:
            master.id,
          sourceOrderIds:
            orders.map(
              (order) =>
                order.id,
            ),
          customerPhone:
            detailSource.customerPhone,
          shippingZone:
            shipping.label,
          mergedProductsNet,
          mergedShippingCost,
          mergedTotal,
        },
      });

    return {
      ...master,
      mergedOrderIds:
        orders.map(
          (order) =>
            order.id,
        ),
      mergedOrderCount:
        orders.length,
    };
  });
}
