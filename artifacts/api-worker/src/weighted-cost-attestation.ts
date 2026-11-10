/**
 * Read-only proof for the owner's confirmation of a frozen moving-average cost.
 *
 * Previous purchase batches may have different prices. What must remain true is:
 * - the complete cost ledger reconciles without gaps or fabricated adjustments;
 * - every cost-bearing acquisition was recorded as confirmed;
 * - since the latest acquisition, every balance and movement uses the proposed
 *   current average; and
 * - the caller separately verifies the physical stock and every sale/return
 *   snapshot before writing the owner's attestation.
 *
 * This NEVER identifies the original sale of a no-receipt return.
 */
export type WeightedCostLedgerRow = {
  eventType: string;
  sourceType: string | null;
  quantityDelta: number;
  valueDeltaMinor: number;
  quantityAfter: number;
  valueAfterMinor: number;
  costQuality: string;
};

const NON_ACQUISITION_EVENTS = new Set([
  "purchase_void",
  "purchase_return",
  "purchase_return_void",
  "pos_sale",
  "pos_sale_void",
  "pos_sale_edit_reverse",
  "pos_return",
  "pos_mobile_return",
  "pos_return_void",
  "online_order",
  "online_order_cancel",
  "online_order_edit_reverse",
  "exchange_return",
  "exchange_sale",
  "exchange_return_void",
  "exchange_sale_void",
  "adjustment_out",
]);

function safeMinor(value: number): boolean {
  return Number.isSafeInteger(value) && Math.abs(value) <= 2_147_483_647;
}

export function hasAuditableWeightedCostHistory(
  rows: WeightedCostLedgerRow[],
  proposedUnitCostMinor: number,
  currentQuantity: number,
  currentValueMinor: number,
): boolean {
  if (!Array.isArray(rows) || rows.length === 0 ||
      !safeMinor(proposedUnitCostMinor) || proposedUnitCostMinor < 0 ||
      !safeMinor(currentQuantity) || currentQuantity < 0 ||
      !safeMinor(currentValueMinor) || currentValueMinor < 0) {
    return false;
  }

  let quantity = 0;
  let value = 0;
  let lastAcquisitionIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!safeMinor(row.quantityDelta) || !safeMinor(row.valueDeltaMinor) ||
        !safeMinor(row.quantityAfter) || row.quantityAfter < 0 ||
        !safeMinor(row.valueAfterMinor) || row.valueAfterMinor < 0 ||
        row.quantityAfter !== quantity + row.quantityDelta ||
        row.valueAfterMinor !== value + row.valueDeltaMinor) {
      return false;
    }

    const acquisition = row.eventType === "opening" ||
      row.eventType === "purchase" || row.eventType === "adjustment_in";
    if (acquisition) {
      if (row.quantityDelta <= 0 || row.valueDeltaMinor < 0 ||
          row.costQuality !== "confirmed" ||
          (row.eventType === "opening" && i !== 0) ||
          (row.eventType === "adjustment_in" && row.sourceType !== "manual_stock")) {
        return false;
      }
      lastAcquisitionIndex = i;
    } else if (row.eventType === "correction" &&
               row.sourceType === "owner_cost_quality_attestation") {
      if (row.quantityDelta !== 0 || row.valueDeltaMinor !== 0 ||
          row.costQuality !== "confirmed") return false;
    } else if (!NON_ACQUISITION_EVENTS.has(row.eventType) ||
               row.quantityDelta === 0 ||
               (row.quantityDelta > 0 && row.valueDeltaMinor < 0) ||
               (row.quantityDelta < 0 && row.valueDeltaMinor > 0)) {
      return false;
    }

    if (i === 0 && !acquisition) return false;
    quantity = row.quantityAfter;
    value = row.valueAfterMinor;
  }

  if (lastAcquisitionIndex < 0 ||
      quantity !== currentQuantity || value !== currentValueMinor ||
      BigInt(currentQuantity) * BigInt(proposedUnitCostMinor) !== BigInt(currentValueMinor)) {
    return false;
  }

  // Before the latest batch, prices may legitimately differ. After that
  // batch, the frozen average must reconcile at EVERY step, not just today.
  for (let i = lastAcquisitionIndex; i < rows.length; i++) {
    const row = rows[i];
    if (BigInt(row.quantityAfter) * BigInt(proposedUnitCostMinor) !== BigInt(row.valueAfterMinor)) {
      return false;
    }
    if (i > lastAcquisitionIndex &&
        BigInt(row.quantityDelta) * BigInt(proposedUnitCostMinor) !== BigInt(row.valueDeltaMinor)) {
      return false;
    }
  }
  return true;
}


/** Snapshot values are immutable: earlier *confirmed* sales legitimately
 * have the unit cost in effect when they were sold, not today's average.
 * Only unresolved estimated/mixed snapshots must match the unit cost the
 * owner is attesting now. A malformed snapshot is never accepted.
 */
export type FrozenCostSnapshot = {
  quantity: number;
  unitCostMinor: number;
  totalMinor: number;
  costQuality: string;
};

export function saleSnapshotsPermitCostAttestation(
  snapshots: FrozenCostSnapshot[],
  proposedUnitCostMinor: number,
): boolean {
  if (!safeMinor(proposedUnitCostMinor) || proposedUnitCostMinor < 0) return false;
  return snapshots.every((snapshot) => (
    safeMinor(snapshot.quantity) && snapshot.quantity > 0 &&
    safeMinor(snapshot.unitCostMinor) && snapshot.unitCostMinor >= 0 &&
    safeMinor(snapshot.totalMinor) && snapshot.totalMinor >= 0 &&
    BigInt(snapshot.quantity) * BigInt(snapshot.unitCostMinor) === BigInt(snapshot.totalMinor) &&
    (snapshot.costQuality === "confirmed" ||
      ((snapshot.costQuality === "mixed" || snapshot.costQuality === "estimated") &&
        snapshot.unitCostMinor === proposedUnitCostMinor))
  ));
}
