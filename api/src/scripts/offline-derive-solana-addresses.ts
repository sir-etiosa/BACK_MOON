/**
 * Derives a batch of Solana deposit addresses from a BIP39 mnemonic, offline.
 *
 * DO NOT run this inside any chat session, cloud shell, or any machine you don't fully
 * trust — same rule as offline-derive-xpubs.ts. Solana's curve (ed25519) can't do
 * public-only derivation like the xpub chains (BTC/LTC/ETH/TRON) — generating an
 * address here necessarily means a private key exists in this process's memory for a
 * moment. This script never prints or saves a private key: only the resulting public
 * addresses, and the index used to produce each one (see below for why that matters).
 *
 * The address pool on the server only stores a bare address — it has no memory of
 * which derivation index produced it. That's fine for day-to-day issuance, but if you
 * ever need to sweep or spend from a *specific* address later, you need to know its
 * index to re-derive the matching private key from this same mnemonic. So this script
 * writes two files when given an output path:
 *   1. "<outputFile>.index-map.csv" — "index,address" table. Keep this OFFLINE, next
 *      to your mnemonic backup — it's your only record of which index maps to which
 *      address. Never copy this one to the server.
 *   2. "<outputFile>" — plain address-only, one per line. Safe to copy to the server
 *      and import with `npm run import-pool -- solana <file>`.
 * No count limit — this runs the same way for 10 addresses or 10,000, just takes
 * longer and produces a bigger file. For very large batches, run in smaller chunks
 * (e.g. 2,000 at a time, bumping startIndex each time) so each offline session stays
 * short, rather than one huge run.
 *
 * Usage: npx tsx src/scripts/offline-derive-solana-addresses.ts "mnemonic..." <startIndex> <count> [outputFile]
 */
import fs from "node:fs";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { derivePath } from "ed25519-hd-key";
import { Keypair } from "@solana/web3.js";

const [mnemonic, startArg, countArg, outputFile] = process.argv.slice(2);
if (!mnemonic || !startArg || !countArg) {
  console.error(
    'Usage: npx tsx src/scripts/offline-derive-solana-addresses.ts "mnemonic (12-24 words)" <startIndex> <count> [outputAddressesFile]',
  );
  process.exit(1);
}
if (!validateMnemonic(mnemonic, wordlist)) {
  console.error("That doesn't look like a valid BIP39 mnemonic — double check the word list/checksum.");
  process.exit(1);
}

const start = parseInt(startArg, 10);
const count = parseInt(countArg, 10);
if (!Number.isInteger(start) || start < 0 || !Number.isInteger(count) || count <= 0) {
  console.error("startIndex must be >= 0 and count must be a positive integer.");
  process.exit(1);
}

const seedHex = Buffer.from(mnemonicToSeedSync(mnemonic)).toString("hex");

const rows: { index: number; address: string }[] = [];
for (let i = start; i < start + count; i++) {
  // Standard Solana derivation path (same one Phantom/Sollet/etc. use) — fully
  // hardened at every level, which is the only kind ed25519 supports.
  const path = `m/44'/501'/${i}'/0'`;
  const { key } = derivePath(path, seedHex);
  const keypair = Keypair.fromSeed(key);
  rows.push({ index: i, address: keypair.publicKey.toBase58() });
}

console.log(`\nGenerated ${count} Solana address(es), indices ${start}-${start + count - 1}.\n`);

if (outputFile) {
  const indexMapFile = `${outputFile}.index-map.csv`;
  fs.writeFileSync(indexMapFile, rows.map((r) => `${r.index},${r.address}`).join("\n") + "\n");
  fs.writeFileSync(outputFile, rows.map((r) => r.address).join("\n") + "\n");

  console.log(`Wrote the index->address record to ${indexMapFile} — keep this file OFFLINE, with your mnemonic. Never copy it to the server.`);
  console.log(`Wrote ${count} bare addresses to ${outputFile} — safe to copy to the server and run:`);
  console.log(`  npm run import-pool -- solana ${outputFile}\n`);
} else {
  // Small batch, no file requested — fine to just print the table directly.
  console.log("--- KEEP THIS TABLE OFFLINE, NEXT TO YOUR MNEMONIC — your only record of index -> address ---");
  for (const r of rows) console.log(`${r.index},${r.address}`);
  console.log("--- end table ---\n");
  console.log("No output file given — copy the addresses above manually, or re-run with a 4th argument to write files instead.\n");
}

console.log(
  "No private key was printed or written anywhere. It existed only in this process's memory and is gone now that this script has finished.\n",
);
