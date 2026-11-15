import assert from "node:assert/strict";
import test from "node:test";
import {
  publishFacebookPhotoStory,
  publishInstagramPhotoStory,
  safeMetaError,
} from "./owner-story-meta-publish.ts";

test("Facebook Story stages unpublished photo then uses photo_stories endpoint", async () => {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).endsWith("/photos")) {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("url"), "https://cdn.example.com/item.jpg");
      assert.equal(body.get("published"), "false");
      assert.equal(init.headers.Authorization, "Bearer secret-page-token");
      return Response.json({ id: "777111" });
    }
    if (String(input).endsWith("/photo_stories")) {
      assert.equal(new URLSearchParams(init.body).get("photo_id"), "777111");
      return Response.json({ success: true, post_id: "888222" });
    }
    throw new Error("Unexpected Meta endpoint");
  };
  try {
    const id = await publishFacebookPhotoStory("400159390780629", "secret-page-token", "https://cdn.example.com/item.jpg");
    assert.equal(id, "888222");
    assert.equal(calls.length, 2);
    assert.ok(calls.every(({ url }) => !url.includes("secret-page-token")));
  } finally {
    globalThis.fetch = orig;
  }
});

test("Instagram Story creates media, checks FINISHED, and publishes that container", async () => {
  const orig = globalThis.fetch;
  const calls = [];
  const id = "17841411928735926";
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    assert.equal(init.headers.Authorization, "Bearer secret-instagram-token");
    if (String(input).endsWith("/media")) {
      assert.equal(new URLSearchParams(init.body).get("media_type"), "STORIES");
      assert.equal(new URLSearchParams(init.body).get("image_url"), "https://cdn.example.com/story.jpg");
      return Response.json({ id: "111222" });
    }
    if (String(input).includes("/111222?fields=status_code")) {
      assert.equal(init.method, "GET");
      return Response.json({ status_code: "FINISHED" });
    }
    if (String(input).endsWith("/media_publish")) {
      assert.equal(new URLSearchParams(init.body).get("creation_id"), "111222");
      return Response.json({ id: "333444" });
    }
    throw new Error("Unexpected Meta endpoint");
  };
  try {
    assert.equal(await publishInstagramPhotoStory(id, "secret-instagram-token", "https://cdn.example.com/story.jpg"), "333444");
    assert.equal(calls.length, 3);
    assert.ok(calls.every(({ url }) => !url.includes("secret-instagram-token")));
  } finally {
    globalThis.fetch = orig;
  }
});

test("Instagram Story refuses to publish a container while Meta processes it", async () => {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/media")) return Response.json({ id: "123123" });
    return Response.json({ status_code: "IN_PROGRESS" });
  };
  try {
    await assert.rejects(publishInstagramPhotoStory("17841411928735926", "secret", "https://cdn.example.com/item.jpg"), /STORY_NOT_READY/);
    assert.equal(calls.length, 2);
    assert.ok(!calls.some((url) => url.includes("media_publish")));
  } finally {
    globalThis.fetch = orig;
  }
});

test("upstream Meta failure reveals numeric codes only, not secrets or remote message", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    error: { code: 190, error_subcode: 463, message: "private-token leaked" },
  }, { status: 401 });
  try {
    await assert.rejects(publishFacebookPhotoStory("400159390780629", "secret", "https://cdn.example.com/item.jpg"), (error) => {
      assert.equal(safeMetaError(error), "STORY_META_ERROR_190_463");
      assert.ok(!safeMetaError(error).includes("private-token"));
      return true;
    });
  } finally {
    globalThis.fetch = orig;
  }
});

test("incomplete Facebook Story response cannot be mistaken for publication", async () => {
  const orig = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => {
    count++;
    return count === 1
      ? Response.json({ id: "321" })
      : Response.json({ success: true }); // Missing post_id
  };
  try {
    await assert.rejects(publishFacebookPhotoStory("400159390780629", "secret", "https://cdn.example.com/item.jpg"), /STORY_UNEXPECTED_RESPONSE/);
  } finally {
    globalThis.fetch = orig;
  }
});
