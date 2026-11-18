import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { prisma } from "../../db/prisma.js";
import { recordAndCreditIfReady } from "./deposit-helper.js";

const RPC_URL = "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

// Solana doesn't have block-depth confirmations like UTXO/EVM chains — it has a
// confirmationStatus per signature. Map that onto the same numeric confirmations/
// requiredConfirmations contract recordAndCreditIfReady already expects everywhere
// else: "finalized" (Solana's strongest, effectively-irreversible guarantee) meets the
// bar; "confirmed" alone does not.
const REQUIRED_CONFIRMATIONS = 2;
function confirmationsFor(status: string | null): number {
  if (status === "finalized") return REQUIRED_CONFIRMATIONS;
  if (status === "confirmed") return REQUIRED_CONFIRMATIONS - 1;
  return 0;
}

async function watchNativeSol(userId: string, address: string, assetId: string): Promise<number> {
  let credited = 0;
  const pubkey = new PublicKey(address);
  const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 20 });

  for (const sig of signatures) {
    if (sig.err) continue;
    const confirmations = confirmationsFor(sig.confirmationStatus ?? null);

    const tx = await connection.getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0 });
    if (!tx?.meta) continue;

    const accountKeys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
    const idx = accountKeys.indexOf(address);
    if (idx === -1) continue;

    const delta = tx.meta.postBalances[idx] - tx.meta.preBalances[idx];
    if (delta <= 0) continue; // outgoing or no-op from this address's perspective

    const deposit = await recordAndCreditIfReady({
      userId,
      assetId,
      address,
      txHash: sig.signature,
      amount: delta,
      confirmations,
      requiredConfirmations: REQUIRED_CONFIRMATIONS,
    });
    if (deposit.status === "CREDITED") credited++;
  }

  return credited;
}

async function watchUsdcSpl(userId: string, address: string, assetId: string, mintAddress: string): Promise<number> {
  let credited = 0;
  const owner = new PublicKey(address);
  const mint = new PublicKey(mintAddress);
  const ata = await getAssociatedTokenAddress(mint, owner);

  const signatures = await connection.getSignaturesForAddress(ata, { limit: 20 });

  for (const sig of signatures) {
    if (sig.err) continue;
    const confirmations = confirmationsFor(sig.confirmationStatus ?? null);

    const tx = await connection.getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0 });
    if (!tx?.meta) continue;

    const pre = tx.meta.preTokenBalances?.find((b) => b.owner === address && b.mint === mintAddress);
    const post = tx.meta.postTokenBalances?.find((b) => b.owner === address && b.mint === mintAddress);
    const preAmount = BigInt(pre?.uiTokenAmount.amount ?? "0");
    const postAmount = BigInt(post?.uiTokenAmount.amount ?? "0");
    const delta = postAmount - preAmount;
    if (delta <= 0n) continue;

    const deposit = await recordAndCreditIfReady({
      userId,
      assetId,
      address,
      txHash: sig.signature,
      amount: delta.toString(),
      confirmations,
      requiredConfirmations: REQUIRED_CONFIRMATIONS,
    });
    if (deposit.status === "CREDITED") credited++;
  }

  return credited;
}

/** Scoped to SOL and USDC-SPL for now, per the current build brief — other SPL tokens
 * can be added the same way (just another `watchSplToken` call with a different mint)
 * once there's demand for them. */
export async function runSolanaWatcher() {
  const [solAsset, usdcAsset] = await Promise.all([
    prisma.asset.findFirstOrThrow({ where: { chain: "solana", symbol: "SOL" } }),
    prisma.asset.findFirst({ where: { chain: "solana", symbol: "USDC" } }),
  ]);

  const addresses = await prisma.userAddress.findMany({ where: { chain: "solana" } });

  let addressesChecked = 0;
  let depositsCredited = 0;

  for (const { userId, address } of addresses) {
    addressesChecked++;
    try {
      depositsCredited += await watchNativeSol(userId, address, solAsset.id);
    } catch (err) {
      console.error(`solana watcher: native SOL check failed for ${address}:`, (err as Error).message);
    }

    if (usdcAsset?.contractAddress) {
      try {
        depositsCredited += await watchUsdcSpl(userId, address, usdcAsset.id, usdcAsset.contractAddress);
      } catch (err) {
        console.error(`solana watcher: USDC-SPL check failed for ${address}:`, (err as Error).message);
      }
    }
  }

  return { chain: "solana", addressesChecked, depositsCredited };
}
