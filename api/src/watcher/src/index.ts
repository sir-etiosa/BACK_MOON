import { env } from "./config.js";
import { prisma } from "./db.js";
import { buildTasks, parseChainList, type WatcherTask } from "./tasks.js";

const RUN_ONCE = process.argv.includes("--once");

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

async function withTimeout<T>(promise: Promise<T>, seconds: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${seconds}s`)), seconds * 1000);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One full sweep across every configured chain, sequentially. Sequential (not
 * Promise.all) on purpose: the old GitHub Actions job did the same, and running the
 * chains one after another keeps a single VPS from opening dozens of concurrent
 * Etherscan/TronGrid/RPC requests and tripping their rate limits. */
async function runCycle(tasks: WatcherTask[]) {
  const startedAt = Date.now();
  let failed = 0;

  for (const task of tasks) {
    const t0 = Date.now();
    try {
      const result = await withTimeout(task.run(), env.WATCHER_RUN_TIMEOUT_SECONDS, task.chain);
      log("watcher.ok", { chain: task.chain, ms: Date.now() - t0, result });
    } catch (err) {
      // A failing chain never aborts the cycle — the other chains (and the next run)
      // still work, and a transient provider outage is not a process-fatal event.
      failed++;
      log("watcher.error", { chain: task.chain, ms: Date.now() - t0, error: (err as Error).message });
    }
  }

  log("cycle.done", { chains: tasks.length, failed, ms: Date.now() - startedAt });
}

async function main() {
  const chains = parseChainList(env.WATCHER_CHAINS);
  const tasks = buildTasks(chains);
  log("watcher.start", {
    chains,
    intervalSeconds: env.WATCHER_INTERVAL_SECONDS,
    runTimeoutSeconds: env.WATCHER_RUN_TIMEOUT_SECONDS,
    mode: RUN_ONCE ? "once" : "loop",
  });

  if (RUN_ONCE) {
    await runCycle(tasks);
    await prisma.$disconnect();
    return;
  }

  let stopping = false;
  let running = false;

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log("watcher.stop", { signal, running });
    // Don't disconnect mid-transaction — a running cycle finishes, then exits.
    if (!running) void prisma.$disconnect().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  while (!stopping) {
    // Re-entrancy guard: if a cycle outruns the interval, skip this tick instead of
    // stacking overlapping scans (which would double-process the same txs and fight
    // over the same deposit rows).
    if (!running) {
      running = true;
      await runCycle(tasks);
      running = false;
    }

    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, env.WATCHER_INTERVAL_SECONDS * 1000));
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  log("watcher.fatal", { error: (err as Error).message });
  void prisma.$disconnect();
  process.exit(1);
});
