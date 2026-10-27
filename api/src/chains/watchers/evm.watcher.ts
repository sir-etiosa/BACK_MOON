import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { recordAndCreditIfReady } from "./deposit-helper.js";
import { fetchWithTimeout } from "./fetch-with-timeout.js";

const REQUIRED_CONFIRMATIONS = 12;

interface EtherscanTx {
  hash: string;
  to: string;
  value: string;
  blockNumber: string;
  isError: string;
}

async function getCurrentBlockNumber(): Promise<number> {
  const res = await fetchWithTimeout("https://ethereum-rpc.publicnode.com", {
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

  const asset = await prisma.asset.findFirstOrThrow({ where: { chain: "evm", symbol: "ETH" } });
  const addresses = await prisma.userAddress.findMany({ where: { chain: "evm" } });
  const currentBlock = await getCurrentBlockNumber();

  let addressesChecked = 0;
  let depositsCredited = 0;

  for (const { userId, address } of addresses) {
    addressesChecked++;
    const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=${address}&sort=desc&page=1&offset=20&apikey=${env.ETHERSCAN_API_KEY}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) continue;

    const body = (await res.json()) as { result: EtherscanTx[] | string };
    if (!Array.isArray(body.result)) continue; // Etherscan returns a string message on no-results/errors

    const incoming = body.result.filter(
      (t) => t.to?.toLowerCase() === address.toLowerCase() && t.isError === "0" && BigInt(t.value) > 0n,
    );

    for (const t of incoming) {
      const confirmations = currentBlock - parseInt(t.blockNumber, 10) + 1;
      const deposit = await recordAndCreditIfReady({
        userId,
        assetId: asset.id,
        address,
        txHash: t.hash,
        amount: t.value,
        confirmations,
        requiredConfirmations: REQUIRED_CONFIRMATIONS,
      });
      if (deposit.status === "CREDITED") depositsCredited++;
    }
  }

  return { chain: "evm", addressesChecked, depositsCredited };
}
