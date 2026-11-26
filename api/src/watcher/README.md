# MoonXch deposit watcher (VPS edition)

Standalone daemon that polls every chain and credits confirmed deposits into the same
Postgres database the API uses. This replaces the GitHub Actions workflow
(`.github/workflows/watch-deposits.yml`) — no public HTTP endpoint, no 60-second curl
timeout, no waiting on GitHub's "best effort" scheduler.

It runs the **same watcher code** as the API's `/cron/watch-*` routes, so switching to it
does not change how deposits are detected or credited.

---

## What's inside

```
watcher/
├── package.json          deps + scripts (once you copy this folder, it's a whole project)
├── tsconfig.json
├── .env.example          copy to .env and fill in
├── prisma/
│   └── schema.prisma     read-only copy — the watcher NEVER migrates
└── src/
    ├── index.ts          the scheduler loop (this is what systemd runs)
    ├── config.ts         env validation
    ├── db.ts             Prisma client
    ├── tasks.ts          chain registry (evm/tron/btc/ltc/solana/monero)
    ├── ledger.ts         double-entry primitives (copied from the API)
    ├── templates.ts      deposit email template
    ├── mailer.ts         console / resend transport
    ├── monero-wallet-rpc.ts
    ├── selftest.ts       config + (optional) DB credit test
    └── watchers/
        ├── evm.watcher.ts
        ├── tron.watcher.ts
        ├── btc-ltc.watcher.ts
        ├── solana.watcher.ts
        ├── monero.watcher.ts
        ├── deposit-helper.ts   records a deposit, credits the ledger once confirmed
        └── fetch-with-timeout.ts
```

> **Copied code caveat:** `ledger.ts`, `templates.ts`, `mailer.ts`, `monero-wallet-rpc.ts`
> and `watchers/*` are copies of the API's source. If you change deposit/ledger logic in
> `api/`, mirror it here. Everything else (the loop, config, task registry) is unique to
> this folder.
>
> One deliberate divergence already exists: `watchers/deposit-helper.ts` here returns
> `{ ...deposit, justCredited }` instead of a bare deposit, and the watchers count
> `deposit.justCredited` rather than `deposit.status === "CREDITED"`. The API's version
> counts every already-credited deposit on every run, so a long-running daemon would log
> "credited N" forever and look like it was re-crediting. This copy reports only *new*
> credits. Port this change back to `api/` if you want them identical.

---

## 1. Prerequisites on the VPS

- Node.js 20+ (`node -v`)
- Outbound HTTPS to Etherscan, Blockcypher, TronGrid, Solana RPC
- Network access to your Postgres (the same `DATABASE_URL` the API uses)

## 2. Copy the folder up

From your machine, inside `api/src`:

```bash
rsync -av --exclude node_modules --exclude dist --exclude .env \
  watcher/ user@your-vps-ip:/opt/moon-xch-watcher/
```

> **Never copy `node_modules/` or `dist/` from Windows to a Linux VPS.**
> Prisma ships a platform-specific native engine — a Windows install contains
> `query_engine-windows.dll.node`, which Ubuntu cannot load, and the daemon dies on
> startup. Always `npm install` on the VPS itself (it fetches
> `libquery_engine-debian-openssl-3.0.x.so.node` instead). If you already copied a
> Windows `node_modules`, fix it with:
>
> ```bash
> cd /opt/moon-xch-watcher
> rm -rf node_modules dist
> npm install
> npm run build
> ```
>
> Don't copy `.env` either — make a fresh one on the VPS from `.env.example`.

On the VPS:

```bash
cd /opt/moon-xch-watcher
```

## 3. Install

```bash
npm install          # also runs `prisma generate`
```

## 4. Configure

```bash
cp .env.example .env
nano .env
```

Minimum required:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | **Same database as the API.** Use the pooled connection string. |
| `ETHERSCAN_API_KEY` | Required by the EVM watcher (free at etherscan.io/apidashboard). |
| `WATCHER_INTERVAL_SECONDS` | Default `30` (one full sweep every 30 seconds). |
| `WATCHER_CHAINS` | Default `evm,tron,ltc,btc,solana`. Add `monero` only if you run monero-wallet-rpc. |

Optional: `BLOCKCYPHER_TOKEN`, `MAIL_TRANSPORT`/`RESEND_API_KEY`/`MAIL_FROM`.

## 5. Test before you daemonize

```bash
# config sanity, no DB or network writes
npm test

# the real credit path against your DB (creates a temp user, credits, re-checks
# idempotency, then deletes everything it made)
RUN_DB_TESTS=1 npm test

# one full sweep now, then exit (runs the TS sources directly)
npm run once
```

`npm run once` is the recommended smoke test: it prints one JSON line per chain. A chain
with no deposits yet should log `watcher.ok` with `addressesChecked: 0`
(`monero` will error unless `MONERO_WALLET_RPC_URL` is set — that's expected).

## 5b. Compile

The systemd unit runs the compiled output, so build before starting the service:

```bash
npm run build
```

This emits `dist/index.js`. Re-run it after any source change.

## 6. Run it as a service (systemd)

```bash
sudo cp deploy/moon-xch-watcher.service /etc/systemd/system/
sudo nano /etc/systemd/system/moon-xch-watcher.service   # set User= to your login
sudo systemctl daemon-reload
sudo systemctl enable --now moon-xch-watcher
```

Logs:

```bash
journalctl -u moon-xch-watcher -f
```

## 7. Turn off the old GitHub Actions cron

Once `journalctl` shows clean `watcher.ok` / `cycle.done` lines, delete
`.github/workflows/watch-deposits.yml` (or disable the workflow in the Actions tab) so
two schedulers don't poll the same chains.

---

## Operational notes

- **Idempotent by design.** Every run re-scans recent txs. `recordAndCreditIfReady` locks
  the deposit row and the ledger's `(refType, refId, account, direction)` unique constraint
  is the final backstop — re-observing a tx never double-credits. The self-test proves this.
- **Failures are per-chain, never fatal.** A provider outage logs `watcher.error` for that
  chain and continues; the next cycle retries.
- **No overlap.** If a cycle runs longer than the interval, the next tick is skipped rather
  than stacking. Each chain also has a hard `WATCHER_RUN_TIMEOUT_SECONDS` ceiling.
- **Graceful shutdown.** `SIGTERM`/`SIGINT` let the in-flight cycle finish before exit.
- **No migrations.** The watcher only reads/writes rows. Run `npm run prisma:deploy` in
  `api/` for schema changes.
