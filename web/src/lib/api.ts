const API_URL = process.env.NEXT_PUBLIC_API_URL!;
const TOKEN_KEY = "moonxch_access_token";

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

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  requestOtp: (email: string) => request<{ ok: true }>("/auth/otp/request", { method: "POST", body: JSON.stringify({ email }) }),
  verifyOtp: (email: string, code: string) =>
    request<{ accessToken: string }>("/auth/otp/verify", { method: "POST", body: JSON.stringify({ email, code }) }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  getAddresses: () => request<{ addresses: { chain: string; address: string | null; error: string | null }[] }>("/wallet/addresses"),
  getBalances: () => request<{ balances: { symbol: string; chain: string; balance: string }[] }>("/wallet/balances"),
};
