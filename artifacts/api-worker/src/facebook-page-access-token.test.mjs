import assert from "node:assert/strict";
import test from "node:test";
import {
  facebookPostsUseNextToken,
  resolveFacebookPageAccessToken,
  resolveFacebookPostPageAccessToken,
} from "./facebook-page-access-token.ts";

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

test("new token is NEVER used for posts unless explicitly enabled", async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (_url, init) => {
    seen.push(init.headers.Authorization);
    return Response.json({ data: [{ id: pageId, access_token: "page-for-" + init.headers.Authorization }] });
  };
  try {
    const env = {
      META_FACEBOOK_PAGE_ID: pageId,
      META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN: "existing-token",
      META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN_NEXT: "replacement-token",
    };
    assert.equal(facebookPostsUseNextToken(env), false);
    assert.equal(await resolveFacebookPostPageAccessToken(env), "page-for-Bearer existing-token");
    assert.deepEqual(seen, ["Bearer existing-token"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("only the explicit true switch enables next token for Facebook posts", async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (_url, init) => {
    seen.push(init.headers.Authorization);
    return Response.json({ data: [{ id: pageId, access_token: "next-page-token" }] });
  };
  try {
    const env = {
      META_FACEBOOK_PAGE_ID: pageId,
      META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN: "existing-token",
      META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN_NEXT: "replacement-token",
      META_FACEBOOK_POSTS_USE_NEXT_TOKEN: "true",
    };
    assert.equal(facebookPostsUseNextToken(env), true);
    assert.equal(await resolveFacebookPostPageAccessToken(env), "next-page-token");
    assert.deepEqual(seen, ["Bearer replacement-token"]);
    assert.equal(facebookPostsUseNextToken({ ...env, META_FACEBOOK_POSTS_USE_NEXT_TOKEN: "false" }), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("read-only candidate check uses NEXT even while the post switch is disabled", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.headers.Authorization, "Bearer replacement-token");
    return Response.json({ data: [{ id: pageId, access_token: "candidate-page-token" }] });
  };
  try {
    assert.equal(await resolveFacebookPageAccessToken({
      META_FACEBOOK_PAGE_ID: pageId,
      META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN: "existing-token",
      META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN_NEXT: "replacement-token",
    }, "next"), "candidate-page-token");
  } finally {
    globalThis.fetch = original;
  }
});

test("NEXT mode never silently falls back to old secrets on missing or invalid token", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error("must not fetch"); };
    await assert.rejects(resolveFacebookPostPageAccessToken({
      META_FACEBOOK_PAGE_ID: pageId,
      META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN: "existing-token",
      META_FACEBOOK_PAGE_ACCESS_TOKEN: "legacy-token",
      META_FACEBOOK_POSTS_USE_NEXT_TOKEN: "true",
    }), /FACEBOOK_NOT_CONFIGURED/);
    globalThis.fetch = async () => Response.json({ error: { code: 190 } }, { status: 401 });
    await assert.rejects(resolveFacebookPostPageAccessToken({
      META_FACEBOOK_PAGE_ID: pageId,
      META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN: "existing-token",
      META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN_NEXT: "invalid-next-token",
      META_FACEBOOK_POSTS_USE_NEXT_TOKEN: "true",
    }), /FACEBOOK_SYSTEM_TOKEN_FAILED_190/);
  } finally {
    globalThis.fetch = original;
  }
});
