import { createHash } from "node:crypto";
import type { Env } from "./db";

const META_DATASET_ID = "923601613685011";
const META_GRAPH_VERSION = "v26.0";

type MetaPurchaseInput = {
  orderId: number;
  customerName: string;
  customerPhone: string;
  totalPrice: number;
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

  const eventId = `order-${input.orderId}`;

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        event_source_url:
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
