import {
  insertOrderSchema,
  ordersTable,
} from "@workspace/db/schema";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import {
  createTrustedOrder,
  OrderValidationError,
} from "./order-service";
import { cancelOrderAndRestoreStock } from "./order-stock";
import {
  sendOrderStatusNotification,
  sendNewOrderNotification,
} from "./notification-routes";

type Db = Awaited<
  ReturnType<typeof openDb>
>["db"];

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });

const ORDER_STATUSES = new Set(["new", "confirmed", "delivering", "done", "cancelled"]);
const ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  new: ["new", "confirmed", "cancelled"],
  confirmed: ["new", "confirmed", "delivering", "cancelled"],
  delivering: ["new", "confirmed", "delivering", "done", "cancelled"],
  done: ["done"],
  cancelled: ["cancelled"],
};


const orderOwnerWhere = (userId: number, phone?: string | null) =>
  phone
    ? or(
        eq(ordersTable.userId, userId),
        and(isNull(ordersTable.userId), eq(ordersTable.customerPhone, phone)),
      )
    : eq(ordersTable.userId, userId);

async function handleCreateOrder(
  request: Request,
  db: Db,
  env: Env,
) {
  const body = await request.json().catch(() => null);
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

    if (!authUser) {
      return json({ error: "يجب تسجيل الدخول لإتمام الطلب" }, 401);
    }

    const newOrder = await createTrustedOrder(
      db,
      {
        userId: authUser?.id ?? null,
        customerName: parsed.data.customerName,
        customerPhone:
          authUser?.phone ??
          parsed.data.customerPhone,
        customerAddress:
          parsed.data.customerAddress,
        notes: parsed.data.notes,
        shippingZone: parsed.data.shippingZone,
        paymentMethod: parsed.data.paymentMethod,
        items: parsed.data.items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          size: item.size,
          color: item.color,
        })),
      },
    );

    try {
      const notificationResult =
        await sendNewOrderNotification(db, {
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

    return json(newOrder, 201);
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

  return json(orders);
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
    .where(orderOwnerWhere(user.id, user.phone))
    .orderBy(desc(ordersTable.createdAt));

  return json(orders);
}

export async function handleOrderRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "POST" &&
    path === "/api/orders"
  ) {
    return handleCreateOrder(request, db, env);
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
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  if (!current[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
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

  const result = await cancelOrderAndRestoreStock(
    db,
    id,
    ["new"],
  );

  if (result.kind === "not_found") {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  if (result.kind === "invalid_status") {
    return json({ error: "لا يمكن إلغاء هذا الطلب" }, 409);
  }

  return json(result.order);
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
  } | null;

  if (!body?.status) {
    return json({ error: "الحالة مطلوبة" }, 400);
  }

  if (!ORDER_STATUSES.has(body.status)) {
    return json({ error: "حالة الطلب غير صالحة" }, 400);
  }

  const current = await db
    .select({ id: ordersTable.id, status: ordersTable.status, customerPhone: ordersTable.customerPhone })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  if (!current[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
  }

  const allowed = ORDER_TRANSITIONS[current[0].status] ?? [];

  if (!allowed.includes(body.status)) {
    return json({ error: "لا يمكن نقل الطلب إلى هذه الحالة" }, 409);
  }

  if (body.status === "cancelled") {
    const result = await cancelOrderAndRestoreStock(db, id, ["new", "confirmed", "delivering"]);

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
    .set({ status: body.status })
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

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  const body = await request.json().catch(() => null) as {
    paymentProof?: string;
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
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  if (!current[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
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
      { error: "لا يمكنك تعديل طلب لا يخص حسابك" },
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
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  if (!current[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
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
    .select({ status: ordersTable.status })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  if (!current[0]) {
    return json({ error: "الطلب غير موجود" }, 404);
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
