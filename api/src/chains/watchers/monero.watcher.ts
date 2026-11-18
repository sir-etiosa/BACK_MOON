import { prisma } from "../../db/prisma.js";
import { recordAndCreditIfReady } from "./deposit-helper.js";
import { moneroWalletRpcCall } from "../monero-wallet-rpc.js";

const REQUIRED_CONFIRMATIONS = 10;

interface MoneroTransfer {
  txid: string;
  amount: number;
  confirmations: number;
  subaddr_index: { major: number; minor: number };
}

/** Polls wallet-rpc for incoming transfers per subaddress. Does nothing (and the
 * outer try/catch in cron.routes.ts reports it cleanly) until MONERO_WALLET_RPC_URL
 * is actually configured and pointed at a running view-only wallet-rpc instance. */
export async function runMoneroWatcher() {
  const asset = await prisma.asset.findFirstOrThrow({ where: { chain: "monero", symbol: "XMR" } });
  const addresses = await prisma.userAddress.findMany({ where: { chain: "monero" } });

  let addressesChecked = 0;
  let depositsCredited = 0;

  for (const { userId, address, derivationIndex } of addresses) {
    addressesChecked++;
    try {
      const result = await moneroWalletRpcCall<{ in?: MoneroTransfer[] }>("get_transfers", {
        in: true,
        account_index: 0,
        subaddr_indices: [derivationIndex],
      });

      for (const t of result.in ?? []) {
        const deposit = await recordAndCreditIfReady({
          userId,
          assetId: asset.id,
          address,
          txHash: t.txid,
          amount: t.amount,
          confirmations: t.confirmations,
          requiredConfirmations: REQUIRED_CONFIRMATIONS,
        });
        if (deposit.status === "CREDITED") depositsCredited++;
      }
    } catch (err) {
      console.error(`monero watcher: check failed for subaddress ${derivationIndex}:`, (err as Error).message);
    }
  }

  return { chain: "monero", addressesChecked, depositsCredited };
}
