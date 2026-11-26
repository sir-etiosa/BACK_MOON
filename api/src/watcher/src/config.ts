import "dotenv/config";
import { z } from "zod";

// Trimmed to what the deposit watcher actually reads — no JWT/admin/xpub config here.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),

  MAIL_TRANSPORT: z.enum(["console", "resend"]).default("console"),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  ETHERSCAN_API_KEY: z.string().optional(),
  BLOCKCYPHER_TOKEN: z.string().optional(),

  MONERO_WALLET_RPC_URL: z.string().optional(),
  MONERO_WALLET_RPC_USER: z.string().optional(),
  MONERO_WALLET_RPC_PASSWORD: z.string().optional(),

  // comma-separated subset of evm,tron,btc,ltc,solana,monero
  WATCHER_CHAINS: z.string().optional(),
  WATCHER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  // per-run safety net: a hung third-party API must never wedge the loop forever
  WATCHER_RUN_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),
});

export const env = envSchema.parse(process.env);
