import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { walletRoutes } from "./modules/wallet/wallet.routes.js";
import { tradeRoutes } from "./modules/trade/trade.routes.js";
import { adminRoutes } from "./modules/admin/admin.routes.js";
import { withdrawalRoutes } from "./modules/withdrawals/withdrawal.routes.js";
import { cronRoutes } from "./modules/cron/cron.routes.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);

  await app.register(swagger, {
    openapi: {
      info: { title: "MoonXch API", version: "0.1.0" },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(walletRoutes);
  await app.register(tradeRoutes);
  await app.register(adminRoutes);
  await app.register(withdrawalRoutes);
  await app.register(cronRoutes);

  return app;
}
