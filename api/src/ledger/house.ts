import { prisma } from "../db/prisma.js";

export const HOUSE_EMAIL = "house@moonxch.internal";

let cachedHouseUserId: string | null = null;

/** The exchange's own treasury account — the counterparty on every swap. Seeded once via `npm run seed`. */
export async function getHouseUserId(): Promise<string> {
  if (cachedHouseUserId) return cachedHouseUserId;
  const house = await prisma.user.findUnique({ where: { email: HOUSE_EMAIL } });
  if (!house) {
    throw new Error("House account not found — run `npm run seed` first");
  }
  cachedHouseUserId = house.id;
  return house.id;
}
