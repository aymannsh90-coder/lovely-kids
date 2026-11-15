import assert from "node:assert/strict";
import test from "node:test";
import { resolveFacebookPageAccessToken } from "./facebook-page-access-token.ts";

const pageId = "400159390780629";

test("system token is exchanged for the exact configured Page token", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.match(String(url), /\/me\/accounts\?fields=id,access_token/);
    assert.equal(init.headers.Authorization, "Bearer private-system-token");
    assert.ok(!String(url).includes("private-system-token"));
    return Response.json({ data: [
      { id: "111", access_token: "wrong-page" },
      { id: pageId, access_token: "correct-page-token" },
    ] });
  };
  try {
    const token = await resolveFacebookPageAccessToken({
      META_FACEBOOK_PAGE_ID: pageId,
      META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN: "private-system-token",
      META_FACEBOOK_PAGE_ACCESS_TOKEN: "expired-legacy-token",
    });
    assert.equal(token, "correct-page-token");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("legacy token is used only when no system token exists", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Must not fetch"); };
  try {
    assert.equal(await resolveFacebookPageAccessToken({
      META_FACEBOOK_PAGE_ID: pageId,
      META_FACEBOOK_PAGE_ACCESS_TOKEN: "legacy-page-token",
    }), "legacy-page-token");
  } finally {
    globalThis.fetch = original;
  }
});

test("missing assigned Page never falls back to expired legacy token", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    data: [{ id: "another-page", access_token: "other-token" }],
  });
  try {
    await assert.rejects(resolveFacebookPageAccessToken({
      META_FACEBOOK_PAGE_ID: pageId,
      META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN: "system-token",
      META_FACEBOOK_PAGE_ACCESS_TOKEN: "expired-legacy-token",
    }), /FACEBOOK_SYSTEM_PAGE_NOT_FOUND/);
  } finally {
    globalThis.fetch = original;
  }
});

test("Meta errors expose only numeric diagnostics and no secrets", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    error: { code: 190, error_subcode: 463, message: "secret-token-never-share" },
  }, { status: 401 });
  try {
    await assert.rejects(resolveFacebookPageAccessToken({
      META_FACEBOOK_PAGE_ID: pageId,
      META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN: "secret-token-never-share",
    }), (error) => {
      assert.equal(error.message, "FACEBOOK_SYSTEM_TOKEN_FAILED_190_463");
      assert.ok(!error.message.includes("secret-token-never-share"));
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("missing credentials are rejected", async () => {
  await assert.rejects(resolveFacebookPageAccessToken({
    META_FACEBOOK_PAGE_ID: pageId,
  }), /FACEBOOK_NOT_CONFIGURED/);
});
