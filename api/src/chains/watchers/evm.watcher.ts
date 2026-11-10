import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { recordAndCreditIfReady } from "./deposit-helper.js";
import { fetchWithTimeout } from "./fetch-with-timeout.js";

const REQUIRED_CONFIRMATIONS = 12;

// Etherscan's V2 API covers 50+ EVM chains through one endpoint/key, keyed by chainid.
// Base reuses the exact same address as mainnet (same xpub, same secp256k1 derivation —
// EVM addresses aren't chain-specific), so both networks scan the same UserAddress rows.
const NETWORKS = [
  { chainId: 1, assetChain: "evm", rpcUrl: "https://ethereum-rpc.publicnode.com" },
  { chainId: 8453, assetChain: "base", rpcUrl: "https://base-rpc.publicnode.com" },
] as const;

interface EtherscanTx {
  hash: string;
  to: string;
  value: string;
  blockNumber: string;
  isError: string;
}

interface EtherscanTokenTx {
  hash: string;
  to: string;
  value: string;
  blockNumber: string;
}

async function getCurrentBlockNumber(rpcUrl: string): Promise<number> {
  const res = await fetchWithTimeout(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
  });
  const body = (await res.json()) as { result: string };
  return parseInt(body.result, 16);
}

export async function runEvmWatcher() {
  if (!env.ETHERSCAN_API_KEY) {
    throw new Error("ETHERSCAN_API_KEY not set — get a free key at etherscan.io/apidashboard");
  }

  const addresses = await prisma.userAddress.findMany({ where: { chain: "evm" } });

  let addressesChecked = 0;
  let depositsCredited = 0;

  for (const network of NETWORKS) {
    const ethAsset = await prisma.asset.findFirst({ where: { chain: network.assetChain, symbol: "ETH" } });
    const tokenAssets = await prisma.asset.findMany({
      where: { chain: network.assetChain, isActive: true, symbol: { not: "ETH" }, contractAddress: { not: null } },
    });
    if (!ethAsset && tokenAssets.length === 0) continue;

    const currentBlock = await getCurrentBlockNumber(network.rpcUrl);

    for (const { userId, address } of addresses) {
      addressesChecked++;

      if (ethAsset) {
        const ethUrl = `https://api.etherscan.io/v2/api?chainid=${network.chainId}&module=account&action=txlist&address=${address}&sort=desc&page=1&offset=20&apikey=${env.ETHERSCAN_API_KEY}`;
        const ethRes = await fetchWithTimeout(ethUrl);
        if (ethRes.ok) {
          const body = (await ethRes.json()) as { result: EtherscanTx[] | string };
          if (Array.isArray(body.result)) {
            const incoming = body.result.filter(
              (t) => t.to?.toLowerCase() === address.toLowerCase() && t.isError === "0" && BigInt(t.value) > 0n,
            );
            for (const t of incoming) {
              const confirmations = currentBlock - parseInt(t.blockNumber, 10) + 1;
              const deposit = await recordAndCreditIfReady({
                userId,
                assetId: ethAsset.id,
                address,
                txHash: t.hash,
                amount: t.value,
                confirmations,
                requiredConfirmations: REQUIRED_CONFIRMATIONS,
              });
              if (deposit.status === "CREDITED") depositsCredited++;
            }
          }
        }
      }

      for (const tokenAsset of tokenAssets) {
        const tokenUrl = `https://api.etherscan.io/v2/api?chainid=${network.chainId}&module=account&action=tokentx&contractaddress=${tokenAsset.contractAddress}&address=${address}&sort=desc&page=1&offset=20&apikey=${env.ETHERSCAN_API_KEY}`;
        const tokenRes = await fetchWithTimeout(tokenUrl);
        if (!tokenRes.ok) continue;

        const body = (await tokenRes.json()) as { result: EtherscanTokenTx[] | string };
        if (!Array.isArray(body.result)) continue;

        const incoming = body.result.filter((t) => t.to?.toLowerCase() === address.toLowerCase());
        for (const t of incoming) {
          const confirmations = currentBlock - parseInt(t.blockNumber, 10) + 1;
          const deposit = await recordAndCreditIfReady({
            userId,
            assetId: tokenAsset.id,
            address,
            txHash: t.hash,
            amount: t.value,
            confirmations,
            requiredConfirmations: REQUIRED_CONFIRMATIONS,
          });
          if (deposit.status === "CREDITED") depositsCredited++;
        }
      }
    }
  }

  return { chain: "evm", addressesChecked, depositsCredited };
}
