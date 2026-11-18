import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";

/**
 * Confirms the chart-of-accounts cutover (`migrate-to-ledger-accounts.ts`) moved every
 * naira/token exactly: sums the legacy `Balance` table per asset and compares it against
 * the sum of `LedgerAccountBalance` rows for `USER_ASSET`/`TREASURY` accounts per asset.
 * Run before relying on the new ledger for anything live.
 */
async function main() {
  const legacyBalances = await prisma.balance.findMany({ select: { assetId: true, balance: true } });
  const legacyByAsset = new Map<string, Prisma.Decimal>();
  for (const row of legacyBalances) {
    const current = legacyByAsset.get(row.assetId) ?? new Prisma.Decimal(0);
    legacyByAsset.set(row.assetId, current.plus(row.balance));
  }

  const newBalances = await prisma.ledgerAccountBalance.findMany({
    include: { account: { select: { assetId: true, type: true } } },
  });
  const newByAsset = new Map<string, Prisma.Decimal>();
  for (const row of newBalances) {
    if (row.account.type !== "USER_ASSET" && row.account.type !== "TREASURY") continue;
    const current = newByAsset.get(row.account.assetId) ?? new Prisma.Decimal(0);
    newByAsset.set(row.account.assetId, current.plus(row.balance));
  }

  const assetIds = new Set([...legacyByAsset.keys(), ...newByAsset.keys()]);
  let mismatches = 0;
  for (const assetId of assetIds) {
    const legacy = legacyByAsset.get(assetId) ?? new Prisma.Decimal(0);
    const migrated = newByAsset.get(assetId) ?? new Prisma.Decimal(0);
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    const label = asset ? `${asset.symbol}/${asset.chain}` : assetId;
    if (!legacy.equals(migrated)) {
      mismatches++;
      console.error(`MISMATCH ${label}: legacy=${legacy.toString()} migrated=${migrated.toString()}`);
    } else {
      console.log(`ok ${label}: ${legacy.toString()}`);
    }
  }

  if (mismatches > 0) {
    console.error(`${mismatches} asset(s) mismatched — do not deploy phase 1+ against this data.`);
    process.exit(1);
  }
  console.log("Parity confirmed: every asset's legacy total matches the new chart of accounts.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
