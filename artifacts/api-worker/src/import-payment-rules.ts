/**
 * Currency-safe plan for a USD supplier prepayment using an EXISTING USD bank asset.
 * Pure functions only; callers must obtain balances and spot rate from trusted
 * ledger/memo sources and post under one atomic idempotent DB transaction.
 * Accounting base currency: ILS; money amounts are minor units.
 */
export type UsdAdvanceInput = {
  paymentUsdMinor: number;
  sourceUsdBalanceMinor: number;
  sourceIlsBookBalanceMinor: number;
  paymentSpotRateMicros: number;
};

export type UsdAdvancePlan = {
  paymentUsdMinor: number;
  bankBookCreditIlsMinor: number;
  supplierAdvanceDebitIlsMinor: number;
  realizedFxGainCreditIlsMinor: number;
  realizedFxLossDebitIlsMinor: number;
  bankBookExchangeRateMicros: number;
  paymentSpotExchangeRateMicros: number;
};

const MAX = 2_147_483_647;
function positive(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value <= 0 || value > MAX) {
    throw new Error("IMPORT_PAYMENT_INVALID_" + label);
  }
  return value;
}
function roundedDiv(n: bigint, d: bigint) {
  return (n + (d / 2n)) / d;
}
function safe(n: bigint, label: string) {
  if (n <= 0n || n > BigInt(MAX)) throw new Error("IMPORT_PAYMENT_OVERFLOW_" + label);
  return Number(n);
}
function exactBookRate(bookIlsMinor: number, usdMinor: number) {
  const base = roundedDiv(BigInt(bookIlsMinor) * 1_000_000n, BigInt(usdMinor));
  for (const candidate of [base,base-1n,base+1n,base-2n,base+2n]) {
    if (candidate <= 0n || candidate > BigInt(MAX)) continue;
    if (roundedDiv(BigInt(usdMinor) * candidate, 1_000_000n) === BigInt(bookIlsMinor)) {
      return Number(candidate);
    }
  }
  throw new Error("IMPORT_PAYMENT_BANK_BOOK_RATE_NOT_EXACT");
}

/** Preserve booked foreign bank balance; never credit the bank at market FX. */
export function planUsdSupplierAdvance(input: UsdAdvanceInput): UsdAdvancePlan {
  const amount = positive(input.paymentUsdMinor, "USD_AMOUNT");
  const bankUsd = positive(input.sourceUsdBalanceMinor, "SOURCE_USD_BALANCE");
  const bookIls = positive(input.sourceIlsBookBalanceMinor, "SOURCE_ILS_BOOK_BALANCE");
  const spot = positive(input.paymentSpotRateMicros, "SPOT_RATE");
  if (amount > bankUsd) throw new Error("IMPORT_PAYMENT_INSUFFICIENT_USD");

  const bookCreditBig = amount === bankUsd
    ? BigInt(bookIls)
    : roundedDiv(BigInt(bookIls) * BigInt(amount), BigInt(bankUsd));
  const bankCredit = safe(bookCreditBig, "BANK_CREDIT");
  const advance = safe(
    roundedDiv(BigInt(amount) * BigInt(spot), 1_000_000n), "ADVANCE",
  );
  const difference = advance - bankCredit;
  const gain = difference > 0 ? difference : 0;
  const loss = difference < 0 ? -difference : 0;

  if (advance + loss !== bankCredit + gain) {
    throw new Error("IMPORT_PAYMENT_JOURNAL_NOT_BALANCED");
  }
  return {
    paymentUsdMinor: amount,
    bankBookCreditIlsMinor: bankCredit,
    supplierAdvanceDebitIlsMinor: advance,
    realizedFxGainCreditIlsMinor: gain,
    realizedFxLossDebitIlsMinor: loss,
    bankBookExchangeRateMicros: exactBookRate(bankCredit, amount),
    paymentSpotExchangeRateMicros: spot,
  };
}
