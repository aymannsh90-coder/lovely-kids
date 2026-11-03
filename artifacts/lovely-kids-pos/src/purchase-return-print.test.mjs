import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = new URL("../", import.meta.url);
const globalCss = readFileSync(new URL("index.css", dir), "utf8");
const printCss = readFileSync(new URL("pages/purchases/PurchaseReturnsPage.css", dir), "utf8");

test("POS global print hides all descendants by default", () => {
  assert.match(globalCss, /body\s+\*\s*\{\s*visibility\s*:\s*hidden\s*!important\s*;/);
});

test("purchase-return print mode explicitly reveals the receipt and its descendants", () => {
  assert.match(printCss,
    /body\.pret-a4-printing\s*>\s*\.pret-a4-sheet\s*,\s*body\.pret-a4-printing\s*>\s*\.pret-a4-sheet\s+\*\s*\{\s*visibility\s*:\s*visible\s*!important\s*;/);
  assert.match(printCss, /body\.pret-a4-printing\s*>\s*\.pret-a4-sheet\s*\{\s*display\s*:\s*block\s*!important\s*;/);
  assert.match(printCss, /body\.pret-a4-printing\s*>\s*:not\(\.pret-a4-sheet\)\s*\{\s*display\s*:\s*none\s*!important\s*;/);
});
