import { prisma } from "../../db/prisma.js";
import { getOnchainTotalForAsset } from "./onchain-balance.service.js";

/** Sum of every user's ledger balance for one asset — "what you'd owe if everyone
 * cashed out/withdrew this asset at once." Raw SQL join+sum so this stays cheap at
 * real scale (thousands of users), not an N+1 fetch-then-sum in JS. */
async function sumUserLedgerBalances(assetId: string): Promise<bigint> {
  const rows = await prisma.$queryRaw<{ total: string | null }[]>`
    SELECT COALESCE(SUM(b.balance), 0)::text AS total
    FROM ledger_account_balances b
    JOIN ledger_accounts a ON a.id = b.ledger_account_id
    WHERE a.type = 'USER_ASSET' AND a.asset_id = ${assetId}
  `;
  return BigInt(rows[0]?.total ?? "0");
}

async function getTreasuryLedgerBalance(assetId: string): Promise<bigint> {
  const rows = await prisma.$queryRaw<{ total: string | null }[]>`
    SELECT COALESCE(SUM(b.balance), 0)::text AS total
    FROM ledger_account_balances b
    JOIN ledger_accounts a ON a.id = b.ledger_account_id
    WHERE a.type = 'TREASURY' AND a.asset_id = ${assetId}
  `;
  return BigInt(rows[0]?.total ?? "0");
}

export interface AssetExposureRow {
  assetId: string;
  symbol: string;
  chain: string;
  decimals: number;
  onchainTotalMinor: string | null;
  onchainNote?: string;
  userLedgerTotalMinor: string;
  treasuryLedgerBalanceMinor: string;
  /** onchain − user-owed. Positive = surplus (you hold more than you owe, from
   * un-swept deposits). Negative = you're short — this is what needs hedging/topping
   * up before it becomes a real problem at withdrawal time. Null if onchain is
   * unavailable (XMR, fiat). */
  gapMinor: string | null;
}

/**
 * The exposure report for the admin dashboard: for every asset, real on-chain custody
 * vs what the ledger says you owe users, side by side. `treasuryLedgerBalanceMinor` is
 * what swaps/cashouts/bills have accumulated on your books from users disposing of
 * this asset — the number a manual Binance hedge is meant to flatten. `gapMinor` is
 * the actual real-money reality check: it only moves when real deposits/withdrawals/
 * sweeps happen, independent of anything the ledger says.
 */
export async function getAssetExposureReport(): Promise<AssetExposureRow[]> {
  const assets = await prisma.asset.findMany({ where: { isActive: true }, orderBy: { symbol: "asc" } });

  const rows: AssetExposureRow[] = [];
  for (const asset of assets) {
    const [onchain, userLedgerTotal, treasuryLedgerBalance] = await Promise.all([
      getOnchainTotalForAsset(asset),
      sumUserLedgerBalances(asset.id),
      getTreasuryLedgerBalance(asset.id),
    ]);

    rows.push({
      assetId: asset.id,
      symbol: asset.symbol,
      chain: asset.chain,
      decimals: asset.decimals,
      onchainTotalMinor: onchain.totalMinor,
      onchainNote: onchain.note,
      userLedgerTotalMinor: userLedgerTotal.toString(),
      treasuryLedgerBalanceMinor: treasuryLedgerBalance.toString(),
      gapMinor: onchain.totalMinor !== null ? (BigInt(onchain.totalMinor) - userLedgerTotal).toString() : null,
    });
  }

  return rows;
}
