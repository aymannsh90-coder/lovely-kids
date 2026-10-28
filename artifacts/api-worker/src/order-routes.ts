import {
  appSettingsTable,
  deliveryCompaniesTable,
  exchangeDocumentsTable,
  insertOrderSchema,
  ordersTable,
} from "@workspace/db/schema";
import { sql, and, desc, eq, isNull, or } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import {
  createTrustedOrder,
  OrderValidationError,
  resolveShippingZone,
  STORE_PICKUP_LABEL,
  LOCAL_NABLUS_DELIVERY_LABEL,
} from "./order-service";
import {
  cancelOrderAndRestoreStock,
  editOrderItemsAndAdjustStock,
  OrderEditError,
  restoreCancelledOrderAndDeductStock,
} from "./order-stock";
import {
  sendOrderStatusNotification,
  sendNewOrderNotification,
} from "./notification-routes";
import {
  completeOrderWithFinance,
  OrderFinanceError,
} from "./order-finance";
import { rewriteMediaUrlsForPublic } from "./media-url";
import { sendMetaPurchaseEvent } from "./meta-capi";
import {
  mergeOnlineOrders,
  OrderMergeError,
} from "./order-merge";

type Db = Awaited<
  ReturnType<typeof openDb>
>["db"];

// Never include internal courier cost or delivery company ID in customer APIs.
const customerOrderView = (order: typeof ordersTable.$inferSelect) => ({
  ...order,
  deliveryCompanyId: undefined,
  deliveryCompanyCost: undefined,
});

const json = (data: unknown, status = 200) =>
  Response.json(rewriteMediaUrlsForPublic(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });


type MetaAttribution = {
  fbp?: string;
  fbc?: string;
  eventSourceUrl?: string;
};

function normalizeMetaBrowserIdentifier(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    normalized.length > 1024 ||
    !/^fb\.\d+\.\d+\.[^\s]+$/.test(normalized)
  ) {
    return undefined;
  }

  return normalized;
}

function normalizeMetaEventSourceUrl(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    normalized.length > 2048
  ) {
    return undefined;
  }

  try {
    const url = new URL(normalized);

    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:"
    ) {
      return undefined;
    }

    const hostname = url.hostname.toLowerCase();

    const allowed =
      hostname === "lovelykids.net" ||
      hostname.endsWith(".lovelykids.net") ||
      hostname === "lovely-kids.pages.dev" ||
      hostname.endsWith(".lovely-kids.pages.dev");

    if (!allowed) return undefined;

    return url.toString();
  } catch {
    return undefined;
  }
}

function getMetaAttribution(body: unknown): MetaAttribution {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return {};
  }

  const raw = body as Record<string, unknown>;

  return {
    fbp: normalizeMetaBrowserIdentifier(raw.metaFbp),
    fbc: normalizeMetaBrowserIdentifier(raw.metaFbc),
    eventSourceUrl: normalizeMetaEventSourceUrl(
      raw.metaEventSourceUrl,
    ),
  };
}

function createOrderTrackingToken(
  orderId: number,
  customerPhone: string,
  env: Env,
): string | null {
  const secret = env.ORDER_TRACKING_SECRET?.trim();
  if (!secret) return null;

  return createHmac("sha256", secret)
    .update(`${orderId}:${customerPhone}`)
    .digest("hex");
}

function trackingTokensMatch(token: string, expected: string): boolean {
  const tokenBytes = new TextEncoder().encode(token);
  const expectedBytes = new TextEncoder().encode(expected);

  return (
    tokenBytes.length === expectedBytes.length &&
    timingSafeEqual(tokenBytes, expectedBytes)
  );
}

const ORDER_STATUSES = new Set(["new", "confirmed", "delivering", "done", "cancelled"]);
const ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  new: ["new", "confirmed", "cancelled"],
  confirmed: ["new", "confirmed", "delivering", "cancelled"],
  delivering: ["new", "confirmed", "delivering", "done", "cancelled"],
  done: ["done"],
  cancelled: ["confirmed", "delivering"],
};

type AutomaticFulfillmentUpdate = {
  fulfillmentMethod: "delivery" | "pickup";
  deliveryCompanyId: number | null;
  deliveryCompanyCost: number | null;
};

async function getAutomaticFulfillmentUpdate(
  db: Db,
  order: {
    shippingZone: string | null;
    fulfillmentMethod: string | null;
    deliveryCompanyId: number | null;
    deliveryCompanyCost: number | null;
  },
  targetStatus: string,
): Promise<
  | { ok: true; update: AutomaticFulfillmentUpdate | null }
  | { ok: false; error: string }
> {
  if (order.shippingZone === STORE_PICKUP_LABEL) {
    return {
      ok: true,
      update: {
        fulfillmentMethod: "pickup",
        deliveryCompanyId: null,
        deliveryCompanyCost: 0,
      },
    };
  }

  if (!order.shippingZone) {
    return {
      ok: false,
      error: "منطقة التوصيل غير محددة في الطلب",
    };
  }

  if (order.shippingZone === LOCAL_NABLUS_DELIVERY_LABEL) {
    if (
      order.deliveryCompanyCost === null ||
      !Number.isSafeInteger(order.deliveryCompanyCost) ||
      order.deliveryCompanyCost < 0
    ) {
      return {
        ok: false,
        error: "حدد أجرة ديلفري نابلس وتكلفة المندوب مع تأكيد الزبون قبل إرسال الطلب",
      };
    }

    return {
      ok: true,
      update: {
        fulfillmentMethod: "delivery",
        deliveryCompanyId: null,
        deliveryCompanyCost: order.deliveryCompanyCost,
      },
    };
  }

  // عند التسليم نحافظ على Snapshot الشركة الذي تم تثبيته
  // عند إخراج الطلب للتوصيل.
  if (
    targetStatus === "done" &&
    order.fulfillmentMethod === "delivery" &&
    order.deliveryCompanyId !== null &&
    order.deliveryCompanyCost !== null
  ) {
    return {
      ok: true,
      update: null,
    };
  }

  const settingsRows = await db
    .select({ data: appSettingsTable.data })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.id, 1))
    .limit(1);

  let shipping;

  try {
    shipping = resolveShippingZone(
      settingsRows[0]?.data,
      order.shippingZone,
    );
  } catch {
    return {
      ok: false,
      error: "منطقة التوصيل في الطلب غير صالحة",
    };
  }

  const activeCompanies = await db
    .select({
      id: deliveryCompaniesTable.id,
      name: deliveryCompaniesTable.name,
    })
    .from(deliveryCompaniesTable)
    .where(eq(deliveryCompaniesTable.status, "active"))
    .limit(2);

  if (activeCompanies.length === 0) {
    return {
      ok: false,
      error: "يجب تعريف شركة توصيل فعّالة قبل إخراج الطلب للتوصيل",
    };
  }

  if (activeCompanies.length > 1) {
    return {
      ok: false,
      error: "يوجد أكثر من شركة توصيل فعّالة. اترك شركة واحدة فعّالة فقط",
    };
  }

  const company = activeCompanies[0];

  if (!company) {
    return {
      ok: false,
      error: "تعذر تحديد شركة التوصيل",
    };
  }

  return {
    ok: true,
    update: {
      fulfillmentMethod: "delivery",
      deliveryCompanyId: company.id,

      // Snapshot للتكلفة الفعلية لشركة التوصيل وقت إخراج الطلب.
      // لا نستخدم cost ولا promoCost هنا إلا كـfallback للبيانات القديمة
      // التي لم يكن فيها companyCost بعد.
      deliveryCompanyCost:
        shipping.companyCost ??
        shipping.cost,
    },
  };
}


const orderOwnerWhere = (userId: number, phone?: string | null) =>
  phone
    ? or(
        eq(ordersTable.userId, userId),
        and(isNull(ordersTable.userId), eq(ordersTable.customerPhone, phone)),
      )
    : eq(ordersTable.userId, userId);

async function handleMergeOrders(
  request: Request,
  db: Db,
  env: Env,
) {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  if (!user.isAdmin) {
    return json({ error: "غير مصرح" }, 403);
  }

  const body = await request
    .json()
    .catch(() => null) as
    | { orderIds?: unknown }
    | null;

  try {
    const merged =
      await mergeOnlineOrders(
        db,
        body?.orderIds,
        user.id,
      );

    return json(merged, 201);
  } catch (error) {
    if (error instanceof OrderMergeError) {
      return json(
        { error: error.message },
        error.status,
      );
    }

    console.error(
      "MERGE_ORDERS_FAILED",
      error,
    );

    return json(
      { error: "تعذر دمج الطلبات" },
      500,
    );
  }
}

async function getOrderMergeRelation(
  db: Db,
  id: number,
) {
  const rows = await db
    .select({
      id: ordersTable.id,
      mergedIntoOrderId:
        ordersTable.mergedIntoOrderId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  const order = rows[0];

  if (!order) {
    return {
      exists: false as const,
      mergedIntoOrderId: null,
      hasMergedChildren: false,
    };
  }

  const childRows = await db
    .select({
      id: ordersTable.id,
    })
    .from(ordersTable)
    .where(
      eq(
        ordersTable.mergedIntoOrderId,
        id,
      ),
    )
    .limit(1);

  return {
    exists: true as const,
    mergedIntoOrderId:
      order.mergedIntoOrderId,
    hasMergedChildren:
      childRows.length > 0,
  };
}

async function handleCreateOrder(
  request: Request,
  db: Db,
  env: Env,
  options: {
    manualPos?: boolean;
  } = {},
) {
  const body = await request.json().catch(() => null);
  const metaAttribution = getMetaAttribution(body);
  const clientRequestId =
    request.headers
      .get("Idempotency-Key")
      ?.trim() || null;
  const parsed = insertOrderSchema.safeParse(body);

  if (!parsed.success) {
    return json(
      {
        error: "بيانات غير صالحة",
        details: parsed.error.issues,
      },
      400,
    );
  }

  try {
    const authUser = await getCurrentUser(
      db,
      request,
      env,
    );

    if (
      options.manualPos &&
      (
        !authUser ||
        (!authUser.isAdmin && !authUser.isOwner)
      )
    ) {
      return json(
        { error: "غير مصرح بإنشاء طلب يدوي" },
        403,
      );
    }

    const creation = await createTrustedOrder(
      db,
      {
        userId:
          options.manualPos
            ? null
            : authUser?.id ?? null,
        clientRequestId,
        customerName: parsed.data.customerName,
        customerPhone:
          options.manualPos
            ? parsed.data.customerPhone
            : (
                authUser?.phone ??
                parsed.data.customerPhone
              ),
        customerAddress:
          parsed.data.customerAddress,
        notes: parsed.data.notes,
        shippingZone: parsed.data.shippingZone,
        paymentMethod: parsed.data.paymentMethod,
        discountCode:
          parsed.data.discountCode,
        items: parsed.data.items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          size: item.size,
          color: item.color,
          rewardForPromotionId:
            item.rewardForPromotionId,
        })),
      },
    );

    const newOrder =
      creation.order;

    if (
      creation.created &&
      !options.manualPos
    ) {
      try {
        const metaResult =
        await sendMetaPurchaseEvent(
          env,
          request,
          {
            orderId: newOrder.id,
            customerName: newOrder.customerName,
            customerPhone: newOrder.customerPhone,
            totalPrice: newOrder.totalPrice,
            fbp: metaAttribution.fbp,
            fbc: metaAttribution.fbc,
            eventSourceUrl:
              metaAttribution.eventSourceUrl,
            items: parsed.data.items.map((item) => ({
              id: item.id,
              quantity: item.quantity,
            })),
          },
        );

      console.log("META_CAPI_PURCHASE", {
        orderId: newOrder.id,
        ...metaResult,
      });
      } catch (metaError) {
        console.error("META_CAPI_PURCHASE_FAILED", {
        orderId: newOrder.id,
        error:
          metaError instanceof Error
            ? metaError.message
            : String(metaError),
      });
      }

      try {
        const notificationResult =
        await sendNewOrderNotification(db, env, {
          id: newOrder.id,
          customerName: newOrder.customerName,
          totalPrice: newOrder.totalPrice,
        });

      console.log(
        "NEW_ORDER_NOTIFICATION",
        notificationResult,
      );
      } catch (notificationError) {
        console.error(
          "NEW_ORDER_NOTIFICATION_FAILED",
        notificationError,
      );
      }
    }

    const trackingToken = createOrderTrackingToken(
      newOrder.id,
      newOrder.customerPhone,
      env,
    );

    return json(
      trackingToken
        ? { ...newOrder, trackingToken }
        : newOrder,
      creation.created ? 201 : 200,
    );
  } catch (error) {
    if (error instanceof OrderValidationError) {
      return json(
        { error: error.message },
        400,
      );
    }

    console.error("CREATE_ORDER_FAILED", error);

    return json(
      { error: "تعذر إنشاء الطلب، حاول مرة أخرى" },
      500,
    );
  }
}

async function handleGetOrders(
  request: Request,
  db: Db,
  env: Env,
) {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  if (!user.isAdmin) {
    return json({ error: "غير مصرح" }, 403);
  }

  const orders = await db
    .select()
    .from(ordersTable)
    .orderBy(desc(ordersTable.createdAt));

  const exchangeLinks =
    await db
      .select({
        replacementOrderId:
          exchangeDocumentsTable.replacementOrderId,
        originalOrderId:
          exchangeDocumentsTable.originalOrderId,
        publicId:
          exchangeDocumentsTable.publicId,
        replacementOrderOrigin:
          exchangeDocumentsTable.replacementOrderOrigin,
        returnNetMinor:
          exchangeDocumentsTable.returnNetMinor,
        newNetMinor:
          exchangeDocumentsTable.newNetMinor,
        differenceMinor:
          exchangeDocumentsTable.differenceMinor,
        deliveryChargeMinor:
          exchangeDocumentsTable.deliveryChargeMinor,
        settlementAmountMinor:
          exchangeDocumentsTable.settlementAmountMinor,
        financialCompletedAt:
          exchangeDocumentsTable.financialCompletedAt,
        returnReceivedAt:
          exchangeDocumentsTable.returnReceivedAt,
      })
      .from(exchangeDocumentsTable)
      .where(
        and(
          eq(
            exchangeDocumentsTable.sourceType,
            "online_order",
          ),
          eq(
            exchangeDocumentsTable.status,
            "completed",
          ),
        ),
      );

  const exchangeByReplacement =
    new Map(
      exchangeLinks
        .filter(
          (row) =>
            row.replacementOrderId !== null &&
            row.originalOrderId !== null,
        )
        .map((row) => [
          row.replacementOrderId!,
          row,
        ]),
    );

  const mergedOrderIdsByMaster =
    new Map<number, number[]>();

  for (const order of orders) {
    if (
      order.mergedIntoOrderId === null
    ) {
      continue;
    }

    const current =
      mergedOrderIdsByMaster.get(
        order.mergedIntoOrderId,
      ) ?? [];

    current.push(order.id);

    mergedOrderIdsByMaster.set(
      order.mergedIntoOrderId,
      current,
    );
  }

  return json(
    orders.map((order) => {
      const linkedExchange =
        exchangeByReplacement.get(order.id);

      const mergedOrderIds =
        mergedOrderIdsByMaster.get(
          order.id,
        ) ?? [];

      return {
        ...order,
        mergedOrderIds,
        mergedOrderCount:
          mergedOrderIds.length,
        exchangeOriginalOrderId:
          linkedExchange?.originalOrderId ?? null,
        exchangePublicId:
          linkedExchange?.publicId ?? null,
        exchangeReplacementOrderOrigin:
          linkedExchange?.replacementOrderOrigin ?? null,
        exchangeReturnNetMinor:
          linkedExchange?.returnNetMinor ?? null,
        exchangeNewNetMinor:
          linkedExchange?.newNetMinor ?? null,
        exchangeDifferenceMinor:
          linkedExchange?.differenceMinor ?? null,
        exchangeDeliveryChargeMinor:
          linkedExchange?.deliveryChargeMinor ?? null,
        exchangeSettlementAmountMinor:
          linkedExchange?.settlementAmountMinor ?? null,
        exchangeFinancialCompletedAt:
          linkedExchange?.financialCompletedAt?.toISOString() ?? null,
        exchangeReturnReceivedAt:
          linkedExchange?.returnReceivedAt?.toISOString() ?? null,
      };
    }),
  );
}

async function handleLookupOrder(
  request: Request,
  db: Db,
  env: Env,
) {
  const body = await request.json().catch(() => null) as {
    orderId?: number;
    customerPhone?: string;
  } | null;

  const orderId = Number(body?.orderId);
  const customerPhone = body?.customerPhone?.trim() ?? "";

  if (
    !Number.isInteger(orderId) ||
    orderId <= 0 ||
    customerPhone.length === 0
  ) {
    return json({ error: "بيانات البحث غير صالحة" }, 400);
  }

  const rows = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.id, orderId),
        eq(ordersTable.customerPhone, customerPhone),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  const order = rows[0];

  if (
    order.mergedIntoOrderId !== null
  ) {
    const masterRows = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(
            ordersTable.id,
            order.mergedIntoOrderId,
          ),
          eq(
            ordersTable.customerPhone,
            customerPhone,
          ),
        ),
      )
      .limit(1);

    if (masterRows[0]) {
      const master = masterRows[0];
      const trackingToken =
        createOrderTrackingToken(
          master.id,
          master.customerPhone,
          env,
        );

      return json({
        ...customerOrderView(master),
        mergedFromOrderId:
          order.id,
        ...(trackingToken
          ? { trackingToken }
          : {}),
      });
    }
  }

  const trackingToken =
    createOrderTrackingToken(
      order.id,
      order.customerPhone,
      env,
    );

  return json({
    ...customerOrderView(order),
    ...(trackingToken
      ? { trackingToken }
      : {}),
  });
}

async function handleTrackOrder(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const token =
    new URL(request.url).searchParams.get("token")?.trim() ?? "";

  if (!Number.isInteger(id) || id <= 0 || token.length === 0) {
    return json({ error: "رابط المتابعة غير صالح" }, 400);
  }

  const rows = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  const order = rows[0];

  if (!order) {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  const expected = createOrderTrackingToken(
    order.id,
    order.customerPhone,
    env,
  );

  if (!expected) {
    return json({ error: "خدمة متابعة الطلب غير مفعلة" }, 503);
  }

  if (!trackingTokensMatch(token, expected)) {
    return json({ error: "رابط المتابعة غير صالح" }, 403);
  }

  if (
    order.mergedIntoOrderId !== null
  ) {
    const masterRows = await db
      .select()
      .from(ordersTable)
      .where(
        eq(
          ordersTable.id,
          order.mergedIntoOrderId,
        ),
      )
      .limit(1);

    const master =
      masterRows[0];

    if (master) {
      const masterToken =
        createOrderTrackingToken(
          master.id,
          master.customerPhone,
          env,
        );

      return json({
        ...customerOrderView(master),
        mergedFromOrderId:
          order.id,
        ...(masterToken
          ? {
              trackingToken:
                masterToken,
            }
          : {}),
      });
    }
  }

  return json(customerOrderView(order));
}

async function handleGetMyOrders(
  request: Request,
  db: Db,
  env: Env,
) {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  const orders = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        orderOwnerWhere(
          user.id,
          user.phone,
        ),
        isNull(
          ordersTable.mergedIntoOrderId,
        ),
      ),
    )
    .orderBy(desc(ordersTable.createdAt));

  return json(orders.map(customerOrderView));
}

async function handleMarkOrderPrinted(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  if (!user.isAdmin) {
    return json({ error: "غير مصرح" }, 403);
  }

  const updated = await db
    .update(ordersTable)
    .set({
      printedAt: new Date(),
      printCount: sql`${ordersTable.printCount} + 1`,
    })
    .where(eq(ordersTable.id, id))
    .returning();

  if (!updated[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  return json(updated[0]);
}

export async function handleOrderRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "POST" &&
    path === "/api/orders/manual"
  ) {
    return handleCreateOrder(
      request,
      db,
      env,
      { manualPos: true },
    );
  }

  if (
    request.method === "POST" &&
    path === "/api/orders"
  ) {
    return handleCreateOrder(request, db, env);
  }

  if (
    request.method === "POST" &&
    path === "/api/orders/merge"
  ) {
    return handleMergeOrders(
      request,
      db,
      env,
    );
  }

  if (
    request.method === "POST" &&
    path === "/api/orders/lookup"
  ) {
    return handleLookupOrder(
      request,
      db,
      env,
    );
  }

  const trackingMatch = path.match(
    /^\/api\/orders\/(\d+)\/track$/,
  );

  if (
    request.method === "GET" &&
    trackingMatch
  ) {
    return handleTrackOrder(
      request,
      db,
      env,
      Number(trackingMatch[1]),
    );
  }

  if (
    request.method === "GET" &&
    path === "/api/orders/my"
  ) {
    return handleGetMyOrders(request, db, env);
  }

  if (
    request.method === "GET" &&
    path === "/api/orders"
  ) {
    return handleGetOrders(request, db, env);
  }

  const printMatch = path.match(
    /^\/api\/orders\/(\d+)\/print$/,
  );

  if (
    request.method === "PATCH" &&
    printMatch
  ) {
    return handleMarkOrderPrinted(
      request,
      db,
      env,
      Number(printMatch[1]),
    );
  }

  const paymentProofMatch = path.match(
    /^\/api\/orders\/(\d+)\/payment-proof$/,
  );

  if (
    request.method === "PATCH" &&
    paymentProofMatch
  ) {
    return handlePaymentProof(
      request,
      db,
      env,
      Number(paymentProofMatch[1]),
    );
  }

  const confirmPaymentMatch = path.match(
    /^\/api\/orders\/(\d+)\/confirm-payment$/,
  );

  if (
    request.method === "PATCH" &&
    confirmPaymentMatch
  ) {
    return handleConfirmPayment(
      request,
      db,
      env,
      Number(confirmPaymentMatch[1]),
    );
  }

  const customerEditItemsMatch = path.match(
    /^\/api\/orders\/(\d+)\/customer-items$/,
  );

  if (
    request.method === "PATCH" &&
    customerEditItemsMatch
  ) {
    return handleCustomerEditOrderItems(
      request,
      db,
      env,
      Number(customerEditItemsMatch[1]),
    );
  }

  const editItemsMatch = path.match(
    /^\/api\/orders\/(\d+)\/items$/,
  );

  if (
    request.method === "PATCH" &&
    editItemsMatch
  ) {
    return handleEditOrderItems(
      request,
      db,
      env,
      Number(editItemsMatch[1]),
    );
  }

  const storePickupMatch = path.match(
    /^\/api\/orders\/(\d+)\/store-pickup$/,
  );

  if (
    request.method === "PATCH" &&
    storePickupMatch
  ) {
    return handleConvertOrderToStorePickup(
      request,
      db,
      env,
      Number(storePickupMatch[1]),
    );
  }

  const statusMatch = path.match(
    /^\/api\/orders\/(\d+)\/status$/,
  );

  if (
    request.method === "PATCH" &&
    statusMatch
  ) {
    return handleUpdateOrderStatus(
      request,
      db,
      env,
      Number(statusMatch[1]),
    );
  }

  const cancelMatch = path.match(
    /^\/api\/orders\/(\d+)\/cancel$/,
  );

  if (
    request.method === "PATCH" &&
    cancelMatch
  ) {
    return handleCancelOrder(
      request,
      db,
      env,
      Number(cancelMatch[1]),
    );
  }

  const orderMatch = path.match(
    /^\/api\/orders\/(\d+)$/,
  );

  if (
    request.method === "DELETE" &&
    orderMatch
  ) {
    return handleDeleteOrder(
      request,
      db,
      env,
      Number(orderMatch[1]),
    );
  }

  return null;
}

async function handleCustomerEditOrderItems(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const body = await request.json().catch(() => null) as
    | {
        items?: unknown;
        trackingToken?: unknown;
      }
    | null;

  if (!body || body.items === undefined) {
    return json({ error: "المنتجات مطلوبة" }, 400);
  }

  const currentRows = await db
    .select({
      id: ordersTable.id,
      status: ordersTable.status,
      userId: ordersTable.userId,
      customerPhone: ordersTable.customerPhone,
      mergedIntoOrderId:
        ordersTable.mergedIntoOrderId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  const current = currentRows[0];

  if (!current) {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  const mergeRelation =
    await getOrderMergeRelation(
      db,
      id,
    );

  if (
    current.mergedIntoOrderId !== null
  ) {
    return json(
      {
        error:
          `هذا الطلب مدمج داخل الطلب #${current.mergedIntoOrderId} ولا يمكن تعديله منفردًا`,
      },
      409,
    );
  }

  if (
    mergeRelation.hasMergedChildren
  ) {
    return json(
      {
        error:
          "لا يمكن تعديل الطلب بعد دمجه مع طلبات أخرى",
      },
      409,
    );
  }

  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  const ownerAccess =
    !!user &&
    (
      current.userId === user.id ||
      (
        current.userId === null &&
        !!user.phone &&
        current.customerPhone === user.phone
      )
    );

  const providedTrackingToken =
    typeof body.trackingToken === "string"
      ? body.trackingToken.trim()
      : "";

  const expectedTrackingToken =
    createOrderTrackingToken(
      current.id,
      current.customerPhone,
      env,
    );

  const trackingAccess =
    !!providedTrackingToken &&
    !!expectedTrackingToken &&
    trackingTokensMatch(
      providedTrackingToken,
      expectedTrackingToken,
    );

  if (!ownerAccess && !trackingAccess) {
    return json(
      { error: "لا يمكنك تعديل هذا الطلب" },
      403,
    );
  }

  if (current.status !== "new") {
    return json(
      {
        error:
          "تم تأكيد الطلب أو بدأت معالجته ولم يعد بالإمكان تعديله",
      },
      409,
    );
  }

  // Never trust prices or order details supplied by the customer.
  // Customer editing is limited to product, variant, size and quantity.
  const safeItems =
    Array.isArray(body.items)
      ? body.items.map((raw) => {
          if (
            !raw ||
            typeof raw !== "object" ||
            Array.isArray(raw)
          ) {
            return raw;
          }

          const item =
            raw as Record<string, unknown>;

          return {
            id:
              item.id ??
              item.productId,
            quantity:
              item.quantity,
            color:
              item.color,
            size:
              item.size,
          };
        })
      : body.items;

  try {
    const updated =
      await editOrderItemsAndAdjustStock(
        db,
        id,
        safeItems,
        undefined,
        user?.id ?? null,
        {
          allowedStatuses: ["new"],
          preserveExistingProductPrice: true,
          restrictToPublicCatalog: true,
        },
      );

    return json(customerOrderView(updated));
  } catch (error) {
    if (error instanceof OrderEditError) {
      return json(
        { error: error.message },
        error.status,
      );
    }

    console.error(
      "Customer edit order items failed:",
      error,
    );

    return json(
      { error: "تعذر تعديل الطلب" },
      500,
    );
  }
}

async function handleEditOrderItems(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  if (!user.isAdmin) {
    return json({ error: "غير مصرح" }, 403);
  }

  const mergeRelation =
    await getOrderMergeRelation(
      db,
      id,
    );

  if (!mergeRelation.exists) {
    return json(
      { error: "الطلب غير موجود" },
      404,
    );
  }

  if (
    mergeRelation.mergedIntoOrderId !==
    null
  ) {
    return json(
      {
        error:
          `هذا الطلب مدمج داخل الطلب #${mergeRelation.mergedIntoOrderId} ولا يمكن تعديله منفردًا`,
      },
      409,
    );
  }

  if (
    mergeRelation.hasMergedChildren
  ) {
    return json(
      {
        error:
          "لا يمكن تعديل أصناف الطلب الرئيسي بعد الدمج حتى تبقى حركة المخزون والتقارير محفوظة",
      },
      409,
    );
  }

  const body = await request.json().catch(() => null) as
    | {
        items?: unknown;
        customerName?: unknown;
        customerPhone?: unknown;
        customerAddress?: unknown;
        shippingZone?: unknown;
        notes?: unknown;
        invoiceDiscount?: unknown;
        paymentMethod?: unknown;
        exchangeDeliveryDiscountMode?: unknown;
        exchangeManualDeliveryDiscountMinor?: unknown;
        localDeliveryCharge?: unknown;
        localDeliveryCourierCost?: unknown;
      }
    | null;

  if (!body || body.items === undefined) {
    return json({ error: "المنتجات مطلوبة" }, 400);
  }

  try {
    const updated = await editOrderItemsAndAdjustStock(
      db,
      id,
      body.items,
      {
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        customerAddress: body.customerAddress,
        shippingZone: body.shippingZone,
        notes: body.notes,
        invoiceDiscount: body.invoiceDiscount,
        paymentMethod: body.paymentMethod,
        exchangeDeliveryDiscountMode: body.exchangeDeliveryDiscountMode,
        exchangeManualDeliveryDiscountMinor: body.exchangeManualDeliveryDiscountMinor,
        localDeliveryCharge: body.localDeliveryCharge,
        localDeliveryCourierCost: body.localDeliveryCourierCost,
      },
      user.id,
    );

    return json(updated);
  } catch (error) {
    if (error instanceof OrderEditError) {
      return json({ error: error.message }, error.status);
    }

    console.error("Edit order items failed:", error);
    return json({ error: "تعذر تعديل الطلب" }, 500);
  }
}

async function handleCancelOrder(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  const current = await db
    .select({
      status: ordersTable.status,
      userId: ordersTable.userId,
      customerPhone: ordersTable.customerPhone,
      mergedIntoOrderId:
        ordersTable.mergedIntoOrderId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  if (!current[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  if (
    current[0].mergedIntoOrderId !==
    null
  ) {
    return json(
      {
        error:
          `هذا الطلب مدمج داخل الطلب #${current[0].mergedIntoOrderId}`,
      },
      409,
    );
  }

  if (
    !user.isAdmin &&
    current[0].userId !== user.id &&
    (
      current[0].userId !== null ||
      !user.phone ||
      current[0].customerPhone !== user.phone
    )
  ) {
    return json(
      { error: "لا يمكنك إلغاء طلب لا يخص حسابك" },
      403,
    );
  }

  const status = current[0].status;

  if (status !== "new") {
    const messages: Record<string, string> = {
      confirmed: "لا يمكن إلغاء الطلب بعد تأكيده",
      delivering: "لا يمكن إلغاء الطلب وهو قيد التوصيل",
      done: "لا يمكن إلغاء الطلب بعد تسليمه",
      cancelled: "الطلب ملغى مسبقاً",
    };

    return json(
      {
        error:
          messages[status] ??
          "لا يمكن إلغاء هذا الطلب",
      },
      400,
    );
  }

  let result: Awaited<ReturnType<typeof cancelOrderAndRestoreStock>>;
  try {
    result = await cancelOrderAndRestoreStock(db, id, ["new"], user.id);
  } catch (error) {
    if (error instanceof OrderEditError) {
      return json({ error: error.message }, error.status);
    }
    throw error;
  }

  if (result.kind === "not_found") {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  if (result.kind === "invalid_status") {
    return json({ error: "لا يمكن إلغاء هذا الطلب" }, 409);
  }

  return json(user.isAdmin ? result.order : customerOrderView(result.order));
}

async function handleConvertOrderToStorePickup(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  if (!user.isAdmin) {
    return json({ error: "غير مصرح" }, 403);
  }

  const rows = await db
    .select({
      id: ordersTable.id,
      status: ordersTable.status,
      shippingZone: ordersTable.shippingZone,
      shippingCost: ordersTable.shippingCost,
      totalPrice: ordersTable.totalPrice,
      mergedIntoOrderId:
        ordersTable.mergedIntoOrderId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  const order = rows[0];

  if (!order) {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  if (
    order.mergedIntoOrderId !== null
  ) {
    return json(
      {
        error:
          `هذا الطلب مدمج داخل الطلب #${order.mergedIntoOrderId}`,
      },
      409,
    );
  }

  if (order.status === "done" || order.status === "cancelled") {
    return json(
      { error: "لا يمكن تعديل طريقة استلام طلب مكتمل أو ملغي" },
      409,
    );
  }

  if (order.shippingZone === "استلام من المحل") {
    const current = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, id))
      .limit(1);

    return json(current[0]);
  }

  const oldShippingCost =
    typeof order.shippingCost === "number" && order.shippingCost > 0
      ? order.shippingCost
      : 0;

  const newTotal = Math.max(0, order.totalPrice - oldShippingCost);

  const updated = await db
    .update(ordersTable)
    .set({
      shippingZone: "استلام من المحل",
      shippingCost: 0,
      shippingOriginalCost: 0,
      shippingPromotionDiscount: 0,
      fulfillmentMethod: "pickup",
      deliveryCompanyId: null,
      deliveryCompanyCost: 0,
      totalPrice: newTotal,
      customerAddress: "استلام من المحل",
    })
    .where(eq(ordersTable.id, id))
    .returning();

  return json(updated[0]);
}

async function handleUpdateOrderStatus(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  if (!user.isAdmin) {
    return json({ error: "غير مصرح" }, 403);
  }

  const body = await request.json().catch(() => null) as {
    status?: string;
    pickupSettlementMethod?:
      | "cash"
      | "card";
    cardProcessor?:
      | "arab"
      | "bop";
  } | null;

  if (!body?.status) {
    return json({ error: "الحالة مطلوبة" }, 400);
  }

  if (!ORDER_STATUSES.has(body.status)) {
    return json({ error: "حالة الطلب غير صالحة" }, 400);
  }

  const current = await db
    .select({
      id: ordersTable.id,
      status: ordersTable.status,
      customerPhone: ordersTable.customerPhone,
      shippingZone: ordersTable.shippingZone,
      fulfillmentMethod: ordersTable.fulfillmentMethod,
      deliveryCompanyId: ordersTable.deliveryCompanyId,
      deliveryCompanyCost: ordersTable.deliveryCompanyCost,
      paymentMethod: ordersTable.paymentMethod,
      mergedIntoOrderId:
        ordersTable.mergedIntoOrderId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  if (!current[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  if (
    current[0].mergedIntoOrderId !==
    null
  ) {
    return json(
      {
        error:
          `هذا الطلب مدمج داخل الطلب #${current[0].mergedIntoOrderId}`,
      },
      409,
    );
  }

  const isPickup =
    current[0].shippingZone === STORE_PICKUP_LABEL ||
    current[0].fulfillmentMethod === "pickup";

  if (
    isPickup &&
    body.status === "delivering"
  ) {
    return json(
      {
        error:
          "طلب الاستلام من المحل لا يمر بحالة قيد التوصيل",
      },
      409,
    );
  }

  const allowed =
    ORDER_TRANSITIONS[
      current[0].status
    ] ?? [];

  const pickupDirectDone =
    isPickup &&
    current[0].status === "confirmed" &&
    body.status === "done";

  if (
    !allowed.includes(body.status) &&
    !pickupDirectDone
  ) {
    return json(
      {
        error:
          "لا يمكن نقل الطلب إلى هذه الحالة",
      },
      409,
    );
  }

  let fulfillmentUpdate: AutomaticFulfillmentUpdate | null = null;

  if (
    body.status === "delivering" ||
    body.status === "done"
  ) {
    const fulfillment =
      await getAutomaticFulfillmentUpdate(
        db,
        current[0],
        body.status,
      );

    if (!fulfillment.ok) {
      return json(
        { error: fulfillment.error },
        409,
      );
    }

    fulfillmentUpdate = fulfillment.update;
  }

  if (
    body.status === "done" &&
    current[0].status !== "done"
  ) {
    try {
      let pickupSettlement:
        | {
            method: "cash";
          }
        | {
            method: "card";
            cardProcessor:
              | "arab"
              | "bop";
          }
        | null = null;

      if (
        isPickup &&
        current[0].paymentMethod === "cod"
      ) {
        if (
          body.pickupSettlementMethod ===
          "cash"
        ) {
          pickupSettlement = {
            method: "cash",
          };
        } else if (
          body.pickupSettlementMethod ===
          "card"
        ) {
          if (
            body.cardProcessor !== "arab" &&
            body.cardProcessor !== "bop"
          ) {
            return json(
              {
                error:
                  "اختر ماكينة الفيزا: البنك العربي أو بنك فلسطين",
              },
              400,
            );
          }

          pickupSettlement = {
            method: "card",
            cardProcessor:
              body.cardProcessor,
          };
        } else {
          return json(
            {
              error:
                "اختر طريقة الدفع عند الاستلام: نقدي أو فيزا",
            },
            400,
          );
        }
      }

      const updatedOrder =
        await completeOrderWithFinance(
          db,
          id,
          user.id,
          fulfillmentUpdate,
          pickupSettlement,
        );

      if (current[0].customerPhone) {
        try {
          await sendOrderStatusNotification(
            db,
            env,
            id,
            current[0].customerPhone,
            "done",
            isPickup
              ? "pickup"
              : "delivery",
          );
        } catch (error) {
          console.error(
            "Order status notification failed:",
            error,
          );
        }
      }

      return json(updatedOrder);
    } catch (error) {
      if (error instanceof OrderFinanceError) {
        return json(
          { error: error.message },
          error.status,
        );
      }

      console.error(
        "Complete order finance failed:",
        error,
      );

      return json(
        {
          error:
            isPickup
              ? "تعذر تسجيل استلام الطلب من المحل محاسبيًا"
              : "تعذر تسجيل تسليم الطلب محاسبيًا",
        },
        500,
      );
    }
  }

  if (
    current[0].status === "cancelled" &&
    body.status !== "cancelled"
  ) {
    try {
      const restoredOrder =
        await restoreCancelledOrderAndDeductStock(
          db,
          id,
          body.status,
          user.id,
        );

      const updatedOrder = fulfillmentUpdate
        ? (
            await db
              .update(ordersTable)
              .set(fulfillmentUpdate)
              .where(eq(ordersTable.id, id))
              .returning()
          )[0] ?? restoredOrder
        : restoredOrder;

      if (current[0].customerPhone) {
        try {
          await sendOrderStatusNotification(
            db,
            env,
            id,
            current[0].customerPhone,
            body.status,
          );
        } catch (error) {
          console.error(
            "Order status notification failed:",
            error,
          );
        }
      }

      return json(updatedOrder);
    } catch (error) {
      if (error instanceof OrderEditError) {
        return json(
          { error: error.message },
          error.status,
        );
      }

      console.error(
        "Restore cancelled order failed:",
        error,
      );

      return json(
        { error: "تعذر إعادة تفعيل الطلب" },
        500,
      );
    }
  }

  if (body.status === "cancelled") {
    let result: Awaited<ReturnType<typeof cancelOrderAndRestoreStock>>;
    try {
      result = await cancelOrderAndRestoreStock(
        db,
        id,
        ["new", "confirmed", "delivering"],
        user.id,
      );
    } catch (error) {
      if (error instanceof OrderEditError) {
        return json({ error: error.message }, error.status);
      }
      throw error;
    }

    if (result.kind === "not_found") {
      return json({ error: "الطلب غير موجود" }, 404);
    }

    if (result.kind === "invalid_status") {
      return json({ error: "لا يمكن إلغاء الطلب بهذه الحالة" }, 409);
    }

    if (current[0].customerPhone) {
      try {
        await sendOrderStatusNotification(db, env, id, current[0].customerPhone, "cancelled");
      } catch (error) {
        console.error("Order status notification failed:", error);
      }
    }

    return json(result.order);
  }


  const updated = await db
    .update(ordersTable)
    .set({
      status: body.status,
      ...(fulfillmentUpdate ?? {}),
    })
    .where(eq(ordersTable.id, id))
    .returning();

  if (!updated[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  if (body.status !== current[0].status && current[0].customerPhone) {
    try {
      await sendOrderStatusNotification(
        db,
        env,
        id,
        current[0].customerPhone,
        body.status,
      );
    } catch (error) {
      console.error("Order status notification failed:", error);
    }
  }

  return json(updated[0]);
}

async function handlePaymentProof(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  const body = await request.json().catch(() => null) as {
    paymentProof?: string;
    customerPhone?: string;
  } | null;

  const paymentProof = body?.paymentProof;

  if (
    !paymentProof ||
    !paymentProof.startsWith("data:image/") ||
    paymentProof.length > 8_000_000
  ) {
    return json(
      { error: "صورة الوصل غير صالحة أو كبيرة جدًا" },
      400,
    );
  }

  const current = await db
    .select({
      userId: ordersTable.userId,
      customerPhone: ordersTable.customerPhone,
      paymentMethod: ordersTable.paymentMethod,
      status: ordersTable.status,
      paymentStatus: ordersTable.paymentStatus,
      mergedIntoOrderId:
        ordersTable.mergedIntoOrderId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  if (!current[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  if (
    current[0].mergedIntoOrderId !== null
  ) {
    return json(
      {
        error:
          `هذا الطلب مدمج داخل الطلب #${current[0].mergedIntoOrderId}`,
      },
      409,
    );
  }

  const guestPhone = body?.customerPhone?.trim() ?? "";

  const canAccess =
    user?.isAdmin === true ||
    (user ? current[0].userId === user.id : false) ||
    (
      !!user?.phone &&
      current[0].userId === null &&
      current[0].customerPhone === user.phone
    ) ||
    (
      !user &&
      current[0].userId === null &&
      guestPhone.length > 0 &&
      current[0].customerPhone === guestPhone
    );

  if (!canAccess) {
    return json(
      { error: "لا يمكنك تعديل هذا الطلب" },
      403,
    );
  }

  if (current[0].paymentMethod !== "bank_transfer") {
    return json(
      { error: "هذا الطلب لا يستخدم التحويل البنكي" },
      400,
    );
  }
  if (current[0].paymentStatus === "confirmed") {
    return json({ error: "تم تأكيد الدفع ولا يمكن تعديل الوصل" }, 409);
  }
  if (current[0].status === "cancelled" || current[0].status === "done") {
    return json({ error: "لا يمكن تعديل وصل هذا الطلب" }, 409);
  }





  const updated = await db
    .update(ordersTable)
    .set({
      paymentProof,
      paymentStatus: "proof_submitted",
    })
    .where(eq(ordersTable.id, id))
    .returning();

  if (!updated[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  return json(updated[0]);
}

async function handleConfirmPayment(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  if (!user.isAdmin) {
    return json({ error: "غير مصرح" }, 403);
  }

  const current = await db
    .select({
      status: ordersTable.status,
      paymentMethod: ordersTable.paymentMethod,
      paymentStatus: ordersTable.paymentStatus,
      customerPhone: ordersTable.customerPhone,
      mergedIntoOrderId:
        ordersTable.mergedIntoOrderId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  if (!current[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  if (
    current[0].mergedIntoOrderId !== null
  ) {
    return json(
      {
        error:
          `هذا الطلب مدمج داخل الطلب #${current[0].mergedIntoOrderId}`,
      },
      409,
    );
  }

  if (current[0].paymentMethod !== "bank_transfer") {
    return json({ error: "هذا الطلب لا يستخدم التحويل البنكي" }, 400);
  }

  if (current[0].status === "cancelled" || current[0].status === "done") {
    return json({ error: "لا يمكن تأكيد دفع هذا الطلب" }, 409);
  }


  if (current[0].status !== "new" && current[0].status !== "confirmed") {
    return json({ error: "حالة الطلب لا تسمح بتأكيد الدفع" }, 409);
  }

  const updated = await db
    .update(ordersTable)
    .set({
      paymentStatus: "confirmed",
      status: "confirmed",
    })
    .where(eq(ordersTable.id, id))
    .returning();

  if (!updated[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  if (current[0].status !== "confirmed" && current[0].customerPhone) {
    try {
      await sendOrderStatusNotification(
        db,
        env,
        id,
        current[0].customerPhone,
        "confirmed",
      );
    } catch (error) {
      console.error("Order status notification failed:", error);
    }
  }

  return json(updated[0]);
}

async function handleDeleteOrder(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  if (!user.isAdmin) {
    return json({ error: "غير مصرح" }, 403);
  }

  const current = await db
    .select({
      status: ordersTable.status,
      mergedIntoOrderId:
        ordersTable.mergedIntoOrderId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  if (!current[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  if (
    current[0].mergedIntoOrderId !== null
  ) {
    return json(
      {
        error:
          `هذا الطلب جزء من طلب مدمج #${current[0].mergedIntoOrderId} ولا يمكن حذفه`,
      },
      409,
    );
  }

  const mergedChildren = await db
    .select({
      id: ordersTable.id,
    })
    .from(ordersTable)
    .where(
      eq(
        ordersTable.mergedIntoOrderId,
        id,
      ),
    )
    .limit(1);

  if (mergedChildren[0]) {
    return json(
      {
        error:
          "لا يمكن حذف الطلب الرئيسي المدمج لأن الطلبات الأصلية مرتبطة به",
      },
      409,
    );
  }

  if (current[0].status !== "cancelled" && current[0].status !== "done") {
    return json({ error: "يجب إلغاء الطلب أو إكماله قبل حذفه" }, 409);
  }

  const deleted = await db
    .delete(ordersTable)
    .where(eq(ordersTable.id, id))
    .returning();

  if (!deleted[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });
}
