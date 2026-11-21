import { createHash } from "node:crypto";

// Cloudflare already limits rapid requests per IP at the edge. This adds a
// narrowly scoped, shared, per-phone-and-IP limit for failed password attempts.
export const LOGIN_FAILURE_LIMIT = 8;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_COOLDOWN_MS = 60 * 1000;

// Absolute lifetimes. Existing sessions receive a 30-day grace period in the
// additive database migration; no forced logout occurs at initial rollout.
export const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const STAFF_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function clientIpFromCloudflare(request: Request): string | null {
  const ip = request.headers.get("CF-Connecting-IP")?.trim() ?? "";
  // Do not trust arbitrary forwarded-for headers or group all clients under
  // one "unknown" key. Edge WAF still protects requests without this header.
  return ip.length > 0 && ip.length <= 45 && /^[0-9a-f:.]+$/i.test(ip)
    ? ip
    : null;
}

export function loginFailureKey(normalizedPhone: string, ip: string): string {
  return createHash("sha256")
    .update(JSON.stringify([normalizedPhone, ip]))
    .digest("hex");
}

export function isLoginTemporarilyBlocked(
  blockedUntil: Date | null,
  now: Date,
): boolean {
  return blockedUntil !== null && blockedUntil.getTime() > now.getTime();
}

export function sessionExpiresAt(now: Date, privileged: boolean): Date {
  return new Date(
    now.getTime() +
      (privileged ? STAFF_SESSION_TTL_MS : CUSTOMER_SESSION_TTL_MS),
  );
}

export function isSessionExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}
