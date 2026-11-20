import test from "node:test";
import assert from "node:assert/strict";
import { requireIlsLegacyPurchasePosting } from "./import-purchase-currency-guard.ts";

test("existing local ILS supplier invoice continues to post normally", () => {
  assert.equal(requireIlsLegacyPurchasePosting("ILS"),"ILS");
});
test("USD purchase cannot be posted as ILS amount through the legacy route", () => {
  assert.throws(() => requireIlsLegacyPurchasePosting("USD"),
    /PURCHASE_CURRENCY_REQUIRES_IMPORT_FX_ACCOUNTING/);
});
test("all foreign currency codes require actual valuation of base GL amount", () => {
  for (const currency of ["EUR","JOD","GBP","usd",""]) {
    assert.throws(() => requireIlsLegacyPurchasePosting(currency));
  }
});
