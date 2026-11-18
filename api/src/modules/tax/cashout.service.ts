import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { applyLedgerTransfer, getSystemAccountId, getUserAssetAccountId, TX_OPTIONS } from "../../ledger/ledger.service.js";
import { capturePriceSnapshot } from "./pricing.service.js";
import { getActiveFeeRule, getActiveTaxRule } from "./rules.service.js";
import { computeCashoutBreakdown, type FeeRuleLike } from "./calculations.js";

interface CashoutInput {
  userId: string;
  sourceAssetId: string;
  ngnAmount: string | number;
  bankAccountId: string;
}

async function getNgnAsset() {
  return prisma.asset.findUniqueOrThrow({ where: { symbol_chain: { symbol: "XCH", chain: "fiat" } } });
}

/**
 * Collapses quote + execute into one call. Replaces the old two-transaction flow
 * (swap-to-USDC, then a separate hold-debit) with one atomic transaction that also
 * posts the full WHT/fee/VAT/stamp-duty posting set from the brief's §6 — including
 * the bank-payout leg, which the pre-tax-engine flow never posted at all (only
 * `CashoutRequestStatus` tracked the NGN side, manually).
 */
export async function executeTaxedCashout(input: CashoutInput) {
  const profile = await prisma.cashoutProfile.findUnique({ where: { userId: input.userId } });
  if (!profile) throw new Error("Set up your cash-out bank account first");

  const bankAccount = await prisma.cashoutBankAccount.findUnique({ where: { id: input.bankAccountId } });
  if (!bankAccount || bankAccount.userId !== input.userId) throw new Error("Select a valid bank account");

  const ngnAmount = new Prisma.Decimal(input.ngnAmount);
  if (ngnAmount.lte(0)) throw new Error("Enter an amount to cash out");

  const [sourceAsset, ngnAsset] = await Promise.all([
    prisma.asset.findUniqueOrThrow({ where: { id: input.sourceAssetId } }),
    getNgnAsset(),
  ]);

  const priceSnapshot = await capturePriceSnapshot(sourceAsset.id, sourceAsset.symbol);
  const usdAmount = ngnAmount.div(priceSnapshot.usdNgnRate);
  const grossTokenMinor = usdAmount
    .div(priceSnapshot.usdPrice)
    .mul(new Prisma.Decimal(10).pow(sourceAsset.decimals))
    .toDecimalPlaces(0);

  const [whtRule, vatRule, stampRule, feeRuleRow] = await Promise.all([
    getActiveTaxRule("WHT", "CASHOUT", sourceAsset.category),
    getActiveTaxRule("VAT", "CASHOUT", sourceAsset.category),
    getActiveTaxRule("STAMP", "CASHOUT", sourceAsset.category),
    getActiveFeeRule("CASHOUT", sourceAsset.id),
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

  const breakdown = computeCashoutBreakdown({
    grossTokenMinor: grossTokenMinor.toFixed(0),
    whtRateBps: whtRule?.rateBps ?? 0,
    feeRule: feeRuleLike,
    vatRateBps: vatRule?.rateBps ?? 0,
    stampFlatMinor: stampRule?.flatAmountMinor ? BigInt(stampRule.flatAmountMinor.toFixed(0)) : 0n,
    tokenUsdPrice: priceSnapshot.usdPrice,
    usdNgnRate: priceSnapshot.usdNgnRate,
    tokenDecimals: sourceAsset.decimals,
  });

  const accountName = [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ");

  // Resolve every account id up front — provisioning is idempotent and doesn't need
  // to hold the money-moving transaction open.
  const userAccountId = await getUserAssetAccountId(input.userId, sourceAsset.id);
  const whtAccountId = breakdown.whtToken > 0n ? await getSystemAccountId("TAX_WHT", sourceAsset.id, "WHT") : null;
  const treasuryTokenAccountId = await getSystemAccountId("TREASURY", sourceAsset.id);
  const treasuryNgnAccountId = await getSystemAccountId("TREASURY", ngnAsset.id);
  const payoutClearingAccountId = await getSystemAccountId("PAYOUT_CLEARING", ngnAsset.id);
  const revenueFeesNgnAccountId = breakdown.feeMinor > 0n ? await getSystemAccountId("REVENUE_FEES", ngnAsset.id) : null;
  const taxVatNgnAccountId = breakdown.vatMinor > 0n ? await getSystemAccountId("TAX_VAT", ngnAsset.id, "VAT") : null;
  const taxStampNgnAccountId = breakdown.stampMinor > 0n ? await getSystemAccountId("TAX_STAMP", ngnAsset.id, "STAMP") : null;
  const bankPayoutAccountId = await getSystemAccountId("BANK_PAYOUT", ngnAsset.id);

  return prisma.$transaction(async (tx) => {
    const taxTransaction = await tx.taxTransaction.create({
      data: {
        userId: input.userId,
        eventType: "CASHOUT",
        status: "PENDING",
        idempotencyKey: `cashout:${input.userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      },
    });

    // refId is unique per leg (not just per transaction) — payout:clearing is the hub
    // for fee/VAT/stamp/payout and would otherwise collide against the (refType,
    // refId, account, direction) dedupe constraint whenever it's the "to" side of more
    // than one leg under the same refType.
    let legIndex = 0;
    const post = (fromAccountId: string, toAccountId: string, assetId: string, amount: bigint, refType: "TAX_WHT" | "CASHOUT" | "FEE" | "TAX_VAT" | "TAX_STAMP") => {
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

    if (breakdown.whtToken > 0n && whtAccountId) {
      await post(userAccountId, whtAccountId, sourceAsset.id, breakdown.whtToken, "TAX_WHT");
    }
    await post(userAccountId, treasuryTokenAccountId, sourceAsset.id, breakdown.soldToken, "CASHOUT");
    await post(treasuryNgnAccountId, payoutClearingAccountId, ngnAsset.id, breakdown.proceedsNgnKobo, "CASHOUT");
    if (breakdown.feeMinor > 0n && revenueFeesNgnAccountId) {
      await post(payoutClearingAccountId, revenueFeesNgnAccountId, ngnAsset.id, breakdown.feeMinor, "FEE");
    }
    if (breakdown.vatMinor > 0n && taxVatNgnAccountId) {
      await post(payoutClearingAccountId, taxVatNgnAccountId, ngnAsset.id, breakdown.vatMinor, "TAX_VAT");
    }
    if (breakdown.stampMinor > 0n && taxStampNgnAccountId) {
      await post(payoutClearingAccountId, taxStampNgnAccountId, ngnAsset.id, breakdown.stampMinor, "TAX_STAMP");
    }
    if (breakdown.payoutNgnKobo > 0n) {
      await post(payoutClearingAccountId, bankPayoutAccountId, ngnAsset.id, breakdown.payoutNgnKobo, "CASHOUT");
    }

    const request = await tx.cashoutRequest.create({
      data: {
        userId: input.userId,
        sourceAssetId: sourceAsset.id,
        sourceAmount: breakdown.grossToken.toString(),
        usdcAssetId: null,
        usdcAmount: null,
        ngnRate: priceSnapshot.usdNgnRate,
        ngnAmount,
        whtTokenAmount: breakdown.whtToken.toString(),
        feeNgnAmount: new Prisma.Decimal(breakdown.feeMinor.toString()).div(100),
        vatNgnAmount: new Prisma.Decimal(breakdown.vatMinor.toString()).div(100),
        stampNgnAmount: new Prisma.Decimal(breakdown.stampMinor.toString()).div(100),
        payoutNgnAmount: new Prisma.Decimal(breakdown.payoutNgnKobo.toString()).div(100),
        taxTransactionId: taxTransaction.id,
        accountName,
        bankName: bankAccount.bankName,
        accountNumber: bankAccount.accountNumber,
        status: "PENDING",
      },
    });

    await tx.taxTransaction.update({ where: { id: taxTransaction.id }, data: { status: "COMPLETED" } });

    const decimalsDivisor = new Prisma.Decimal(10).pow(sourceAsset.decimals);
    await tx.taxEvent.create({
      data: {
        transactionId: taxTransaction.id,
        userId: input.userId,
        assetSymbol: sourceAsset.symbol,
        quantityMinor: breakdown.grossToken.toString(),
        grossUsdValue: new Prisma.Decimal(breakdown.grossToken.toString()).div(decimalsDivisor).mul(priceSnapshot.usdPrice),
        priceSnapshotId: priceSnapshot.id,
        whtTokenMinor: breakdown.whtToken.toString(),
        whtNgnValueKobo: new Prisma.Decimal(breakdown.whtToken.toString())
          .div(decimalsDivisor)
          .mul(priceSnapshot.usdPrice)
          .mul(priceSnapshot.usdNgnRate)
          .mul(100)
          .toDecimalPlaces(0),
        feeAmountMinor: breakdown.feeMinor.toString(),
        feeCurrencyAssetId: ngnAsset.id,
        vatAmountMinor: breakdown.vatMinor.toString(),
        vatCurrencyAssetId: ngnAsset.id,
        stampAmountKobo: breakdown.stampMinor.toString(),
        ruleVersionsJson: {
          whtRuleId: whtRule?.id ?? null,
          vatRuleId: vatRule?.id ?? null,
          stampRuleId: stampRule?.id ?? null,
          feeRuleId: feeRuleRow?.id ?? null,
        },
        counterpartyRef: bankAccount.accountNumber,
      },
    });

    return request;
  }, TX_OPTIONS);
}
