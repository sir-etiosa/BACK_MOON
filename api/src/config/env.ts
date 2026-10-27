import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_JWT_SECRET: z.string().min(16, "APP_JWT_SECRET must be set to a long random value"),
  PORT: z.coerce.number().default(4000),
  MAIL_TRANSPORT: z.enum(["console", "resend"]).default("console"),
  EVM_XPUB: z.string().optional(),
  TRON_XPUB: z.string().optional(),
  LTC_XPUB: z.string().optional(),
  BTC_XPUB: z.string().optional(),
  ETHERSCAN_API_KEY: z.string().optional(),
  BLOCKCYPHER_TOKEN: z.string().optional(),
  CRON_SECRET: z.string().min(16),
});

export const env = envSchema.parse(process.env);
