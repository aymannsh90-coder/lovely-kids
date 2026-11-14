import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_FACEBOOK_POST_PRODUCTS,
  composeFacebookPhotoCaption,
  composeFacebookProductCaption,
  productStorefrontUrl,
} from "./facebook-post-composer.ts";

const a = { id: 603, nameAr: "طقم شتوي بناتي", name: "Winter Set" };
const b = { id: 602, nameAr: "ترنج أطفال", name: "Kids Set" };

test("uses exact Arabic store name and product-specific link beneath photo", () => {
  const caption = composeFacebookPhotoCaption(a);
  assert.ok(caption.startsWith("طقم شتوي بناتي\n"));
  assert.ok(caption.includes("النمر والألوان المتوفرة"));
  assert.ok(caption.endsWith("https://lovelykids.net/product/603"));
});

test("combined post includes each product caption and correct URL in selection order", () => {
  const caption = composeFacebookProductCaption([b, a], "وصل حديثًا 💗");
  assert.ok(caption.startsWith("وصل حديثًا 💗"));
  assert.ok(caption.indexOf("https://lovelykids.net/product/602") <
    caption.indexOf("https://lovelykids.net/product/603"));
  assert.equal((caption.match(/لمشاهدة هذا الموديل/g) ?? []).length, 2);
});

test("fallback names, duplicate protection and validation", () => {
  assert.equal(productStorefrontUrl(3), "https://lovelykids.net/product/3");
  assert.ok(composeFacebookPhotoCaption({ id: 1, nameAr: null, name: "Alternative" }).startsWith("Alternative"));
  assert.throws(() => productStorefrontUrl(0));
  assert.throws(() => composeFacebookProductCaption([]));
  assert.throws(() => composeFacebookProductCaption([a, a]));
  assert.throws(() => composeFacebookProductCaption([a], "a".repeat(501)));
  assert.throws(() => composeFacebookProductCaption(Array.from({ length: MAX_FACEBOOK_POST_PRODUCTS + 1 }, (_, i) =>
    ({ id: i + 1, nameAr: "x", name: "x" }))));
});
