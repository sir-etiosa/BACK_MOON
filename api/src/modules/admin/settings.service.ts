import { prisma } from "../../db/prisma.js";
import { getUsdToNgnRate } from "../trade/price-feed.service.js";

const NGN_RATE_KEY = "usd_ngn_rate";

/** Admin-set USD->NGN rate, used for cash-out pricing and the app's NGN display.
 * Falls back to the live FX feed until an owner admin sets one explicitly. */
export async function getNgnRate(): Promise<number | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: NGN_RATE_KEY } });
  if (row) return Number(row.value);
  return getUsdToNgnRate();
}

export async function setNgnRate(rate: number, adminId: string): Promise<number> {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Rate must be a positive number");
  }
  await prisma.appSetting.upsert({
    where: { key: NGN_RATE_KEY },
    create: { key: NGN_RATE_KEY, value: String(rate), updatedByAdminId: adminId },
    update: { value: String(rate), updatedByAdminId: adminId },
  });
  return rate;
}
