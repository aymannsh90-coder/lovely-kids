import assert from "node:assert/strict";
import test from "node:test";
import {
  eligibleForSocialPublishing,
  exactSocialPublishingBarcodeMatches,
  matchesSocialPublishingProduct,
  socialPublishingEffectiveStock,
  socialPublishingDisplayImage,
} from "./socialPublishingProductSearch.ts";

function product(fields = {}) {
  return {
    id: "587",
    nameAr: "طقم طفل",
    name: "Baby set",
    productCode: "MODEL-587",
    barcode: "1234567890123",
    additionalBarcodes: [
      { barcode: "LKQR-587-1ABCDEF", color: "زهري", size: "0-3" },
    ],
    stock: 4,
    colorVariants: [],
    isHidden: false,
    deletedAt: null,
    ...fields,
  };
}

test("stock zero is excluded, but unknown stock remains eligible", () => {
  assert.equal(eligibleForSocialPublishing(product({ stock: 0 })), false);
  assert.equal(eligibleForSocialPublishing(product({ stock: null })), true);
  assert.equal(eligibleForSocialPublishing(product({ stock: 3 })), true);
  assert.equal(eligibleForSocialPublishing(product({ isHidden: true })), false);
  assert.equal(eligibleForSocialPublishing(product({ deletedAt: "2026-11-19" })), false);
});

test("variant-tracked zero quantity hides a model, matching POS quantity rules", () => {
  const variants = [{ color: "زهري", sizes: [{ size: "0-3", stock: 0 }, { size: "3-6", stock: 0 }] }];
  assert.equal(socialPublishingEffectiveStock(product({ stock: null, colorVariants: variants })), 0);
  assert.equal(eligibleForSocialPublishing(product({ stock: null, colorVariants: variants })), false);
  assert.equal(eligibleForSocialPublishing(product({ stock: 6, colorVariants: variants })), false);
  assert.equal(socialPublishingEffectiveStock(product({
    stock: 4, colorVariants: [{ color: "زهري", sizes: [{ size: "0-3", stock: 2 }, { size: "3-6", stock: 0 }] }],
  })), 2);
  assert.equal(eligibleForSocialPublishing(product({
    stock: 4, colorVariants: [{ color: "زهري", sizes: [{ size: "0-3", stock: 2 }, { size: "3-6", stock: 0 }] }],
  })), true);
  assert.equal(eligibleForSocialPublishing(product({
    stock: null, colorVariants: [{ color: "زهري", sizes: [{ size: "0-3", stock: null }] }],
  })), true);
});

test("manual search includes original barcode and all LKQR color/size codes", () => {
  const p = product();
  assert.equal(matchesSocialPublishingProduct(p, "لك"), false);
  assert.equal(matchesSocialPublishingProduct(p, "LKQR-587-1ABCDEF"), true);
  assert.equal(matchesSocialPublishingProduct(p, "1abcdef"), true);
  assert.equal(matchesSocialPublishingProduct(p, "1234567890123"), true);
  assert.equal(matchesSocialPublishingProduct(p, "MODEL-587"), true);
  assert.equal(matchesSocialPublishingProduct(p, "587"), true);
  assert.equal(matchesSocialPublishingProduct(p, "طفل"), true);
});

test("exact barcode auto-matching is unique and refuses zero stock/hidden products", () => {
  const p = product();
  assert.equal(exactSocialPublishingBarcodeMatches([p], " lkqr-587-1abcdef ")[0]?.id, "587");
  assert.equal(exactSocialPublishingBarcodeMatches([p], " 1234567890123 ").length, 1);
  assert.equal(exactSocialPublishingBarcodeMatches([product({ stock: 0 })], "LKQR-587-1ABCDEF").length, 0);
  assert.equal(exactSocialPublishingBarcodeMatches([p, product({ id: "588" })], "1234567890123").length, 2);
  assert.equal(exactSocialPublishingBarcodeMatches([p], "lkqr").length, 0);
});

test("three colors: one in stock uses that color image, two in stock uses main", () => {
  const base = product({
    image: "https://cdn.example.com/main.jpg",
    colorVariants: [
      { color: "أزرق", image: "https://cdn.example.com/blue.jpg", sizes: [{ size: "0-3", stock: 0 }] },
      { color: "زهري", image: "https://cdn.example.com/pink.jpg", sizes: [{ size: "0-3", stock: 2 }] },
      { color: "أبيض", image: "https://cdn.example.com/white.jpg", sizes: [{ size: "0-3", stock: 0 }] },
    ],
  });
  assert.equal(socialPublishingDisplayImage(base), "https://cdn.example.com/pink.jpg");
  base.colorVariants[2].sizes[0].stock = 1;
  assert.equal(socialPublishingDisplayImage(base), "https://cdn.example.com/main.jpg");
  base.colorVariants[2].sizes[0].stock = null;
  assert.equal(socialPublishingDisplayImage(base), "https://cdn.example.com/main.jpg");
  base.colorVariants[2].sizes[0].stock = 0;
  base.colorVariants[1].image = "http://cdn.example.com/pink.jpg";
  assert.equal(socialPublishingDisplayImage(base), "https://cdn.example.com/main.jpg");
});
