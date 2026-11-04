// Pure accounting rules shared by finance note and discounted receipt routes.
// Monetary values are integer agorot, never floating-point shekels.
const MAX_MINOR = 2_147_483_647;

type Line = {
  accountId: number;
  debitMinor: number;
  creditMinor: number;
  customerId?: number | null;
  supplierId?: number | null;
  memo?: string;
  [dimension: string]: unknown;
};

function positiveMinor(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_MINOR) {
    throw new Error("DISCOUNT_INVALID_" + field);
  }
  return value;
}

function positiveAccount(accountId: number) {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new Error("DISCOUNT_INVALID_ACCOUNT");
  }
}

export function validatedReceiptSettlement(
  cashMinor: number,
  discountMinor: number,
  customerDueMinor: number,
): number {
  positiveMinor(cashMinor, "RECEIPT");
  if (!Number.isSafeInteger(discountMinor) || discountMinor < 0 || discountMinor > MAX_MINOR) {
    throw new Error("DISCOUNT_INVALID_AMOUNT");
  }
  const settledMinor = cashMinor + discountMinor;
  if (!Number.isSafeInteger(settledMinor) || settledMinor > MAX_MINOR) {
    throw new Error("DISCOUNT_SETTLEMENT_OVERFLOW");
  }
  if (discountMinor > 0 &&
    (!Number.isSafeInteger(customerDueMinor) || customerDueMinor < settledMinor)) {
    throw new Error("DISCOUNT_EXCEEDS_CUSTOMER_BALANCE");
  }
  return settledMinor;
}

export function buildDiscountNoteLines(
  kind: "customer_credit" | "customer_debit" | "supplier_earned",
  amountMinor: number,
  offsetAccountId: number,
  partyAccountId: number,
  partyId: number,
): Line[] {
  positiveMinor(amountMinor, "AMOUNT");
  positiveAccount(offsetAccountId);
  positiveAccount(partyAccountId);
  if (offsetAccountId === partyAccountId) throw new Error("DISCOUNT_DUPLICATE_ACCOUNT");
  if (!Number.isSafeInteger(partyId) || partyId <= 0) throw new Error("DISCOUNT_INVALID_PARTY");
  const isCredit = kind !== "customer_debit";
  const partyDimension = kind === "supplier_earned"
    ? { supplierId: partyId }
    : { customerId: partyId };
  return [
    {
      accountId: offsetAccountId,
      debitMinor: isCredit ? amountMinor : 0,
      creditMinor: isCredit ? 0 : amountMinor,
    },
    {
      accountId: partyAccountId,
      ...partyDimension,
      debitMinor: isCredit ? 0 : amountMinor,
      creditMinor: isCredit ? amountMinor : 0,
    },
  ];
}

export function buildCustomerReceiptDiscountLines(
  cashOrBankLine: Line,
  customerReceivableLine: Line,
  discountAccountId: number | null,
  discountMinor: number,
): Line[] {
  const cashMinor = positiveMinor(cashOrBankLine.debitMinor, "RECEIPT");
  if (cashOrBankLine.creditMinor !== 0 ||
    customerReceivableLine.debitMinor !== 0 ||
    customerReceivableLine.creditMinor !== cashMinor) {
    throw new Error("DISCOUNT_RECEIPT_LINES_INVALID");
  }
  if (discountMinor === 0) return [cashOrBankLine, customerReceivableLine];
  if (discountAccountId == null) throw new Error("DISCOUNT_ACCOUNT_REQUIRED");
  positiveAccount(discountAccountId);
  if (cashOrBankLine.accountId === discountAccountId ||
    customerReceivableLine.accountId === discountAccountId ||
    cashOrBankLine.accountId === customerReceivableLine.accountId) {
    throw new Error("DISCOUNT_DUPLICATE_ACCOUNT");
  }
  validatedReceiptSettlement(cashMinor, discountMinor, MAX_MINOR);
  return [
    cashOrBankLine,
    {
      accountId: discountAccountId,
      debitMinor: discountMinor,
      creditMinor: 0,
      memo: "خصم مسموح به للزبون عند التسديد",
    },
    {
      ...customerReceivableLine,
      creditMinor: cashMinor + discountMinor,
    },
  ];
}
