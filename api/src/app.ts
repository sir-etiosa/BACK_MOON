import type { IncomingMessage, ServerResponse } from "node:http";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
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
  // Raw spec — no server-side UI plugin involved, so nothing here can hit the
  // @fastify/static -> content-disposition ESM conflict that broke @fastify/swagger-ui
  // under Vercel's bundler.
  app.get("/openapi.json", async () => app.swagger());

  // Swagger UI is just static HTML/CSS/JS that fetches a spec URL in the browser — it
  // doesn't need any server-side plugin at all. Loading it from a CDN sidesteps the
  // broken dependency chain entirely and works identically locally and on Vercel.
  app.get("/docs", async (_req, reply) => {
    reply.type("text/html").send(`<!DOCTYPE html>
<html>
<head>
  <title>MoonXch API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({ url: "/openapi.json", dom_id: "#swagger-ui" });
  </script>
</body>
</html>`);
  });

  app.get("/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(walletRoutes);
  await app.register(tradeRoutes);
  await app.register(adminRoutes);
  await app.register(withdrawalRoutes);
  await app.register(cronRoutes);

  return app;
}

// Vercel's zero-config Fastify detection calls this file's default export directly for
// every request (it auto-detected "Fastify" from package.json and picked this file as the
// entry point) — must be a function or server, built once and reused across invocations.
let appPromise: ReturnType<typeof buildApp> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!appPromise) appPromise = buildApp();
  const app = await appPromise;
  await app.ready();
  app.server.emit("request", req, res);
}
