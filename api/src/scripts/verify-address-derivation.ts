import { mnemonicToSeedSync } from "@scure/bip39";
import { HDKey } from "@scure/bip32";
import { deriveEvmAddress, deriveTronAddress, deriveBtcAddress, deriveLtcAddress } from "../chains/address-derivation.js";

// Well-known, widely-published Hardhat/Anvil default test mnemonic — NOT a secret, purely for verification.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";

const seed = mnemonicToSeedSync(TEST_MNEMONIC);
const master = HDKey.fromMasterSeed(seed);

// m/44'/60'/0'/0 — the "change level" node whose xpub we export and store on the server.
const evmChangeNode = master.derive("m/44'/60'/0'/0");
const evmXpub = evmChangeNode.publicExtendedKey;

const expected = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
];

let allMatch = true;
for (let i = 0; i < expected.length; i++) {
  const derived = deriveEvmAddress(evmXpub, i);
  const match = derived.toLowerCase() === expected[i].toLowerCase();
  allMatch = allMatch && match;
  console.log(`EVM address[${i}]: ${derived}  expected: ${expected[i]}  MATCH: ${match}`);
}

// Sanity (format only, no external vector) for the other xpub-based chains.
const tronNode = master.derive("m/44'/195'/0'/0");
console.log(`\nTRON address[0] (format check): ${deriveTronAddress(tronNode.publicExtendedKey, 0)}`);

const btcNode = master.derive("m/44'/0'/0'/0");
console.log(`BTC  address[0] (format check): ${deriveBtcAddress(btcNode.publicExtendedKey, 0)}`);

const ltcNode = master.derive("m/44'/2'/0'/0");
console.log(`LTC  address[0] (format check): ${deriveLtcAddress(ltcNode.publicExtendedKey, 0)}`);

if (!allMatch) {
  console.error("\nEVM derivation does NOT match known test vectors.");
  process.exit(1);
}
console.log("\nEVM derivation matches known test vectors.");
