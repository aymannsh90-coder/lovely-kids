export type MetaPixelEvent =
  | "ViewContent"
  | "AddToCart"
  | "InitiateCheckout"
  | "Purchase";

export type MetaPixelParams = Record<string, unknown>;

const META_PIXEL_ID = "923601613685011";

type MetaAdvancedMatchingInput = {
  phone?: string | null;
  fullName?: string | null;
};

function toEnglishDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) =>
      String(digit.charCodeAt(0) - "٠".charCodeAt(0)),
    )
    .replace(/[۰-۹]/g, (digit) =>
      String(digit.charCodeAt(0) - "۰".charCodeAt(0)),
    );
}

function normalizeMetaPhone(value: string): string {
  let digits = toEnglishDigits(value).replace(/\D/g, "");

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  // Already includes Palestine / Israel country code.
  if (digits.startsWith("970") || digits.startsWith("972")) {
    return digits;
  }

  // Palestinian mobile networks commonly using 056 / 059.
  if (/^0(?:56|59)\d+$/.test(digits)) {
    return `970${digits.slice(1)}`;
  }

  // Other local 05x mobile numbers are normally +972 numbers.
  if (/^05\d+$/.test(digits)) {
    return `972${digits.slice(1)}`;
  }

  // Default local Palestinian numbers such as landlines.
  if (digits.startsWith("0")) {
    return `970${digits.slice(1)}`;
  }

  return digits;
}

function getNameParts(fullName: string): {
  firstName?: string;
  lastName?: string;
} {
  const parts = fullName
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);

  if (parts.length === 0) return {};

  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts[parts.length - 1] : undefined,
  };
}

export function setMetaAdvancedMatching({
  phone,
  fullName,
}: MetaAdvancedMatchingInput): void {
  const root = globalThis as typeof globalThis & {
    fbq?: (...args: unknown[]) => void;
  };

  if (typeof root.fbq !== "function") return;

  const normalizedPhone = phone
    ? normalizeMetaPhone(phone.trim())
    : "";

  const { firstName, lastName } = fullName
    ? getNameParts(fullName)
    : {};

  const userData: Record<string, string> = {};

  if (normalizedPhone) userData.ph = normalizedPhone;
  if (firstName) userData.fn = firstName;
  if (lastName) userData.ln = lastName;

  if (Object.keys(userData).length === 0) return;

  root.fbq("init", META_PIXEL_ID, userData);
}

export function trackMetaEvent(
  event: MetaPixelEvent,
  params: MetaPixelParams = {},
): void {
  const root = globalThis as typeof globalThis & {
    fbq?: (...args: unknown[]) => void;
  };

  if (typeof root.fbq !== "function") return;

  root.fbq("track", event, params);
}
