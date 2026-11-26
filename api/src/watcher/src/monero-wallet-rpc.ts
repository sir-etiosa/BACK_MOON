import { createHash, randomBytes } from "node:crypto";
import { env } from "./config.js";
import { fetchWithTimeout } from "./watchers/fetch-with-timeout.js";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

/** monero-wallet-rpc's `--rpc-login user:pass` flag protects the endpoint with HTTP
 * Digest auth (not Basic) — the standard flow: get challenged with a 401 + nonce,
 * compute the digest response, retry once with it. */
async function digestFetch(url: string, body: string): Promise<Response> {
  const first = await fetchWithTimeout(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  if (first.status !== 401 || !env.MONERO_WALLET_RPC_USER) return first;

  const header = first.headers.get("www-authenticate");
  if (!header) return first;

  const realm = /realm="([^"]*)"/.exec(header)?.[1] ?? "";
  const nonce = /nonce="([^"]*)"/.exec(header)?.[1] ?? "";
  const qop = /qop="?([^",]*)"?/.exec(header)?.[1] ?? "auth";
  const opaque = /opaque="([^"]*)"/.exec(header)?.[1];
  const user = env.MONERO_WALLET_RPC_USER;
  const pass = env.MONERO_WALLET_RPC_PASSWORD ?? "";
  const uri = new URL(url).pathname || "/json_rpc";
  const nc = "00000001";
  const cnonce = randomBytes(8).toString("hex");

  const ha1 = md5(`${user}:${realm}:${pass}`);
  const ha2 = md5(`POST:${uri}`);
  const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);

  const authHeader =
    `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", ` +
    `qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"` +
    (opaque ? `, opaque="${opaque}"` : "");

  return fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body,
  });
}

/** Calls a monero-wallet-rpc JSON-RPC method. Throws a clear error if
 * MONERO_WALLET_RPC_URL isn't configured (not deployed yet) or the call itself fails
 * — callers should treat that as "temporarily unavailable", not crash the whole
 * issuance/watcher flow for other chains. */
export async function moneroWalletRpcCall<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!env.MONERO_WALLET_RPC_URL) {
    throw new Error("MONERO_WALLET_RPC_URL not set — deploy monero-wallet-rpc (view-only wallet) first");
  }

  const body = JSON.stringify({ jsonrpc: "2.0", id: "0", method, params });
  let res: Response;
  try {
    res = await digestFetch(env.MONERO_WALLET_RPC_URL, body);
  } catch (err) {
    throw new Error(`Can't reach monero-wallet-rpc at ${env.MONERO_WALLET_RPC_URL} — is it deployed and running? (${(err as Error).message})`);
  }
  if (!res.ok) {
    throw new Error(`monero-wallet-rpc ${method} failed: HTTP ${res.status}`);
  }

  const parsed = (await res.json()) as { result?: T; error?: { message: string } };
  if (parsed.error) throw new Error(`monero-wallet-rpc ${method}: ${parsed.error.message}`);
  if (parsed.result === undefined) throw new Error(`monero-wallet-rpc ${method} returned no result`);
  return parsed.result;
}
