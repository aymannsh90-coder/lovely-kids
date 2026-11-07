/**
 * Customer receivable balances are debit-positive (customer owes the shop).
 * A negative balance is a credit the shop owes to the customer.
 * Payouts settle that credit and must never turn into a new customer loan.
 */
export function isCustomerCreditPayoutWithinBalance(
  balanceMinor: number,
  amountMinor: number,
): boolean {
  return (
    Number.isSafeInteger(balanceMinor) &&
    Number.isSafeInteger(amountMinor) &&
    balanceMinor < 0 &&
    amountMinor > 0 &&
    amountMinor <= -balanceMinor
  );
}
