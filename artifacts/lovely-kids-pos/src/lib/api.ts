const fallbackApiBaseUrl = "https://api.lovelykids.net";

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || fallbackApiBaseUrl
).replace(/\/+$/, "");

const configuredRegisterKey = (import.meta.env.VITE_POS_REGISTER_KEY || "main")
  .trim()
  .toLowerCase();

export const POS_REGISTER_KEY = /^[a-z0-9_-]{1,50}$/.test(configuredRegisterKey)
  ? configuredRegisterKey
  : "main";

export interface PosUser {
  id: string | number;
  name: string;
  phone?: string | null;
  email?: string | null;
  isAdmin: boolean;
  isOwner: boolean;
}

export interface CashSession {
  id: string;
  registerKey: string;
  businessDate: string;
  openedByUserId: string;
  closedByUserId: string | null;
  openingBalanceMinor: number;
  openingBalance: number;
  closingBalanceMinor: number | null;
  closingBalance: number | null;
  expectedBalanceMinor: number | null;
  expectedBalance: number | null;
  currencyCode: string;
  status: "open" | "closed";
  openingNote: string | null;
  closingNote: string | null;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(options.headers);

  headers.set("Accept", "application/json");

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    let message = `فشل الطلب برمز ${response.status}`;

    if (
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
    ) {
      message = payload.error;
    }

    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export function loginPos(phone: string, password: string) {
  return apiRequest<{
    token: string;
    user: PosUser;
  }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      phone,
      password,
    }),
  });
}

export function getCurrentPosUser(token: string) {
  return apiRequest<PosUser>("/api/auth/me", {}, token);
}

export function getCurrentCashSession(token: string, registerKey = "main") {
  const register = encodeURIComponent(registerKey);

  return apiRequest<{
    session: CashSession | null;
  }>(`/api/pos/cash-sessions/current?register=${register}`, {}, token);
}

export function openCashSession(
  token: string,
  input: {
    registerKey?: string;
    currencyCode?: string;
    openingBalance: string;
    openingNote?: string;
  },
) {
  return apiRequest<{
    session: CashSession;
    alreadyOpen: boolean;
  }>(
    "/api/pos/cash-sessions/open",
    {
      method: "POST",
      body: JSON.stringify({
        registerKey: input.registerKey ?? "main",
        currencyCode: input.currencyCode || undefined,
        openingBalance: input.openingBalance,
        openingNote: input.openingNote || undefined,
      }),
    },
    token,
  );
}

export function closeCashSession(
  token: string,
  input: {
    sessionId: string;
    registerKey?: string;
    closingBalance: string;
    closingNote?: string;
  },
) {
  return apiRequest<{
    session: CashSession;
    alreadyClosed: boolean;
    varianceMinor: number;
    variance: number;
  }>(
    "/api/pos/cash-sessions/close",
    {
      method: "POST",
      body: JSON.stringify({
        sessionId: input.sessionId,
        registerKey: input.registerKey ?? "main",
        closingBalance: input.closingBalance,
        closingNote: input.closingNote || undefined,
      }),
    },
    token,
  );
}

export function logoutPos(token: string) {
  return apiRequest<void>(
    "/api/auth/logout",
    {
      method: "POST",
    },
    token,
  );
}

export interface PosSizeStock {
  size: string;
  outOfStock?: boolean;
  stock?: number | null;
}

export interface PosColorVariant {
  color: string;
  hex: string;
  image?: string;
  sizes: PosSizeStock[];
}

export interface PosProductBarcode {
  barcode: string;
  color: string | null;
  size: string | null;
}

export interface PosProductLookup {
  productId: string;
  barcode: string | null;
  primaryBarcode?: string | null;
  barcodes?: PosProductBarcode[];
  productCode: string | null;
  nameAr: string;
  image: string;
  websiteUnitPrice: number;
  websiteUnitPriceMinor: number;
  mappedColor: string | null;
  mappedSize: string | null;
  sizes: string[];
  colorVariants: PosColorVariant[];
  stock: number | null;
  outOfStock: boolean;
}

export interface PosAdminInventoryProduct {
  id: string;
  nameAr: string;
  productCode: string | null;
  barcode: string | null;
  price: number;
  image: string;
  category: string;
  colorVariants: PosColorVariant[];
  stock: number | null;
  isHidden: boolean;
  deletedAt: string | null;
}

export type PosManualStockCostMode =
  | "same"
  | "new";

export interface PosManualStockCostInput {
  costMode?: PosManualStockCostMode;
  unitCostMinor?: number;
}

export function getPosAdminInventoryProducts(
  token: string,
) {
  return apiRequest<PosAdminInventoryProduct[]>(
    "/api/products/admin",
    {},
    token,
  );
}

export function setPosGeneralStock(
  token: string,
  productId: string | number,
  input: {
    amount: number;
  } & PosManualStockCostInput,
) {
  return apiRequest<PosAdminInventoryProduct>(
    `/api/products/${encodeURIComponent(String(productId))}/stock`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "set",
        amount: input.amount,
        costMode: input.costMode,
        unitCostMinor:
          input.unitCostMinor,
      }),
    },
    token,
  );
}

export function setPosVariantStock(
  token: string,
  productId: string | number,
  input: {
    color: string;
    size: string;
    amount: number;
  } & PosManualStockCostInput,
) {
  return apiRequest<PosAdminInventoryProduct>(
    `/api/products/${encodeURIComponent(String(productId))}/variant-stock`,
    {
      method: "PATCH",
      body: JSON.stringify({
        color: input.color,
        size: input.size,
        action: "set",
        amount: input.amount,
        costMode: input.costMode,
        unitCostMinor:
          input.unitCostMinor,
      }),
    },
    token,
  );
}


export interface PosSaleItemResult {
  id: string;
  productId: string | null;
  lineNumber: number;
  barcode: string | null;
  productCode: string | null;
  productNameAr: string;
  productImage: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  websiteUnitPriceMinor: number;
  websiteUnitPrice: number;
  soldUnitPriceMinor: number;
  soldUnitPrice: number;
  lineDiscountMinor: number;
  lineDiscount: number;
  lineTotalMinor: number;
  lineTotal: number;
  generalStockBefore: number | null;
  generalStockAfter: number | null;
  variantStockBefore: number | null;
  variantStockAfter: number | null;
}

export interface PosSaleResult {
  alreadyCreated: boolean;
  sale: {
    id: string;
    publicId: string;
    cashSessionId: string;
    registerKey: string;
    businessDate: string;
    cashierUserId: string;
    status: string;
    paymentMethod: string;
    cardProcessor:
      | "arab"
      | "bop"
      | null;

    cashTender:
      | {
          currencyCode: string;
          currencyAmountMinor: number;
          exchangeRateMicros: number;
          baseReceivedMinor: number;
          changeMinor: number;
          cashSessionId: number | null;
        }
      | null;

    customerId: string | null;
    customerBalanceMinor: number | null;
    customerBalance: number | null;

    accountDueMinor: number;
    accountDue: number;
    subtotalMinor: number;
    subtotal: number;
    discountMinor: number;
    discount: number;
    itemDiscountMinor: number;
    itemDiscount: number;
    invoiceDiscountMinor: number;
    invoiceDiscount: number;
    totalMinor: number;
    total: number;
    paidMinor: number;
    paid: number;
    changeMinor: number;
    change: number;
    customerName: string | null;
    customerPhone: string | null;
    notes: string | null;

    voidedAt: string | null;
    voidedByUserId: string | null;
    voidReason: string | null;

    createdAt: string;
    updatedAt: string;
  };
  navigation?: {
    previousPublicId: string | null;
    nextPublicId: string | null;
  };
  items: PosSaleItemResult[];
}

export interface PosProductSearchResult {
  query: string;
  results: PosProductLookup[];
}

export function searchPosProducts(token: string, query: string, limit = 15) {
  const search = encodeURIComponent(query.trim());

  const resultLimit = Math.min(25, Math.max(1, Math.trunc(limit)));

  return apiRequest<PosProductSearchResult>(
    `/api/pos/products/search?q=${search}&limit=${resultLimit}`,
    {},
    token,
  );
}

export function lookupPosProductByBarcode(token: string, barcode: string) {
  return apiRequest<PosProductLookup>(
    `/api/pos/products/by-barcode?barcode=${encodeURIComponent(barcode)}`,
    {},
    token,
  );
}


export type InventoryMovementType =
  | "purchase"
  | "purchase_void"
  | "pos_sale"
  | "pos_sale_void"
  | "pos_sale_edit"
  | "pos_sale_return"
  | "pos_sale_return_void"
  | "online_order"
  | "online_order_cancel"
  | "online_order_restore"
  | "online_order_edit"
  | "adjustment";

export interface PosInventoryMovement {
  id: number;
  productId: number | null;

  barcode: string | null;
  productCode: string | null;
  productNameAr: string;

  color: string | null;
  size: string | null;

  movementType: InventoryMovementType;
  quantityDelta: number;

  generalStockBefore: number | null;
  generalStockAfter: number | null;

  variantStockBefore: number | null;
  variantStockAfter: number | null;

  sourceType:
    | "pos_purchase"
    | "pos_sale"
    | "pos_sale_return"
    | "online_order"
    | "manual";

  sourceId: number | null;
  sourceItemId: number | null;
  sourcePublicId: string | null;

  eventKey: string;
  occurredAt: string;
}

export interface PosProductCardResult {
  product: PosProductLookup;
  movements: PosInventoryMovement[];
}

export function getPosProductCard(
  token: string,
  productId: string,
) {
  return apiRequest<PosProductCardResult>(
    `/api/pos/inventory/product-card?productId=${encodeURIComponent(productId)}`,
    {},
    token,
  );
}

export interface PosCustomer {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;

  creditLimitMinor: number | null;

  status:
    | "active"
    | "inactive";

  balanceMinor: number;
  balance: number;

  createdAt: string;
  updatedAt: string;
}

export interface PosCustomerListResult {
  results: PosCustomer[];
}

export function getPosCustomers(
  token: string,
  options: {
    query?: string;
    status?:
      | "active"
      | "inactive";
  } = {},
) {
  const params =
    new URLSearchParams();

  if (options.query?.trim()) {
    params.set(
      "query",
      options.query.trim(),
    );
  }

  if (options.status) {
    params.set(
      "status",
      options.status,
    );
  }

  const query =
    params.toString();

  return apiRequest<PosCustomerListResult>(
    `/api/pos/customers${query ? `?${query}` : ""}`,
    {},
    token,
  );
}


export interface PosCustomerLedgerEntry {
  transactionId:
    | number
    | string
    | null;

  publicId: string | null;
  transactionType: string | null;
  sourceType: string | null;
  sourceId: string | null;
  sourceEvent: string | null;
  status: string | null;
  businessDate: string | null;
  createdAt: string;

  debitMinor: number;
  creditMinor: number;

  memo: string | null;
}

export interface PosCustomerLedgerResult {
  customer: {
    id: number;
    code: string;
    name: string;
    phone: string | null;
    address: string | null;
    notes: string | null;
    creditLimitMinor: number | null;
    status: string;
  };

  balanceMinor: number;
  balance: number;

  entries: PosCustomerLedgerEntry[];
}

export function createPosCustomer(
  token: string,
  input: {
    name: string;
    phone?: string;
    address?: string;
    notes?: string;
    creditLimit?: string;
  },
) {
  return apiRequest<{
    customer: PosCustomer;
  }>(
    "/api/pos/customers",
    {
      method: "POST",
      body: JSON.stringify(
        input,
      ),
    },
    token,
  );
}

export function getPosCustomerLedger(
  token: string,
  customerId: number,
) {
  return apiRequest<PosCustomerLedgerResult>(
    `/api/pos/customers/${customerId}/ledger`,
    {},
    token,
  );
}

export function createPosCustomerReceipt(
  token: string,
  customerId: number,
  input: {
    amount: string;
    paymentMethod:
      | "cash"
      | "card";
    cardProcessor?:
      | "arab"
      | "bop";
    registerKey: string;
    notes?: string;
    idempotencyKey: string;
  },
) {
  return apiRequest<{
    alreadyCreated?: boolean;
    voucher: {
      id: number;
      publicId: string;
      voucherType: string;
      paymentMethod: string;
      amountMinor: number;
      businessDate: string;
      status: string;
    };
  }>(
    `/api/pos/customers/${customerId}/receipts`,
    {
      method: "POST",
      body: JSON.stringify(
        input,
      ),
    },
    token,
  );
}


export type PosFinancePaymentMethod =
  | "cash"
  | "card"
  | "bank";

export interface PosExpenseCategory {
  id: number;
  code: string;
  name: string;
  financeAccountId: number;
  status: "active" | "inactive";
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PosEmployee {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  userId: number | null;
  baseSalaryMinor: number;
  hireDate: string | null;
  status: "active" | "inactive";
  notes: string | null;
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
  advanceMinor: number;
  payableMinor: number;
  netDueToEmployeeMinor: number;
}


export interface PosEmployeeLedgerEntry {
  lineId: number;
  accountKind:
    | "employee_advance"
    | "employee_payable";
  publicId: string | null;
  transactionType: string | null;
  sourceEvent: string | null;
  status: string | null;
  businessDate: string | null;
  referencePeriod: string | null;
  createdAt: string;
  debitMinor: number;
  creditMinor: number;
  memo: string | null;
}

export interface PosEmployeeLedgerResult {
  employee: Omit<
    PosEmployee,
    | "advanceMinor"
    | "payableMinor"
    | "netDueToEmployeeMinor"
  >;
  advanceMinor: number;
  payableMinor: number;
  netDueToEmployeeMinor: number;
  entries: PosEmployeeLedgerEntry[];
}

export interface PosEmployeeInput {
  name: string;
  phone?: string | null;
  baseSalary?: string;
  hireDate?: string | null;
  status?: "active" | "inactive";
  notes?: string | null;
}

export type PosAssistantDraftIntent =
  | "expense"
  | "employee_advance"
  | "owner_withdrawal"
  | "finance_transfer";

export type PosAssistantTransferDirection =
  | "cash_to_bank"
  | "bank_to_cash";

export interface PosAssistantDraft {
  id: number;
  publicId: string;
  originalText: string;
  source: "text" | "voice";
  intent: PosAssistantDraftIntent | null;
  amountMinor: number | null;
  employeeId: number | null;
  expenseCategoryId: number | null;
  paymentMethod:
    | "cash"
    | "bank";
  bankAccountId: number | null;
  registerKey: string;
  transferDirection:
    | PosAssistantTransferDirection
    | null;
  confidence: number | null;
  parseMessage: string | null;
  notes: string | null;
  status:
    | "pending"
    | "approved"
    | "rejected";
  financeVoucherId: number | null;
  financeTransactionId: number | null;
  createdByUserId: number;
  reviewedByUserId: number | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  employeeName?: string | null;
  expenseCategoryName?: string | null;
}

export function createPosAssistantDraft(
  token: string,
  input: {
    text: string;
    source:
      | "text"
      | "voice";
    registerKey?: string;
  },
) {
  return apiRequest<{
    draft: PosAssistantDraft;
    parsed: {
      intent:
        | PosAssistantDraftIntent
        | null;
      amountMinor:
        | number
        | null;
      employeeId:
        | number
        | null;
      expenseCategoryId:
        | number
        | null;
      paymentMethod:
        | "cash"
        | "bank";
      bankAccountId:
        | number
        | null;
      transferDirection:
        | PosAssistantTransferDirection
        | null;
      confidence: number;
      parseMessage: string;
      employeeName:
        | string
        | null;
      expenseCategoryName:
        | string
        | null;
      bankAccountName:
        | string
        | null;
      bankName:
        | string
        | null;
    };
  }>(
    "/api/pos/assistant/drafts",
    {
      method: "POST",
      body: JSON.stringify(
        input,
      ),
    },
    token,
  );
}

export function getPosAssistantDrafts(
  token: string,
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "all" =
      "pending",
) {
  return apiRequest<{
    results:
      PosAssistantDraft[];
  }>(
    `/api/pos/assistant/drafts?status=${status}`,
    {},
    token,
  );
}

export function updatePosAssistantDraft(
  token: string,
  draftId: number,
  input: {
    intent?:
      | PosAssistantDraftIntent
      | null;
    amount?:
      | string
      | null;
    employeeId?:
      | number
      | null;
    expenseCategoryId?:
      | number
      | null;
    paymentMethod?:
      | "cash"
      | "bank";
    bankAccountId?:
      | number
      | null;
    transferDirection?:
      | PosAssistantTransferDirection
      | null;
    registerKey?: string;
    notes?:
      | string
      | null;
  },
) {
  return apiRequest<{
    draft:
      PosAssistantDraft;
  }>(
    `/api/pos/assistant/drafts/${draftId}`,
    {
      method: "PATCH",
      body: JSON.stringify(
        input,
      ),
    },
    token,
  );
}

export function approvePosAssistantDraft(
  token: string,
  draftId: number,
) {
  return apiRequest<{
    alreadyApproved: boolean;
    draft:
      PosAssistantDraft;
    voucher?: {
      id: number;
      publicId: string;
    };
    transaction?: {
      id: number;
      publicId: string;
    };
  }>(
    `/api/pos/assistant/drafts/${draftId}/approve`,
    {
      method: "POST",
    },
    token,
  );
}

export function rejectPosAssistantDraft(
  token: string,
  draftId: number,
) {
  return apiRequest<{
    draft:
      PosAssistantDraft;
  }>(
    `/api/pos/assistant/drafts/${draftId}/reject`,
    {
      method: "POST",
    },
    token,
  );
}


export interface PosFinanceVoucher {
  id: number;
  publicId: string;
  idempotencyKey: string;
  voucherType:
    | "customer_receipt"
    | "expense"
    | "employee_advance"
    | "employee_repayment"
    | "salary_accrual"
    | "employee_payment"
    | "owner_withdrawal"
    | "adjustment"
    | "receipt"
    | "payment"
    | "journal";
  voucherPurpose:
    | "customer_receipt"
    | "employee_repayment"
    | "supplier_refund"
    | "delivery_company_settlement"
    | "customer_cash_loan"
    | "employee_advance"
    | "employee_payment"
    | "supplier_payment"
    | "account_transfer"
    | null;
  partyType:
    | "customer"
    | "employee"
    | "supplier"
    | "delivery_company"
    | "owner"
    | null;
  partyId: number | null;
  expenseCategoryId: number | null;
  paymentMethod:
    | PosFinancePaymentMethod
    | "non_cash";
  cardProcessor?:
    | "arab"
    | "bop"
    | null;
  amountMinor: number;
  currencyCode: string;
  transactionAmountMinor: number | null;
  exchangeRateMicros: number;
  bankAccountId: number | null;
  businessDate: string;
  referencePeriod: string | null;
  cashSessionId: number | null;
  financeTransactionId: number | null;
  replacesVoucherId: number | null;
  status: "posted" | "voided";
  notes: string | null;
  createdByUserId: number;
  voidedAt: string | null;
  voidedByUserId: number | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getPosExpenseCategories(
  token: string,
) {
  return apiRequest<{
    results: PosExpenseCategory[];
  }>(
    "/api/pos/finance/expense-categories",
    {},
    token,
  );
}

export function createPosExpenseCategory(
  token: string,
  name: string,
) {
  return apiRequest<{
    category: PosExpenseCategory;
  }>(
    "/api/pos/finance/expense-categories",
    {
      method: "POST",
      body: JSON.stringify({
        name,
      }),
    },
    token,
  );
}

export function getPosEmployees(
  token: string,
  options: {
    query?: string;
    status?: "active" | "inactive";
  } = {},
) {
  const params =
    new URLSearchParams();

  if (options.query?.trim()) {
    params.set(
      "query",
      options.query.trim(),
    );
  }

  if (options.status) {
    params.set(
      "status",
      options.status,
    );
  }

  const query =
    params.toString();

  return apiRequest<{
    results: PosEmployee[];
  }>(
    `/api/pos/employees${query ? `?${query}` : ""}`,
    {},
    token,
  );
}


export function createPosEmployee(
  token: string,
  input: PosEmployeeInput,
) {
  return apiRequest<{
    employee:
      Omit<
        PosEmployee,
        | "advanceMinor"
        | "payableMinor"
        | "netDueToEmployeeMinor"
      >;
    advanceMinor: number;
    payableMinor: number;
    netDueToEmployeeMinor: number;
  }>(
    "/api/pos/employees",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function updatePosEmployee(
  token: string,
  employeeId: number,
  input: PosEmployeeInput,
) {
  return apiRequest<{
    employee:
      Omit<
        PosEmployee,
        | "advanceMinor"
        | "payableMinor"
        | "netDueToEmployeeMinor"
      >;
  }>(
    `/api/pos/employees/${employeeId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function getPosEmployeeLedger(
  token: string,
  employeeId: number,
) {
  return apiRequest<PosEmployeeLedgerResult>(
    `/api/pos/employees/${employeeId}/ledger`,
    {},
    token,
  );
}

export function createPosExpense(
  token: string,
  input: {
    expenseCategoryId: number;
    amount: string;
    paymentMethod: PosFinancePaymentMethod;
    registerKey: string;
    bankAccountId?: number;
    exchangeRate?: string;
    notes?: string;
    idempotencyKey: string;
  },
) {
  return apiRequest<{
    alreadyCreated?: boolean;
    voucher: PosFinanceVoucher;
  }>(
    "/api/pos/finance/expenses",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export interface PosEmployeeSettlementInput {
  amount: string;
  paymentMethod: PosFinancePaymentMethod;
  cardProcessor?:
    | "arab"
    | "bop";
  registerKey: string;
  bankAccountId?: number;
  exchangeRate?: string;
  referencePeriod?: string;
  notes?: string;
  idempotencyKey: string;
}

export function createPosEmployeeAdvance(
  token: string,
  employeeId: number,
  input: PosEmployeeSettlementInput,
) {
  return apiRequest<{
    alreadyCreated?: boolean;
    voucher: PosFinanceVoucher;
  }>(
    `/api/pos/employees/${employeeId}/advance`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function createPosEmployeeRepayment(
  token: string,
  employeeId: number,
  input: PosEmployeeSettlementInput,
) {
  return apiRequest<{
    alreadyCreated?: boolean;
    voucher: PosFinanceVoucher;
  }>(
    `/api/pos/employees/${employeeId}/repayment`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function createPosEmployeeSalaryAccrual(
  token: string,
  employeeId: number,
  input: {
    amount: string;
    registerKey: string;
    referencePeriod?: string;
    notes?: string;
    idempotencyKey: string;
  },
) {
  return apiRequest<{
    alreadyCreated?: boolean;
    voucher: PosFinanceVoucher;
  }>(
    `/api/pos/employees/${employeeId}/salary`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function createPosEmployeePayment(
  token: string,
  employeeId: number,
  input: PosEmployeeSettlementInput,
) {
  return apiRequest<{
    alreadyCreated?: boolean;
    voucher: PosFinanceVoucher;
  }>(
    `/api/pos/employees/${employeeId}/payment`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function createPosOwnerWithdrawal(
  token: string,
  input: {
    amount: string;
    paymentMethod: PosFinancePaymentMethod;
    registerKey: string;
    bankAccountId?: number;
    exchangeRate?: string;
    notes?: string;
    idempotencyKey: string;
  },
) {
  return apiRequest<{
    alreadyCreated?: boolean;
    voucher: PosFinanceVoucher;
  }>(
    "/api/pos/finance/owner-withdrawals",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function getPosFinanceVouchers(
  token: string,
  options: {
    type?: PosFinanceVoucher["voucherType"];
    date?: string;
  } = {},
) {
  const params =
    new URLSearchParams();

  if (options.type) {
    params.set(
      "type",
      options.type,
    );
  }

  if (options.date) {
    params.set(
      "date",
      options.date,
    );
  }

  const query =
    params.toString();

  return apiRequest<{
    results: PosFinanceVoucher[];
  }>(
    `/api/pos/finance/vouchers${query ? `?${query}` : ""}`,
    {},
    token,
  );
}

export function voidPosFinanceVoucher(
  token: string,
  voucherId: number,
  reason: string,
) {
  return apiRequest<{
    voucher: PosFinanceVoucher;
    reversal: unknown;
    expectedCashBeforeMinor: number | null;
    expectedCashAfterMinor: number | null;
  }>(
    `/api/pos/finance/vouchers/${voucherId}/void`,
    {
      method: "POST",
      body: JSON.stringify({
        reason,
      }),
    },
    token,
  );
}


export type PosUnifiedVoucherPartyType =
  | "customer"
  | "employee"
  | "supplier"
  | "delivery_company";

export type PosUnifiedVoucherAccountRef =
  | {
      kind: "cash";
      registerKey: string;
    }
  | {
      kind: "bank";
      bankAccountId: number;
    }
  | {
      kind: "customer";
      customerId: number;
    }
  | {
      kind:
        | "employee_advance"
        | "employee_payable";
      employeeId: number;
    }
  | {
      kind: "supplier";
      supplierId: number;
    }
  | {
      kind: "delivery_company";
      deliveryCompanyId: number;
    }
  | {
      kind: "expense";
      expenseCategoryId: number;
    };

export interface PosUnifiedVoucherResult {
  alreadyCreated: boolean;
  voucher: PosFinanceVoucher;
  financeTransaction: unknown | null;
  expectedCashBeforeMinor?: number | null;
  expectedCashAfterMinor?: number | null;
}

export function createPosUnifiedReceiptVoucher(
  token: string,
  input: {
    partyType: PosUnifiedVoucherPartyType;
    partyId: number;
    amount: string;
    paymentMethod:
      | "cash"
      | "bank";
    registerKey: string;
    bankAccountId?: number;
    notes?: string;
    idempotencyKey: string;
  },
) {
  return apiRequest<PosUnifiedVoucherResult>(
    "/api/pos/finance/vouchers/receipt",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function createPosForeignCurrencyCustomerReceipt(
  token: string,
  input: {
    customerId: number;
    amount: string;
    foreignAmount: string;
    exchangeRate: string;
    foreignCashAccountId: number;
    notes?: string;
    idempotencyKey: string;
  },
) {
  return apiRequest<
    PosUnifiedVoucherResult & {
      receivedBaseMinor: number;
      changeMinor: number;
      foreignCashBeforeMinor:
        | number
        | null;
      foreignCashAfterMinor:
        | number
        | null;
      ilsCashBeforeMinor:
        | number
        | null;
      ilsCashAfterMinor:
        | number
        | null;
    }
  >(
    "/api/pos/finance/vouchers/foreign-currency-customer-receipt",
    {
      method: "POST",
      body: JSON.stringify(
        input,
      ),
    },
    token,
  );
}

export function createPosUnifiedPaymentVoucher(
  token: string,
  input: {
    partyType: PosUnifiedVoucherPartyType;
    partyId: number;
    amount: string;
    paymentMethod:
      | "cash"
      | "bank";
    registerKey: string;
    bankAccountId?: number;
    employeePaymentType?:
      | "advance"
      | "payable";
    notes?: string;
    idempotencyKey: string;
  },
) {
  return apiRequest<PosUnifiedVoucherResult>(
    "/api/pos/finance/vouchers/payment",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function createPosUnifiedJournalVoucher(
  token: string,
  input: {
    from: PosUnifiedVoucherAccountRef;
    to: PosUnifiedVoucherAccountRef;
    amount: string;
    notes?: string;
    idempotencyKey: string;
  },
) {
  return apiRequest<PosUnifiedVoucherResult>(
    "/api/pos/finance/vouchers/journal",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}


export function replacePosUnifiedVoucher(
  token: string,
  voucherId: number,
  input: {
    amount: string;
    notes?: string;
    idempotencyKey: string;
  },
) {
  return apiRequest<{
    alreadyReplaced: boolean;
    originalVoucher: PosFinanceVoucher | null;
    replacementVoucher: PosFinanceVoucher;
    reversalTransaction: unknown | null;
    financeTransaction: unknown | null;
    expectedCashBeforeMinor: number | null;
    expectedCashAfterMinor: number | null;
  }>(
    `/api/pos/finance/vouchers/${voucherId}/replace`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}


export interface PosFinanceCurrency {
  code: string;
  nameAr: string;
  nameEn: string;
  symbol: string;
  minorUnit: number;
  isBase: boolean;
  status: "active" | "inactive";
  latestRate: {
    rateDate: string;
    ilsPerUnitMicros: number;
    ilsPerUnit: number;
    source: string | null;
  } | null;
}

export interface PosBank {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string | null;
  status: "active" | "inactive";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PosBankAccount {
  id: number;
  bankId: number;
  code: string;
  name: string;
  accountNumber: string | null;
  iban: string | null;
  currencyCode: string;
  financeAccountId: number;
  status: "active" | "inactive";
  notes: string | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
  bank: {
    id: number;
    code: string;
    nameAr: string;
    nameEn: string | null;
  };
  financeAccount: {
    id: number;
    code: string;
    name: string;
    currencyCode: string;
  };
  baseBalanceMinor: number;
  currencyBalanceMinor: number;
}

export function getPosFinanceBankingReference(
  token: string,
) {
  return apiRequest<{
    currencies: PosFinanceCurrency[];
    banks: PosBank[];
  }>(
    "/api/pos/finance/banking/reference",
    {},
    token,
  );
}

export function getPosBankAccounts(
  token: string,
) {
  return apiRequest<{
    results: PosBankAccount[];
  }>(
    "/api/pos/finance/bank-accounts",
    {},
    token,
  );
}

export function createPosBankAccount(
  token: string,
  input: {
    bankId: number;
    name: string;
    accountNumber?: string;
    iban?: string;
    currencyCode: string;
    notes?: string;
  },
) {
  return apiRequest<{
    account: PosBankAccount;
    bank: PosBank;
    financeAccount: {
      id: number;
      code: string;
      name: string;
      currencyCode: string;
    };
  }>(
    "/api/pos/finance/bank-accounts",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export type PosCardProcessor =
  | "arab"
  | "bop";

export interface PosCardSettlementTransaction {
  id: number;
  publicId: string;
  idempotencyKey: string;
  businessDate: string;
  transactionType: string;
  sourceType: string;
  sourceId: string;
  sourceEvent: string;
  cashSessionId: number | null;
  status:
    | "posted"
    | "reversed";
  notes: string | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PosCardSettlementSummary {
  terminals: Array<{
    processor:
      PosCardProcessor;
    label: string;
    financeAccountId:
      number | null;
    balanceMinor: number;
  }>;
  bankAccounts: Array<{
    id: number;
    bankName: string;
    name: string;
    code: string;
    financeAccountId: number;
  }>;
  settlements: Array<{
    transaction:
      PosCardSettlementTransaction;
    processor:
      PosCardProcessor | null;
    grossMinor: number;
    netMinor: number;
    feeMinor: number;
    bankAccountName:
      string | null;
  }>;
}

export function getPosCardSettlements(
  token: string,
) {
  return apiRequest<
    PosCardSettlementSummary
  >(
    "/api/pos/finance/card-settlements",
    {},
    token,
  );
}

export function createPosCardSettlement(
  token: string,
  input: {
    processor:
      PosCardProcessor;
    bankAccountId: number;
    grossAmount: string;
    netAmount: string;
    notes?: string;
    idempotencyKey: string;
  },
) {
  return apiRequest<{
    alreadyCreated: boolean;
    transaction:
      PosCardSettlementTransaction;
    processor?:
      PosCardProcessor;
    grossMinor?: number;
    netMinor?: number;
    feeMinor?: number;
    balanceBeforeMinor?: number;
    balanceAfterMinor?: number;
  }>(
    "/api/pos/finance/card-settlements",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function reversePosCardSettlement(
  token: string,
  input: {
    publicId: string;
    reason: string;
  },
) {
  return apiRequest<{
    alreadyReversed: boolean;
    transaction:
      PosCardSettlementTransaction;
    reversal:
      PosCardSettlementTransaction |
      null;
  }>(
    "/api/pos/finance/card-settlements/reverse",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}


export interface PosFinanceCashAccount {
  id: number;
  code: string;
  name: string;
  registerKey: string;
  currencyCode: string;
  bookBalanceMinor: number;
  operationalBalanceMinor: number;
  balanceSource:
    | "cash_session"
    | "ledger";
  cashSessionId: number | null;
}

export interface PosFinanceTransferAccount {
  id: number;
  code: string;
  name: string;
  currencyCode: string;
}

export interface PosFinanceTransferTransaction {
  id: number;
  publicId: string;
  idempotencyKey: string;
  businessDate: string;
  transactionType: string;
  sourceType: string;
  sourceId: string;
  sourceEvent: string;
  cashSessionId: number | null;
  status:
    | "posted"
    | "reversed";
  notes: string | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PosFinanceTransfer {
  transaction:
    PosFinanceTransferTransaction;
  source:
    | PosFinanceTransferAccount
    | null;
  destination:
    | PosFinanceTransferAccount
    | null;
  amountMinor: number;
  baseAmountMinor: number;
  exchangeRateMicros: number;
}

export function getPosFinanceCashAccounts(
  token: string,
) {
  return apiRequest<{
    results:
      PosFinanceCashAccount[];
  }>(
    "/api/pos/finance/cash-accounts",
    {},
    token,
  );
}

export function createPosFinanceCashAccount(
  token: string,
  input: {
    name: string;
    currencyCode?: string;
    notes?: string;
  },
) {
  return apiRequest<{
    account: {
      id: number;
      code: string;
      name: string;
      currencyCode: string;
      status: string;
    };
  }>(
    "/api/pos/finance/cash-accounts",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export interface PosCurrencyConversion {
  transaction:
    PosFinanceTransferTransaction;
  source:
    | PosFinanceTransferAccount
    | null;
  destination:
    | PosFinanceTransferAccount
    | null;
  fromAmountMinor: number;
  toAmountMinor: number;
  sourceBookBaseMinor: number;
  destinationBaseMinor: number;
  fxDifferenceMinor: number;
  actualRateMicros: number;
}

export function getPosCurrencyConversions(
  token: string,
) {
  return apiRequest<{
    results:
      PosCurrencyConversion[];
  }>(
    "/api/pos/finance/currency-conversions",
    {},
    token,
  );
}

export function createPosCurrencyConversion(
  token: string,
  input: {
    idempotencyKey: string;
    fromAccountId: number;
    toAccountId: number;
    fromAmount: string;
    toAmount: string;
    notes?: string;
  },
) {
  return apiRequest<{
    alreadyCreated: boolean;
    transaction:
      PosFinanceTransferTransaction;
    fromAccount?: PosFinanceTransferAccount;
    toAccount?: PosFinanceTransferAccount;
    fromAmountMinor?: number;
    toAmountMinor?: number;
    sourceBookBaseMinor?: number;
    destinationBaseMinor?: number;
    actualRateMicros?: number;
    fxDifferenceMinor?: number;
  }>(
    "/api/pos/finance/currency-conversions",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function reversePosCurrencyConversion(
  token: string,
  input: {
    publicId: string;
    reason: string;
  },
) {
  return apiRequest<{
    alreadyReversed: boolean;
    transaction:
      PosFinanceTransferTransaction;
    reversal?:
      PosFinanceTransferTransaction;
  }>(
    "/api/pos/finance/currency-conversions/reverse",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}


export function getPosFinanceTransfers(
  token: string,
) {
  return apiRequest<{
    results:
      PosFinanceTransfer[];
  }>(
    "/api/pos/finance/transfers",
    {},
    token,
  );
}

export function createPosFinanceTransfer(
  token: string,
  input: {
    idempotencyKey: string;
    fromAccountId: number;
    toAccountId: number;
    amount: string;
    notes?: string;
  },
) {
  return apiRequest<{
    alreadyCreated: boolean;
    transaction:
      PosFinanceTransferTransaction;
  }>(
    "/api/pos/finance/transfers",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function reversePosFinanceTransfer(
  token: string,
  input: {
    publicId: string;
    reason: string;
  },
) {
  return apiRequest<{
    alreadyReversed: boolean;
    transaction:
      PosFinanceTransferTransaction;
    reversal?:
      PosFinanceTransferTransaction;
  }>(
    "/api/pos/finance/transfers/reverse",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}


export interface PosFinanceStatementReference {
  cashAccounts: Array<{
    id: number;
    code: string;
    name: string;
    currencyCode: string;
    accountType: string;
  }>;

  bankAccounts: Array<{
    id: number;
    name: string;
    currencyCode: string;
    financeAccountId: number;
    bankName: string;
  }>;

  expenseCategories: Array<{
    id: number;
    code: string;
    name: string;
    financeAccountId: number;
  }>;
}

export interface PosFinanceAccountStatementEntry {
  lineId: number;
  lineNumber: number;
  businessDate: string;
  transactionId: number;
  publicId: string;
  transactionType: string;
  sourceType: string;
  sourceId: string;
  sourceEvent: string;
  status: string;
  transactionNotes: string | null;
  createdAt: string;
  debitMinor: number;
  creditMinor: number;
  currencyCode: string | null;
  currencyAmountMinor: number | null;
  exchangeRateMicros: number | null;
  memo: string | null;
  changeMinor: number;
  runningBalanceMinor: number;
}

export interface PosFinanceAccountStatement {
  account: {
    id: number;
    code: string;
    name: string;
    accountType: string;
    currencyCode: string;
  };

  range: {
    from: string;
    to: string;
  };

  openingBalanceMinor: number;
  periodDebitMinor: number;
  periodCreditMinor: number;
  closingBalanceMinor: number;
  entries: PosFinanceAccountStatementEntry[];
}

export function getPosFinanceStatementReference(
  token: string,
) {
  return apiRequest<PosFinanceStatementReference>(
    "/api/pos/finance/statements/reference",
    {},
    token,
  );
}

export function getPosFinanceAccountStatement(
  token: string,
  input: {
    accountId: number;
    from: string;
    to: string;
  },
) {
  const params =
    new URLSearchParams({
      accountId:
        String(
          input.accountId,
        ),
      from:
        input.from,
      to:
        input.to,
    });

  return apiRequest<PosFinanceAccountStatement>(
    `/api/pos/finance/statements/account?${params.toString()}`,
    {},
    token,
  );
}


export function getPosFinanceCashStatement(
  token: string,
  input: {
    accountId: number;
    from: string;
    to: string;
  },
) {
  const params =
    new URLSearchParams({
      accountId:
        String(
          input.accountId,
        ),
      from:
        input.from,
      to:
        input.to,
    });

  return apiRequest<PosFinanceAccountStatement>(
    `/api/pos/finance/statements/cash?${params.toString()}`,
    {},
    token,
  );
}


export interface PosTrialBalanceRow {
  account: {
    id: number;
    code: string;
    name: string;
    accountType: string;
    currencyCode: string;
    status: string;
  };
  openingDebitMinor: number;
  openingCreditMinor: number;
  periodDebitMinor: number;
  periodCreditMinor: number;
  closingDebitMinor: number;
  closingCreditMinor: number;
}

export interface PosTrialBalanceResult {
  range: {
    from: string;
    to: string;
  };
  totals: {
    openingDebitMinor: number;
    openingCreditMinor: number;
    periodDebitMinor: number;
    periodCreditMinor: number;
    closingDebitMinor: number;
    closingCreditMinor: number;
  };
  integrity: {
    passed: boolean;
    transactionsChecked: number;
    unbalancedTransactionCount: number;
    ledgerDebitMinor: number;
    ledgerCreditMinor: number;
    ledgerDifferenceMinor: number;
    openingDifferenceMinor: number;
    periodDifferenceMinor: number;
    closingDifferenceMinor: number;
    unbalancedTransactions: Array<{
      transactionId: number;
      publicId: string;
      businessDate: string;
      status: string;
      lineCount: number;
      debitMinor: number;
      creditMinor: number;
      differenceMinor: number;
    }>;
  };
  rows: PosTrialBalanceRow[];
}

export function getPosFinanceTrialBalance(
  token: string,
  input: {
    from: string;
    to: string;
  },
) {
  const params =
    new URLSearchParams({
      from:
        input.from,
      to:
        input.to,
    });

  return apiRequest<PosTrialBalanceResult>(
    `/api/pos/finance/statements/trial-balance?${params.toString()}`,
    {},
    token,
  );
}


export interface PosFinanceAgingRow {
  id: number;
  code: string;
  name: string;
  status: string;
  currentMinor: number;
  days31To60Minor: number;
  days61To90Minor: number;
  daysOver90Minor: number;
  balanceMinor: number;
  oppositeBalanceMinor: number;
}

export interface PosFinanceLiquidityReport {
  asOf: string;
  summary: {
    cashOperationalBaseMinor: number;
    bankBaseMinor: number;
    currentLiquidityMinor: number;
    customerReceivableMinor: number;
    customerCreditMinor: number;
    supplierPayableMinor: number;
    supplierDebitMinor: number;
    incomingChecksMinor: number;
    outgoingChecksMinor: number;
    expectedCollectionsMinor: number;
    expectedPaymentsMinor: number;
    projectedLiquidityMinor: number;
    cashBaseComplete: boolean;
  };
  customerAging: {
    totals: {
      currentMinor: number;
      days31To60Minor: number;
      days61To90Minor: number;
      daysOver90Minor: number;
      balanceMinor: number;
      oppositeBalanceMinor: number;
    };
    rows: PosFinanceAgingRow[];
  };
  supplierAging: {
    totals: {
      currentMinor: number;
      days31To60Minor: number;
      days61To90Minor: number;
      daysOver90Minor: number;
      balanceMinor: number;
      oppositeBalanceMinor: number;
    };
    rows: PosFinanceAgingRow[];
  };
  checks: {
    totals: {
      incomingMinor: number;
      outgoingMinor: number;
      incomingOverdueMinor: number;
      outgoingOverdueMinor: number;
      incomingNext7Minor: number;
      outgoingNext7Minor: number;
      incomingNext30Minor: number;
      outgoingNext30Minor: number;
    };
    rows: Array<{
      id: number;
      publicId: string;
      checkNumber: string;
      direction: "received" | "issued";
      status: string;
      dueDate: string;
      daysUntilDue: number;
      dueBucket:
        | "overdue"
        | "next_7"
        | "next_30"
        | "later";
      currencyCode: string;
      amountMinor: number;
      baseAmountMinor: number;
      partyName: string;
    }>;
  };
  liquidity: {
    cash: Array<{
      id: number;
      code: string;
      name: string;
      currencyCode: string;
      bookBaseMinor: number;
      bookCurrencyMinor: number;
      operationalMinor: number;
      operationalBaseMinor: number | null;
      rateMicros: number | null;
      balanceSource: "cash_session" | "ledger";
      cashSessionId: number | null;
    }>;
    banks: Array<{
      id: number;
      code: string;
      name: string;
      bankName: string;
      currencyCode: string;
      financeAccountId: number;
      baseBalanceMinor: number;
      currencyBalanceMinor: number;
    }>;
  };
  diagnostics: {
    missingCustomerPartyMinor: number;
    missingSupplierPartyMinor: number;
    agingSourceMovements: number;
    cashBaseComplete: boolean;
  };
}

export function getPosFinanceLiquidityReport(
  token: string,
) {
  return apiRequest<PosFinanceLiquidityReport>(
    "/api/pos/finance/reports/liquidity",
    {},
    token,
  );
}


export function savePosExchangeRate(
  token: string,
  input: {
    currencyCode: string;
    ilsPerUnit: string;
    rateDate?: string;
    source?: string;
    notes?: string;
  },
) {
  return apiRequest<{
    rate: {
      id: number;
      currencyCode: string;
      rateDate: string;
      ilsPerUnitMicros: number;
      source: string | null;
      notes: string | null;
      createdByUserId: number | null;
      createdAt: string;
    };
    ilsPerUnit: number;
  }>(
    "/api/pos/finance/exchange-rates",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}


export type PosFinanceCheckStatus =
  | "on_hand"
  | "deposited"
  | "issued"
  | "cleared"
  | "returned"
  | "cancelled";

export interface PosFinanceCheck {
  id: number;
  publicId: string;
  idempotencyKey: string;
  direction:
    | "received"
    | "issued";
  checkNumber: string;
  bankId: number;
  bankAccountId: number | null;
  depositedToBankAccountId: number | null;
  currencyCode: string;
  amountMinor: number;
  exchangeRateMicros: number;
  baseAmountMinor: number;
  dueDate: string;
  customerId: number | null;
  supplierId: number | null;
  employeeId: number | null;
  drawerName: string | null;
  payeeName: string | null;
  status: PosFinanceCheckStatus;
  initialFinanceTransactionId: number | null;
  settlementFinanceTransactionId: number | null;
  notes: string | null;
  createdByUserId: number;
  depositedAt: string | null;
  clearedAt: string | null;
  returnedAt: string | null;
  cancelledAt: string | null;
  cancelledByUserId: number | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  bank: PosBank | null;
  bankAccount: {
    id: number;
    bankId: number;
    code: string;
    name: string;
    accountNumber: string | null;
    iban: string | null;
    currencyCode: string;
    financeAccountId: number;
    status: "active" | "inactive";
  } | null;
  depositedToBankAccount: {
    id: number;
    bankId: number;
    code: string;
    name: string;
    accountNumber: string | null;
    iban: string | null;
    currencyCode: string;
    financeAccountId: number;
    status: "active" | "inactive";
  } | null;
  party: {
    type:
      | "customer"
      | "supplier"
      | "employee";
    id: number;
    name: string;
  } | null;
}

export interface PosFinanceCheckPartyReference {
  id: number;
  code: string;
  name: string;
  status: "active" | "inactive";
}

export function getPosFinanceCheckReference(
  token: string,
) {
  return apiRequest<{
    customers:
      PosFinanceCheckPartyReference[];
    suppliers:
      PosFinanceCheckPartyReference[];
  }>(
    "/api/pos/finance/checks/reference",
    {},
    token,
  );
}


export function getPosFinanceChecks(
  token: string,
  options: {
    direction?: "received" | "issued";
    status?: PosFinanceCheckStatus;
  } = {},
) {
  const params =
    new URLSearchParams();

  if (options.direction) {
    params.set(
      "direction",
      options.direction,
    );
  }

  if (options.status) {
    params.set(
      "status",
      options.status,
    );
  }

  const suffix =
    params.size > 0
      ? `?${params.toString()}`
      : "";

  return apiRequest<{
    results: PosFinanceCheck[];
  }>(
    `/api/pos/finance/checks${suffix}`,
    {},
    token,
  );
}

export function createPosReceivedCheck(
  token: string,
  input: {
    idempotencyKey: string;
    checkNumber: string;
    bankId: number;
    customerId: number;
    currencyCode: string;
    amount: string;
    exchangeRate?: string;
    dueDate: string;
    drawerName?: string;
    notes?: string;
  },
) {
  return apiRequest<{
    alreadyCreated: boolean;
    check: PosFinanceCheck;
  }>(
    "/api/pos/finance/checks/received",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function createPosIssuedCheck(
  token: string,
  input: {
    idempotencyKey: string;
    checkNumber: string;
    bankAccountId: number;
    supplierId: number;
    amount: string;
    exchangeRate?: string;
    dueDate: string;
    payeeName?: string;
    notes?: string;
  },
) {
  return apiRequest<{
    alreadyCreated: boolean;
    check: PosFinanceCheck;
  }>(
    "/api/pos/finance/checks/issued",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function depositPosFinanceCheck(
  token: string,
  checkId: number,
  bankAccountId: number,
) {
  return apiRequest<{
    check: PosFinanceCheck;
    alreadyDeposited: boolean;
  }>(
    `/api/pos/finance/checks/${checkId}/deposit`,
    {
      method: "POST",
      body: JSON.stringify({
        bankAccountId,
      }),
    },
    token,
  );
}

export function clearPosFinanceCheck(
  token: string,
  checkId: number,
  input: {
    bankAccountId?: number;
    exchangeRate?: string;
  } = {},
) {
  return apiRequest<{
    check: PosFinanceCheck;
    alreadyCleared: boolean;
    bankBaseMinor?: number;
    clearingRateMicros?: number;
  }>(
    `/api/pos/finance/checks/${checkId}/clear`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function returnPosFinanceCheck(
  token: string,
  checkId: number,
  reason?: string,
) {
  return apiRequest<{
    check: PosFinanceCheck;
    alreadyReversed: boolean;
  }>(
    `/api/pos/finance/checks/${checkId}/return`,
    {
      method: "POST",
      body: JSON.stringify({
        reason:
          reason || undefined,
      }),
    },
    token,
  );
}

export function cancelPosFinanceCheck(
  token: string,
  checkId: number,
  reason: string,
) {
  return apiRequest<{
    check: PosFinanceCheck;
    alreadyReversed: boolean;
  }>(
    `/api/pos/finance/checks/${checkId}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({
        reason,
      }),
    },
    token,
  );
}


export interface PosSaleCashCurrency {
  code: string;
  nameAr: string;
  symbol: string;
  isBase: boolean;
  cashAccountId: number | null;
  cashAccountName: string | null;
  registerKey: string | null;
  cashSessionId: number | null;
  cashSessionBusinessDate: string | null;
  latestRateMicros: number | null;
  latestRate: number | null;
}

export function getPosSaleCashCurrencies(
  token: string,
) {
  return apiRequest<{
    defaultCurrencyCode: string;
    currencies:
      PosSaleCashCurrency[];
  }>(
    "/api/pos/sales/cash-currencies",
    {},
    token,
  );
}

export function createPosSale(
  token: string,
  input: {
    registerKey: string;
    idempotencyKey: string;
    paymentMethod:
      | "cash"
      | "card"
      | "credit"
      | "mixed";
    cardProcessor?:
      | "arab"
      | "bop";
    cashCurrencyCode?: string;
    cashExchangeRate?: string;
    discountAmount: string;
    paidAmount: string;
    customerId?: number;
    customerName?: string;
    customerPhone?: string;
    notes?: string;
    items: Array<{
      productId: string;
      barcode?: string;
      quantity: number;
      soldUnitPrice: string;
      lineDiscount?: string;
      color?: string;
      size?: string;
    }>;
  },
) {
  return apiRequest<PosSaleResult>(
    "/api/pos/sales",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export interface PosTodaySalesResult {
  session: {
    id: string;
    registerKey: string;
    businessDate: string;
  } | null;

  sales: PosSaleResult[];

  saleReturns: Array<
    PosSaleReturnResult & {
      originalSalePublicId: string | null;
    }
  >;

  mobileReturns: PosMobileReturnResult[];
}

export function getTodayPosSales(
  token: string,
  registerKey = "main",
  businessDate?: string,
) {
  const params = new URLSearchParams({
    register: registerKey,
  });

  if (businessDate) {
    params.set("date", businessDate);
  }

  return apiRequest<PosTodaySalesResult>(
    `/api/pos/sales/today?${params.toString()}`,
    {},
    token,
  );
}

export function getPosSaleByPublicId(token: string, publicId: string) {
  return apiRequest<PosSaleResult>(
    `/api/pos/sales/by-public-id?publicId=${encodeURIComponent(publicId)}`,
    {},
    token,
  );
}

export interface PosSaleEditResult extends PosSaleResult {
  alreadyUpdated: boolean;
  revisionNumber: number;
}

export function updatePosSale(
  token: string,
  input: {
    publicId: string;
    registerKey: string;
    idempotencyKey: string;
    expectedUpdatedAt: string;
    reason: string;
    paymentMethod: "cash" | "card";
    discountAmount: string;
    paidAmount: string;
    customerName?: string;
    customerPhone?: string;
    notes?: string;
    items: Array<{
      productId: string;
      barcode?: string;
      quantity: number;
      soldUnitPrice: string;
      lineDiscount?: string;
      color?: string;
      size?: string;
    }>;
  },
) {
  return apiRequest<PosSaleEditResult>(
    "/api/pos/sales",
    {
      method: "PUT",
      body: JSON.stringify({
        ...input,
        publicId: input.publicId.trim().toUpperCase(),
      }),
    },
    token,
  );
}

export function voidPosSale(
  token: string,
  input: {
    publicId: string;
    reason: string;
  },
) {
  return apiRequest<PosSaleResult>(
    "/api/pos/sales/void",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}


export interface PosSaleReturnPreviewItem {
  id: string;
  productId: string | null;
  lineNumber: number;

  barcode: string | null;
  productCode: string | null;
  productNameAr: string;
  productImage: string | null;

  color: string | null;
  size: string | null;

  soldQuantity: number;
  returnedQuantity: number;
  returnableQuantity: number;

  soldUnitPriceMinor: number;
  soldUnitPrice: number;

  lineDiscountMinor: number;
  lineDiscount: number;

  originalLineTotalMinor: number;
  originalLineTotal: number;

  returnableGrossMinor: number;
  returnableGross: number;
}

export interface PosSaleReturnPreviewResult {
  sale: {
    id: string;
    publicId: string;

    status: string;
    registerKey: string;
    businessDate: string;

    customerId: number | null;
    customerName: string | null;
    customerPhone: string | null;

    subtotalMinor: number;
    subtotal: number;

    discountMinor: number;
    discount: number;

    itemDiscountMinor: number;
    itemDiscount: number;

    invoiceDiscountMinor: number;
    invoiceDiscount: number;

    totalMinor: number;
    total: number;

    createdAt: string;
  };

  navigation?: {
    previousPublicId: string | null;
    nextPublicId: string | null;
  };

  filter: {
    barcode: string | null;
  };

  summary: {
    soldQuantity: number;
    returnedQuantity: number;
    returnableQuantity: number;
    fullyReturned: boolean;
  };

  items: PosSaleReturnPreviewItem[];
}

export function getPosSaleReturnPreview(
  token: string,
  publicId: string,
  barcode?: string,
) {
  const params = new URLSearchParams({
    publicId: publicId.trim().toUpperCase(),
  });

  const normalizedBarcode = barcode?.trim();

  if (normalizedBarcode) {
    params.set("barcode", normalizedBarcode);
  }

  return apiRequest<PosSaleReturnPreviewResult>(
    `/api/pos/sales/returns/preview?${params.toString()}`,
    {},
    token,
  );
}

export interface PosSaleReturnItemResult {
  id: string;
  originalSaleItemId: string;
  productId: string | null;

  lineNumber: number;

  barcode: string | null;
  productCode: string | null;
  productNameAr: string;

  color: string | null;
  size: string | null;

  quantity: number;

  soldUnitPriceMinor: number;
  soldUnitPrice: number;

  grossAmountMinor: number;
  grossAmount: number;

  lineDiscountMinor: number;
  lineDiscount: number;

  invoiceDiscountMinor: number;
  invoiceDiscount: number;

  allocatedDiscountMinor: number;
  allocatedDiscount: number;

  refundAmountMinor: number;
  refundAmount: number;

  generalStockBefore: number | null;
  generalStockAfter: number | null;

  variantStockBefore: number | null;
  variantStockAfter: number | null;
}

export interface PosSaleReturnResult {
  alreadyCreated: boolean;

  saleReturn: {
    id: string;
    publicId: string;

    originalSaleId: string;
    customerId: string | null;
    cashSessionId: string;

    registerKey: string;
    businessDate: string;
    cashierUserId: string;

    status: string;
    refundMethod: string;

    grossAmountMinor: number;
    grossAmount: number;

    discountAmountMinor: number;
    discountAmount: number;

    refundAmountMinor: number;
    refundAmount: number;

    reason: string;
    notes: string | null;

    createdAt: string;
  };

  items: PosSaleReturnItemResult[];
}

export function createPosSaleReturn(
  token: string,
  input: {
    registerKey: string;
    idempotencyKey: string;
    publicId: string;
    reason: string;
    notes?: string;

    refundMethod:
      | "cash"
      | "card"
      | "customer";

    customerId?: number;

    items: Array<{
      originalSaleItemId: string;
      quantity: number;
    }>;
  },
) {
  return apiRequest<PosSaleReturnResult>(
    "/api/pos/sales/returns",
    {
      method: "POST",
      body: JSON.stringify({
        registerKey: input.registerKey,
        idempotencyKey: input.idempotencyKey,
        publicId: input.publicId.trim().toUpperCase(),
        reason: input.reason,
        notes: input.notes || undefined,
        refundMethod:
          input.refundMethod,
        customerId:
          input.customerId,
        items: input.items,
      }),
    },
    token,
  );
}

export interface PosSaleReturnVoidResult {
  alreadyVoided: boolean;

  saleReturn: {
    id: string;
    publicId: string;
    status: string;

    refundAmountMinor: number;
    refundAmount: number;

    voidedAt: string | null;
    voidedByUserId: string | null;
    voidReason: string | null;
  };
}

export function voidPosSaleReturn(
  token: string,
  input: {
    publicId: string;
    reason: string;
  },
) {
  return apiRequest<PosSaleReturnVoidResult>(
    "/api/pos/sales/returns/void",
    {
      method: "POST",
      body: JSON.stringify({
        publicId: input.publicId.trim().toUpperCase(),
        reason: input.reason.trim(),
      }),
    },
    token,
  );
}

export interface PosSupplier {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: "active" | "inactive";

  totalPurchasesMinor?: number;
  totalPurchases?: number;

  paidMinor?: number;
  paid?: number;

  dueMinor?: number;
  due?: number;

  supplierCreditMinor?: number;
  supplierCredit?: number;

  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PosSupplierListResult {
  results: PosSupplier[];
}

export function getPosSuppliers(
  token: string,
  options: {
    query?: string;
    status?: "active" | "inactive";
  } = {},
) {
  const params = new URLSearchParams();

  const query = options.query?.trim();

  if (query) {
    params.set("q", query);
  }

  if (options.status) {
    params.set("status", options.status);
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : "";

  return apiRequest<PosSupplierListResult>(
    `/api/pos/suppliers${suffix}`,
    {},
    token,
  );
}

export function createPosSupplier(
  token: string,
  input: {
    code: string;
    name: string;
    contactPerson?: string;
    phone?: string;
    mobile?: string;
    email?: string;
    address?: string;
    notes?: string;
    status?: "active" | "inactive";
  },
) {
  return apiRequest<{ supplier: PosSupplier }>(
    "/api/pos/suppliers",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export interface PosPurchaseItemResult {
  id: string;
  lineNumber: number;
  productId: string | null;
  barcode: string | null;
  productCode: string | null;
  productNameAr: string;
  productImage: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  freeQuantity: number;
  unitCostMinor: number | null;
  unitCost: number | null;
  lineDiscountMinor: number;
  lineDiscount: number;
  lineTotalMinor: number | null;
  lineTotal: number | null;
  generalStockBefore: number | null;
  generalStockAfter: number | null;
  variantStockBefore: number | null;
  variantStockAfter: number | null;
}

export interface PosPurchaseResult {
  alreadyCreated: boolean;
  hasUnknownCost?: boolean;
  navigation?: {
    previousPublicId: string | null;
    nextPublicId: string | null;
  };
  purchase: {
    id: string;
    publicId: string;
    supplierId: string;
    supplier: {
      id: string;
      code: string;
      name: string;
    };
    supplierInvoiceNumber: string | null;
    businessDate: string;
    warehouseKey: string;
    currencyCode: string;
    enteredByUserId: string;
    status: "draft" | "completed" | "voided";
    paymentMethod: "cash" | "credit" | "mixed";
    subtotalMinor: number;
    subtotal: number;
    discountMinor: number;
    discount: number;
    totalMinor: number;
    total: number;
    paidMinor: number;
    paid: number;
    dueMinor: number;
    due: number;
    notes: string | null;
    voidedAt: string | null;
    voidedByUserId: string | null;
    voidReason: string | null;
    createdAt: string;
    updatedAt: string;
    items: PosPurchaseItemResult[];
  };
}

export function getPosPurchaseByPublicId(
  token: string,
  publicId: string,
) {
  return apiRequest<PosPurchaseResult>(
    `/api/pos/purchases/by-public-id?publicId=${encodeURIComponent(publicId)}`,
    {},
    token,
  );
}

export function getLatestPosPurchase(
  token: string,
  warehouseKey = "main",
) {
  return apiRequest<PosPurchaseResult>(
    `/api/pos/purchases/latest?warehouseKey=${encodeURIComponent(warehouseKey)}`,
    {},
    token,
  );
}

export async function getOpenPosPurchaseDraft(
  token: string,
  supplierId: string,
  warehouseKey = "main",
) {
  const result = await apiRequest<
    PosPurchaseResult | { purchase: null }
  >(
    `/api/pos/purchases/draft?supplierId=${encodeURIComponent(supplierId)}&warehouseKey=${encodeURIComponent(warehouseKey)}`,
    {},
    token,
  );

  if (result.purchase === null) {
    return null;
  }

  return result as PosPurchaseResult;
}

export function savePosPurchaseDraft(
  token: string,
  input: {
    supplierId: string;
    supplierInvoiceNumber?: string;
    businessDate: string;
    warehouseKey: string;
    currencyCode: string;
    paymentMethod: "cash" | "credit" | "mixed";
    invoiceDiscount: string;
    paid: string;
    notes?: string;
    items: Array<{
      productId: string;
      barcode?: string;
      quantity: number;
      freeQuantity?: number;
      unitCost: string;
      lineDiscount?: string;
    }>;
  },
) {
  return apiRequest<PosPurchaseResult>(
    "/api/pos/purchases/draft",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function discardOpenPosPurchaseDraft(
  token: string,
  supplierId: string,
  warehouseKey = "main",
) {
  return apiRequest<{ ok: true }>(
    `/api/pos/purchases/draft?supplierId=${encodeURIComponent(supplierId)}&warehouseKey=${encodeURIComponent(warehouseKey)}`,
    {
      method: "DELETE",
    },
    token,
  );
}

export function createPosPurchase(
  token: string,
  input: {
    supplierId: string;
    idempotencyKey: string;
    draftPublicId?: string;
    supplierInvoiceNumber?: string;
    businessDate: string;
    warehouseKey: string;
    currencyCode: string;
    paymentMethod: "cash" | "credit" | "mixed";
    invoiceDiscount: string;
    paid: string;
    notes?: string;
    items: Array<{
      productId: string;
      barcode?: string;
      quantity: number;
      freeQuantity?: number;
      unitCost: string;
      lineDiscount?: string;
      color?: string;
      size?: string;
    }>;
  },
) {
  return apiRequest<PosPurchaseResult>(
    "/api/pos/purchases",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function voidPosPurchase(
  token: string,
  input: {
    publicId: string;
    reason: string;
  },
) {
  return apiRequest<PosPurchaseResult>(
    "/api/pos/purchases/void",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}


export interface CreatePosMobileReturnInput {
  registerKey: string;
  idempotencyKey: string;
  refundMethod?: "cash" | "card" | "customer";
  cardProcessor?:
    | "arab"
    | "bop";
  customerId?: number;
  reason?: string;
  notes?: string;

  items: Array<{
    barcode: string;
    color?: string | null;
    size?: string | null;
    quantity: number;
    refundUnitPrice: string;
  }>;
}

export interface PosMobileReturnResult {
  alreadyCreated: boolean;

  saleReturn: {
    id: string;
    publicId: string;
    customerId: string | null;

    cashSessionId: string;

    registerKey: string;
    businessDate: string;

    cashierUserId: string;

    status: string;
    refundMethod: "cash" | "card" | "customer";

    grossAmountMinor: number;
    grossAmount: number;

    refundAmountMinor: number;
    refundAmount: number;

    reason: string;

    createdAt: string;
  };

  items: Array<{
    id: string;

    productId: string | null;

    barcode: string | null;
    productCode: string | null;

    productNameAr: string;

    color: string | null;
    size: string | null;

    quantity: number;

    refundUnitPriceMinor: number;
    refundUnitPrice: number;

    refundAmountMinor: number;
    refundAmount: number;

    generalStockBefore: number | null;
    generalStockAfter: number | null;

    variantStockBefore: number | null;
    variantStockAfter: number | null;
  }>;
}

export function createPosMobileReturn(
  token: string,
  input: CreatePosMobileReturnInput,
) {
  return apiRequest<PosMobileReturnResult>(
    "/api/pos/sales/returns/mobile",
    {
      method: "POST",

      body: JSON.stringify(input),
    },
    token,
  );
}


export interface PosDeliveryCompany {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  notes: string | null;
  status: "active" | "inactive";
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
}

export interface PosDeliveryUnsettledOrder {
  id: number;
  customerName: string;
  customerPhone: string;
  shippingZone: string | null;
  totalPrice: number;
  shippingCost: number | null;
  deliveryCompanyCost: number | null;
  createdAt: string;
  amountMinor: number;
  amount: number;

  // التوصيل على الزبون، تكلفة الشركة، وصافي الربح/الخسارة.
  shippingChargedMinor: number;
  deliveryCompanyCostMinor: number;
  deliveryMarginMinor: number;
}

export interface PosDeliverySettlementSummary {
  company: {
    id: number;
    code: string;
    name: string;
    status: "active" | "inactive";
  };
  outstandingMinor: number;
  outstanding: number;

  shippingChargedMinor: number;
  deliveryCompanyCostMinor: number;
  deliveryMarginMinor: number;

  unsettledOrders: PosDeliveryUnsettledOrder[];
  settlements: Array<{
    id: number;
    publicId: string;
    businessDate: string;
    receiptMethod: "cash" | "bank";
    totalMinor: number;
    total: number;
    status: "posted" | "reversed";
    notes: string | null;
    createdAt: string;
    orders: Array<{
      orderId: number;
      amountMinor: number;
      amount: number;
      status: "posted" | "reversed";
    }>;
  }>;
}

export function getDeliveryCompanies(token: string) {
  return apiRequest<PosDeliveryCompany[]>(
    "/api/delivery-companies",
    {},
    token,
  );
}

export function getDeliveryCompanySettlementSummary(
  token: string,
  companyId: number,
) {
  return apiRequest<PosDeliverySettlementSummary>(
    `/api/delivery-companies/${companyId}/settlement-summary`,
    {},
    token,
  );
}

export function createDeliveryCompanySettlement(
  token: string,
  companyId: number,
  input: {
    orderIds: number[];
    receiptMethod: "cash" | "bank";
    notes?: string;
  },
) {
  return apiRequest<{
    settlement: {
      id: number;
      publicId: string;
    };
    financeTransaction: {
      id: number;
      publicId: string;
    };
    orderIds: number[];
    totalMinor: number;
    total: number;
  }>(
    `/api/delivery-companies/${companyId}/settlements`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}


export function reverseDeliveryCompanySettlement(
  token: string,
  companyId: number,
  settlementId: number,
  reason: string,
) {
  return apiRequest<{
    settlement: {
      id: number;
      publicId: string;
      status: "reversed";
    };
    reversalTransaction: {
      id: number;
      publicId: string;
    };
    orderIds: number[];
    totalMinor: number;
    total: number;
  }>(
    `/api/delivery-companies/${companyId}/settlements/${settlementId}/reverse`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    },
    token,
  );
}


export interface OwnerProductAnalyticsRow {
  productId: string;
  nameAr: string;
  productCode: string | null;
  barcode: string | null;
  category: string;
  price: number;
  image: string;
  isHidden: boolean;
  createdAt: string;

  views: number;
  viewers: number;
  addToCart: number;
  cartUsers: number;

  orders: number;
  units: number;
  revenueMinor: number;

  interestScore: number;
  hasInterestWithoutSales: boolean;
}

export interface OwnerProductAnalyticsReport {
  range: {
    from: string;
    to: string;
  };

  generatedAt: string;

  tracking: {
    firstTrackedDate: string | null;
    engagementHistorical: boolean;
    salesHistorical: boolean;
  };

  summary: {
    views: number;
    uniqueViewers: number;
    addToCart: number;
    orders: number;
    units: number;
    revenueMinor: number;
    interestWithoutSales: number;
    completedOnlineOrders: number;
  };

  products:
    OwnerProductAnalyticsRow[];

  warnings: string[];

  methodology: {
    views: string;
    addToCart: string;
    sales: string;
    revenue: string;
    interestScore: string;
  };
}

export function getOwnerProductAnalytics(
  token: string,
  input: {
    from: string;
    to: string;
  },
) {
  const params =
    new URLSearchParams({
      from: input.from,
      to: input.to,
    });

  return apiRequest<OwnerProductAnalyticsReport>(
    `/api/owner/reports/product-analytics?${params.toString()}`,
    {},
    token,
  );
}


export interface OwnerInventoryValuationProduct {
  productId: string;
  nameAr: string;
  productCode: string | null;
  barcode: string | null;
  price: number;
  category: string;
  isHidden: boolean;
  createdAt: string;

  currentQuantity: number | null;
  stockTracked: boolean;

  initialized: boolean;
  accountingQuantity: number | null;
  inventoryValueMinor: number | null;
  referenceUnitCostMinor: number | null;
  averageCostMinor: number | null;
  costQuality:
    | "confirmed"
    | "estimated"
    | "mixed"
    | null;

  stockMatchesAccounting: boolean;
  initializedAt: string | null;
  updatedAt: string | null;
}

export function getOwnerInventoryValuationProducts(
  token: string,
) {
  return apiRequest<{
    products: OwnerInventoryValuationProduct[];
  }>(
    "/api/owner/costs/products",
    {},
    token,
  );
}


export function setOwnerOpeningCost(
  token: string,
  input: {
    productId: string;
    unitCostMinor: number;
    costQuality?: "confirmed" | "estimated";
  },
) {
  return apiRequest<{
    historicalBackfill: {
      posSaleItems: number;
      posReturnItems: number;
      exchangeReturnItems: number;
      exchangeSaleItems: number;
      onlineOrderItems: number;
    };
    product: {
      productId: string;
      nameAr: string;
      quantity: number;
      unitCostMinor: number;
      referenceUnitCostMinor: number;
      inventoryValueMinor: number;
      costQuality: "confirmed" | "estimated";
    };
  }>(
    "/api/owner/costs/opening",
    {
      method: "POST",
      body: JSON.stringify({
        productId: input.productId,
        unitCostMinor: input.unitCostMinor,
        costQuality:
          input.costQuality ??
          "confirmed",
      }),
    },
    token,
  );
}


export function correctOwnerOpeningCost(
  token: string,
  input: {
    productId: string;
    unitCostMinor: number;
    reason?: string;
  },
) {
  return apiRequest<{
    unchanged: boolean;
    product: {
      productId: string;
      nameAr: string;
      quantity: number;
      previousUnitCostMinor: number;
      unitCostMinor: number;
      inventoryValueMinor: number;
    };
  }>(
    "/api/owner/costs/opening-correction",
    {
      method: "POST",
      body: JSON.stringify({
        productId:
          input.productId,
        unitCostMinor:
          input.unitCostMinor,
        reason:
          input.reason?.trim() || undefined,
      }),
    },
    token,
  );
}


export function setOwnerHistoricalCostRepair(
  token: string,
  input: {
    productId: string;
    unitCostMinor: number;
    from: string;
    to: string;
    costQuality?: "confirmed" | "estimated";
  },
) {
  return apiRequest<{
    range: {
      from: string;
      to: string;
    };
    product: {
      productId: string;
      nameAr: string;
      unitCostMinor: number;
      costQuality: "confirmed" | "estimated";
    };
    historicalBackfill: {
      posSaleItems: number;
      posReturnItems: number;
      exchangeReturnItems: number;
      exchangeSaleItems: number;
      onlineOrderItems: number;
    };
  }>(
    "/api/owner/costs/historical-repair",
    {
      method: "POST",
      body: JSON.stringify({
        productId: input.productId,
        unitCostMinor: input.unitCostMinor,
        from: input.from,
        to: input.to,
        costQuality:
          input.costQuality ??
          "confirmed",
      }),
    },
    token,
  );
}


export type InventoryMovementClass =
  | "fast"
  | "normal"
  | "slow"
  | "dead"
  | "new";

export type InventoryStockState =
  | "in_stock"
  | "out_of_stock"
  | "untracked";

export type InventoryCoverageSignal =
  | "untracked"
  | "insufficient_history"
  | "no_net_demand"
  | "out_of_stock"
  | "low"
  | "healthy"
  | "high";

export type InventoryRiskSignal =
  | "untracked"
  | "insufficient_history"
  | "balanced"
  | "stockout_now"
  | "stockout_high"
  | "stockout_watch"
  | "overstock_high"
  | "overstock_watch";

export type InventoryActionSignal =
  | "untracked"
  | "insufficient_history"
  | "reorder"
  | "reduce"
  | "review_no_demand"
  | "balanced";

export type InventoryFinancialCostQuality =
  | "confirmed"
  | "estimated"
  | "mixed";

export interface OwnerInventoryIntelligenceProduct {
  productId: string;
  nameAr: string;
  productCode: string | null;
  barcode: string | null;
  image: string;
  category: string;
  isHidden: boolean;

  currentQuantity: number | null;
  stockState: InventoryStockState;

  createdDate: string;
  inventoryStartDate: string;
  firstPurchaseDate: string | null;
  lastPurchaseDate: string | null;
  ageDays: number;

  lastSaleDate: string | null;
  daysSinceLastSale: number | null;

  sold30: number;
  sold90: number;
  totalSold: number;

  sellThrough30Percent: number | null;
  sellThrough90Percent: number | null;
  sellThrough30Reliable: boolean;
  sellThrough90Reliable: boolean;
  sellThrough30WindowDays: number;
  sellThrough90WindowDays: number;
  sellThrough30NetDemand: number;
  sellThrough90NetDemand: number;
  sellThrough30AvailableUnits: number | null;
  sellThrough90AvailableUnits: number | null;

  velocityWindowDays: number;
  velocityNetDemand: number;
  averageDailyNetDemand: number | null;
  daysOfSupply: number | null;
  coverageSignal: InventoryCoverageSignal;
  inventoryRiskSignal: InventoryRiskSignal;

  actionPlanReliable: boolean;
  inventoryActionSignal: InventoryActionSignal;
  targetStockUnits: number | null;
  maxHealthyStockUnits: number | null;
  suggestedReorderQuantity: number | null;
  excessUnits: number | null;

  costInitialized: boolean;
  costQuality: InventoryFinancialCostQuality | null;
  costStockMatchesAccounting: boolean;
  accountingQuantity: number | null;
  inventoryValueMinor: number | null;
  referenceUnitCostMinor: number | null;
  averageUnitCostMinor: number | null;
  currentInventoryValueMinor: number | null;
  suggestedReorderBudgetMinor: number | null;
  excessInventoryValueMinor: number | null;
  slowDeadCapitalMinor: number | null;

  movementClass: InventoryMovementClass;
  neverSold: boolean;
}

export interface OwnerInventoryIntelligenceVariant {
  variantKey: string;
  productId: string;
  nameAr: string;
  productCode: string | null;
  image: string;
  category: string;
  color: string;
  size: string;
  barcode: string | null;

  currentQuantity: number | null;
  stockState: InventoryStockState;
  ageDays: number;

  lastDemandDate: string | null;
  daysSinceLastDemand: number | null;

  netDemand30: number;
  netDemand90: number;
  sellThrough30Percent: number | null;
  sellThrough90Percent: number | null;
  sellThrough30Reliable: boolean;
  sellThrough90Reliable: boolean;

  velocityWindowDays: number;
  velocityNetDemand: number;
  averageDailyNetDemand: number | null;
  daysOfSupply: number | null;
  coverageSignal: InventoryCoverageSignal;
  inventoryRiskSignal: InventoryRiskSignal;

  actionPlanReliable: boolean;
  inventoryActionSignal: InventoryActionSignal;
  targetStockUnits: number | null;
  maxHealthyStockUnits: number | null;
  suggestedReorderQuantity: number | null;
  excessUnits: number | null;

  referenceUnitCostMinor: number | null;
  suggestedReorderBudgetMinor: number | null;

  movementClass: InventoryMovementClass;
}

export interface OwnerInventoryIntelligenceReport {
  generatedAt: string;
  asOfDate: string;

  history: {
    earliestSaleDate: string | null;
    coverageDays: number;
    hasThirtyDayHistory: boolean;
    hasNinetyDayHistory: boolean;
    earliestInventoryMovementDate: string | null;
    inventoryMovementCoverageDays: number;
  };

  thresholds: {
    fast30: number;
    fast90: number;
    slow30Max: number;
    slow90Max: number;
    newProductDays: number;
    deadProductDays: number;
    minimumVelocityHistoryDays: number;
    stockoutHighDays: number;
    lowCoverageDays: number;
    highCoverageDays: number;
    targetCoverageDays: number;
    overstockHighDays: number;
    minimumOverstockAgeDays: number;
  };

  summary: {
    totalProducts: number;
    trackedProducts: number;
    inStockProducts: number;
    fastMovers: number;
    slowMovers: number;
    deadMovers: number;
    newProducts: number;
    neverSoldInStock: number;
    fastOutOfStock: number;
    untrackedStock: number;
    sellThrough30Percent: number | null;
    sellThrough90Percent: number | null;
    sellThrough30ReliableProducts: number;
    sellThrough90ReliableProducts: number;
    coverUnder14Days: number;
    cover15To60Days: number;
    coverOver60Days: number;
    noVelocityInStock: number;
    insufficientCoverageData: number;
    stockoutNow: number;
    stockoutHighRisk: number;
    stockoutWatch: number;
    overstockHighRisk: number;
    overstockWatch: number;
    balancedInventoryRisk: number;
    insufficientRiskData: number;
    reorderSuggestedProducts: number;
    suggestedReorderUnits: number;
    excessSuggestedProducts: number;
    excessUnits: number;
    noDemandReviewProducts: number;
    insufficientActionData: number;
    suggestedReorderBudgetKnownMinor: number;
    reorderBudgetMissingCostProducts: number;
    excessInventoryValueKnownMinor: number;
    excessValueMissingCostProducts: number;
    slowDeadCapitalKnownMinor: number;
    slowDeadCapitalMissingCostProducts: number;
    costQuantityMismatchProducts: number;
  };

  warnings: string[];

  methodology: {
    sales: string;
    purchase: string;
    fast: string;
    slow: string;
    dead: string;
    new: string;
    sellThrough: string;
    daysOfSupply: string;
    inventoryRisk: string;
    inventoryAction: string;
    financialImpact: string;
    variantIntelligence: string;
  };

  variantSummary: {
    totalVariants: number;
    trackedVariants: number;
    inStockVariants: number;
    outOfStockVariants: number;
    fastVariants: number;
    slowVariants: number;
    deadVariants: number;
    stockoutNowVariants: number;
    stockoutHighRiskVariants: number;
    stockoutWatchVariants: number;
    overstockHighRiskVariants: number;
    overstockWatchVariants: number;
    reorderSuggestedVariants: number;
    suggestedReorderUnits: number;
    excessSuggestedVariants: number;
    excessUnits: number;
    noDemandReviewVariants: number;
    insufficientDataVariants: number;
    suggestedReorderBudgetKnownMinor: number;
    reorderBudgetMissingCostVariants: number;
    unattributedDemand30: number;
    unattributedDemand90: number;
  };

  variants: OwnerInventoryIntelligenceVariant[];
  products: OwnerInventoryIntelligenceProduct[];
}

export function getOwnerInventoryIntelligenceReport(
  token: string,
) {
  return apiRequest<OwnerInventoryIntelligenceReport>(
    "/api/owner/reports/inventory-intelligence",
    {},
    token,
  );
}


export interface GrossProfitChannelSummary {
  documents: number;
  returnDocuments: number;
  exchangeDocuments: number;

  salesMinor: number;
  returnsMinor: number;
  netSalesMinor: number;

  cogsKnownMinor: number;

  grossProfitMinor:
    | number
    | null;

  grossMarginPercent:
    | number
    | null;

  shippingChargedMinor: number;
  deliveryCompanyCostMinor: number;
  deliveryImpactMinor: number;

  profitAfterDeliveryMinor:
    | number
    | null;

  saleQuantity: number;
  trackedSaleQuantity: number;

  returnQuantity: number;
  trackedReturnQuantity: number;

  costCoveragePercent: number;
  costCoverageComplete: boolean;

  costQuality:
    | "confirmed"
    | "mixed"
    | "incomplete"
    | "not_applicable";
}

export interface GrossProfitMissingCostProduct {
  productId: string;
  nameAr: string;
  productCode: string | null;
  barcode: string | null;
  image: string;
  soldQuantity: number;
  channels: Array<
    "pos" | "exchange" | "online"
  >;
  canSetOpeningCost: boolean;
}

export interface GrossProfitReport {
  range: {
    from: string;
    to: string;
  };

  generatedAt: string;

  channels: {
    total:
      GrossProfitChannelSummary;

    pos:
      GrossProfitChannelSummary;

    online:
      GrossProfitChannelSummary;
  };

  warnings: string[];

  missingCostProducts:
    GrossProfitMissingCostProduct[];

  unresolvedMissingCostLines: number;

  methodology: {
    posDateBasis: string;
    onlineDateBasis: string;
    profitDefinition: string;
    deliveryDefinition: string;
    expensesIncluded: boolean;
  };
}

export function getGrossProfitReport(
  token: string,
  from: string,
  to: string,
) {
  const params =
    new URLSearchParams({
      from,
      to,
    });

  return apiRequest<GrossProfitReport>(
    `/api/owner/reports/gross-profit?${params.toString()}`,
    {},
    token,
  );
}


// ===== ONLINE ORDER EXCHANGE =====

export type OnlineExchangeDeliveryDiscountMode =
  | "none"
  | "half"
  | "full"
  | "manual";

export interface OnlineOrderExchangePreviewResult {
  order: {
    id: string;
    status: string;
    customerName: string;
    customerPhone: string;
    totalPrice: number;
    shippingCost: number | null;
    createdAt: string;
  };

  summary: {
    soldQuantity: number;
    exchangedQuantity: number;
    returnableQuantity: number;
    returnableValueMinor: number;
  };

  items: Array<{
    lineNumber: number;
    productId: string;
    productNameAr: string;
    productImage: string | null;
    color: string | null;
    size: string | null;
    soldQuantity: number;
    exchangedQuantity: number;
    returnableQuantity: number;
    soldUnitPriceMinor: number;
    originalLineTotalMinor: number;
  }>;
}

export interface OnlineOrderExchangeResult {
  replayed: boolean;

  exchange: {
    id: string;
    publicId: string;
    sourceType: "online_order";
    originalOrderId: string | null;
    replacementOrderId: string | null;
    replacementOrderOrigin:
      | "existing_order"
      | "system_created"
      | null;

    businessDate: string;
    status: "completed" | "voided";

    returnGrossMinor: number;
    returnDiscountMinor: number;
    returnNetMinor: number;

    newGrossMinor: number;
    newDiscountMinor: number;
    newNetMinor: number;

    differenceMinor: number;

    deliveryBaseChargeMinor: number;
    deliveryDiscountMinor: number;
    deliveryDiscountMode:
      OnlineExchangeDeliveryDiscountMode | null;
    deliveryChargeMinor: number;

    settlementAmountMinor: number;

    financialCompletedAt: string | null;
    returnReceivedAt: string | null;
  };

  replacementOrder: {
    id: string;
    status: string;
    customerName: string;
    customerPhone: string;
    shippingZone: string | null;
    shippingCost: number | null;
    totalPrice: number;
  } | null;

  returnItems: Array<{
    id: string;
    lineNumber: number;
    originalOrderLineNumber: number | null;
    productId: string | null;
    productNameAr: string;
    productImage: string | null;
    color: string | null;
    size: string | null;
    quantity: number;
    soldUnitPriceMinor: number;
    grossAmountMinor: number;
    allocatedDiscountMinor: number;
    returnNetMinor: number;
  }>;
}

export function getOnlineOrderExchangePreview(
  token: string,
  orderId: string | number,
) {
  return apiRequest<OnlineOrderExchangePreviewResult>(
    `/api/pos/exchanges/order-preview?orderId=${encodeURIComponent(String(orderId))}`,
    {},
    token,
  );
}

export function createOnlineOrderExchange(
  token: string,
  input: {
    idempotencyKey: string;
    originalOrderId: string | number;
    replacementOrderId?: string | number | null;

    returnItems: Array<{
      originalOrderLineNumber: number;
      quantity: number;
    }>;

    deliveryDiscountMode:
      OnlineExchangeDeliveryDiscountMode;

    manualDeliveryDiscountMinor?: number;
    notes?: string;
  },
) {
  return apiRequest<OnlineOrderExchangeResult>(
    "/api/pos/exchanges/online",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function getOnlineOrderExchangeStatus(
  token: string,
  publicId: string,
) {
  return apiRequest<OnlineOrderExchangeResult>(
    `/api/pos/exchanges/online/status?publicId=${encodeURIComponent(publicId.trim().toUpperCase())}`,
    {},
    token,
  );
}

export function receiveOnlineExchangeReturn(
  token: string,
  publicId: string,
) {
  return apiRequest<unknown>(
    "/api/pos/exchanges/online/receive-return",
    {
      method: "POST",
      body: JSON.stringify({
        publicId:
          publicId.trim().toUpperCase(),
      }),
    },
    token,
  );
}

// ===== POS EXCHANGE =====

export type PosExchangeSourceType =
  | "pos_sale"
  | "pos_no_receipt";

export type PosExchangeSettlementType =
  | "cash"
  | "card"
  | "customer";

export interface PosExchangePreviewItem {
  id: string;
  productId: string | null;
  lineNumber: number;

  barcode: string | null;
  productCode: string | null;
  productNameAr: string;
  productImage: string | null;

  color: string | null;
  size: string | null;

  soldQuantity: number;
  returnedQuantity: number;
  exchangedQuantity: number;
  consumedQuantity: number;
  returnableQuantity: number;

  soldUnitPriceMinor: number;
  soldUnitPrice: number;

  lineDiscountMinor: number;
  lineDiscount: number;

  consumedLineDiscountMinor: number;
  remainingLineDiscountMinor: number;

  originalLineTotalMinor: number;
  originalLineTotal: number;
}

export interface PosExchangePreviewResult {
  sale: {
    id: string;
    publicId: string;

    status: string;
    registerKey: string;
    businessDate: string;

    customerName: string | null;
    customerPhone: string | null;

    subtotalMinor: number;
    subtotal: number;

    discountMinor: number;
    discount: number;

    itemDiscountMinor: number;
    itemDiscount: number;

    invoiceDiscountMinor: number;
    invoiceDiscount: number;

    totalMinor: number;
    total: number;

    createdAt: string;
  };

  filter: {
    barcode: string | null;
  };

  summary: {
    soldQuantity: number;
    returnedQuantity: number;
    exchangedQuantity: number;
    returnableQuantity: number;

    priorReturnNetMinor: number;
    priorExchangeNetMinor: number;
    previouslyCreditedNetMinor: number;

    returnableNetMinor: number;
    returnableNet: number;

    fullyConsumed: boolean;
  };

  items: PosExchangePreviewItem[];
}

export interface PosExchangeNewItemInput {
  productId?: string | number | null;
  barcode?: string | null;
  quantity: number;

  soldUnitPrice: string | number;
  lineDiscount?: string | number;

  color?: string | null;
  size?: string | null;
}

export interface PosExchangeReceiptReturnItemInput {
  originalSaleItemId: string | number;
  quantity: number;
}

export interface PosExchangeNoReceiptReturnItemInput {
  productId?: string | number | null;
  barcode?: string | null;
  quantity: number;

  returnUnitPrice?: string | number;

  color?: string | null;
  size?: string | null;
}

interface PosExchangeCreateBaseInput {
  registerKey: string;
  idempotencyKey: string;

  settlementType: PosExchangeSettlementType;
  cardProcessor?:
    PosCardProcessor;

  customerId?: number;

  newItems: PosExchangeNewItemInput[];

  newInvoiceDiscount?: string | number;

  customerName?: string;

  validationOnly?: boolean;

  expectedQuote?: {
    returnNetMinor: number;
    newNetMinor: number;
    settlementAmountMinor: number;
  };

  reason?: string;
  notes?: string;
}

export type PosExchangeCreateInput =
  | (
      PosExchangeCreateBaseInput & {
        sourceType: "pos_sale";
        originalSalePublicId: string;
        returnItems: PosExchangeReceiptReturnItemInput[];
      }
    )
  | (
      PosExchangeCreateBaseInput & {
        sourceType: "pos_no_receipt";
        returnItems: PosExchangeNoReceiptReturnItemInput[];
      }
    );

export interface PosExchangeReturnItemResult {
  id: number;
  lineNumber: number;

  originalPosSaleItemId: number | null;
  productId: number | null;

  barcode: string | null;
  productCode: string | null;
  productNameAr: string;
  productImage: string | null;

  color: string | null;
  size: string | null;

  quantity: number;

  catalogUnitPriceMinor: number | null;
  soldUnitPriceMinor: number;

  grossAmountMinor: number;
  lineDiscountMinor: number;
  invoiceDiscountMinor: number;
  allocatedDiscountMinor: number;
  returnNetMinor: number;

  generalStockBefore: number | null;
  generalStockAfter: number | null;

  variantStockBefore: number | null;
  variantStockAfter: number | null;

  createdAt: string;
}

export interface PosExchangeSaleItemResult {
  id: number;
  lineNumber: number;
  productId: number;

  barcode: string | null;
  productCode: string | null;
  productNameAr: string;
  productImage: string | null;

  color: string | null;
  size: string | null;

  quantity: number;

  websiteUnitPriceMinor: number;
  soldUnitPriceMinor: number;

  grossAmountMinor: number;
  lineDiscountMinor: number;
  invoiceDiscountMinor: number;
  allocatedDiscountMinor: number;
  lineNetMinor: number;

  generalStockBefore: number | null;
  generalStockAfter: number | null;

  variantStockBefore: number | null;
  variantStockAfter: number | null;

  createdAt: string;
}

export interface PosExchangeQuoteReturnItemResult {
  lineNumber: number;

  originalSaleItemId: number | null;
  productId: number | null;

  barcode: string | null;
  productCode: string | null;
  productNameAr: string;
  productImage: string | null;

  color: string | null;
  size: string | null;

  quantity: number;

  catalogUnitPriceMinor: number | null;
  soldUnitPriceMinor: number;

  grossAmountMinor: number;
  lineDiscountMinor: number;
  invoiceDiscountMinor: number;
  allocatedDiscountMinor: number;
  returnNetMinor: number;
}

export interface PosExchangeQuoteSaleItemResult {
  lineNumber: number;
  productId: number;

  barcode: string | null;
  productCode: string | null;
  productNameAr: string;
  productImage: string | null;

  color: string | null;
  size: string | null;

  quantity: number;

  websiteUnitPriceMinor: number;
  soldUnitPriceMinor: number;

  grossAmountMinor: number;
  lineDiscountMinor: number;
  invoiceDiscountMinor: number;
  allocatedDiscountMinor: number;
  lineNetMinor: number;
}

export interface PosExchangeQuoteResult {
  sourceType: PosExchangeSourceType;
  originalSalePublicId: string | null;

  settlementType:
    PosExchangeSettlementType;
  cardProcessor?:
    PosCardProcessor | null;

  returnGrossMinor: number;
  returnDiscountMinor: number;
  returnNetMinor: number;

  newGrossMinor: number;
  newDiscountMinor: number;
  newNetMinor: number;

  differenceMinor: number;

  deliveryChargeMinor: number;
  deliveryCompanyCostMinor: number;

  settlementAmountMinor: number;

  expectedCashBeforeMinor: number;
  expectedCashAfterMinor: number;
}

export interface PosExchangeCreateResult {
  ok: boolean;
  validationOnly: boolean;
  alreadyCreated: boolean;

  quote: PosExchangeQuoteResult | null;

  exchange: {
    id: number;
    publicId: string;

    sourceType: PosExchangeSourceType;

    businessDate: string;
    registerKey: string | null;

    customerName?: string | null;

    status: "completed" | "voided";

    voidedAt?: string | null;
    voidReason?: string | null;

    settlementType:
      PosExchangeSettlementType;
    cardProcessor?:
      PosCardProcessor | null;

    returnGrossMinor: number;
    returnDiscountMinor: number;
    returnNetMinor: number;

    newGrossMinor: number;
    newDiscountMinor: number;
    newNetMinor: number;

    differenceMinor: number;
    settlementAmountMinor: number;

    expectedCashBeforeMinor?: number;
    expectedCashAfterMinor?: number;

    createdAt: string;
  } | null;

  returnItems: Array<
    | PosExchangeReturnItemResult
    | PosExchangeQuoteReturnItemResult
  >;

  saleItems: Array<
    | PosExchangeSaleItemResult
    | PosExchangeQuoteSaleItemResult
  >;
}

export interface PosExchangeSummary {
  id: number;
  publicId: string;

  sourceType: string;

  businessDate: string;
  registerKey: string | null;

  status:
    | "completed"
    | "voided";

  settlementType: string;
  cardProcessor?:
    PosCardProcessor | null;

  returnNetMinor: number;
  newNetMinor: number;

  differenceMinor: number;
  settlementAmountMinor: number;

  reason: string | null;
  notes: string | null;

  voidedAt: string | null;
  voidReason: string | null;

  createdAt: string;
}

export interface PosTodayExchangesResult {
  session: {
    id: string;
    registerKey: string;
    businessDate: string;
  } | null;

  exchanges:
    PosExchangeSummary[];
}

export function getTodayPosExchanges(
  token: string,
  registerKey = "main",
  businessDate?: string,
) {
  const params = new URLSearchParams({
    register: registerKey,
  });

  if (businessDate) {
    params.set("date", businessDate);
  }

  return apiRequest<PosTodayExchangesResult>(
    `/api/pos/exchanges?${params.toString()}`,
    {},
    token,
  );
}

export function getPosExchangeByPublicId(
  token: string,
  publicId: string,
) {
  return apiRequest<PosExchangeCreateResult>(
    `/api/pos/exchanges/by-public-id?publicId=${encodeURIComponent(
      publicId
        .trim()
        .toUpperCase(),
    )}`,
    {},
    token,
  );
}

export interface PosExchangeVoidResult {
  ok: boolean;
  alreadyVoided: boolean;

  exchange: {
    id: number;
    publicId: string;

    status: "completed" | "voided";

    sourceType:
      PosExchangeSourceType;

    settlementType:
      PosExchangeSettlementType;

    settlementAmountMinor: number;

    businessDate: string;

    voidedAt: string | null;
    voidReason: string | null;

    createdAt: string;

    expectedCashBeforeMinor:
      number | null;

    expectedCashAfterMinor:
      number | null;
  };
}

export function voidPosExchange(
  token: string,
  input: {
    publicId: string;
    reason: string;
  },
) {
  return apiRequest<PosExchangeVoidResult>(
    "/api/pos/exchanges/void",
    {
      method: "POST",

      body: JSON.stringify({
        publicId:
          input.publicId
            .trim()
            .toUpperCase(),

        reason:
          input.reason.trim(),
      }),
    },
    token,
  );
}

export function getPosExchangePreview(
  token: string,
  publicId: string,
  barcode?: string,
) {
  const params = new URLSearchParams({
    publicId:
      publicId.trim().toUpperCase(),
  });

  const normalizedBarcode =
    barcode?.trim();

  if (normalizedBarcode) {
    params.set(
      "barcode",
      normalizedBarcode,
    );
  }

  return apiRequest<PosExchangePreviewResult>(
    `/api/pos/exchanges/preview?${params.toString()}`,
    {},
    token,
  );
}

export function quotePosExchange(
  token: string,
  input: PosExchangeCreateInput,
) {
  return createPosExchange(
    token,
    {
      ...input,
      validationOnly: true,
    },
  );
}

export function createPosExchange(
  token: string,
  input: PosExchangeCreateInput,
) {
  const normalizedInput =
    input.sourceType === "pos_sale"
      ? {
          ...input,
          originalSalePublicId:
            input.originalSalePublicId
              .trim()
              .toUpperCase(),
        }
      : input;

  return apiRequest<PosExchangeCreateResult>(
    "/api/pos/exchanges",
    {
      method: "POST",
      body: JSON.stringify(
        normalizedInput,
      ),
    },
    token,
  );
}
