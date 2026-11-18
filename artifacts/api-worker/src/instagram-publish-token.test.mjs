import assert from "node:assert/strict";
import test from "node:test";
import { instagramPublishingToken, instagramPublishUsesNextToken } from "./instagram-publish-token.ts";

const env = {
  META_INSTAGRAM_ACCESS_TOKEN: "old-ig",
  META_INSTAGRAM_ACCESS_TOKEN_NEXT: "new-ig",
  META_FACEBOOK_POSTS_USE_NEXT_TOKEN: "true",
};

test("Instagram publishing is independent from enabled Facebook cutover", () => {
  assert.equal(instagramPublishUsesNextToken(env, "feed"), false);
  assert.equal(instagramPublishUsesNextToken(env, "stories"), false);
  assert.equal(instagramPublishingToken(env, "stories"), "old-ig");
});

test("Stories switch alone explicitly selects NEXT", () => {
  const selected = { ...env, META_INSTAGRAM_STORIES_USE_NEXT_TOKEN: "true" };
  assert.equal(instagramPublishingToken(selected, "stories"), "new-ig");
  assert.equal(instagramPublishUsesNextToken(selected, "feed"), false);
});

test("Feed switch alone explicitly selects NEXT", () => {
  const selected = { ...env, META_INSTAGRAM_FEED_USE_NEXT_TOKEN: "true" };
  assert.equal(instagramPublishingToken(selected, "feed"), "new-ig");
  assert.equal(instagramPublishingToken(selected, "stories"), "old-ig");
});

test("NEXT missing never falls back to old token", () => {
  const selected = { META_INSTAGRAM_ACCESS_TOKEN: "old-ig", META_INSTAGRAM_STORIES_USE_NEXT_TOKEN: "true" };
  assert.equal(instagramPublishingToken(selected, "stories"), "");
});

test("Old token missing and default OFF never silently uses NEXT", () => {
  assert.equal(instagramPublishingToken({ META_INSTAGRAM_ACCESS_TOKEN_NEXT: "new-ig" }, "stories"), "");
});

test("Flag is true only for literal true, not truthy strings", () => {
  for (const flag of ["1", "TRUE", "false", "yes", ""]) {
    assert.equal(instagramPublishUsesNextToken({ ...env, META_INSTAGRAM_FEED_USE_NEXT_TOKEN: flag }, "feed"), false);
  }
  assert.equal(instagramPublishUsesNextToken({ ...env, META_INSTAGRAM_FEED_USE_NEXT_TOKEN: " true " }, "feed"), true);
});
