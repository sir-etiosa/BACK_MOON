/**
 * Derives the four account-level xpubs (EVM, TRON, Litecoin, Bitcoin) from a BIP39 mnemonic.
 *
 * DO NOT run this inside any chat session, cloud shell, or any machine you don't fully
 * trust — the mnemonic you pass in is your real master seed. Run it on the same offline
 * /dedicated device where the seed was generated, then copy ONLY the printed xpub lines
 * (public, safe to share) into this project's .env. Never paste the mnemonic anywhere else.
 *
 * Usage: npx tsx src/scripts/offline-derive-xpubs.ts "word1 word2 ... word24"
 */
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";

const mnemonic = process.argv[2];
if (!mnemonic) {
  console.error('Usage: npx tsx src/scripts/offline-derive-xpubs.ts "your mnemonic (12, 15, 18, 21, or 24 words)"');
  process.exit(1);
}
if (!validateMnemonic(mnemonic, wordlist)) {
  console.error("That doesn't look like a valid BIP39 mnemonic — double check the word list/checksum.");
  process.exit(1);
}

const seed = mnemonicToSeedSync(mnemonic);
const master = HDKey.fromMasterSeed(seed);

const chains: { chain: string; coinType: number; envVar: string }[] = [
  { chain: "evm", coinType: 60, envVar: "EVM_XPUB" },
  { chain: "tron", coinType: 195, envVar: "TRON_XPUB" },
  { chain: "litecoin", coinType: 2, envVar: "LTC_XPUB" },
  { chain: "bitcoin", coinType: 0, envVar: "BTC_XPUB" },
];

console.log("\nCopy these lines into api/.env, replacing the test-only xpubs:\n");
for (const { coinType, envVar } of chains) {
  const node = master.derive(`m/44'/${coinType}'/0'/0`);
  console.log(`${envVar}="${node.publicExtendedKey}"`);
}
console.log("\nThen run: npm run load-xpubs\n");
