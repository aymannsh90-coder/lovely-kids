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
  barcode: string;
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
    totalMinor: number;
    total: number;
    paidMinor: number;
    paid: number;
    changeMinor: number;
    change: number;
    customerName: string | null;
    customerPhone: string | null;
    notes: string | null;
    createdAt: string;
  };
  items: PosSaleItemResult[];
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
      barcode: string;
      quantity: number;
      soldUnitPrice: string;
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
