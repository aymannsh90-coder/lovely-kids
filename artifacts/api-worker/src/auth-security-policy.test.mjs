import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOMER_SESSION_TTL_MS,
  STAFF_SESSION_TTL_MS,
  LOGIN_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_MS,
  LOGIN_COOLDOWN_MS,
  clientIpFromCloudflare,
  loginFailureKey,
  isLoginTemporarilyBlocked,
  sessionExpiresAt,
  isSessionExpired,
} from "./auth-security-policy.ts";

test("login limiter hashes phone + IP, without storing either in plaintext", () => {
  const one = loginFailureKey("0599000000", "192.0.2.1");
  assert.match(one, /^[a-f0-9]{64}$/);
  assert.equal(one, loginFailureKey("0599000000", "192.0.2.1"));
  assert.notEqual(one, loginFailureKey("0599000000", "192.0.2.2"));
  assert.notEqual(one, loginFailureKey("0599000001", "192.0.2.1"));
  assert.ok(!one.includes("0599000000"));
});

test("only Cloudflare's validated connecting-IP header is accepted", () => {
  assert.equal(
    clientIpFromCloudflare(new Request("https://api.example.test", {
      headers: { "CF-Connecting-IP": "2001:db8::1" },
    })),
    "2001:db8::1",
  );
  assert.equal(
    clientIpFromCloudflare(new Request("https://api.example.test", {
      headers: { "X-Forwarded-For": "192.0.2.10" },
    })),
    null,
  );
  assert.equal(
    clientIpFromCloudflare(new Request("https://api.example.test", {
      headers: { "CF-Connecting-IP": "bad-ip" },
    })),
    null,
  );
});

test("cooldown boundary is precise and configuration conservative", () => {
  const now = new Date("2026-11-21T10:00:00.000Z");
  assert.equal(LOGIN_FAILURE_LIMIT, 8);
  assert.equal(LOGIN_FAILURE_WINDOW_MS, 900000);
  assert.equal(LOGIN_COOLDOWN_MS, 60000);
  assert.equal(isLoginTemporarilyBlocked(new Date(now.getTime() + 1), now), true);
  assert.equal(isLoginTemporarilyBlocked(new Date(now.getTime()), now), false);
  assert.equal(isLoginTemporarilyBlocked(null, now), false);
});

test("staff sessions expire earlier; customer checkout remains guest-friendly", () => {
  const now = new Date("2026-11-21T10:00:00.000Z");
  const staff = sessionExpiresAt(now, true);
  const customer = sessionExpiresAt(now, false);
  assert.equal(staff.getTime() - now.getTime(), STAFF_SESSION_TTL_MS);
  assert.equal(customer.getTime() - now.getTime(), CUSTOMER_SESSION_TTL_MS);
  assert.equal(isSessionExpired(staff, new Date(staff.getTime() - 1)), false);
  assert.equal(isSessionExpired(staff, staff), true);
});
