import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { mailer } from "../auth/mailer.js";

const WEEKLY_LIMIT = 10;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function requestAsset(userId: string, tokenName: string, network: string) {
  const weekAgo = new Date(Date.now() - WEEK_MS);
  const recentCount = await prisma.assetRequest.count({
    where: { userId, createdAt: { gte: weekAgo } },
  });
  if (recentCount >= WEEKLY_LIMIT) {
    throw new Error(`You've reached your limit of ${WEEKLY_LIMIT} token requests this week. Try again later.`);
  }

  const request = await prisma.assetRequest.create({
    data: { userId, tokenName: tokenName.trim(), network: network.trim() },
  });

  if (env.ADMIN_EMAIL) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await mailer
      .send(
        env.ADMIN_EMAIL,
        `New token request: ${request.tokenName}`,
        `${user.email} requested ${request.tokenName} on ${request.network}.`,
      )
      .catch((err) => {
        console.error("admin asset-request notification email failed:", (err as Error).message);
      });
  } else {
    console.warn("ADMIN_EMAIL not set — asset request stored but no notification sent");
  }

  return request;
}

export function getAllAssetRequests() {
  return prisma.assetRequest.findMany({
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
  });
}
