import { pushTokensTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
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

function isValidExpoPushToken(token: string) {
  return /^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]+\]$/.test(
    token,
  );
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

  const phone =
    user?.phone?.trim() ||
    requestedPhone ||
    null;

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

  return json({ count: rows.length });
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


export async function sendNewOrderNotification(
  db: Db,
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

  if (devices.length === 0) {
    return {
      sent: 0,
      total: 0,
      removedInvalidTokens: 0,
    };
  }

  const tokens = devices.map(
    (device) => device.token,
  );


  let sent = 0;
  const invalidTokens: string[] = [];

  for (const tokenBatch of chunk(tokens, 100)) {
    const messages = tokenBatch.map((to) => ({
      to,
      sound: "default",
      channelId: "default",
      title: "طلب جديد",
      body:
        `طلب #${order.id} من ${order.customerName}` +
        ` بقيمة ${order.totalPrice} ₪`,
      data: {
        type: "new_order",
        orderId: String(order.id),
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
        data?: Array<{
          status?: string;
          details?: { error?: string };
        }>;
      } | null;

    const tickets = Array.isArray(expoData?.data)
      ? expoData.data
      : [];

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

  return {
    sent,
    total: tokens.length,
    removedInvalidTokens:
      uniqueInvalidTokens.length,
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

  if (devices.length === 0) {
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
  const invalidTokens: string[] = [];

  for (const tokenBatch of chunk(tokens, 100)) {
    const messages = tokenBatch.map((to) => ({
      to,
      sound: "default",
      channelId: "default",
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
        data?: Array<{
          status?: string;
          details?: { error?: string };
        }>;
      } | null;

    const tickets = Array.isArray(expoData?.data)
      ? expoData.data
      : [];

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

  return json({
    sent,
    total: tokens.length,
    failed: tokens.length - sent,
    removedInvalidTokens:
      uniqueInvalidTokens.length,
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
