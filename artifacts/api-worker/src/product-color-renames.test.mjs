import test from "node:test";
import assert from "node:assert/strict";

import {
  validProductColorRenames,
  priorVariantsWithRenamedColors,
  originalColorName,
} from "./product-color-renames.ts";

test("renaming a color preserves the existing stock identity, sizes and images", () => {
  const oldVariants = [
    { color: "أزرق", hex: "#2196F3", image: "https://example.test/blue.jpg", sizes: [
      { size: "3-6", stock: 1 }, { size: "6-9", stock: 4 },
    ] },
    { color: "أحمر", hex: "#EF4444", sizes: [{ size: "3-6", stock: 2 }] },
  ];
  const newVariants = [
    { ...oldVariants[0], color: "أزرق سماوي", hex: "#37A6E9" },
    oldVariants[1],
  ];
  const renames = [{ from: "أزرق", to: "أزرق سماوي" }];
  assert.equal(validProductColorRenames(oldVariants, newVariants, renames), true);
  const prior = priorVariantsWithRenamedColors(oldVariants, renames);
  assert.deepEqual(prior[0].sizes, oldVariants[0].sizes);
  assert.equal(prior[0].image, oldVariants[0].image);
  assert.equal(prior[0].color, "أزرق سماوي");
  assert.equal(originalColorName(newVariants[0].color, renames), "أزرق");

  const stockByKey = (variants) =>
    new Map(variants.flatMap((v) =>
      v.sizes.map((s) => [`${v.color}/${s.size}`, s.stock])
    ));
  assert.deepEqual(stockByKey(prior), stockByKey(newVariants));
});

test("renamed color with a real quantity change still reports the true delta", () => {
  const previous = [{ color: "أزرق", sizes: [{ size: "3-6", stock: 2 }] }];
  const current = [{ color: "سماوي", sizes: [{ size: "3-6", stock: 5 }] }];
  const rename = [{ from: "أزرق", to: "سماوي" }];
  assert.ok(validProductColorRenames(previous, current, rename));
  const renamedPrevious = priorVariantsWithRenamedColors(previous, rename);
  assert.equal(current[0].sizes[0].stock - renamedPrevious[0].sizes[0].stock, 3);
});

test("rejects stale, duplicate, ambiguous, or swapped color names", () => {
  const previous = [{ color: "أزرق" }, { color: "أحمر" }];
  assert.equal(
    validProductColorRenames(previous, [{ color: "سماوي" }, { color: "أحمر" }], [
      { from: "أزرق", to: "سماوي" },
    ]),
    true,
  );
  assert.equal(
    validProductColorRenames(previous, [{ color: "أزرق" }, { color: "أحمر" }], [
      { from: "أزرق", to: "سماوي" },
    ]),
    false,
  );
  assert.equal(
    validProductColorRenames(previous, [{ color: "أحمر" }, { color: "أزرق" }], [
      { from: "أزرق", to: "أحمر" }, { from: "أحمر", to: "أزرق" },
    ]),
    false,
  );
  assert.equal(
    validProductColorRenames(previous, [{ color: "سماوي" }, { color: "أحمر" }], [
      { from: "أزرق", to: "سماوي" }, { from: "أزرق", to: "سماوي" },
    ]),
    false,
  );
  assert.equal(
    validProductColorRenames(previous, [{ color: "سماوي" }, { color: "أحمر" }], [
      { from: "أخضر", to: "سماوي" },
    ]),
    false,
  );
});
