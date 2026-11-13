import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { applyLedgerMovement, InsufficientBalanceError, TX_OPTIONS } from "../../ledger/ledger.service.js";
import { swapAgainstHouse } from "../trade/trade.service.js";
import { getUsdPrice } from "../trade/price-feed.service.js";
import { getNgnRate } from "../admin/settings.service.js";

export { InsufficientBalanceError };

// Internal settlement asset: non-USDC cash-outs are swapped to this against the house
// before the payout hold is placed. Either USDC row would do — this is just an internal
// accounting step, never an on-chain transfer — "evm" is picked as the fixed convention.
const SETTLEMENT_USDC = { symbol: "USDC", chain: "evm" };

interface CreateCashoutRequestInput {
  userId: string;
  sourceAssetId: string;
  ngnAmount: string | number;
}

export async function createCashoutRequest(input: CreateCashoutRequestInput) {
  const profile = await prisma.cashoutProfile.findUnique({ where: { userId: input.userId } });
  if (!profile || !profile.bankName || !profile.accountNumber) {
    throw new Error("Set up your cash-out bank account first");
  }

  const ngnAmount = new Prisma.Decimal(input.ngnAmount);
  if (ngnAmount.lte(0)) throw new Error("Enter an amount to cash out");

  const ngnRate = await getNgnRate();
  if (!ngnRate) throw new Error("Cash-out rate is unavailable right now, try again shortly");

  const sourceAsset = await prisma.asset.findUniqueOrThrow({ where: { id: input.sourceAssetId } });
  const usdAmount = ngnAmount.div(ngnRate);

  const accountName = [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ");

  const isAlreadyUsdc = sourceAsset.symbol === "USDC";

  let usdcAssetId: string;
  let usdcAmountSmallest: Prisma.Decimal;
  let sourceAmountSmallest: Prisma.Decimal;
  let tradeId: string | null = null;

  if (isAlreadyUsdc) {
    sourceAmountSmallest = usdAmount.mul(new Prisma.Decimal(10).pow(sourceAsset.decimals)).toDecimalPlaces(0);
    usdcAssetId = sourceAsset.id;
    usdcAmountSmallest = sourceAmountSmallest;
  } else {
    const usdcAsset = await prisma.asset.findUniqueOrThrow({ where: { symbol_chain: SETTLEMENT_USDC } });
    const usdPrice = await getUsdPrice(sourceAsset.symbol);

    sourceAmountSmallest = usdAmount
      .div(usdPrice)
      .mul(new Prisma.Decimal(10).pow(sourceAsset.decimals))
      .toDecimalPlaces(0);
    usdcAmountSmallest = usdAmount.mul(new Prisma.Decimal(10).pow(usdcAsset.decimals)).toDecimalPlaces(0);
    usdcAssetId = usdcAsset.id;

    const trade = await swapAgainstHouse({
      userId: input.userId,
      assetFromId: sourceAsset.id,
      amountFrom: sourceAmountSmallest.toString(),
      assetToId: usdcAssetId,
      amountTo: usdcAmountSmallest.toString(),
    });
    tradeId = trade.id;
  }

  return prisma.$transaction(async (tx) => {
    const request = await tx.cashoutRequest.create({
      data: {
        userId: input.userId,
        sourceAssetId: sourceAsset.id,
        sourceAmount: sourceAmountSmallest,
        tradeId,
        usdcAssetId,
        usdcAmount: usdcAmountSmallest,
        ngnRate,
        ngnAmount,
        accountName,
        bankName: profile.bankName!,
        accountNumber: profile.accountNumber!,
        status: "PENDING",
      },
    });

    await applyLedgerMovement(tx, {
      userId: input.userId,
      assetId: usdcAssetId,
      direction: "DEBIT",
      amount: usdcAmountSmallest,
      refType: "CASHOUT",
      refId: request.id,
    });

    return request;
  }, TX_OPTIONS);
}

export async function listCashoutRequestsForUser(userId: string) {
  return prisma.cashoutRequest.findMany({ where: { userId }, orderBy: { requestedAt: "desc" } });
}

export async function listPendingCashoutRequests() {
  return prisma.cashoutRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { requestedAt: "asc" },
    include: { user: { select: { email: true } } },
  });
}

export async function markCashoutPaid(requestId: string, adminId: string) {
  const request = await prisma.cashoutRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new Error("Cash-out request not found");
  if (request.status !== "PENDING") throw new Error(`Cannot mark paid from status ${request.status}`);

  return prisma.cashoutRequest.update({
    where: { id: requestId },
    data: { status: "PAID", processedByAdmin: adminId, processedAt: new Date() },
  });
}

/** Refunds the held USDC back to the user and closes the request out. */
export async function rejectCashoutRequest(requestId: string, adminId: string, notes?: string) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.cashoutRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new Error("Cash-out request not found");
    if (request.status !== "PENDING") throw new Error(`Cannot reject from status ${request.status}`);

    await applyLedgerMovement(tx, {
      userId: request.userId,
      assetId: request.usdcAssetId,
      direction: "CREDIT",
      amount: request.usdcAmount,
      refType: "CASHOUT",
      refId: request.id,
    });

    return tx.cashoutRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED", processedByAdmin: adminId, processedAt: new Date(), notes },
    });
  }, TX_OPTIONS);
}
