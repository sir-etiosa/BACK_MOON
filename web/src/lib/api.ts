const API_URL = process.env.NEXT_PUBLIC_API_URL!;
const TOKEN_KEY = "moonxch_access_token";
const LAST_EMAIL_KEY = "moonxch_last_email";
const LOGGED_OUT_KEY = "moonxch_explicit_logout";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getLastEmail(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LAST_EMAIL_KEY);
}

export function setLastEmail(email: string): void {
  localStorage.setItem(LAST_EMAIL_KEY, email);
}

export function wasExplicitLogout(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(LOGGED_OUT_KEY) === "1";
}

export function markExplicitLogout(): void {
  localStorage.setItem(LOGGED_OUT_KEY, "1");
}

export function clearExplicitLogout(): void {
  localStorage.removeItem(LOGGED_OUT_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function tryRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
    if (!res.ok) return null;
    const body = (await res.json()) as { accessToken?: string };
    if (!body.accessToken) return null;
    setToken(body.accessToken);
    return body.accessToken;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}, isRetry = false): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401 && token && !isRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, init, true);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) clearToken();
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export interface Balance {
  id: string;
  symbol: string;
  chain: string;
  decimals: number;
  balance: string;
  usdValue: string | null;
}

export interface SupportTicketMessage {
  id: string;
  sender: "USER" | "ADMIN";
  body: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  status: "OPEN" | "CLOSED";
  createdAt: string;
  updatedAt: string;
  messages: SupportTicketMessage[];
}

export interface CashoutProfileStatus {
  step: "name" | "otp" | "bank" | "done";
  email: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  bankName: string | null;
  accountNumber: string | null;
}

export interface Withdrawal {
  id: string;
  assetId: string;
  toAddress: string;
  amount: string;
  status: "PENDING" | "APPROVED" | "SENT" | "CONFIRMED" | "REJECTED";
  txHash: string | null;
  requestedAt: string;
}

export const api = {
  refresh: tryRefresh,
  identify: (email: string) =>
    request<{ exists: boolean; hasPassword: boolean }>("/auth/identify", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  loginWithPassword: (email: string, password: string) =>
    request<{ accessToken: string }>("/auth/password/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  setPassword: (password: string) =>
    request<{ ok: true }>("/auth/password/set", { method: "POST", body: JSON.stringify({ password }) }),
  requestOtp: (email: string) => request<{ ok: true }>("/auth/otp/request", { method: "POST", body: JSON.stringify({ email }) }),
  verifyOtp: (email: string, code: string) =>
    request<{ accessToken: string; needsPassword: boolean }>("/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  getAddresses: () => request<{ addresses: { chain: string; address: string | null; error: string | null }[] }>("/wallet/addresses"),
  getBalances: () => request<{ balances: Balance[]; ngnRate: number | null }>("/wallet/balances"),
  swap: (assetFromId: string, amountFrom: string, assetToId: string) =>
    request<{ trade: unknown; amountTo: string }>("/trade/swap", {
      method: "POST",
      body: JSON.stringify({ assetFromId, amountFrom, assetToId }),
    }),
  requestWithdrawal: (assetId: string, amount: string, toAddress: string) =>
    request<{ withdrawal: Withdrawal }>("/withdrawals", {
      method: "POST",
      body: JSON.stringify({ assetId, amount, toAddress }),
    }),
  getWithdrawals: () => request<{ withdrawals: Withdrawal[] }>("/withdrawals"),
  requestAsset: (tokenName: string, network: string) =>
    request<{ ok: true }>("/asset-requests", { method: "POST", body: JSON.stringify({ tokenName, network }) }),
  sendSupportMessage: (message: string) =>
    request<{ ok: true }>("/support-messages", { method: "POST", body: JSON.stringify({ message }) }),
  getSupportMessages: () => request<{ tickets: SupportTicket[] }>("/support-messages"),
  getSupportTicket: (id: string) => request<{ ticket: SupportTicket }>(`/support-messages/${id}`),
  replySupportTicket: (id: string, message: string) =>
    request<{ message: SupportTicketMessage }>(`/support-messages/${id}/reply`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  getCashoutProfile: () => request<CashoutProfileStatus>("/cashout/profile"),
  submitCashoutName: (firstName: string, middleName: string | undefined, lastName: string) =>
    request<{ ok: true }>("/cashout/profile/name", {
      method: "POST",
      body: JSON.stringify({ firstName, middleName, lastName }),
    }),
  resendCashoutOtp: () => request<{ ok: true }>("/cashout/otp/resend", { method: "POST" }),
  verifyCashoutOtp: (code: string) =>
    request<{ ok: true }>("/cashout/otp/verify", { method: "POST", body: JSON.stringify({ code }) }),
  saveCashoutBank: (bankName: string, accountNumber: string) =>
    request<{ ok: true }>("/cashout/bank", { method: "POST", body: JSON.stringify({ bankName, accountNumber }) }),
};
