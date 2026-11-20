import assert from "node:assert/strict";
import test from "node:test";
import {
  assignGalleryImageToStory,
  canUseGalleryImageForStory,
} from "./productStoryImageSelection.ts";

const main = "https://media.lovelykids.net/media/r2/main.jpg";
const second = "https://media.lovelykids.net/media/r2/second.jpeg";
const third = "https://media.lovelykids.net/media/r2/third.jpg";

test("assigning a secondary gallery JPEG moves its URL to Story with no new upload", () => {
  const before = { image: main, images: [main, second, third] };
  const after = assignGalleryImageToStory(before, second);
  assert.deepEqual(after, {
    image: main,
    images: [main, third],
    storyImage: second,
    movedFromGallery: true,
  });
  assert.deepEqual(before.images, [main, second, third], "input unchanged");
});

test("moving the main image safely selects a new main gallery photo", () => {
  const after = assignGalleryImageToStory({ image: main, images: [main, second, third] }, main);
  assert.deepEqual(after, {
    image: second,
    images: [second, third],
    storyImage: main,
    movedFromGallery: true,
  });
});

test("one remaining gallery photo stays visible in shop and is shared by URL", () => {
  const after = assignGalleryImageToStory({ image: main, images: [main] }, main);
  assert.deepEqual(after, {
    image: main,
    images: [main],
    storyImage: main,
    movedFromGallery: false,
  });
});

test("moving duplicate gallery references clears both but preserves another main image", () => {
  const after = assignGalleryImageToStory({ image: third, images: [second, third, second] }, second);
  assert.deepEqual(after, {
    image: third,
    images: [third],
    storyImage: second,
    movedFromGallery: true,
  });
});

test("rejects PNG, WebP, HTTP, encoded credentials, and URLs outside gallery", () => {
  assert.equal(canUseGalleryImageForStory("https://media.lovelykids.net/image.jpg?ver=1"), true);
  for (const bad of [
    "https://media.lovelykids.net/image.webp",
    "https://media.lovelykids.net/image.png",
    "http://media.lovelykids.net/image.jpg",
    "https://user:pass@media.lovelykids.net/image.jpg",
    "javascript:alert(1)",
    "",
  ]) assert.equal(canUseGalleryImageForStory(bad), false);

  assert.equal(assignGalleryImageToStory({ image: main, images: [main] }, third), null);
  assert.equal(assignGalleryImageToStory({
    image: main, images: [main, "https://media.lovelykids.net/image.png"],
  }, "https://media.lovelykids.net/image.png"), null);
});
