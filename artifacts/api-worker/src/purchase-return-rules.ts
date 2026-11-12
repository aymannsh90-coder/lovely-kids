/**
 * Financial/quantity rules for purchase returns.
 * All monetary calculations use integer minor units (agorot).
 * Product/variant stock remains a separate physical quantity dimension.
 */
export function allocateMinor(total: number, part: number, overall: number): number {
  if (![total, part, overall].every(Number.isSafeInteger) || total < 0 || part < 0 || overall <= 0 || part > overall) {
    throw new Error("INVALID_PURCHASE_RETURN_ALLOCATION");
  }
  if (part === 0 || total === 0) return 0;
  if (part === overall) return total;
  return Number(BigInt(total) * BigInt(part) / BigInt(overall));
}

export function splitAmount(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(weights) ||
      !weights.every(x => Number.isSafeInteger(x) && x >= 0)) {
    throw new Error("INVALID_PURCHASE_RETURN_SPLIT");
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(sum) || (sum === 0 && total > 0)) throw new Error("INVALID_PURCHASE_RETURN_SPLIT");
  let priorWeight = 0, priorAmount = 0;
  return weights.map(weight => {
    priorWeight += weight;
    const next = sum > 0 ? allocateMinor(total, priorWeight, sum) : 0;
    const amount = next - priorAmount;
    priorAmount = next;
    return amount;
  });
}

export function computeReturnRefundMinor(input: {
  originalAmountMinor: number;
  originalQuantity: number;
  previouslyReturnedQuantity: number;
  previouslyRefundedMinor: number;
  returnQuantity: number;
}): number {
  const { originalAmountMinor: total, originalQuantity: bought,
    previouslyReturnedQuantity: priorQty, previouslyRefundedMinor: priorMinor,
    returnQuantity: qty } = input;
  if (![total, bought, priorQty, priorMinor, qty].every(Number.isSafeInteger) ||
      total < 0 || bought <= 0 || priorQty < 0 || priorMinor < 0 ||
      qty <= 0 || priorQty + qty > bought || priorMinor > total) {
    throw new Error("PURCHASE_RETURN_EXCEEDS_ORIGINAL");
  }
  const remaining = total - priorMinor;
  if (qty === bought - priorQty) return remaining;
  return Math.min(remaining, allocateMinor(total, qty, bought));
}

export function distributeFullReturn(
  remainingQuantity: number,
  options: ReadonlyArray<{ stock: number | null; allowed?: boolean }>,
): number[] {
  if (!Number.isSafeInteger(remainingQuantity) || remainingQuantity < 0) throw new Error("INVALID_PURCHASE_RETURN_QUANTITY");
  let remaining = remainingQuantity;
  const result = options.map(option => {
    const stock = option.allowed === false ? 0 : option.stock;
    if (stock === null || !Number.isSafeInteger(stock) || stock < 0) return 0;
    const quantity = Math.min(remaining, stock);
    remaining -= quantity;
    return quantity;
  });
  if (remaining) throw new Error("INSUFFICIENT_PHYSICAL_STOCK");
  return result;
}
