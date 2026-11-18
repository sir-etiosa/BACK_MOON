import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { fetchWithTimeout } from "../../chains/watchers/fetch-with-timeout.js";

export interface OnchainBalanceResult {
  totalMinor: string | null; // null = genuinely unavailable (XMR) — never fake a zero
  note?: string;
}

// --- EVM (ETH, USDC on evm/base) — direct JSON-RPC, no API key needed -------------
// Base shares the exact same address as mainnet (same xpub/derivation), so UserAddress
// rows are always stored under chain "evm" regardless of which EVM network we're
// reading balances from — same convention as evm.watcher.ts.
const EVM_RPC_URL: Record<string, string> = {
  evm: "https://ethereum-rpc.publicnode.com",
  base: "https://base-rpc.publicnode.com",
};

async function evmRpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<string> {
  const res = await fetchWithTimeout(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const body = (await res.json()) as { result?: string; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  if (body.result === undefined) throw new Error(`${method} returned no result`);
  return body.result;
}

async function sumEvmNative(rpcUrl: string, addresses: string[]): Promise<bigint> {
  let total = 0n;
  for (const address of addresses) {
    try {
      total += BigInt(await evmRpcCall(rpcUrl, "eth_getBalance", [address, "latest"]));
    } catch {
      // one address failing (rate limit, transient RPC error) shouldn't blank the whole total
    }
  }
  return total;
}

async function sumErc20(rpcUrl: string, contractAddress: string, addresses: string[]): Promise<bigint> {
  let total = 0n;
  for (const address of addresses) {
    try {
      // balanceOf(address) — selector 0x70a08231 + left-padded 32-byte address argument
      const data = `0x70a08231000000000000000000000000${address.replace(/^0x/, "").toLowerCase()}`;
      total += BigInt(await evmRpcCall(rpcUrl, "eth_call", [{ to: contractAddress, data }, "latest"]));
    } catch {
      // see above
    }
  }
  return total;
}

async function getEvmOnchainTotal(chain: string, contractAddress: string | null): Promise<OnchainBalanceResult> {
  const rpcUrl = EVM_RPC_URL[chain];
  if (!rpcUrl) return { totalMinor: null, note: `No RPC configured for chain "${chain}"` };

  // NOTE: one RPC call per address today — fine at current address counts (dozens), but
  // revisit with a Multicall3 batch call once this grows into the thousands, to avoid
  // thousands of sequential round trips per dashboard refresh.
  const addresses = (await prisma.userAddress.findMany({ where: { chain: "evm" }, select: { address: true } })).map(
    (a) => a.address,
  );
  if (addresses.length === 0) return { totalMinor: "0" };

  const total = contractAddress ? await sumErc20(rpcUrl, contractAddress, addresses) : await sumEvmNative(rpcUrl, addresses);
  return { totalMinor: total.toString() };
}

// --- BTC / LTC — BlockCypher, same provider the deposit watcher already uses ------
async function getBtcLtcOnchainTotal(chain: "bitcoin" | "litecoin"): Promise<OnchainBalanceResult> {
  const coin = chain === "bitcoin" ? "btc" : "ltc";
  const addresses = (await prisma.userAddress.findMany({ where: { chain }, select: { address: true } })).map(
    (a) => a.address,
  );
  if (addresses.length === 0) return { totalMinor: "0" };

  const tokenParam = env.BLOCKCYPHER_TOKEN ? `?token=${env.BLOCKCYPHER_TOKEN}` : "";
  let total = 0n;
  let anyFailed = false;
  for (const address of addresses) {
    try {
      const res = await fetchWithTimeout(`https://api.blockcypher.com/v1/${coin}/main/addrs/${address}/balance${tokenParam}`);
      if (!res.ok) {
        anyFailed = true;
        continue;
      }
      const body = (await res.json()) as { final_balance?: number };
      total += BigInt(body.final_balance ?? 0);
    } catch {
      anyFailed = true;
    }
  }
  return {
    totalMinor: total.toString(),
    note: anyFailed
      ? env.BLOCKCYPHER_TOKEN
        ? "One or more addresses failed to look up"
        : "No BLOCKCYPHER_TOKEN set — free tier rate limits may have dropped some addresses"
      : undefined,
  };
}

// --- TRON (USDT-TRC20) — TronGrid public endpoint, no key needed ------------------
async function getTronOnchainTotal(contractAddress: string): Promise<OnchainBalanceResult> {
  const addresses = (await prisma.userAddress.findMany({ where: { chain: "tron" }, select: { address: true } })).map(
    (a) => a.address,
  );
  if (addresses.length === 0) return { totalMinor: "0" };

  let total = 0n;
  for (const address of addresses) {
    try {
      const res = await fetchWithTimeout(`https://api.trongrid.io/v1/accounts/${address}`);
      if (!res.ok) continue;
      const body = (await res.json()) as { data?: Array<{ trc20?: Array<Record<string, string>> }> };
      const trc20List = body.data?.[0]?.trc20 ?? [];
      for (const entry of trc20List) {
        const bal = entry[contractAddress];
        if (bal) total += BigInt(bal);
      }
    } catch {
      // see EVM note above
    }
  }
  return { totalMinor: total.toString() };
}

// --- Solana — public RPC, native SOL only -----------------------------------------
async function getSolanaOnchainTotal(): Promise<OnchainBalanceResult> {
  const addresses = (await prisma.userAddress.findMany({ where: { chain: "solana" }, select: { address: true } })).map(
    (a) => a.address,
  );
  if (addresses.length === 0) return { totalMinor: "0", note: "No Solana addresses issued yet" };

  let total = 0n;
  for (const address of addresses) {
    try {
      const res = await fetchWithTimeout("https://api.mainnet-beta.solana.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }),
      });
      const body = (await res.json()) as { result?: { value: number } };
      total += BigInt(body.result?.value ?? 0);
    } catch {
      // see EVM note above
    }
  }
  return { totalMinor: total.toString() };
}

/**
 * Real on-chain custody per asset — what's actually sitting in deposit addresses right
 * now, fetched live. This is the other half of the exposure comparison in
 * `treasury.service.ts`: ledger says what you owe users; this says what you actually
 * hold. Monero can't be queried without a view key — reported as unavailable, never
 * faked as zero.
 */
export async function getOnchainTotalForAsset(asset: {
  symbol: string;
  chain: string;
  contractAddress: string | null;
}): Promise<OnchainBalanceResult> {
  if (asset.chain === "evm" || asset.chain === "base") {
    return getEvmOnchainTotal(asset.chain, asset.contractAddress);
  }
  if (asset.chain === "bitcoin" || asset.chain === "litecoin") {
    return getBtcLtcOnchainTotal(asset.chain);
  }
  if (asset.chain === "tron") {
    if (!asset.contractAddress) return { totalMinor: null, note: "Missing contract address" };
    return getTronOnchainTotal(asset.contractAddress);
  }
  if (asset.chain === "solana") {
    return getSolanaOnchainTotal();
  }
  if (asset.chain === "monero") {
    return { totalMinor: null, note: "Monero balances can't be queried without a view-only wallet-rpc (not deployed)" };
  }
  if (asset.chain === "fiat") {
    return { totalMinor: null, note: "Fiat-backed token (XCH/NGN) — not an on-chain asset" };
  }
  return { totalMinor: null, note: `Unrecognized chain "${asset.chain}"` };
}
