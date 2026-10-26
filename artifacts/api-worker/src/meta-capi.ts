import { createHash } from "node:crypto";
import type { Env } from "./db";

const META_DATASET_ID = "923601613685011";
const META_GRAPH_VERSION = "v26.0";

export type MetaWebEventName =
  | "PageView"
  | "ViewContent"
  | "AddToCart"
  | "InitiateCheckout";

type MetaWebEventInput = {
  eventName: MetaWebEventName;
  eventId: string;
  fbp?: string;
  fbc?: string;
  eventSourceUrl?: string;
  customData?: Record<string, unknown>;
};

type MetaPurchaseInput = {
  orderId: number;
  customerName: string;
  customerPhone: string;
  totalPrice: number;
  fbp?: string;
  fbc?: string;
  eventSourceUrl?: string;
  items: Array<{
    id: string | number;
    quantity: number;
  }>;
};

function sha256(value: string): string {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function toEnglishDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) =>
      String(digit.charCodeAt(0) - "٠".charCodeAt(0)),
    )
    .replace(/[۰-۹]/g, (digit) =>
      String(digit.charCodeAt(0) - "۰".charCodeAt(0)),
    );
}

function normalizePhone(value: string): string {
  let digits = toEnglishDigits(value).replace(/\D/g, "");

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("970") || digits.startsWith("972")) {
    return digits;
  }

  if (/^0(?:56|59)\d+$/.test(digits)) {
    return `970${digits.slice(1)}`;
  }

  if (/^05\d+$/.test(digits)) {
    return `972${digits.slice(1)}`;
  }

  if (digits.startsWith("0")) {
    return `970${digits.slice(1)}`;
  }

  return digits;
}

function getNameParts(fullName: string) {
  const parts = fullName
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);

  return {
    firstName: parts[0],
    lastName:
      parts.length > 1
        ? parts[parts.length - 1]
        : undefined,
  };
}

export async function sendMetaPurchaseEvent(
  env: Env,
  request: Request,
  input: MetaPurchaseInput,
) {
  const accessToken =
    env.META_CAPI_ACCESS_TOKEN?.trim();

  if (!accessToken) {
    return {
      sent: false as const,
      reason: "missing_access_token",
    };
  }

  const phone = normalizePhone(input.customerPhone);
  const { firstName, lastName } =
    getNameParts(input.customerName);

  const userData: Record<string, unknown> = {};

  if (phone) {
    userData.ph = [sha256(phone)];
  }

  if (firstName) {
    userData.fn = [sha256(firstName)];
  }

  if (lastName) {
    userData.ln = [sha256(lastName)];
  }

  const clientIp =
    request.headers.get("CF-Connecting-IP")?.trim();

  const userAgent =
    request.headers.get("User-Agent")?.trim();

  if (clientIp) {
    userData.client_ip_address = clientIp;
  }

  if (userAgent) {
    userData.client_user_agent = userAgent;
  }

  if (input.fbp) {
    userData.fbp = input.fbp;
  }

  if (input.fbc) {
    userData.fbc = input.fbc;
  }

  const eventId = `order-${input.orderId}`;

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        event_source_url:
          input.eventSourceUrl ||
          request.headers.get("Origin") ||
          "https://lovelykids.net",

        user_data: userData,

        custom_data: {
          currency: "ILS",
          value: input.totalPrice,
          content_type: "product",
          content_ids: input.items.map((item) =>
            String(item.id),
          ),
          contents: input.items.map((item) => ({
            id: String(item.id),
            quantity: item.quantity,
          })),
          order_id: String(input.orderId),
        },
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    3000,
  );

  try {
    const response = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${META_DATASET_ID}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );

    const result = await response
      .json()
      .catch(() => null) as {
        events_received?: number;
        fbtrace_id?: string;
      } | null;

    if (!response.ok) {
      throw new Error(
        `Meta CAPI HTTP ${response.status}`,
      );
    }

    return {
      sent: true as const,
      eventId,
      eventsReceived:
        result?.events_received ?? null,
      traceId:
        result?.fbtrace_id ?? null,
    };
  } finally {
    clearTimeout(timeout);
  }
}


export async function sendMetaWebEvent(
  env: Env,
  request: Request,
  input: MetaWebEventInput,
) {
  const accessToken = env.META_CAPI_ACCESS_TOKEN?.trim();

  if (!accessToken) {
    return { sent: false as const, reason: "missing_access_token" };
  }

  const userData: Record<string, unknown> = {};
  const clientIp = request.headers.get("CF-Connecting-IP")?.trim();
  const userAgent = request.headers.get("User-Agent")?.trim();

  if (clientIp) userData.client_ip_address = clientIp;
  if (userAgent) userData.client_user_agent = userAgent;
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;

  const payload = {
    data: [{
      event_name: input.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: input.eventId,
      action_source: "website",
      event_source_url:
        input.eventSourceUrl ||
        request.headers.get("Origin") ||
        "https://lovelykids.net",
      user_data: userData,
      custom_data: input.customData ?? {},
    }],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${META_DATASET_ID}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );

    const result = await response.json().catch(() => null) as {
      events_received?: number;
      fbtrace_id?: string;
    } | null;

    if (!response.ok) {
      throw new Error(`Meta CAPI HTTP ${response.status}`);
    }

    return {
      sent: true as const,
      eventId: input.eventId,
      eventsReceived: result?.events_received ?? null,
      traceId: result?.fbtrace_id ?? null,
    };
  } finally {
    clearTimeout(timeout);
  }
}


function normalizeMetaBrowserIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 1024 || !/^fb\.\d+\.\d+\.[^\s]+$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function normalizeStoreEventSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    const hostname = url.hostname.toLowerCase();
    const allowed =
      hostname === "lovelykids.net" ||
      hostname.endsWith(".lovelykids.net") ||
      hostname === "lovely-kids.pages.dev" ||
      hostname.endsWith(".lovely-kids.pages.dev");
    return allowed ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function metaJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function handleMetaWebEventRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/api/meta/events") return null;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return metaJson({ error: "Invalid Meta event payload" }, 400);

  const allowedEvents = new Set<MetaWebEventName>([
    "PageView",
    "ViewContent",
    "AddToCart",
    "InitiateCheckout",
  ]);
  const eventName = body.eventName;
  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  if (
    typeof eventName !== "string" ||
    !allowedEvents.has(eventName as MetaWebEventName) ||
    !/^[A-Za-z0-9._:-]{8,160}$/.test(eventId)
  ) {
    return metaJson({ error: "Invalid Meta event" }, 400);
  }

  const eventSourceUrl = normalizeStoreEventSourceUrl(body.metaEventSourceUrl);
  if (!eventSourceUrl) return metaJson({ error: "Invalid Meta event source" }, 400);

  const customData = body.customData && typeof body.customData === "object" && !Array.isArray(body.customData)
    ? body.customData as Record<string, unknown>
    : {};
  if (JSON.stringify(customData).length > 8192) {
    return metaJson({ error: "Meta event payload too large" }, 413);
  }

  try {
    const result = await sendMetaWebEvent(env, request, {
      eventName: eventName as MetaWebEventName,
      eventId,
      fbp: normalizeMetaBrowserIdentifier(body.metaFbp),
      fbc: normalizeMetaBrowserIdentifier(body.metaFbc),
      eventSourceUrl,
      customData,
    });
    return metaJson(result);
  } catch (error) {
    console.error("META_CAPI_WEB_EVENT_FAILED", {
      eventName,
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    return metaJson({ sent: false, reason: "delivery_failed" });
  }
}
