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

export interface PosProductLookup {
  productId: string;
  barcode: string | null;
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

    customerId: string | null;

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
    `/api/pos/customers/${customerId}/receipt`,
    {
      method: "POST",
      body: JSON.stringify(
        input,
      ),
    },
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
  unitCostMinor: number;
  unitCost: number;
  lineDiscountMinor: number;
  lineDiscount: number;
  lineTotalMinor: number;
  lineTotal: number;
  generalStockBefore: number | null;
  generalStockAfter: number | null;
  variantStockBefore: number | null;
  variantStockAfter: number | null;
}

export interface PosPurchaseResult {
  alreadyCreated: boolean;
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
    status: "completed" | "voided";
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

export function createPosPurchase(
  token: string,
  input: {
    supplierId: string;
    idempotencyKey: string;
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

    cashSessionId: string;

    registerKey: string;
    businessDate: string;

    cashierUserId: string;

    status: string;

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


export interface GrossProfitChannelSummary {
  documents: number;
  returnDocuments: number;

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
  | "card";

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
