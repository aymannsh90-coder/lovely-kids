/**
 * Read-only reallocation preview for legacy online exchange return costs.
 * The ledger and any closed period are NEVER changed by this helper.
 * A POS cash difference without an exchange journal is a review item,
 * not evidence of a missing cash payment.
 */
export function historicalReturnProfitShiftMinor(
  from: string,
  to: string,
  financialBusinessDate: string,
  receivedBusinessDate: string,
  costMinor: number,
): number {
  if (!Number.isSafeInteger(costMinor) || costMinor < 0) {
    throw new RangeError("Invalid historical return cost");
  }
  const financialIncluded = financialBusinessDate >= from && financialBusinessDate <= to;
  const receiptIncluded = receivedBusinessDate >= from && receivedBusinessDate <= to;
  return (financialIncluded ? costMinor : 0) - (receiptIncluded ? costMinor : 0);
}
