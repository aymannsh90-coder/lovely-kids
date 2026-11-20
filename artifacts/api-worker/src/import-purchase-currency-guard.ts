/**
 * Legacy POS purchase journals are denominated in ILS minor units.
 * The currencyCode field is informational in that path: it must never be
 * allowed to silently reinterpret 100 USD as 100 ILS.
 * Imported USD vendor invoices are documented separately until explicitly
 * supported by an FX-aware purchase posting flow.
 */
export function requireIlsLegacyPurchasePosting(currencyCode: string): "ILS" {
  if (currencyCode !== "ILS") {
    throw new Error("PURCHASE_CURRENCY_REQUIRES_IMPORT_FX_ACCOUNTING");
  }
  return "ILS";
}
