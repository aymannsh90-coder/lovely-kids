// Dedicated ILS-only shipping-agent clearing flow. No bank or USD account is created.
export const IMPORT_AGENT_CODE = "IMPORT_AGENT_CLEARING";
export const IMPORT_FREIGHT_CODE = "IMPORT_FREIGHT_IN_TRANSIT";

export type ImportJournalDirection =
  | "fund_agent"
  | "pay_supplier"
  | "pay_freight"
  | "refund_to_bank_or_cash"
  | "settle_freight_on_purchase"
  | "refund_freight_to_agent"
  | "invalid";

export function classifyImportJournal(
  fromCode: string,
  fromKind: string,
  toCode: string,
  toKind: string,
): ImportJournalDirection | null {
  const isImportCode = (code: string) =>
    code === IMPORT_AGENT_CODE || code === IMPORT_FREIGHT_CODE;

  if (!isImportCode(fromCode) && !isImportCode(toCode)) {
    return null;
  }

  if (
    toCode === IMPORT_AGENT_CODE &&
    (fromKind === "bank" || fromKind === "cash")
  ) {
    return "fund_agent";
  }

  if (fromCode === IMPORT_AGENT_CODE && toKind === "supplier") {
    return "pay_supplier";
  }

  if (fromCode === IMPORT_AGENT_CODE && toCode === IMPORT_FREIGHT_CODE) {
    return "pay_freight";
  }

  if (
    fromCode === IMPORT_AGENT_CODE &&
    (toKind === "bank" || toKind === "cash")
  ) {
    return "refund_to_bank_or_cash";
  }

  if (fromCode === IMPORT_FREIGHT_CODE && toKind === "supplier") {
    return "settle_freight_on_purchase";
  }

  if (fromCode === IMPORT_FREIGHT_CODE && toCode === IMPORT_AGENT_CODE) {
    return "refund_freight_to_agent";
  }

  return "invalid";
}

export function importDebitBalanceAllows(
  balanceMinor: number,
  amountMinor: number,
): boolean {
  return Number.isSafeInteger(balanceMinor) &&
    Number.isSafeInteger(amountMinor) &&
    amountMinor > 0 &&
    balanceMinor >= amountMinor;
}

export function freightCanSettleAgainstPayable(
  supplierPayableMinor: number,
  freightMinor: number,
): boolean {
  return importDebitBalanceAllows(supplierPayableMinor, freightMinor);
}
