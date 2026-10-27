import { prisma } from "../../db/prisma.js";
import { recordAndCreditIfReady } from "./deposit-helper.js";
import { fetchWithTimeout } from "./fetch-with-timeout.js";

// Tron finalizes in ~3s blocks; TronGrid's trc20-transfers endpoint only lists already-landed
// transfers (no mempool entries), but we add a time cushion as extra safety margin instead
// of trusting "appears in the list" alone.
const REQUIRED_AGE_SECONDS = 60;

interface TronGridTransfer {
  transaction_id: string;
  value: string;
  to: string;
  block_timestamp: number;
}

export async function runTronWatcher() {
  const asset = await prisma.asset.findFirstOrThrow({ where: { chain: "tron", symbol: "USDT" } });
  if (!asset.contractAddress) throw new Error("USDT asset is missing its contractAddress");

  const addresses = await prisma.userAddress.findMany({ where: { chain: "tron" } });

  let addressesChecked = 0;
  let depositsCredited = 0;
  const now = Date.now();

  for (const { userId, address } of addresses) {
    addressesChecked++;
    const url = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=20&contract_address=${asset.contractAddress}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) continue;

    const body = (await res.json()) as { data?: TronGridTransfer[] };
    const incoming = (body.data ?? []).filter((t) => t.to === address);

    for (const t of incoming) {
      const ageSeconds = (now - t.block_timestamp) / 1000;
      const deposit = await recordAndCreditIfReady({
        userId,
        assetId: asset.id,
        address,
        txHash: t.transaction_id,
        amount: t.value,
        confirmations: Math.floor(ageSeconds),
        requiredConfirmations: REQUIRED_AGE_SECONDS,
      });
      if (deposit.status === "CREDITED") depositsCredited++;
    }
  }

  return { chain: "tron", addressesChecked, depositsCredited };
}
