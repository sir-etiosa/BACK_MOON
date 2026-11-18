import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { applyLedgerTransfer, getSystemAccountId, getUserAssetAccountId, TX_OPTIONS } from "../../ledger/ledger.service.js";
import { capturePriceSnapshot } from "./pricing.service.js";
import { getActiveFeeRule, getActiveTaxRule } from "./rules.service.js";
import { resolveSymbolLegs, allocateAcrossLegs } from "./leg-resolver.js";
import { computeBillBreakdown, type FeeRuleLike } from "./calculations.js";

interface BillInput {
  userId: string;
  billAmountNgn: string | number;
  assetSymbol: string;
  billerCategory: string;
  billerRef?: string;
}

async function getNgnAsset() {
  return prisma.asset.findUniqueOrThrow({ where: { symbol_chain: { symbol: "XCH", chain: "fiat" } } });
}

/**
 * No real biller integration exists anywhere in this repo (`/pay` in web is a UI
 * mockup) — this builds the full tax+ledger logic and a request/admin-confirm pair of
 * endpoints mirroring cashout's `markCashoutPaid`/`rejectCashoutRequest` exactly.
 * Actual settlement with a biller stays a manual admin action, not a real API call.
 *
 * Gross-up per the brief's §4.2: the user specifies the naira bill amount, which must
 * be paid in full — WHT is grossed up on top so it never leaves the bill short. The
 * invariant `sold_token * price >= naira_needed` is enforced inside
 * `computeBillBreakdown` itself (it grows gross_token until it genuinely holds).
 */
export async function executeTaxedBillPayment(input: BillInput) {
  const billAmountNgn = new Prisma.Decimal(input.billAmountNgn);
  if (billAmountNgn.lte(0)) throw new Error("Enter a bill amount");

  const [variants, ngnAsset] = await Promise.all([
    prisma.asset.findMany({ where: { symbol: input.assetSymbol, isActive: true } }),
    getNgnAsset(),
  ]);
  if (variants.length === 0) throw new Error(`Unknown asset ${input.assetSymbol}`);
  const representative = variants[0];

  const priceSnapshot = await capturePriceSnapshot(representative.id, representative.symbol);

  const [whtRule, vatRule, feeRuleRow] = await Promise.all([
    getActiveTaxRule("WHT", "BILL_PAYMENT", representative.category),
    getActiveTaxRule("VAT", "BILL_PAYMENT", representative.category),
    getActiveFeeRule("BILL_PAYMENT", representative.id),
  ]);

  const feeRuleLike: FeeRuleLike | null = feeRuleRow
    ? {
        type: feeRuleRow.type,
        rateBps: feeRuleRow.rateBps ?? undefined,
        flatAmountMinor: feeRuleRow.flatAmountMinor?.toString(),
        chargeIn: feeRuleRow.chargeIn,
        base: feeRuleRow.base,
      }
    : null;

  const billAmountNgnKobo = billAmountNgn.mul(100).toDecimalPlaces(0);

  const breakdown = computeBillBreakdown({
    billAmountNgnKobo: billAmountNgnKobo.toFixed(0),
    whtRateBps: whtRule?.rateBps ?? 0,
    feeRule: feeRuleLike,
    vatRateBps: vatRule?.rateBps ?? 0,
    tokenUsdPrice: priceSnapshot.usdPrice,
    usdNgnRate: priceSnapshot.usdNgnRate,
    tokenDecimals: representative.decimals,
  });

  // Drains the user's balance across every chain-variant of the symbol, same as swap —
  // the brief's own example debits a single `user:ETH` leg; this generalizes to
  // multi-chain legs for consistency, a deliberate low-cost extension.
  const legs = await resolveSymbolLegs(input.userId, variants, breakdown.grossTokenMinor);
  const allocations = allocateAcrossLegs(legs, {
    whtToken: breakdown.whtTokenMinor,
    feeToken: 0n,
    vatToken: 0n,
    netToken: breakdown.soldTokenMinor,
  });

  const perLegAccounts = await Promise.all(
    allocations.map(async (alloc) => ({
      alloc,
      userAccountId: await getUserAssetAccountId(input.userId, alloc.asset.id),
      whtAccountId: alloc.whtAlloc > 0n ? await getSystemAccountId("TAX_WHT", alloc.asset.id, "WHT") : null,
      treasuryAccountId: alloc.netAlloc > 0n ? await getSystemAccountId("TREASURY", alloc.asset.id) : null,
    })),
  );

  const treasuryNgnAccountId = await getSystemAccountId("TREASURY", ngnAsset.id);
  const billsClearingAccountId = await getSystemAccountId("BILLS_CLEARING", ngnAsset.id);
  const revenueFeesNgnAccountId = breakdown.feeNgnKobo > 0n ? await getSystemAccountId("REVENUE_FEES", ngnAsset.id) : null;
  const taxVatNgnAccountId = breakdown.vatNgnKobo > 0n ? await getSystemAccountId("TAX_VAT", ngnAsset.id, "VAT") : null;
  const billerSettlementAccountId = await getSystemAccountId("BILLER_SETTLEMENT", ngnAsset.id);

  return prisma.$transaction(async (tx) => {
    const taxTransaction = await tx.taxTransaction.create({
      data: {
        userId: input.userId,
        eventType: "BILL_PAYMENT",
        status: "PENDING",
        idempotencyKey: `bill:${input.userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      },
    });

    let legIndex = 0;
    const post = (fromAccountId: string, toAccountId: string, assetId: string, amount: bigint, refType: "TAX_WHT" | "BILL_PAYMENT" | "FEE" | "TAX_VAT") => {
      const idx = legIndex++;
      return applyLedgerTransfer(tx, {
        fromAccountId,
        toAccountId,
        assetId,
        amount,
        refType,
        refId: `${taxTransaction.id}:${idx}`,
        transactionId: taxTransaction.id,
        legIndex: idx,
      });
    };

    for (const { alloc, userAccountId, whtAccountId, treasuryAccountId } of perLegAccounts) {
      if (alloc.whtAlloc > 0n && whtAccountId) {
        await post(userAccountId, whtAccountId, alloc.asset.id, alloc.whtAlloc, "TAX_WHT");
      }
      if (alloc.netAlloc > 0n && treasuryAccountId) {
        await post(userAccountId, treasuryAccountId, alloc.asset.id, alloc.netAlloc, "BILL_PAYMENT");
      }
    }

    await post(treasuryNgnAccountId, billsClearingAccountId, ngnAsset.id, breakdown.nairaNeededKobo, "BILL_PAYMENT");
    if (breakdown.feeNgnKobo > 0n && revenueFeesNgnAccountId) {
      await post(billsClearingAccountId, revenueFeesNgnAccountId, ngnAsset.id, breakdown.feeNgnKobo, "FEE");
    }
    if (breakdown.vatNgnKobo > 0n && taxVatNgnAccountId) {
      await post(billsClearingAccountId, taxVatNgnAccountId, ngnAsset.id, breakdown.vatNgnKobo, "TAX_VAT");
    }
    await post(billsClearingAccountId, billerSettlementAccountId, ngnAsset.id, breakdown.billAmountNgnKobo, "BILL_PAYMENT");

    const request = await tx.billPaymentRequest.create({
      data: {
        userId: input.userId,
        assetId: representative.id,
        soldTokenAmount: breakdown.soldTokenMinor.toString(),
        whtTokenAmount: breakdown.whtTokenMinor.toString(),
        feeNgnAmount: new Prisma.Decimal(breakdown.feeNgnKobo.toString()).div(100),
        vatNgnAmount: new Prisma.Decimal(breakdown.vatNgnKobo.toString()).div(100),
        billAmountNgn,
        billerCategory: input.billerCategory,
        billerRef: input.billerRef,
        taxTransactionId: taxTransaction.id,
        status: "PENDING",
      },
    });

    await tx.taxTransaction.update({ where: { id: taxTransaction.id }, data: { status: "COMPLETED" } });

    const decimalsDivisor = new Prisma.Decimal(10).pow(representative.decimals);
    await tx.taxEvent.create({
      data: {
        transactionId: taxTransaction.id,
        userId: input.userId,
        assetSymbol: representative.symbol,
        quantityMinor: breakdown.grossTokenMinor.toString(),
        grossUsdValue: new Prisma.Decimal(breakdown.grossTokenMinor.toString()).div(decimalsDivisor).mul(priceSnapshot.usdPrice),
        priceSnapshotId: priceSnapshot.id,
        whtTokenMinor: breakdown.whtTokenMinor.toString(),
        whtNgnValueKobo: new Prisma.Decimal(breakdown.whtTokenMinor.toString())
          .div(decimalsDivisor)
          .mul(priceSnapshot.usdPrice)
          .mul(priceSnapshot.usdNgnRate)
          .mul(100)
          .toDecimalPlaces(0),
        feeAmountMinor: breakdown.feeNgnKobo.toString(),
        feeCurrencyAssetId: ngnAsset.id,
        vatAmountMinor: breakdown.vatNgnKobo.toString(),
        vatCurrencyAssetId: ngnAsset.id,
        stampAmountKobo: 0,
        ruleVersionsJson: { whtRuleId: whtRule?.id ?? null, vatRuleId: vatRule?.id ?? null, feeRuleId: feeRuleRow?.id ?? null },
        counterpartyRef: input.billerRef ?? null,
      },
    });

    return request;
  }, TX_OPTIONS);
}

export async function listBillRequestsForUser(userId: string) {
  return prisma.billPaymentRequest.findMany({ where: { userId }, orderBy: { requestedAt: "desc" } });
}

export async function listPendingBillRequests() {
  return prisma.billPaymentRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { requestedAt: "asc" },
    include: { user: { select: { email: true } }, asset: { select: { symbol: true, chain: true, decimals: true } } },
  });
}

export async function markBillPaid(requestId: string, adminId: string) {
  const request = await prisma.billPaymentRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new Error("Bill payment request not found");
  if (request.status !== "PENDING") throw new Error(`Cannot mark paid from status ${request.status}`);

  return prisma.billPaymentRequest.update({
    where: { id: requestId },
    data: { status: "PAID", processedByAdmin: adminId, processedAt: new Date() },
  });
}

/** Posts a full mirror-image reversal of every ledger leg, same as cashout rejection. */
export async function rejectBillRequest(requestId: string, adminId: string, notes?: string) {
  const { reverseTaxTransaction } = await import("./reversal.service.js");
  const request = await prisma.billPaymentRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new Error("Bill payment request not found");
  if (request.status !== "PENDING") throw new Error(`Cannot reject from status ${request.status}`);

  if (request.taxTransactionId) {
    await reverseTaxTransaction(request.taxTransactionId, adminId);
  }

  return prisma.billPaymentRequest.update({
    where: { id: requestId },
    data: { status: "REJECTED", processedByAdmin: adminId, processedAt: new Date(), notes },
  });
}
