import type { TaxType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { applyLedgerTransfer, getSystemAccountId, TX_OPTIONS } from "../../ledger/ledger.service.js";
import { recordAudit } from "./audit.service.js";

const TAX_ACCOUNT_TYPE: Record<TaxType, "TAX_WHT" | "TAX_VAT" | "TAX_STAMP"> = {
  WHT: "TAX_WHT",
  VAT: "TAX_VAT",
  STAMP: "TAX_STAMP",
};

interface CreateRemittanceInput {
  taxType: TaxType;
  assetId: string;
  amountMinor: string;
  periodStart: Date;
  periodEnd: Date;
  txHashOrRef?: string;
  nrsReceiptRef?: string;
  documentUrl?: string;
  adminId: string;
}

/**
 * Records a payment already made to the NRS — per the brief's §7, token remitted in
 * the original token, naira stamp duty/VAT remitted in naira (both are just `assetId`
 * here, no special-casing needed). Posts `tax:{TYPE}:{asset} → nrs:remitted:{TYPE}:
 * {asset}` to clear the liability, atomically with the `TaxRemittance` record.
 *
 * Schedule is config, not code: stamp duty is meant to go out by the 15th/30th
 * (`AppSetting` key `stamp_remittance_days`, default "15,30" — see admin settings);
 * WHT/VAT frequency is an explicit OPEN item, left unset rather than guessed. Nothing
 * here enforces a schedule — it only ever records what an admin manually reports.
 */
export async function createRemittance(input: CreateRemittanceInput) {
  const taxAccountId = await getSystemAccountId(TAX_ACCOUNT_TYPE[input.taxType], input.assetId, input.taxType);
  const nrsRemittedAccountId = await getSystemAccountId("NRS_REMITTED", input.assetId, input.taxType);

  return prisma.$transaction(async (tx) => {
    const remittance = await tx.taxRemittance.create({
      data: {
        taxType: input.taxType,
        assetId: input.assetId,
        amountMinor: input.amountMinor,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        txHashOrRef: input.txHashOrRef,
        nrsReceiptRef: input.nrsReceiptRef,
        documentUrl: input.documentUrl,
        status: "PAID",
        createdByAdminId: input.adminId,
      },
    });

    await applyLedgerTransfer(tx, {
      fromAccountId: taxAccountId,
      toAccountId: nrsRemittedAccountId,
      assetId: input.assetId,
      amount: input.amountMinor,
      refType: "REMITTANCE",
      refId: remittance.id,
    });

    await recordAudit({
      actorType: "admin",
      actorId: input.adminId,
      action: "remittance.create",
      entityType: "TaxRemittance",
      entityId: remittance.id,
      after: remittance,
    });

    return remittance;
  }, TX_OPTIONS);
}

export async function patchRemittance(
  id: string,
  input: { txHashOrRef?: string; nrsReceiptRef?: string; documentUrl?: string },
  adminId: string,
) {
  const before = await prisma.taxRemittance.findUniqueOrThrow({ where: { id } });
  const after = await prisma.taxRemittance.update({ where: { id }, data: input });

  await recordAudit({
    actorType: "admin",
    actorId: adminId,
    action: "remittance.patch",
    entityType: "TaxRemittance",
    entityId: id,
    before,
    after,
  });

  return after;
}

export async function listRemittances() {
  return prisma.taxRemittance.findMany({ include: { asset: { select: { symbol: true, chain: true } } }, orderBy: { createdAt: "desc" } });
}
