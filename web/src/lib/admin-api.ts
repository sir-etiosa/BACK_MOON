const API_URL = process.env.NEXT_PUBLIC_API_URL!;
const ADMIN_TOKEN_KEY = "moonxch_admin_token";

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export class AdminApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) clearAdminToken();
    throw new AdminApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export interface AdminWithdrawal {
  id: string;
  userId: string;
  user: { email: string };
  asset: { symbol: string; chain: string; decimals: number };
  assetId: string;
  toAddress: string;
  amount: string;
  status: "PENDING" | "APPROVED" | "SENT" | "CONFIRMED" | "REJECTED";
  txHash: string | null;
  requestedAt: string;
}

export interface AdminAssetRequest {
  id: string;
  tokenName: string;
  network: string;
  createdAt: string;
  user: { email: string };
}

export interface AdminSupportMessage {
  id: string;
  sender: "USER" | "ADMIN";
  body: string;
  createdAt: string;
}

export interface AdminSupportTicket {
  id: string;
  status: "OPEN" | "CLOSED";
  createdAt: string;
  updatedAt: string;
  user: { email: string };
  messages: AdminSupportMessage[];
}

export const adminApi = {
  login: (email: string, password: string) =>
    request<{ accessToken: string }>("/admin/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  getWithdrawals: () => request<{ withdrawals: AdminWithdrawal[] }>("/admin/withdrawals"),
  markWithdrawalSent: (id: string, txHash: string) =>
    request<{ withdrawal: AdminWithdrawal }>(`/admin/withdrawals/${id}/mark-sent`, {
      method: "POST",
      body: JSON.stringify({ txHash }),
    }),
  confirmWithdrawal: (id: string) =>
    request<{ withdrawal: AdminWithdrawal }>(`/admin/withdrawals/${id}/confirm`, { method: "POST" }),
  rejectWithdrawal: (id: string, notes?: string) =>
    request<{ withdrawal: AdminWithdrawal }>(`/admin/withdrawals/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    }),
  getAssetRequests: () => request<{ requests: AdminAssetRequest[] }>("/admin/asset-requests"),
  getSupportTickets: () => request<{ tickets: AdminSupportTicket[] }>("/admin/support-messages"),
  replySupportTicket: (id: string, message: string) =>
    request<{ message: AdminSupportMessage }>(`/admin/support-messages/${id}/reply`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  clearSupportTicket: (id: string) =>
    request<{ ticket: AdminSupportTicket }>(`/admin/support-messages/${id}/clear`, { method: "POST" }),
};
