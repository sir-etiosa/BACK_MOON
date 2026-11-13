import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { applyLedgerMovements, TX_OPTIONS } from "../../ledger/ledger.service.js";
import { getHouseUserId } from "../../ledger/house.js";

interface SwapInput {
  userId: string;
  assetFromId: string;
  amountFrom: string | number;
  assetToId: string;
  amountTo: string | number;
}

/**
 * Swaps a user's balance from one asset to another against the house's own inventory.
 * No blockchain transaction, no signing — four ledger legs in one DB transaction.
 * The house absorbs the opposite position; see the plan's note on treasury rebalancing.
 */
export async function swapAgainstHouse(input: SwapInput) {
  const houseId = await getHouseUserId();

  return prisma.$transaction(async (tx) => {
    const trade = await tx.trade.create({
      data: {
        userAId: input.userId,
        userBId: houseId,
        assetGivenId: input.assetFromId,
        amountGiven: input.amountFrom,
        assetReceivedId: input.assetToId,
        amountReceived: input.amountTo,
        status: "PENDING",
      },
    });

    await applyLedgerMovements(tx, [
      // user gives assetFrom, house takes it in
      {
        userId: input.userId,
        assetId: input.assetFromId,
        direction: "DEBIT",
        amount: input.amountFrom,
        refType: "TRADE",
        refId: trade.id,
      },
      {
        userId: houseId,
        assetId: input.assetFromId,
        direction: "CREDIT",
        amount: input.amountFrom,
        refType: "TRADE",
        refId: trade.id,
      },
      // house gives assetTo, user receives it
      {
        userId: houseId,
        assetId: input.assetToId,
        direction: "DEBIT",
        amount: input.amountTo,
        refType: "TRADE",
        refId: trade.id,
      },
      {
        userId: input.userId,
        assetId: input.assetToId,
        direction: "CREDIT",
        amount: input.amountTo,
        refType: "TRADE",
        refId: trade.id,
      },
    ]);

    return tx.trade.update({ where: { id: trade.id }, data: { status: "COMPLETED" } });
  }, TX_OPTIONS);
}

interface SwapLeg {
  assetId: string;
  amount: string;
}

interface SwapSymbolInput {
  userId: string;
  legs: SwapLeg[];
  amountFromTotal: string;
  assetToId: string;
  amountTo: string;
}

/**
 * Same house-swap as `swapAgainstHouse`, but the "from" side is sourced across however many
 * chain-variant balances of one symbol it takes to cover the requested total (e.g. part from
 * ETH-on-Ethereum, part from ETH-on-Base) — the user sees and spends one combined balance.
 * Each leg gets its own ledger refId (ledger_dedupe is unique per refId+userId+direction, so
 * two debits under the same refId for the same user would collide) under one shared operation
 * id; a single Trade row is still recorded for admin visibility (assetGivenId is just the
 * largest leg, for display — the ledger entries are the source of truth for balances).
 */
export async function swapSymbolAgainstHouse(input: SwapSymbolInput) {
  const houseId = await getHouseUserId();
  const operationId = randomUUID();
  const representativeLeg = [...input.legs].sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)))[0];

  return prisma.$transaction(async (tx) => {
    const trade = await tx.trade.create({
      data: {
        userAId: input.userId,
        userBId: houseId,
        assetGivenId: representativeLeg.assetId,
        amountGiven: input.amountFromTotal,
        assetReceivedId: input.assetToId,
        amountReceived: input.amountTo,
        status: "PENDING",
      },
    });

    for (const leg of input.legs) {
      await applyLedgerMovements(tx, [
        {
          userId: input.userId,
          assetId: leg.assetId,
          direction: "DEBIT",
          amount: leg.amount,
          refType: "TRADE",
          refId: `${operationId}:${leg.assetId}`,
        },
        {
          userId: houseId,
          assetId: leg.assetId,
          direction: "CREDIT",
          amount: leg.amount,
          refType: "TRADE",
          refId: `${operationId}:${leg.assetId}`,
        },
      ]);
    }

    await applyLedgerMovements(tx, [
      {
        userId: houseId,
        assetId: input.assetToId,
        direction: "DEBIT",
        amount: input.amountTo,
        refType: "TRADE",
        refId: `${operationId}:to`,
      },
      {
        userId: input.userId,
        assetId: input.assetToId,
        direction: "CREDIT",
        amount: input.amountTo,
        refType: "TRADE",
        refId: `${operationId}:to`,
      },
    ]);

    return tx.trade.update({ where: { id: trade.id }, data: { status: "COMPLETED" } });
  }, TX_OPTIONS);
}
