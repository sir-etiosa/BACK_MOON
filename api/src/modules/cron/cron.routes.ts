import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { env } from "../../config/env.js";
import { runBtcLtcWatcher } from "../../chains/watchers/btc-ltc.watcher.js";
import { runTronWatcher } from "../../chains/watchers/tron.watcher.js";
import { runEvmWatcher } from "../../chains/watchers/evm.watcher.js";
import { runSolanaWatcher } from "../../chains/watchers/solana.watcher.js";
import { runMoneroWatcher } from "../../chains/watchers/monero.watcher.js";
import { runScheduledSweeps } from "../tax/sweep.service.js";
import { runReconciliation } from "../tax/reconciliation.service.js";

async function requireCronSecret(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers["x-cron-secret"];
  if (header !== env.CRON_SECRET) {
    return reply.code(401).send({ error: "Invalid cron secret" });
  }
}

export async function cronRoutes(app: FastifyInstance) {
  app.get(
    "/cron/watch-evm",
    { preHandler: requireCronSecret, schema: { tags: ["cron"], summary: "Poll for new ETH deposits" } },
    async (_req, reply) => {
      try {
        return reply.send(await runEvmWatcher());
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/cron/watch-tron",
    { preHandler: requireCronSecret, schema: { tags: ["cron"], summary: "Poll for new USDT-TRC20 deposits" } },
    async (_req, reply) => {
      try {
        return reply.send(await runTronWatcher());
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/cron/watch-ltc",
    { preHandler: requireCronSecret, schema: { tags: ["cron"], summary: "Poll for new LTC deposits" } },
    async (_req, reply) => {
      try {
        return reply.send(await runBtcLtcWatcher("litecoin"));
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/cron/watch-btc",
    { preHandler: requireCronSecret, schema: { tags: ["cron"], summary: "Poll for new BTC deposits" } },
    async (_req, reply) => {
      try {
        return reply.send(await runBtcLtcWatcher("bitcoin"));
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/cron/watch-solana",
    { preHandler: requireCronSecret, schema: { tags: ["cron"], summary: "Poll for new SOL and USDC-SPL deposits" } },
    async (_req, reply) => {
      try {
        return reply.send(await runSolanaWatcher());
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/cron/watch-monero",
    { preHandler: requireCronSecret, schema: { tags: ["cron"], summary: "Poll for new XMR deposits (needs MONERO_WALLET_RPC_URL deployed)" } },
    async (_req, reply) => {
      try {
        return reply.send(await runMoneroWatcher());
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/cron/tax-sweep",
    { preHandler: requireCronSecret, schema: { tags: ["cron"], summary: "Sweep accrued tax liabilities from treasury into tax wallets" } },
    async (_req, reply) => {
      try {
        return reply.send(await runScheduledSweeps("system-cron"));
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/cron/tax-reconciliation",
    { preHandler: requireCronSecret, schema: { tags: ["cron"], summary: "Run the daily tax reconciliation check" } },
    async (_req, reply) => {
      try {
        return reply.send(await runReconciliation());
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    },
  );
}
