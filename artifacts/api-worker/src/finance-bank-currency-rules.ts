/**
 * Keep bank account displays and financial postings on one currency basis.
 *
 * ILS is the accounting base currency: its bank balance MUST use the signed
 * debit-minus-credit ledger total, not an optional currency metadata column.
 * Foreign-currency accounts still use their currency amounts.
 */
export function bankDisplayBalanceMinor(
  currencyCode: string,
  baseBalanceMinor: number,
  currencyBalanceMinor: number,
): number {
  return currencyCode === "ILS"
    ? baseBalanceMinor
    : currencyBalanceMinor;
}

interface BankPostingCurrencyLine {
  accountId: number;
  debitMinor: number;
  creditMinor: number;
  currencyCode: string | null;
  currencyAmountMinor: number | null;
  exchangeRateMicros: number | null;
}

/**
 * Only bank-linked finance lines are passed a currency code. A missing ILS
 * metadata triple can be safely derived from the already-balanced base line;
 * a partial or contradictory triple must never be silently overwritten.
 */
export function ensureBankPostingCurrency<T extends BankPostingCurrencyLine>(
  line: T,
  bankCurrencyCode: string | null,
): T {
  if (bankCurrencyCode === null) {
    return line;
  }

  const baseMinor = Math.max(line.debitMinor, line.creditMinor);
  const allMissing =
    line.currencyCode === null &&
    line.currencyAmountMinor === null &&
    line.exchangeRateMicros === null;

  if (allMissing && bankCurrencyCode === "ILS") {
    return {
      ...line,
      currencyCode: "ILS",
      currencyAmountMinor: baseMinor,
      exchangeRateMicros: 1_000_000,
    };
  }

  if (
    line.currencyCode !== bankCurrencyCode ||
    line.currencyAmountMinor === null ||
    line.exchangeRateMicros === null ||
    (bankCurrencyCode === "ILS" &&
      (line.currencyAmountMinor !== baseMinor ||
        line.exchangeRateMicros !== 1_000_000))
  ) {
    throw new Error("BANK_LEDGER_CURRENCY_METADATA_INVALID");
  }

  return line;
}
