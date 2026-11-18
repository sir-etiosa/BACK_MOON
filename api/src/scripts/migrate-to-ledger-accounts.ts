import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { getHouseUserId } from "../ledger/house.js";

/**
 * One-off cutover: copies every existing `Balance` row into the new chart-of-accounts
 * (`LedgerAccount` + `LedgerAccountBalance` + an opening `LedgerAccountEntry`). The house
 * user's balances become `TREASURY` accounts; everyone else's become `USER_ASSET`
 * accounts coded `user:{userId}:{assetId}`. Legacy `Balance`/`LedgerEntry` rows are left
 * untouched (frozen, read-only) as a rollback/audit safety net. Safe to re-run: every
 * write is an upsert keyed on the account's unique `code`.
 */
async function main() {
  const houseId = await getHouseUserId();
  const balances = await prisma.balance.findMany();
  console.log(`Migrating ${balances.length} legacy balance rows...`);

  let migrated = 0;
  for (const row of balances) {
    const isHouse = row.userId === houseId;
    const code = isHouse ? `treasury:${row.assetId}` : `user:${row.userId}:${row.assetId}`;

    const account = await prisma.ledgerAccount.upsert({
      where: { code },
      create: {
        code,
        type: isHouse ? "TREASURY" : "USER_ASSET",
        assetId: row.assetId,
        userId: isHouse ? null : row.userId,
        allowNegative: false,
      },
      update: {},
    });

    await prisma.ledgerAccountBalance.upsert({
      where: { ledgerAccountId: account.id },
      create: { ledgerAccountId: account.id, balance: row.balance },
      update: { balance: row.balance },
    });

    if (new Prisma.Decimal(row.balance).gt(0)) {
      await prisma.ledgerAccountEntry.upsert({
        where: {
          ledger_account_entry_dedupe: {
            refType: "ADJUSTMENT",
            refId: "migration-opening-balance",
            ledgerAccountId: account.id,
            direction: "CREDIT",
          },
        },
        create: {
          ledgerAccountId: account.id,
          direction: "CREDIT",
          amount: row.balance,
          refType: "ADJUSTMENT",
          refId: "migration-opening-balance",
          balanceAfter: row.balance,
        },
        update: {},
      });
    }

    migrated++;
  }

  console.log(`Migrated ${migrated} accounts into the chart of accounts.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
