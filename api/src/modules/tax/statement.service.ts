import { prisma } from "../../db/prisma.js";

export async function getUserTaxStatementData(userId: string, year: number) {
  const start = new Date(`${year}-01-01T00:00:00Z`);
  const end = new Date(`${year + 1}-01-01T00:00:00Z`);

  const events = await prisma.taxEvent.findMany({
    where: { userId, createdAt: { gte: start, lt: end }, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });

  let totalWhtNgnKobo = 0n;
  const totalWhtTokenByAsset = new Map<string, bigint>();
  for (const e of events) {
    totalWhtNgnKobo += BigInt(e.whtNgnValueKobo.toString());
    const prev = totalWhtTokenByAsset.get(e.assetSymbol) ?? 0n;
    totalWhtTokenByAsset.set(e.assetSymbol, prev + BigInt(e.whtTokenMinor.toString()));
  }

  return {
    year,
    events,
    totalWhtNgnKobo: totalWhtNgnKobo.toString(),
    totalWhtTokenByAsset: Object.fromEntries([...totalWhtTokenByAsset].map(([k, v]) => [k, v.toString()])),
  };
}

/** Users claim WHT credits on their annual returns — one line per disposal, exactly
 * what was withheld (token amount + naira value at the time). */
export function toCsv(statement: Awaited<ReturnType<typeof getUserTaxStatementData>>): string {
  const header = "date,assetSymbol,quantityMinor,grossUsdValue,whtTokenMinor,whtNgnValueKobo,feeAmountMinor,vatAmountMinor,stampAmountKobo,counterpartyRef\n";
  const rows = statement.events
    .map((e) =>
      [
        e.createdAt.toISOString(),
        e.assetSymbol,
        e.quantityMinor.toString(),
        e.grossUsdValue.toString(),
        e.whtTokenMinor.toString(),
        e.whtNgnValueKobo.toString(),
        e.feeAmountMinor.toString(),
        e.vatAmountMinor.toString(),
        e.stampAmountKobo.toString(),
        e.counterpartyRef ?? "",
      ].join(","),
    )
    .join("\n");
  return header + rows + "\n";
}
