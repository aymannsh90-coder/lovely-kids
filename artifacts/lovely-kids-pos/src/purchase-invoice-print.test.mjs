import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = new URL("./", import.meta.url);
const globalCss = readFileSync(new URL("index.css", source), "utf8");
const invoice = readFileSync(new URL("components/PurchaseA4Invoice.tsx", source), "utf8");

test("POS global printing hides all elements by default", () => {
  assert.match(globalCss, /body\s+\*\s*\{\s*visibility\s*:\s*hidden\s*!important\s*;/);
});

test("purchase A4 is a body-level portal outside the dashboard", () => {
  assert.match(invoice, /import\s*\{\s*createPortal\s*\}\s*from\s*["']react-dom["']/);
  assert.match(invoice, /return\s+createPortal\s*\(/);
  assert.match(invoice, /document\.body\s*,\s*\);/);
});

test("purchase print mode hides POS root and restores visibility of invoice descendants", () => {
  assert.match(globalCss, /body\[data-print-mode="purchase-a4"\]\s*>\s*:not\(\.purchase-a4-print-area\)\s*\{\s*display:\s*none\s*!important;/);
  assert.match(globalCss, /body\[data-print-mode="purchase-a4"\]\s*>\s*\.purchase-a4-print-area\s*,\s*body\[data-print-mode="purchase-a4"\]\s*>\s*\.purchase-a4-print-area\s+\*\s*\{\s*visibility:\s*visible\s*!important;/);
  assert.match(globalCss, /body\[data-print-mode="purchase-a4"\]\s*>\s*\.purchase-a4-print-area\s*\{\s*display:\s*block\s*!important;/);
});
