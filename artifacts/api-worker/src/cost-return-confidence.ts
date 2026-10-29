/**
 * Decide whether a no-receipt stock return can use an already approved,
 * unchanged unit cost. This is NOT evidence of which sale was returned.
 *
 * The caller must independently lock and validate the current product-cost
 * state before using this function. History must be complete; a truncated
 * query always falls back to an estimated return.
 */
export type CostHistoryEvidence = {
  eventType: string;
  sourceType: string | null;
  costQuality: string;
  quantityAfter: number;
  valueAfterMinor: number;
  note: string | null;
};

const COST_PRESERVING_EVENTS = new Set([
  "opening",
  "purchase",
  "purchase_void",
  "pos_sale",
  "online_order",
  "exchange_sale",
  "pos_return",
  "pos_mobile_return",
  "exchange_return",
  "pos_sale_void",
  "pos_sale_edit_reverse",
  "pos_return_void",
  "online_order_cancel",
  "online_order_edit_reverse",
  "exchange_return_void",
  "exchange_sale_void",
  "adjustment_in",
  "adjustment_out",
]);

export function isStableApprovedReturnCost(
  newestFirst: CostHistoryEvidence[],
  unitCostMinor: number,
  historyComplete: boolean,
): boolean {
  if (!historyComplete || newestFirst.length === 0 ||
    !Number.isSafeInteger(unitCostMinor) || unitCostMinor < 0) return false;

  // Existing owner certifications were made only after auditing the whole
  // ledger and source snapshots. A subsequent purchase at the SAME cost is
  // valid; a different cost or an unexplained event invalidates the proof.
  const ownerCertification = newestFirst.findIndex((event) =>
    event.eventType === "correction" &&
    event.sourceType === "owner_cost_quality_attestation" &&
    event.costQuality === "confirmed" &&
    event.note?.startsWith(
      "Owner verified unit cost " + unitCostMinor +
      " minor units without claiming original sale linkage."
    ),
  );

  // Without an owner certification, require a complete, consistently priced,
  // confirmed history with an original approved opening or purchase.
  const history = ownerCertification >= 0
    ? newestFirst.slice(0, ownerCertification)
    : newestFirst;

  const consistent = history.every((event) =>
    COST_PRESERVING_EVENTS.has(event.eventType) &&
    event.costQuality === "confirmed" &&
    Number.isSafeInteger(event.quantityAfter) && event.quantityAfter >= 0 &&
    Number.isSafeInteger(event.valueAfterMinor) && event.valueAfterMinor >= 0 &&
    BigInt(event.quantityAfter) * BigInt(unitCostMinor) === BigInt(event.valueAfterMinor)
  );
  if (!consistent) return false;

  if (ownerCertification >= 0) return true;

  return newestFirst.some((event) =>
    (event.eventType === "opening" || event.eventType === "purchase") &&
    event.costQuality === "confirmed" &&
    event.quantityAfter > 0 &&
    BigInt(event.quantityAfter) * BigInt(unitCostMinor) === BigInt(event.valueAfterMinor)
  );
}
