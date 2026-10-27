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
