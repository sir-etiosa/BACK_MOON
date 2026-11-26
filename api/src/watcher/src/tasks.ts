import { runBtcLtcWatcher } from "./watchers/btc-ltc.watcher.js";
import { runEvmWatcher } from "./watchers/evm.watcher.js";
import { runMoneroWatcher } from "./watchers/monero.watcher.js";
import { runSolanaWatcher } from "./watchers/solana.watcher.js";
import { runTronWatcher } from "./watchers/tron.watcher.js";

export interface WatcherTask {
  chain: string;
  run: () => Promise<unknown>;
}

/** Mirrors the API's /cron/watch-* endpoints one-for-one, so a chain added here is the
 * same code path GitHub Actions used to hit over HTTP. */
const CHAIN_WATCHERS: Record<string, () => Promise<unknown>> = {
  evm: runEvmWatcher,
  tron: runTronWatcher,
  btc: () => runBtcLtcWatcher("bitcoin"),
  ltc: () => runBtcLtcWatcher("litecoin"),
  solana: runSolanaWatcher,
  monero: runMoneroWatcher,
};

/** Monero stays off by default: it needs a view-only monero-wallet-rpc instance that a
 * plain VPS install doesn't have. Add it explicitly via WATCHER_CHAINS. */
export const DEFAULT_CHAINS = ["evm", "tron", "ltc", "btc", "solana"];

export function parseChainList(raw: string | undefined): string[] {
  const source = raw?.trim() ? raw : DEFAULT_CHAINS.join(",");
  const chains = [...new Set(source.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean))];
  if (chains.length === 0) throw new Error("WATCHER_CHAINS listed no chains");
  for (const chain of chains) {
    if (!CHAIN_WATCHERS[chain]) {
      throw new Error(`Unknown chain "${chain}" — valid: ${Object.keys(CHAIN_WATCHERS).join(", ")}`);
    }
  }
  return chains;
}

export function buildTasks(chains: readonly string[]): WatcherTask[] {
  return chains.map((chain) => ({ chain, run: CHAIN_WATCHERS[chain] }));
}
