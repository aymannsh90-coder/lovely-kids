/**
 * Prove that a pending supplier receipt has already been costed by one
 * confirmed manual opening and its subsequent frozen sale-cost movements.
 *
 * This NEVER changes inventory or accounting state. It returns a reuse plan
 * only for an exact, lossless match. Everything else stays on the normal
 * purchase approval path or fails closed.
 */
export type ExistingReceiptCostLedgerEvent = {
  sourceType: string | null;
  eventType: string;
  quantityDelta: number;
  inventoryValueDeltaMinor: number;
  costQuality: string;
};

export type ExistingReceiptCostPlan = {
  stockQuantityApplied: number;
  stockCostTotalMinor: number;
  historicalSoldQuantity: number;
  historicalSoldCostTotalMinor: number;
};

export function proveExistingReceiptCost(input: {
  receivedQuantity: number;
  receiptCostTotalMinor: number;
  pendingReceiptQuantity: number;
  deferredSoldQuantity: number;
  physicalQuantity: number;
  costQuantity: number;
  costValueMinor: number;
  referenceUnitCostMinor: number;
  costQuality: string | null;
  ledger: ExistingReceiptCostLedgerEvent[];
}): ExistingReceiptCostPlan | null {
  const {
    receivedQuantity, receiptCostTotalMinor, pendingReceiptQuantity,
    deferredSoldQuantity, physicalQuantity, costQuantity, costValueMinor,
    referenceUnitCostMinor, costQuality, ledger,
  } = input;

  const integer = (n: number) => Number.isSafeInteger(n);
  if (![receivedQuantity, receiptCostTotalMinor, pendingReceiptQuantity,
      deferredSoldQuantity, physicalQuantity, costQuantity, costValueMinor,
      referenceUnitCostMinor].every(integer) ||
      receivedQuantity <= 0 || receiptCostTotalMinor < 0 ||
      physicalQuantity < 0 || costQuantity < 0 || costValueMinor < 0 ||
      referenceUnitCostMinor < 0 || pendingReceiptQuantity !== receivedQuantity ||
      deferredSoldQuantity !== 0 || costQuality !== "confirmed" ||
      costQuantity !== physicalQuantity || physicalQuantity > receivedQuantity ||
      ledger.length === 0) {
    return null;
  }

  // This path is deliberately restricted to a flat exact cost. Discounts,
  // freebies, weighted-cost changes and estimated opening values require
  // explicit accounting treatment rather than a silent reuse.
  if (receiptCostTotalMinor !== receivedQuantity * referenceUnitCostMinor ||
      costValueMinor !== physicalQuantity * referenceUnitCostMinor) {
    return null;
  }

  let openings = 0;
  let soldQuantity = 0;
  let quantityInLedger = 0;
  let valueInLedger = 0;

  for (const event of ledger) {
    if (!integer(event.quantityDelta) ||
        !integer(event.inventoryValueDeltaMinor) ||
        event.costQuality !== "confirmed") {
      return null;
    }

    quantityInLedger += event.quantityDelta;
    valueInLedger += event.inventoryValueDeltaMinor;
    if (!integer(quantityInLedger) || !integer(valueInLedger)) return null;

    if (event.sourceType === "manual_opening" &&
        event.eventType === "opening") {
      openings += 1;
      if (event.quantityDelta !== receivedQuantity ||
          event.inventoryValueDeltaMinor !== receiptCostTotalMinor) return null;
      continue;
    }

    if (((event.sourceType === "pos_sale" && event.eventType === "pos_sale") ||
         (event.sourceType === "online_order" && event.eventType === "online_order")) &&
        event.quantityDelta < 0 &&
        event.inventoryValueDeltaMinor ===
          event.quantityDelta * referenceUnitCostMinor) {
      soldQuantity -= event.quantityDelta;
      continue;
    }

    // Returns, adjustments, past approved purchases and unknown source types
    // must never be silently absorbed into a new supplier invoice.
    return null;
  }

  if (openings !== 1 ||
      quantityInLedger !== costQuantity ||
      valueInLedger !== costValueMinor ||
      soldQuantity !== receivedQuantity - physicalQuantity) {
    return null;
  }

  const historicalSoldCostTotalMinor =
    soldQuantity * referenceUnitCostMinor;
  if (!integer(historicalSoldCostTotalMinor) ||
      costValueMinor + historicalSoldCostTotalMinor !== receiptCostTotalMinor) {
    return null;
  }

  return {
    stockQuantityApplied: physicalQuantity,
    stockCostTotalMinor: costValueMinor,
    historicalSoldQuantity: soldQuantity,
    historicalSoldCostTotalMinor,
  };
}
