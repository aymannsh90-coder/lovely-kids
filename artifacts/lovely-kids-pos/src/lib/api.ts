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

export function createPosSale(
  token: string,
  input: {
    registerKey: string;
    idempotencyKey: string;
    paymentMethod: "cash";
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
}

export function getTodayPosSales(token: string, registerKey = "main") {
  const register = encodeURIComponent(registerKey);

  return apiRequest<PosTodaySalesResult>(
    `/api/pos/sales/today?register=${register}`,
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
    paymentMethod: "cash";
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
