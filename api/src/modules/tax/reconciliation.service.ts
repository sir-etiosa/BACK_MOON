import { prisma } from "../../db/prisma.js";
import { getAccountBalance, getSystemAccountId } from "../../ledger/ledger.service.js";
import { recordAudit } from "./audit.service.js";

const TAX_TYPES = ["WHT", "VAT", "STAMP"] as const;

/**
 * Daily reconciliation per the brief's §7: for each tax × asset, the ledger balance
 * should equal the on-chain/bank balance of the tax wallet plus unswept accruals.
 *
 * Honest limitation: this codebase has no wired-up on-chain/bank balance check (no
 * RPC/bank API call happens here) — comparing against a *real* external balance is a
 * genuine integration gap, not something to fake a "match" for. What this run *does*
 * verify honestly: `tax_wallet:{asset}` ledger balance reconciles against the sum of
 * its own completed sweeps (an internal double-entry self-consistency check), and
 * records the current accrued-but-possibly-unswept balance per tax sub-ledger for a
 * human to compare against the real custody provider's reported balance.
 */
export async function runReconciliation() {
  const assets = await prisma.asset.findMany({ where: { isActive: true } });
  const results: Array<{
    assetId: string;
    symbol: string;
    taxType?: string;
    accruedLedgerBalance?: string;
    taxWalletLedgerBalance?: string;
    sweptTotal?: string;
    custodySelfConsistent?: boolean;
    onchainOrBankBalance: null;
    note: string;
  }> = [];

  let anyMismatch = false;

  for (const asset of assets) {
    for (const taxType of TAX_TYPES) {
      const accountType = taxType === "WHT" ? "TAX_WHT" : taxType === "VAT" ? "TAX_VAT" : "TAX_STAMP";
      const accountId = await getSystemAccountId(accountType, asset.id, taxType);
      const accruedLedgerBalance = await getAccountBalance(accountId);
      if (accruedLedgerBalance.isZero()) continue;

      results.push({
        assetId: asset.id,
        symbol: `${asset.symbol}/${asset.chain}`,
        taxType,
        accruedLedgerBalance: accruedLedgerBalance.toFixed(0),
        onchainOrBankBalance: null,
        note: "No external balance check wired up yet — compare against the custody provider's reported balance manually (OPEN item).",
      });
    }

    const taxWalletAccountId = await getSystemAccountId("TAX_WALLET", asset.id);
    const taxWalletBalance = await getAccountBalance(taxWalletAccountId);
    const sweeps = await prisma.taxSweep.findMany({ where: { assetId: asset.id, status: "COMPLETED" } });
    const sweptTotal = sweeps.reduce((sum, s) => sum + BigInt(s.amountMinor.toString()), 0n);

    if (taxWalletBalance.isZero() && sweptTotal === 0n) continue;

    const custodySelfConsistent = BigInt(taxWalletBalance.toFixed(0)) === sweptTotal;
    if (!custodySelfConsistent) anyMismatch = true;

    results.push({
      assetId: asset.id,
      symbol: `${asset.symbol}/${asset.chain}`,
      taxWalletLedgerBalance: taxWalletBalance.toFixed(0),
      sweptTotal: sweptTotal.toString(),
      custodySelfConsistent,
      onchainOrBankBalance: null,
      note: "custodySelfConsistent checks tax_wallet's ledger balance against its own completed-sweep history — not an external balance.",
    });
  }

  const run = await prisma.taxReconciliationRun.create({
    data: { resultsJson: results as object, status: anyMismatch ? "mismatch" : "ok" },
  });

  await recordAudit({
    actorType: "system",
    action: "reconciliation.run",
    entityType: "TaxReconciliationRun",
    entityId: run.id,
    after: { status: run.status },
  });

  return run;
}

export async function getLatestReconciliation() {
  return prisma.taxReconciliationRun.findFirst({ orderBy: { runAt: "desc" } });
}
