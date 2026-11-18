import { prisma } from "../../db/prisma.js";
import { applyLedgerTransfer, getSystemAccountId, getUserAssetAccountId, TX_OPTIONS } from "../../ledger/ledger.service.js";

async function getXchAsset() {
  return prisma.asset.findUniqueOrThrow({ where: { symbol_chain: { symbol: "XCH", chain: "fiat" } } });
}

/**
 * Mints XCH (user-facing "NGN") into a user's balance, 1:1 with a naira amount —
 * same mechanism as a real crypto deposit (EXTERNAL -> user), since minting XCH on a
 * confirmed bank deposit is conceptually the same thing. This is what a real
 * bank-deposit webhook (Quickteller or otherwise) should call once it confirms money
 * actually landed; `amountKobo` must come from that confirmed, real event — never
 * mint on a user's say-so alone.
 */
export async function mintXch(userId: string, amountKobo: string, refId: string): Promise<void> {
  const xch = await getXchAsset();
  const userAccountId = await getUserAssetAccountId(userId, xch.id);
  const externalAccountId = await getSystemAccountId("EXTERNAL", xch.id);

  await prisma.$transaction(
    (tx) =>
      applyLedgerTransfer(tx, {
        fromAccountId: externalAccountId,
        toAccountId: userAccountId,
        assetId: xch.id,
        amount: amountKobo,
        refType: "DEPOSIT",
        refId,
      }),
    TX_OPTIONS,
  );
}
