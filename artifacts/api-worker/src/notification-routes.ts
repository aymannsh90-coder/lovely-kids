import {
  expoPushReceiptsTable,
  ordersTable,
  productsTable,
  pushTokensTable,
  stockNotificationSubscriptionsTable,
  webPushSubscriptionsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import webpush from "web-push";
import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";

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

async function requireAdmin(
  request: Request,
  db: Db,
  env: Env,
) {
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  if (!user.isAdmin) {
    return json({ error: "غير مصرح" }, 403);
  }

  return null;
}

function configureWebPush(env: Env) {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();

  if (!publicKey || !privateKey || !subject) return false;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

function isValidExpoPushToken(token: string) {
  return /^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]+\]$/.test(
    token,
  );
}

async function resolveNotificationPhone(
  db: Db,
  user: { phone?: string | null } | null | undefined,
  requestedPhone: string,
  requestedOrderId: number,
): Promise<{ ok: true; phone: string | null } | { ok: false }> {
  const accountPhone = user?.phone?.trim();

  if (accountPhone) {
    return { ok: true, phone: accountPhone };
  }

  if (!requestedPhone) {
    return { ok: true, phone: null };
  }

  if (
    !Number.isInteger(requestedOrderId) ||
    requestedOrderId <= 0
  ) {
    return { ok: false };
  }

  const rows = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.id, requestedOrderId),
        eq(ordersTable.customerPhone, requestedPhone),
        isNull(ordersTable.userId),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    return { ok: false };
  }

  return { ok: true, phone: requestedPhone };
}

async function handleRegisterToken(
  request: Request,
  db: Db,
  env: Env,
) {
  const body = await request
    .json()
    .catch(() => null) as {
      token?: unknown;
      phone?: unknown;
      orderId?: unknown;
    } | null;

  if (
    !body ||
    typeof body.token !== "string"
  ) {
    return json({ error: "التوكن مطلوب" }, 400);
  }

  const token = body.token.trim();

  if (
    token.length > 512 ||
    !isValidExpoPushToken(token)
  ) {
    return json(
      { error: "توكن الإشعارات غير صالح" },
      400,
    );
  }

  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  const requestedPhone =
    typeof body.phone === "string"
      ? body.phone.trim()
      : "";

  const requestedOrderId =
    typeof body.orderId === "number"
      ? body.orderId
      : Number(body.orderId);

  const resolvedPhone = await resolveNotificationPhone(
    db,
    user,
    requestedPhone,
    requestedOrderId,
  );

  if (!resolvedPhone.ok) {
    return json(
      { error: "تعذر ربط الإشعارات بهذا الطلب" },
      403,
    );
  }

  const phone = resolvedPhone.phone;

  await db
    .insert(pushTokensTable)
    .values({
      token,
      phone,
      isAdmin: user?.isAdmin ?? false,
    })
    .onConflictDoUpdate({
      target: pushTokensTable.token,
      set: {
        phone,
        isAdmin: user?.isAdmin ?? false,
      },
    });

  return json({ success: true }, 201);
}

async function handleRegisterWebPush(request: Request, db: Db, env: Env) {
  const body = await request.json().catch(() => null) as {
    endpoint?: unknown;
    p256dh?: unknown;
    auth?: unknown;
    phone?: unknown;
    orderId?: unknown;
  } | null;

  if (
    !body ||
    typeof body.endpoint !== "string" ||
    typeof body.p256dh !== "string" ||
    typeof body.auth !== "string"
  ) {
    return json({ error: "بيانات الاشتراك غير صالحة" }, 400);
  }

  const user = await getCurrentUser(db, request, env);

  const requestedPhone =
    typeof body.phone === "string"
      ? body.phone.trim()
      : "";

  const requestedOrderId =
    typeof body.orderId === "number"
      ? body.orderId
      : Number(body.orderId);

  const resolvedPhone = await resolveNotificationPhone(
    db,
    user,
    requestedPhone,
    requestedOrderId,
  );

  if (!resolvedPhone.ok) {
    return json(
      { error: "تعذر ربط الإشعارات بهذا الطلب" },
      403,
    );
  }

  const phone = resolvedPhone.phone;

  await db.insert(webPushSubscriptionsTable).values({
    endpoint: body.endpoint,
    p256dh: body.p256dh,
    auth: body.auth,
    phone,
    isAdmin: user?.isAdmin ?? false,
  }).onConflictDoUpdate({
    target: webPushSubscriptionsTable.endpoint,
    set: {
      p256dh: body.p256dh,
      auth: body.auth,
      phone,
      isAdmin: user?.isAdmin ?? false,
    },
  });

  return json({ success: true }, 201);
}

async function sendWebPush(
  env: Env,
  subscription: { endpoint: string; p256dh: string; auth: string },
  title: string,
  body: string,
  url = "/",
) {
  if (!configureWebPush(env)) {
    return { ok: false, expired: false };
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify({ title, body, url }),
    );

    return { ok: true, expired: false };
  } catch (error) {
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error
        ? Number(error.statusCode)
        : 0;

    return {
      ok: false,
      expired: statusCode === 404 || statusCode === 410,
    };
  }
}

function handleWebPushPublicKey(env: Env) {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();

  if (!publicKey) {
    return json({ error: "Web Push غير مهيأ" }, 503);
  }

  return json({ publicKey });
}

async function handleTokenCount(
  request: Request,
  db: Db,
  env: Env,
) {
  const denied = await requireAdmin(request, db, env);
  if (denied) return denied;

  const rows = await db
    .select({ id: pushTokensTable.id })
    .from(pushTokensTable);

  const webRows = await db
    .select({ id: webPushSubscriptionsTable.id })
    .from(webPushSubscriptionsTable);

  return json({
    count: rows.length + webRows.length,
    expoCount: rows.length,
    webCount: webRows.length,
  });
}

function chunk<T>(
  items: T[],
  size: number,
): T[][] {
  const result: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }

  return result;
}

type ExpoPushTicket = {
  status?: string;
  id?: string;
  details?: { error?: string };
};

async function recordExpoPushTickets(
  db: Db,
  tokens: string[],
  tickets: ExpoPushTicket[],
) {
  const rows = tickets.flatMap((ticket, index) => {
    const token = tokens[index];

    if (
      ticket?.status !== "ok" ||
      !ticket.id ||
      !token
    ) {
      return [];
    }

    return [{
      ticketId: ticket.id,
      token,
    }];
  });

  if (rows.length === 0) return;

  await db
    .insert(expoPushReceiptsTable)
    .values(rows)
    .onConflictDoNothing({
      target: expoPushReceiptsTable.ticketId,
    });
}

export async function processExpoPushReceipts(
  db: Db,
) {
  const cutoff =
    new Date(Date.now() - 15 * 60 * 1000);

  const pending = await db
    .select({
      ticketId: expoPushReceiptsTable.ticketId,
      token: expoPushReceiptsTable.token,
    })
    .from(expoPushReceiptsTable)
    .where(
      lte(
        expoPushReceiptsTable.createdAt,
        cutoff,
      ),
    )
    .limit(1000);

  if (pending.length === 0) {
    return {
      checked: 0,
      removedInvalidTokens: 0,
      pending: 0,
    };
  }

  const receiptResponse = await fetch(
    "https://exp.host/--/api/v2/push/getReceipts",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ids: pending.map((row) => row.ticketId),
      }),
    },
  );

  if (!receiptResponse.ok) {
    throw new Error(
      `Expo receipt lookup failed: HTTP ${receiptResponse.status}`,
    );
  }

  const receiptData = await receiptResponse
    .json()
    .catch(() => null) as {
      data?: Record<
        string,
        {
          status?: string;
          message?: string;
          details?: { error?: string };
        }
      >;
    } | null;

  const receipts =
    receiptData?.data ?? {};

  const handledTicketIds: string[] = [];
  const invalidTokens: string[] = [];

  for (const row of pending) {
    const receipt =
      receipts[row.ticketId];

    if (!receipt) continue;

    handledTicketIds.push(
      row.ticketId,
    );

    if (
      receipt.status === "error" &&
      receipt.details?.error ===
        "DeviceNotRegistered"
    ) {
      invalidTokens.push(
        row.token,
      );
    }
  }

  const uniqueInvalidTokens = [
    ...new Set(invalidTokens),
  ];

  if (
    uniqueInvalidTokens.length > 0
  ) {
    await db
      .delete(pushTokensTable)
      .where(
        inArray(
          pushTokensTable.token,
          uniqueInvalidTokens,
        ),
      );
  }

  if (
    handledTicketIds.length > 0
  ) {
    await db
      .delete(expoPushReceiptsTable)
      .where(
        inArray(
          expoPushReceiptsTable.ticketId,
          handledTicketIds,
        ),
      );
  }

  return {
    checked:
      handledTicketIds.length,
    removedInvalidTokens:
      uniqueInvalidTokens.length,
    pending:
      pending.length -
      handledTicketIds.length,
  };
}

async function handleSubscribeStockNotification(
  request: Request,
  db: Db,
) {
  const body = await request
    .json()
    .catch(() => null) as {
      productId?: unknown;
      color?: unknown;
      size?: unknown;
      channel?: unknown;
      target?: unknown;
    } | null;

  const productId =
    typeof body?.productId === "number"
      ? body.productId
      : Number(body?.productId);

  const color =
    typeof body?.color === "string" &&
    body.color.trim()
      ? body.color.trim()
      : null;

  const size =
    typeof body?.size === "string" &&
    body.size.trim()
      ? body.size.trim()
      : null;

  const channel =
    body?.channel === "expo" ||
    body?.channel === "web"
      ? body.channel
      : null;

  const target =
    typeof body?.target === "string"
      ? body.target.trim()
      : "";

  if (
    !Number.isSafeInteger(productId) ||
    productId <= 0 ||
    !channel ||
    !target ||
    target.length > 2048 ||
    (!!color !== !!size)
  ) {
    return json(
      { error: "بيانات تنبيه التوفر غير صالحة" },
      400,
    );
  }

  if (
    channel === "expo" &&
    !isValidExpoPushToken(target)
  ) {
    return json(
      { error: "توكن الإشعارات غير صالح" },
      400,
    );
  }

  const registeredTarget =
    channel === "expo"
      ? await db
          .select({ id: pushTokensTable.id })
          .from(pushTokensTable)
          .where(
            eq(
              pushTokensTable.token,
              target,
            ),
          )
          .limit(1)
      : await db
          .select({
            id: webPushSubscriptionsTable.id,
          })
          .from(webPushSubscriptionsTable)
          .where(
            eq(
              webPushSubscriptionsTable.endpoint,
              target,
            ),
          )
          .limit(1);

  if (!registeredTarget[0]) {
    return json(
      {
        error:
          "فعّل الإشعارات أولًا ثم حاول مرة أخرى",
      },
      403,
    );
  }

  const productRows = await db
    .select({
      id: productsTable.id,
      stock: productsTable.stock,
      colorVariants:
        productsTable.colorVariants,
    })
    .from(productsTable)
    .where(
      eq(
        productsTable.id,
        productId,
      ),
    )
    .limit(1);

  const product =
    productRows[0];

  if (!product) {
    return json(
      { error: "المنتج غير موجود" },
      404,
    );
  }

  const variants =
    (product.colorVariants as Array<{
      color: string;
      sizes?: Array<{
        size: string;
        stock?: number | null;
        outOfStock?: boolean;
      }>;
    }> | null) ?? [];

  const alreadyAvailable =
    color && size
      ? (
          variants
            .find(
              (variant) =>
                variant.color === color,
            )
            ?.sizes?.find(
              (entry) =>
                entry.size === size,
            )
            ?.stock ?? 0
        ) > 0
      : variants.length > 0
        ? variants.some((variant) =>
            (variant.sizes ?? []).some(
              (entry) =>
                (entry.stock ?? 0) > 0 &&
                entry.outOfStock !== true,
            ),
          )
        : (product.stock ?? 0) > 0;

  if (alreadyAvailable) {
    return json({
      success: true,
      alreadyAvailable: true,
    });
  }

  const existing = await db
    .select({
      id:
        stockNotificationSubscriptionsTable.id,
      color:
        stockNotificationSubscriptionsTable.color,
      size:
        stockNotificationSubscriptionsTable.size,
    })
    .from(
      stockNotificationSubscriptionsTable,
    )
    .where(
      and(
        eq(
          stockNotificationSubscriptionsTable.productId,
          productId,
        ),
        eq(
          stockNotificationSubscriptionsTable.channel,
          channel,
        ),
        eq(
          stockNotificationSubscriptionsTable.target,
          target,
        ),
      ),
    );

  const duplicate =
    existing.find(
      (row) =>
        row.color === color &&
        row.size === size,
    );

  if (!duplicate) {
    await db
      .insert(
        stockNotificationSubscriptionsTable,
      )
      .values({
        productId,
        color,
        size,
        channel,
        target,
      });
  }

  return json(
    {
      success: true,
      alreadyAvailable: false,
    },
    201,
  );
}

export async function sendBackInStockNotifications(
  db: Db,
  env: Env,
  input: {
    productId: number;
    productName: string;
    color?: string | null;
    size?: string | null;
  },
) {
  const subscriptions = await db
    .select()
    .from(
      stockNotificationSubscriptionsTable,
    )
    .where(
      eq(
        stockNotificationSubscriptionsTable.productId,
        input.productId,
      ),
    );

  const matched =
    subscriptions.filter(
      (row) =>
        (
          row.color === null &&
          row.size === null
        ) ||
        (
          row.color ===
            (input.color ?? null) &&
          row.size ===
            (input.size ?? null)
        ),
    );

  if (matched.length === 0) {
    return {
      sent: 0,
      matched: 0,
    };
  }

  const title =
    "رجع للمخزون 🎉";

  const details = [
    input.color
      ? `لون ${input.color}`
      : null,
    input.size
      ? `مقاس ${input.size}`
      : null,
  ].filter(Boolean);

  const messageBody =
    `${input.productName}${details.length ? ` - ${details.join(" - ")}` : ""} متوفر الآن`;

  const url =
    `/product/${input.productId}`;

  const successfulTargets =
    new Set<string>();

  const expoTargets = [
    ...new Set(
      matched
        .filter(
          (row) =>
            row.channel === "expo",
        )
        .map((row) => row.target),
    ),
  ];

  for (
    const tokenBatch of
      chunk(expoTargets, 100)
  ) {
    const messages =
      tokenBatch.map((to) => ({
        to,
        sound:
          "lovely_kids_bell.wav",
        channelId:
          "lovely-kids-alerts-v1",
        title,
        body: messageBody,
        data: {
          type: "back_in_stock",
          productId:
            String(input.productId),
          url,
        },
      }));

    const response = await fetch(
      "https://exp.host/--/api/v2/push/send",
      {
        method: "POST",
        headers: {
          Accept:
            "application/json",
          "Content-Type":
            "application/json",
        },
        body:
          JSON.stringify(messages),
      },
    );

    if (!response.ok) continue;

    const data = await response
      .json()
      .catch(() => null) as {
        data?: ExpoPushTicket[];
      } | null;

    const tickets =
      Array.isArray(data?.data)
        ? data.data
        : [];

    await recordExpoPushTickets(
      db,
      tokenBatch,
      tickets,
    );

    tickets.forEach(
      (ticket, index) => {
        if (
          ticket?.status === "ok" &&
          tokenBatch[index]
        ) {
          successfulTargets.add(
            `expo:${tokenBatch[index]}`,
          );
        }
      },
    );
  }

  const webTargets = [
    ...new Set(
      matched
        .filter(
          (row) =>
            row.channel === "web",
        )
        .map((row) => row.target),
    ),
  ];

  if (webTargets.length > 0) {
    const webDevices = await db
      .select({
        endpoint:
          webPushSubscriptionsTable.endpoint,
        p256dh:
          webPushSubscriptionsTable.p256dh,
        auth:
          webPushSubscriptionsTable.auth,
      })
      .from(
        webPushSubscriptionsTable,
      )
      .where(
        inArray(
          webPushSubscriptionsTable.endpoint,
          webTargets,
        ),
      );

    const devicesByEndpoint =
      new Map(
        webDevices.map((device) => [
          device.endpoint,
          device,
        ]),
      );

    for (
      const endpoint of webTargets
    ) {
      const device =
        devicesByEndpoint.get(
          endpoint,
        );

      if (!device) {
        successfulTargets.add(
          `web:${endpoint}`,
        );
        continue;
      }

      const result =
        await sendWebPush(
          env,
          device,
          title,
          messageBody,
          url,
        );

      if (
        result.ok ||
        result.expired
      ) {
        successfulTargets.add(
          `web:${endpoint}`,
        );
      }

      if (result.expired) {
        await db
          .delete(
            webPushSubscriptionsTable,
          )
          .where(
            eq(
              webPushSubscriptionsTable.endpoint,
              endpoint,
            ),
          );
      }
    }
  }

  const completedIds =
    matched
      .filter((row) =>
        successfulTargets.has(
          `${row.channel}:${row.target}`,
        ),
      )
      .map((row) => row.id);

  if (completedIds.length > 0) {
    await db
      .delete(
        stockNotificationSubscriptionsTable,
      )
      .where(
        inArray(
          stockNotificationSubscriptionsTable.id,
          completedIds,
        ),
      );
  }

  return {
    sent:
      successfulTargets.size,
    matched:
      matched.length,
  };
}


export async function processAvailableStockNotifications(
  db: Db,
  env: Env,
) {
  const subscriptions = await db
    .select({
      productId:
        stockNotificationSubscriptionsTable.productId,
      color:
        stockNotificationSubscriptionsTable.color,
      size:
        stockNotificationSubscriptionsTable.size,
    })
    .from(
      stockNotificationSubscriptionsTable,
    );

  if (subscriptions.length === 0) {
    return {
      checked: 0,
      available: 0,
    };
  }

  const productIds = [
    ...new Set(
      subscriptions.map(
        (row) => row.productId,
      ),
    ),
  ];

  const products = await db
    .select({
      id: productsTable.id,
      nameAr: productsTable.nameAr,
      stock: productsTable.stock,
      colorVariants:
        productsTable.colorVariants,
    })
    .from(productsTable)
    .where(
      inArray(
        productsTable.id,
        productIds,
      ),
    );

  const productById =
    new Map(
      products.map((product) => [
        product.id,
        product,
      ]),
    );

  const availableKeys =
    new Map<
      string,
      {
        productId: number;
        productName: string;
        color: string | null;
        size: string | null;
      }
    >();

  for (const subscription of subscriptions) {
    const product =
      productById.get(
        subscription.productId,
      );

    if (!product) continue;

    const variants =
      (product.colorVariants as Array<{
        color: string;
        sizes?: Array<{
          size: string;
          stock?: number | null;
          outOfStock?: boolean;
        }>;
      }> | null) ?? [];

    let available = false;

    if (
      subscription.color &&
      subscription.size
    ) {
      const entry =
        variants
          .find(
            (variant) =>
              variant.color ===
              subscription.color,
          )
          ?.sizes?.find(
            (sizeEntry) =>
              sizeEntry.size ===
              subscription.size,
          );

      available =
        (entry?.stock ?? 0) > 0 &&
        entry?.outOfStock !== true;
    } else if (variants.length > 0) {
      available =
        variants.some((variant) =>
          (variant.sizes ?? []).some(
            (entry) =>
              (entry.stock ?? 0) > 0 &&
              entry.outOfStock !== true,
          ),
        );
    } else {
      available =
        (product.stock ?? 0) > 0;
    }

    if (!available) continue;

    const key =
      JSON.stringify([
        subscription.productId,
        subscription.color,
        subscription.size,
      ]);

    availableKeys.set(key, {
      productId:
        subscription.productId,
      productName:
        product.nameAr,
      color:
        subscription.color,
      size:
        subscription.size,
    });
  }

  let delivered = 0;

  for (
    const item of availableKeys.values()
  ) {
    const result =
      await sendBackInStockNotifications(
        db,
        env,
        item,
      );

    delivered +=
      result.sent;
  }

  return {
    checked:
      subscriptions.length,
    available:
      availableKeys.size,
    delivered,
  };
}


export async function sendOrderStatusNotification(
  db: Db,
  env: Env,
  orderId: number,
  phone: string,
  status: string,
  fulfillmentMethod?:
    | "delivery"
    | "pickup"
    | null,
) {
  const messages: Record<string, { title: string; body: string }> = {
    new: {
      title: "تم تحديث طلبك",
      body: `حالة الطلب #${orderId} أصبحت: جديد`,
    },
    confirmed: {
      title: "تم تأكيد طلبك ✅",
      body: `تم تأكيد الطلب #${orderId} وجارٍ تجهيزه`,
    },
    delivering: {
      title: "طلبك في طريقه إليك 🚚",
      body: `الطلب #${orderId} خرج للتوصيل`,
    },
    done: {
      title: "تم تسليم طلبك 🎉",
      body: `تم تسليم الطلب #${orderId}. شكرًا لتسوقك من Lovely Kids`,
    },
    cancelled: {
      title: "تم إلغاء طلبك",
      body: `تم إلغاء الطلب #${orderId}`,
    },
  };

  const message =
    status === "done" &&
    fulfillmentMethod === "pickup"
      ? {
          title:
            "تم استلام طلبك 🎉",
          body:
            `تم استلام الطلب #${orderId} من المحل. شكرًا لتسوقك من Lovely Kids`,
        }
      : messages[status];

  if (!message) return;

  const devices = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.phone, phone));

  const webDevices = await db
    .select({
      endpoint: webPushSubscriptionsTable.endpoint,
      p256dh: webPushSubscriptionsTable.p256dh,
      auth: webPushSubscriptionsTable.auth,
    })
    .from(webPushSubscriptionsTable)
    .where(eq(webPushSubscriptionsTable.phone, phone));

  const tokens = devices.map((device) => device.token);
  const invalidTokens: string[] = [];
  const expiredWebEndpoints: string[] = [];

  for (const tokenBatch of chunk(tokens, 100)) {
    const messages = tokenBatch.map((to) => ({
      to,
      sound: "lovely_kids_bell.wav",
      channelId: "lovely-kids-alerts-v1",
      title: message.title,
      body: message.body,
      data: { type: "order_status", orderId: String(orderId), status },
    }));

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });

    if (!response.ok) continue;

    const data = await response.json().catch(() => null) as {
      data?: ExpoPushTicket[];
    } | null;

    const tickets = Array.isArray(data?.data) ? data.data : [];

    await recordExpoPushTickets(
      db,
      tokenBatch,
      tickets,
    );

    tickets.forEach((ticket, index) => {
      if (ticket?.details?.error === "DeviceNotRegistered" && tokenBatch[index]) {
        invalidTokens.push(tokenBatch[index]);
      }
    });

  }

  for (const device of webDevices) {
    const result = await sendWebPush(
      env,
      device,
      message.title,
      message.body,
      "/my-orders",
    );
    if (result.expired) expiredWebEndpoints.push(device.endpoint);

  }

  if (invalidTokens.length > 0) {
    await db.delete(pushTokensTable)
      .where(inArray(pushTokensTable.token, [...new Set(invalidTokens)]));
  }

  if (expiredWebEndpoints.length > 0) {
    await db.delete(webPushSubscriptionsTable)
      .where(inArray(webPushSubscriptionsTable.endpoint, [...new Set(expiredWebEndpoints)]));
  }
}

export async function sendNewOrderNotification(
  db: Db,
  env: Env,
  order: {
    id: number;
    customerName: string;
    totalPrice: number;
  },
) {
  const devices = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.isAdmin, true));

  const webDevices = await db
    .select({
      endpoint: webPushSubscriptionsTable.endpoint,
      p256dh: webPushSubscriptionsTable.p256dh,
      auth: webPushSubscriptionsTable.auth,
    })
    .from(webPushSubscriptionsTable)
    .where(
      eq(
        webPushSubscriptionsTable.isAdmin,
        true,
      ),
    );

  const title = "طلب جديد";
  const body =
    `طلب #${order.id} من ${order.customerName}` +
    ` بقيمة ${order.totalPrice} ₪`;

  const tokens =
    devices.map(
      (device) => device.token,
    );

  let sent = 0;
  let webSent = 0;
  const invalidTokens: string[] = [];
  const expiredWebEndpoints: string[] = [];

  for (const tokenBatch of chunk(tokens, 100)) {
    const messages = tokenBatch.map((to) => ({
      to,
      sound: "lovely_kids_bell.wav",
      channelId: "lovely-kids-alerts-v1",
      title,
      body,
      data: {
        type: "new_order",
        orderId: String(order.id),
        url:
          `/admin/orders?orderId=${order.id}`,
      },
    }));

    const expoResponse = await fetch(
      "https://exp.host/--/api/v2/push/send",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messages),
      },
    );

    if (!expoResponse.ok) {
      console.error(
        "New order push failed:",
        expoResponse.status,
      );
      continue;
    }

    const expoData = await expoResponse
      .json()
      .catch(() => null) as {
        data?: ExpoPushTicket[];
      } | null;

    const tickets = Array.isArray(expoData?.data)
      ? expoData.data
      : [];

    await recordExpoPushTickets(
      db,
      tokenBatch,
      tickets,
    );

    for (
      let index = 0;
      index < tickets.length;
      index += 1
    ) {
      const ticket = tickets[index];
      const token = tokenBatch[index];

      if (ticket?.status === "ok") {
        sent += 1;
        continue;
      }

      if (
        ticket?.details?.error ===
          "DeviceNotRegistered" &&
        token
      ) {
        invalidTokens.push(token);
      }
    }
  }

  for (const device of webDevices) {
    const result = await sendWebPush(
      env,
      device,
      title,
      body,
      `/admin/orders?orderId=${order.id}`,
    );

    if (result.ok) {
      webSent += 1;
    } else if (result.expired) {
      expiredWebEndpoints.push(
        device.endpoint,
      );
    }
  }

  const uniqueInvalidTokens = [
    ...new Set(invalidTokens),
  ];

  if (uniqueInvalidTokens.length > 0) {
    await db
      .delete(pushTokensTable)
      .where(
        inArray(
          pushTokensTable.token,
          uniqueInvalidTokens,
        ),
      );
  }

  const uniqueExpiredWebEndpoints = [
    ...new Set(expiredWebEndpoints),
  ];

  if (
    uniqueExpiredWebEndpoints.length > 0
  ) {
    await db
      .delete(
        webPushSubscriptionsTable,
      )
      .where(
        inArray(
          webPushSubscriptionsTable.endpoint,
          uniqueExpiredWebEndpoints,
        ),
      );
  }

  return {
    sent: sent + webSent,
    total:
      tokens.length +
      webDevices.length,
    expoSent: sent,
    webSent,
    removedInvalidTokens:
      uniqueInvalidTokens.length,
    removedExpiredWebSubscriptions:
      uniqueExpiredWebEndpoints.length,
  };
}

async function handleSendNotification(
  request: Request,
  db: Db,
  env: Env,
) {
  const denied = await requireAdmin(
    request,
    db,
    env,
  );

  if (denied) return denied;

  const body = await request
    .json()
    .catch(() => null) as {
      title?: unknown;
      body?: unknown;
    } | null;

  const title =
    typeof body?.title === "string"
      ? body.title.trim()
      : "";

  const messageBody =
    typeof body?.body === "string"
      ? body.body.trim()
      : "";

  if (!title || !messageBody) {
    return json(
      { error: "العنوان والنص مطلوبان" },
      400,
    );
  }

  if (
    title.length > 100 ||
    messageBody.length > 200
  ) {
    return json(
      { error: "العنوان أو النص طويل جدًا" },
      400,
    );
  }

  const devices = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable);

  const webDevices = await db
    .select({
      endpoint: webPushSubscriptionsTable.endpoint,
      p256dh: webPushSubscriptionsTable.p256dh,
      auth: webPushSubscriptionsTable.auth,
    })
    .from(webPushSubscriptionsTable);

  if (devices.length === 0 && webDevices.length === 0) {
    return json({
      sent: 0,
      total: 0,
      message: "لا توجد أجهزة مسجلة",
    });
  }

  const tokens = devices.map(
    (device) => device.token,
  );

  let sent = 0;
  let webSent = 0;
  const invalidTokens: string[] = [];
  const expiredWebEndpoints: string[] = [];

  for (const tokenBatch of chunk(tokens, 100)) {
    const messages = tokenBatch.map((to) => ({
      to,
      sound: "lovely_kids_bell.wav",
      channelId: "lovely-kids-alerts-v1",
      title,
      body: messageBody,
      data: {
        type: "admin_notification",
      },
    }));

    const expoResponse = await fetch(
      "https://exp.host/--/api/v2/push/send",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messages),
      },
    );

    if (!expoResponse.ok) {
      console.error(
        "Expo push failed:",
        expoResponse.status,
      );
      continue;
    }

    const expoData = await expoResponse
      .json()
      .catch(() => null) as {
        data?: ExpoPushTicket[];
      } | null;

    const tickets = Array.isArray(expoData?.data)
      ? expoData.data
      : [];

    await recordExpoPushTickets(
      db,
      tokenBatch,
      tickets,
    );

    for (let index = 0; index < tickets.length; index += 1) {
      const ticket = tickets[index];
      const token = tokenBatch[index];

      if (ticket?.status === "ok") {
        sent += 1;
        continue;
      }

      if (
        ticket?.details?.error === "DeviceNotRegistered" &&
        token
      ) {
        invalidTokens.push(token);
      }

      console.error(
        "Expo push ticket error:",
        ticket,
      );
    }
    }

  for (const device of webDevices) {
    const result = await sendWebPush(
      env,
      device,
      title,
      messageBody,
    );

    if (result.ok) {
      webSent += 1;
    } else if (result.expired) {
      expiredWebEndpoints.push(device.endpoint);
    }
  }

  const uniqueInvalidTokens = [
    ...new Set(invalidTokens),
  ];

  if (uniqueInvalidTokens.length > 0) {
    await db
      .delete(pushTokensTable)
      .where(
        inArray(
          pushTokensTable.token,
          uniqueInvalidTokens,
        ),
      );
  }

  const uniqueExpiredWebEndpoints = [
    ...new Set(expiredWebEndpoints),
  ];

  if (uniqueExpiredWebEndpoints.length > 0) {
    await db
      .delete(webPushSubscriptionsTable)
      .where(
        inArray(
          webPushSubscriptionsTable.endpoint,
          uniqueExpiredWebEndpoints,
        ),
      );
  }

  const totalSent = sent + webSent;
  const totalDevices = tokens.length + webDevices.length;

  return json({
    sent: totalSent,
    total: totalDevices,
    failed: totalDevices - totalSent,
    expoSent: sent,
    webSent,
    removedInvalidTokens: uniqueInvalidTokens.length,
    removedExpiredWebSubscriptions: uniqueExpiredWebEndpoints.length,
  });
}

export async function handleNotificationRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "POST" &&
    path === "/api/push-tokens"
  ) {
    return handleRegisterToken(request, db, env);
  }

  if (
    request.method === "GET" &&
    path === "/api/web-push-public-key"
  ) {
    return handleWebPushPublicKey(env);
  }

  if (
    request.method === "POST" &&
    path === "/api/web-push-subscriptions"
  ) {
    return handleRegisterWebPush(request, db, env);
  }

  if (
    request.method === "POST" &&
    path === "/api/stock-notifications"
  ) {
    return handleSubscribeStockNotification(
      request,
      db,
    );
  }

  if (
    request.method === "GET" &&
    path === "/api/push-tokens/count"
  ) {
    return handleTokenCount(request, db, env);
  }

  if (
    request.method === "POST" &&
    path === "/api/notifications/send"
  ) {
    return handleSendNotification(request, db, env);
  }

  return null;
}
