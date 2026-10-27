import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { recordAndCreditIfReady } from "./deposit-helper.js";
import { fetchWithTimeout } from "./fetch-with-timeout.js";

const REQUIRED_CONFIRMATIONS: Record<"bitcoin" | "litecoin", number> = {
  bitcoin: 2,
  litecoin: 6,
};
const BLOCKCYPHER_COIN: Record<"bitcoin" | "litecoin", string> = { bitcoin: "btc", litecoin: "ltc" };
const SYMBOL: Record<"bitcoin" | "litecoin", string> = { bitcoin: "BTC", litecoin: "LTC" };

interface BlockcypherTxref {
  tx_hash: string;
  tx_input_n: number;
  tx_output_n: number;
  value: number;
  confirmations: number;
}

interface BlockcypherAddr {
  txrefs?: BlockcypherTxref[];
  unconfirmed_txrefs?: BlockcypherTxref[];
}

/** BTC and LTC share the exact same Blockcypher API shape — one watcher, parameterized by chain. */
export async function runBtcLtcWatcher(chain: "bitcoin" | "litecoin") {
  const coin = BLOCKCYPHER_COIN[chain];
  const required = REQUIRED_CONFIRMATIONS[chain];
  const asset = await prisma.asset.findFirstOrThrow({ where: { chain, symbol: SYMBOL[chain] } });
  const addresses = await prisma.userAddress.findMany({ where: { chain } });

  let addressesChecked = 0;
  let depositsCredited = 0;
  const tokenParam = env.BLOCKCYPHER_TOKEN ? `&token=${env.BLOCKCYPHER_TOKEN}` : "";

  for (const { userId, address } of addresses) {
    addressesChecked++;
    const res = await fetchWithTimeout(
      `https://api.blockcypher.com/v1/${coin}/main/addrs/${address}?limit=20${tokenParam}`,
    );
    if (!res.ok) continue; // transient provider error — next run retries, nothing is lost

    const body = (await res.json()) as BlockcypherAddr;
    const incoming = [...(body.txrefs ?? []), ...(body.unconfirmed_txrefs ?? [])].filter(
      (t) => t.tx_input_n === -1,
    );

    for (const t of incoming) {
      const deposit = await recordAndCreditIfReady({
        userId,
        assetId: asset.id,
        address,
        txHash: t.tx_hash,
        amount: t.value,
        confirmations: t.confirmations ?? 0,
        requiredConfirmations: required,
      });
      if (deposit.status === "CREDITED") depositsCredited++;
    }
  }

  return { chain, addressesChecked, depositsCredited };
}
