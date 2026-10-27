import { prisma } from "../db/prisma.js";

const assets = await prisma.asset.findMany();
console.log(JSON.stringify(assets.map((a) => ({ symbol: a.symbol, chain: a.chain, id: a.id })), null, 2));
await prisma.$disconnect();
