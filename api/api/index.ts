// Vercel's convention: serverless functions live in an `api/` folder relative to the
// project's configured Root Directory. Since our backend project is itself named `api`,
// that root directory IS this folder — so this file's real path ends up `api/api/index.ts`.
// Confusing naming, not a mistake: set Vercel's Root Directory to `api` when importing
// the repo, and this is the single catch-all function every request gets routed to
// (see ../vercel.json).
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "../src/app.js";

let appPromise: ReturnType<typeof buildApp> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!appPromise) appPromise = buildApp();
  const app = await appPromise;
  await app.ready();
  app.server.emit("request", req, res);
}
