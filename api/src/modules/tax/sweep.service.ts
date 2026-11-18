import { Prisma, type TaxType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { applyLedgerTransfer, getAccountBalance, getSystemAccountId, TX_OPTIONS } from "../../ledger/ledger.service.js";
import { recordAudit } from "./audit.service.js";

const TAX_ACCOUNT_TYPE: Record<TaxType, "TAX_WHT" | "TAX_VAT" | "TAX_STAMP"> = {
  WHT: "TAX_WHT",
  VAT: "TAX_VAT",
  STAMP: "TAX_STAMP",
};

/** Current outstanding liability (net of remittances already paid out) — the right
 * basis for "how much is currently owed to NRS", but NOT the right basis for sizing a
 * sweep (see `getUnsweptAmount` below): a remittance clears this balance without
 * moving any custody, so it can drop below what's actually still sitting unswept. */
export async function getAccruedTaxLiability(taxType: TaxType, assetId: string): Promise<bigint> {
  const accountId = await getSystemAccountId(TAX_ACCOUNT_TYPE[taxType], assetId, taxType);
  const balance = await getAccountBalance(accountId);
  return BigInt(balance.toFixed(0));
}

/** Sweeps move custody (treasury -> tax_wallet) without touching the liability
 * sub-ledger, and remittances clear the liability sub-ledger without touching
 * custody — so sizing a sweep off the *current* liability balance would re-sweep the
 * same money forever (sweep again with nothing new accrued => same positive balance
 * => sweeps it again) or go blind after a remittance (balance drops below what's
 * actually still unswept). The correct basis is the total ever credited to the tax
 * sub-ledger, minus whatever's already been swept for this exact (taxType, asset). */
async function getUnsweptAmount(taxType: TaxType, assetId: string): Promise<bigint> {
  const accountId = await getSystemAccountId(TAX_ACCOUNT_TYPE[taxType], assetId, taxType);
  const totalEverAccrued = await prisma.ledgerAccountEntry.aggregate({
    where: { ledgerAccountId: accountId, direction: "CREDIT" },
    _sum: { amount: true },
  });
  const alreadySwept = await prisma.taxSweep.aggregate({
    where: { assetId, taxType, status: "COMPLETED" },
    _sum: { amountMinor: true },
  });
  const total = BigInt((totalEverAccrued._sum.amount ?? new Prisma.Decimal(0)).toFixed(0));
  const swept = BigInt((alreadySwept._sum.amountMinor ?? new Prisma.Decimal(0)).toFixed(0));
  return total - swept;
}

export async function createTaxWallet(input: { assetId: string; addressOrAccount: string; custodyProvider: string; adminId: string }) {
  const wallet = await prisma.taxWallet.create({
    data: { assetId: input.assetId, addressOrAccount: input.addressOrAccount, custodyProvider: input.custodyProvider },
  });
  await recordAudit({
    actorType: "admin",
    actorId: input.adminId,
    action: "tax_wallet.create",
    entityType: "TaxWallet",
    entityId: wallet.id,
    after: wallet,
  });
  return wallet;
}

export async function listTaxWallets() {
  return prisma.taxWallet.findMany({ include: { asset: { select: { symbol: true, chain: true } } }, orderBy: { createdAt: "desc" } });
}

/**
 * Moves custody of the currently accrued tax liability for one (taxType, asset) pair
 * out of `treasury:{asset}` and into `tax_wallet:{asset}` — segregating it from
 * general float, per the brief's §7. Sources from `treasury` rather than a separate
 * `hot_wallet` balance: this codebase doesn't track on-chain hot-wallet custody
 * separately from treasury today (deposits credit a user directly from `EXTERNAL`),
 * so treasury is the closest real analog to "hot wallet + operating account" here.
 * The `tax:{TYPE}:{asset}` sub-ledger itself is untouched — it keeps tracking the
 * liability owed to NRS until remittance, independent of where the crypto physically
 * sits.
 */
export async function createSweep(input: { taxType: TaxType; assetId: string; txHashOrRef?: string; adminId: string }) {
  const amountMinor = await getUnsweptAmount(input.taxType, input.assetId);
  if (amountMinor <= 0n) {
    throw new Error("Nothing new accrued to sweep for this tax type and asset");
  }

  const treasuryAccountId = await getSystemAccountId("TREASURY", input.assetId);
  const taxWalletAccountId = await getSystemAccountId("TAX_WALLET", input.assetId);

  return prisma.$transaction(async (tx) => {
    const sweep = await tx.taxSweep.create({
      data: {
        taxType: input.taxType,
        assetId: input.assetId,
        amountMinor: amountMinor.toString(),
        txHashOrRef: input.txHashOrRef,
        coveredPostingIds: [],
        status: "PENDING",
      },
    });

    const { postingId } = await applyLedgerTransfer(tx, {
      fromAccountId: treasuryAccountId,
      toAccountId: taxWalletAccountId,
      assetId: input.assetId,
      amount: amountMinor,
      refType: "SWEEP",
      refId: sweep.id,
    });

    const completed = await tx.taxSweep.update({
      where: { id: sweep.id },
      data: { status: "COMPLETED", coveredPostingIds: [postingId] },
    });

    await recordAudit({
      actorType: "admin",
      actorId: input.adminId,
      action: "sweep.create",
      entityType: "TaxSweep",
      entityId: completed.id,
      after: completed,
    });

    return completed;
  }, TX_OPTIONS);
}

export async function listSweeps() {
  return prisma.taxSweep.findMany({ include: { asset: { select: { symbol: true, chain: true } } }, orderBy: { createdAt: "desc" } });
}

const ALL_TAX_TYPES: TaxType[] = ["WHT", "VAT", "STAMP"];

/** Scheduled entry point (see `modules/cron/cron.routes.ts`): sweeps whatever's
 * currently accrued across every active asset × tax type, skipping combinations with
 * nothing to sweep rather than aborting the whole run. */
export async function runScheduledSweeps(systemActorId: string) {
  const assets = await prisma.asset.findMany({ where: { isActive: true } });
  const swept: Array<{ assetId: string; taxType: TaxType; amountMinor: string }> = [];
  const skipped: Array<{ assetId: string; taxType: TaxType; reason: string }> = [];

  for (const asset of assets) {
    for (const taxType of ALL_TAX_TYPES) {
      try {
        const sweep = await createSweep({ taxType, assetId: asset.id, adminId: systemActorId });
        swept.push({ assetId: asset.id, taxType, amountMinor: sweep.amountMinor.toString() });
      } catch (err) {
        skipped.push({ assetId: asset.id, taxType, reason: (err as Error).message });
      }
    }
  }

  return { swept, skipped };
}
