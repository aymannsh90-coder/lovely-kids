/**
 * Read-only courier reconciliation math. Amounts are always integer agorot.
 * Ledger AR and AP remain separate; this computes the displayed net.
 */
export function remainingExchangePayableMinor(
  grossPayableMinor: number,
  accountedPayableMinor: number,
): number {
  if (!Number.isSafeInteger(grossPayableMinor) ||
      !Number.isSafeInteger(accountedPayableMinor) ||
      grossPayableMinor < 0 || accountedPayableMinor < 0) {
    throw new Error("INVALID_COURIER_EXCHANGE_AMOUNT");
  }
  return Math.max(0, grossPayableMinor - accountedPayableMinor);
}

export function netCourierReceivableMinor(
  grossReceivableMinor: number,
  currentUnappliedExchangeMinor: number,
): number {
  if (!Number.isSafeInteger(grossReceivableMinor) ||
      !Number.isSafeInteger(currentUnappliedExchangeMinor) ||
      grossReceivableMinor < 0 || currentUnappliedExchangeMinor < 0) {
    throw new Error("INVALID_COURIER_RECEIVABLE_AMOUNT");
  }
  return grossReceivableMinor - currentUnappliedExchangeMinor;
}
