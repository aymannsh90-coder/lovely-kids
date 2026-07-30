const fallbackApiBaseUrl = "https://api.lovelykids.net";

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || fallbackApiBaseUrl
).replace(/\/+$/, "");

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

  const response = await fetch(
    `${API_BASE_URL}${path}`,
    {
      ...options,
      headers,
    },
  );

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

export function loginPos(
  phone: string,
  password: string,
) {
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

export function getCurrentPosUser(
  token: string,
) {
  return apiRequest<PosUser>(
    "/api/auth/me",
    {},
    token,
  );
}

export function getCurrentCashSession(
  token: string,
  registerKey = "main",
) {
  const register = encodeURIComponent(registerKey);

  return apiRequest<{
    session: CashSession | null;
  }>(
    `/api/pos/cash-sessions/current?register=${register}`,
    {},
    token,
  );
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

export function logoutPos(token: string) {
  return apiRequest<void>(
    "/api/auth/logout",
    {
      method: "POST",
    },
    token,
  );
}
