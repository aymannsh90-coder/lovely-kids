import { API_BASE } from "@/constants/api";

export type MetaPixelEvent =
  | "ViewContent"
  | "AddToCart"
  | "InitiateCheckout"
  | "Purchase";

export type MetaPixelParams = Record<string, unknown>;

export type MetaPixelEventOptions = {
  eventId?: string;
};

export type MetaAdvancedMatchingInput = {
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  externalId?: string | null;
};

const META_PIXEL_ID = "923601613685011";

let lastAdvancedMatchingSignature = "";

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

export function setMetaAdvancedMatching(
  input: MetaAdvancedMatchingInput,
): void {
  const root = globalThis as typeof globalThis & {
    fbq?: (...args: unknown[]) => void;
  };

  if (typeof root.fbq !== "function") return;

  const params: Record<string, string> = {};

  const email = input.email?.trim().toLowerCase();
  if (email) params.em = email;

  const phone = input.phone
    ? normalizePhone(input.phone)
    : "";
  if (phone) params.ph = phone;

  if (input.fullName) {
    const { firstName, lastName } =
      getNameParts(input.fullName);
    if (firstName) params.fn = firstName;
    if (lastName) params.ln = lastName;
  }

  const externalId = input.externalId?.trim();
  if (externalId) params.external_id = externalId;

  if (Object.keys(params).length === 0) return;

  const signature = JSON.stringify(params);
  if (signature === lastAdvancedMatchingSignature) {
    return;
  }

  // Meta Pixel hashes supported advanced-matching values with SHA-256
  // before transmission. Re-initializing with customer data updates the
  // matching context for subsequent browser events without firing a new event.
  // Analytics must always remain best-effort and must never block checkout.
  try {
    root.fbq("init", META_PIXEL_ID, params);
    lastAdvancedMatchingSignature = signature;
  } catch {
    // Ignore third-party tracking failures.
  }
}

function readMetaCookie(name: string): string | undefined {
  const root = globalThis as typeof globalThis & {
    document?: { cookie?: string };
  };
  const cookieText = root.document?.cookie;
  if (!cookieText) return undefined;
  const prefix = `${name}=`;
  const entry = cookieText.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!entry) return undefined;
  const value = entry.slice(prefix.length);
  try { return decodeURIComponent(value); } catch { return value; }
}

function createMetaEventId(event: MetaPixelEvent): string {
  const cryptoRoot = globalThis as typeof globalThis & {
    crypto?: { randomUUID?: () => string };
  };
  const random = cryptoRoot.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `lk-${event.toLowerCase()}-${random}`;
}

function sendMetaCapiEvent(
  event: Exclude<MetaPixelEvent, "Purchase">,
  eventId: string,
  params: MetaPixelParams,
): void {
  const root = globalThis as typeof globalThis & {
    location?: { href?: string };
    document?: unknown;
  };
  if (!root.document || typeof root.location?.href !== "string") return;

  const metaFbp = readMetaCookie("_fbp");
  const metaFbc = readMetaCookie("_fbc");

  void fetch(`${API_BASE}/api/meta/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventName: event,
      eventId,
      customData: params,
      ...(metaFbp ? { metaFbp } : {}),
      ...(metaFbc ? { metaFbc } : {}),
      metaEventSourceUrl: root.location.href,
    }),
  }).catch(() => {
    // Meta analytics must never block or break the shopping experience.
  });
}

export function trackMetaEvent(
  event: MetaPixelEvent,
  params: MetaPixelParams = {},
  options: MetaPixelEventOptions = {},
): void {
  const root = globalThis as typeof globalThis & {
    fbq?: (...args: unknown[]) => void;
  };

  const eventId = options.eventId ?? createMetaEventId(event);

  if (typeof root.fbq === "function") {
    root.fbq("track", event, params, { eventID: eventId });
  }

  if (event !== "Purchase") {
    sendMetaCapiEvent(event, eventId, params);
  }
}
