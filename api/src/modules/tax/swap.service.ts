import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import {
  applyLedgerTransfer,
  getSystemAccountId,
  getUserAssetAccountId,
  TX_OPTIONS,
} from "../../ledger/ledger.service.js";
import { getHouseUserId } from "../../ledger/house.js";
import { capturePriceSnapshot } from "./pricing.service.js";
import { getActiveFeeRule, getActiveTaxRule } from "./rules.service.js";
import { resolveSymbolLegs, allocateAcrossLegs } from "./leg-resolver.js";
import { computeSwapBreakdown, type FeeRuleLike } from "./calculations.js";

interface SwapInput {
  userId: string;
  fromSymbol: string;
  amountFrom: string;
  assetToId: string;
}

/**
 * Collapses quote + execute into one call (the live /trade/swap route still takes one
 * round trip) — computes the tax/fee breakdown per the brief's §4.1, then posts it as
 * real ledger transfers inside one atomic transaction. Tax goes live the moment this
 * is wired into the route; there is no shadow mode.
 */
export async function executeTaxedSwap(input: SwapInput) {
  if (input.fromSymbol === "XCH") {
    throw new Error("NGN can't be swapped yet — pay bills or cash out instead");
  }

  const [fromVariants, assetTo] = await Promise.all([
    prisma.asset.findMany({ where: { symbol: input.fromSymbol, isActive: true } }),
    prisma.asset.findUniqueOrThrow({ where: { id: input.assetToId } }),
  ]);
  if (fromVariants.length === 0) {
    throw new Error(`Unknown asset ${input.fromSymbol}`);
  }
  if (assetTo.symbol === "XCH") {
    throw new Error("NGN can't be swapped yet");
  }
  const representative = fromVariants[0];

  // Throws InsufficientBalanceError if the combined balance can't cover it.
  const legs = await resolveSymbolLegs(input.userId, fromVariants, input.amountFrom);

  const [fromPriceSnapshot, toPriceSnapshot, whtRule, vatRule, feeRuleRow] = await Promise.all([
    capturePriceSnapshot(representative.id, representative.symbol),
    capturePriceSnapshot(assetTo.id, assetTo.symbol),
    getActiveTaxRule("WHT", "SWAP", representative.category),
    getActiveTaxRule("VAT", "SWAP", representative.category),
    getActiveFeeRule("SWAP", representative.id),
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

  const breakdown = computeSwapBreakdown({
    grossTokenMinor: input.amountFrom,
    whtRateBps: whtRule?.rateBps ?? 0,
    feeRule: feeRuleLike,
    vatRateBps: vatRule?.rateBps ?? 0,
    fromUsdPrice: fromPriceSnapshot.usdPrice,
    toUsdPrice: toPriceSnapshot.usdPrice,
    fromDecimals: representative.decimals,
    toDecimals: assetTo.decimals,
  });

  const allocations = allocateAcrossLegs(legs, breakdown);
  const representativeLeg = [...legs].sort((a, b) => (b.amount > a.amount ? 1 : -1))[0];

  // Resolve every account id up front — account provisioning is idempotent and
  // doesn't need to hold the money-moving transaction open.
  const houseId = await getHouseUserId();
  const perLegAccounts = await Promise.all(
    allocations.map(async (alloc) => ({
      alloc,
      userAccountId: await getUserAssetAccountId(input.userId, alloc.asset.id),
      whtAccountId: alloc.whtAlloc > 0n ? await getSystemAccountId("TAX_WHT", alloc.asset.id, "WHT") : null,
      revenueAccountId: alloc.feeAlloc > 0n ? await getSystemAccountId("REVENUE_FEES", alloc.asset.id) : null,
      vatAccountId: alloc.vatAlloc > 0n ? await getSystemAccountId("TAX_VAT", alloc.asset.id, "VAT") : null,
      treasuryAccountId: alloc.netAlloc > 0n ? await getSystemAccountId("TREASURY", alloc.asset.id) : null,
    })),
  );
  const treasuryToAccountId = await getSystemAccountId("TREASURY", input.assetToId);
  const userToAccountId = await getUserAssetAccountId(input.userId, input.assetToId);

  return prisma.$transaction(async (tx) => {
    const trade = await tx.trade.create({
      data: {
        userAId: input.userId,
        userBId: houseId,
        assetGivenId: representativeLeg.asset.id,
        amountGiven: input.amountFrom,
        assetReceivedId: input.assetToId,
        amountReceived: breakdown.proceeds.toString(),
        status: "PENDING",
      },
    });

    const quote = await tx.taxQuote.create({
      data: {
        userId: input.userId,
        eventType: "SWAP",
        inputsJson: { fromSymbol: input.fromSymbol, amountFrom: input.amountFrom, assetToId: input.assetToId },
        breakdownJson: {
          whtToken: breakdown.whtToken.toString(),
          feeToken: breakdown.feeToken.toString(),
          vatToken: breakdown.vatToken.toString(),
          netToken: breakdown.netToken.toString(),
          proceeds: breakdown.proceeds.toString(),
        },
        ruleVersionsJson: { whtRuleId: whtRule?.id ?? null, vatRuleId: vatRule?.id ?? null, feeRuleId: feeRuleRow?.id ?? null },
        priceSnapshotId: fromPriceSnapshot.id,
        status: "CONSUMED",
        expiresAt: new Date(),
      },
    });

    const taxTransaction = await tx.taxTransaction.create({
      data: {
        quoteId: quote.id,
        userId: input.userId,
        eventType: "SWAP",
        status: "PENDING",
        idempotencyKey: `swap:${trade.id}`,
      },
    });

    // refId is unique per leg (not just per transaction) — a shared clearing/suspense
    // account can legitimately appear as the "to" side of more than one leg under the
    // same refType, which would otherwise collide against the (refType, refId,
    // account, direction) dedupe constraint.
    let legIndex = 0;
    const post = (fromAccountId: string, toAccountId: string, assetId: string, amount: bigint, refType: "TAX_WHT" | "FEE" | "TAX_VAT" | "SWAP") => {
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

    for (const { alloc, userAccountId, whtAccountId, revenueAccountId, vatAccountId, treasuryAccountId } of perLegAccounts) {
      if (alloc.whtAlloc > 0n && whtAccountId) {
        await post(userAccountId, whtAccountId, alloc.asset.id, alloc.whtAlloc, "TAX_WHT");
      }
      if (alloc.feeAlloc > 0n && revenueAccountId) {
        await post(userAccountId, revenueAccountId, alloc.asset.id, alloc.feeAlloc, "FEE");
      }
      if (alloc.vatAlloc > 0n && vatAccountId) {
        await post(userAccountId, vatAccountId, alloc.asset.id, alloc.vatAlloc, "TAX_VAT");
      }
      if (alloc.netAlloc > 0n && treasuryAccountId) {
        await post(userAccountId, treasuryAccountId, alloc.asset.id, alloc.netAlloc, "SWAP");
      }
    }

    if (breakdown.proceeds > 0n) {
      await post(treasuryToAccountId, userToAccountId, input.assetToId, breakdown.proceeds, "SWAP");
    }

    await tx.trade.update({ where: { id: trade.id }, data: { status: "COMPLETED" } });
    await tx.taxTransaction.update({ where: { id: taxTransaction.id }, data: { status: "COMPLETED" } });

    const fromDecimalsDivisor = new Prisma.Decimal(10).pow(representative.decimals);
    await tx.taxEvent.create({
      data: {
        transactionId: taxTransaction.id,
        userId: input.userId,
        assetSymbol: representative.symbol,
        quantityMinor: breakdown.grossToken.toString(),
        grossUsdValue: new Prisma.Decimal(breakdown.grossToken.toString()).div(fromDecimalsDivisor).mul(fromPriceSnapshot.usdPrice),
        priceSnapshotId: fromPriceSnapshot.id,
        whtTokenMinor: breakdown.whtToken.toString(),
        whtNgnValueKobo: new Prisma.Decimal(breakdown.whtToken.toString())
          .div(fromDecimalsDivisor)
          .mul(fromPriceSnapshot.usdPrice)
          .mul(fromPriceSnapshot.usdNgnRate)
          .mul(100)
          .toDecimalPlaces(0),
        feeAmountMinor: breakdown.feeToken.toString(),
        feeCurrencyAssetId: representative.id,
        vatAmountMinor: breakdown.vatToken.toString(),
        vatCurrencyAssetId: representative.id,
        stampAmountKobo: 0,
        ruleVersionsJson: { whtRuleId: whtRule?.id ?? null, vatRuleId: vatRule?.id ?? null, feeRuleId: feeRuleRow?.id ?? null },
      },
    });

    if (breakdown.proceeds > 0n) {
      await tx.acquisitionLot.create({
        data: {
          userId: input.userId,
          assetId: input.assetToId,
          quantityMinor: breakdown.proceeds.toString(),
          usdCostBase: new Prisma.Decimal(breakdown.netToken.toString()).div(fromDecimalsDivisor).mul(fromPriceSnapshot.usdPrice),
          acquiredAt: new Date(),
          sourceTransactionId: taxTransaction.id,
        },
      });
    }

    return { trade, taxTransaction, breakdown };
  }, TX_OPTIONS);
}
