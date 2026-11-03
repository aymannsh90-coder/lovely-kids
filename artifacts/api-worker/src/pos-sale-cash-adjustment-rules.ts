/**
 * Pure accounting rules shared by the POS sale-edit posting and void paths.
 * Amounts are integer agorot. A sale edit changes NET store cash and income,
 * never the original tender amount displayed on the receipt.
 */
export interface PosCashAdjustmentLine {
  accountId: number;
  debitMinor: number;
  creditMinor: number;
}

export function cashEditEvent(revisionId: number): string {
  if (!Number.isSafeInteger(revisionId) || revisionId <= 0) {
    throw new Error("POS_CASH_EDIT_INVALID_REVISION");
  }
  return `cash_edit:${revisionId}`;
}

export function cashEditVoidEvent(revisionId: number): string {
  if (!Number.isSafeInteger(revisionId) || revisionId <= 0) {
    throw new Error("POS_CASH_EDIT_INVALID_REVISION");
  }
  return `cash_edit_void:${revisionId}`;
}

export function cashEditRevisionFromEvent(event: string): number | null {
  const match = /^cash_edit:([1-9][0-9]*)$/.exec(event);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

export function buildPosCashEditLines(
  cashAccountId: number,
  salesAccountId: number,
  newTotalMinor: number,
  oldTotalMinor: number,
): PosCashAdjustmentLine[] {
  if (
    !Number.isSafeInteger(newTotalMinor) ||
    !Number.isSafeInteger(oldTotalMinor) ||
    newTotalMinor < 0 ||
    oldTotalMinor < 0 ||
    !Number.isSafeInteger(cashAccountId) ||
    !Number.isSafeInteger(salesAccountId) ||
    cashAccountId <= 0 ||
    salesAccountId <= 0 ||
    cashAccountId === salesAccountId
  ) {
    throw new Error("POS_CASH_EDIT_INVALID_AMOUNT_OR_ACCOUNT");
  }
  const delta = newTotalMinor - oldTotalMinor;
  if (!delta) return [];
  const amount = Math.abs(delta);
  if (delta > 0) {
    return [
      { accountId: cashAccountId, debitMinor: amount, creditMinor: 0 },
      { accountId: salesAccountId, debitMinor: 0, creditMinor: amount },
    ];
  }
  return [
    { accountId: salesAccountId, debitMinor: amount, creditMinor: 0 },
    { accountId: cashAccountId, debitMinor: 0, creditMinor: amount },
  ];
}

export function cashAccountNetMinor(
  lines: ReadonlyArray<PosCashAdjustmentLine>,
  accountId: number,
): number {
  return lines.reduce(
    (total, line) =>
      total + (line.accountId === accountId ? line.debitMinor - line.creditMinor : 0),
    0,
  );
}

export function assertPostedSaleCashMatches(
  saleTotalMinor: number,
  postedCashMinor: number,
  postedIncomeMinor: number,
): void {
  if (
    !Number.isSafeInteger(saleTotalMinor) ||
    !Number.isSafeInteger(postedCashMinor) ||
    !Number.isSafeInteger(postedIncomeMinor) ||
    saleTotalMinor < 0 ||
    postedCashMinor !== saleTotalMinor ||
    postedIncomeMinor !== saleTotalMinor
  ) {
    throw new Error("POS_CASH_LEDGER_OUT_OF_SYNC");
  }
}

export function reverseCashJournalLines(
  lines: ReadonlyArray<PosCashAdjustmentLine>,
): PosCashAdjustmentLine[] {
  return lines.map(line => ({
    accountId: line.accountId,
    debitMinor: line.creditMinor,
    creditMinor: line.debitMinor,
  }));
}
