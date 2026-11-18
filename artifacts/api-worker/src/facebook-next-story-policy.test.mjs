import assert from "node:assert/strict";
import test from "node:test";
import {
  facebookNextStoryPilotReady,
  facebookNextStoryProductId,
  validFacebookNextStoryImage,
} from "./facebook-next-story-policy.ts";

const valid = {
  META_FACEBOOK_STORIES_NEXT_PILOT_ENABLED: "true",
  META_FACEBOOK_PAGE_ID: "400159390780629",
  META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN_NEXT: "next-system-token",
};

test("NEXT Facebook Stories require their own explicit flag, Page id and NEXT system token", () => {
  assert.equal(facebookNextStoryPilotReady(valid), true);
  for (const value of [undefined, "", "false", "TRUE", "1"]) {
    assert.equal(facebookNextStoryPilotReady({
      ...valid, META_FACEBOOK_STORIES_NEXT_PILOT_ENABLED: value,
    }), false);
  }
  assert.equal(facebookNextStoryPilotReady({
    ...valid, META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN_NEXT: undefined,
    META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN: "old-system-token",
    META_FACEBOOK_PAGE_ACCESS_TOKEN: "old-page-token",
    META_FACEBOOK_POSTS_USE_NEXT_TOKEN: "true",
  }), false);
  assert.equal(facebookNextStoryPilotReady({
    ...valid, META_FACEBOOK_PAGE_ID: "not-a-page",
  }), false);
});

test("exactly one positive integer product id is accepted per endpoint", () => {
  assert.equal(facebookNextStoryProductId(587), 587);
  for (const value of ["587", null, 0, -1, 1.2, {}, [], [587], Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(facebookNextStoryProductId(value), null);
  }
});

test("Facebook NEXT Story reads only original public HTTPS JPEG or PNG URLs", () => {
  for (const url of [
    "https://media.lovelykids.net/media/r2/a.jpg",
    "https://media.lovelykids.net/media/r2/a.jpeg",
    "https://media.lovelykids.net/media/r2/a.PNG",
  ]) assert.equal(validFacebookNextStoryImage(url), true);
  for (const url of [
    "http://media.lovelykids.net/media/r2/a.jpg",
    "https://cdn.example.com/a.webp",
    "https://user:pass@cdn.example.com/a.jpg",
    "https://cdn.example.com/a.jpg.gif",
    "/media/r2/a.jpg",
    "javascript:alert(1)",
  ]) assert.equal(validFacebookNextStoryImage(url), false);
});
