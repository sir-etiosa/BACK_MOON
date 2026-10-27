import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import bs58check from "bs58check";
import * as bitcoin from "bitcoinjs-lib";

/**
 * Public-only BIP32 derivation: given an account-level xpub (no private key),
 * derives the child *public* key for a user index. Works for every chain here
 * because they all use the secp256k1 curve — Solana (ed25519) can't do this,
 * which is why it uses a pre-generated address pool instead.
 */
function deriveChildPublicKey(xpub: string, index: number): Uint8Array {
  const node = HDKey.fromExtendedKey(xpub);
  const child = node.deriveChild(index); // non-hardened — requires only the public key
  if (!child.publicKey) throw new Error("Failed to derive child public key from xpub");
  return child.publicKey; // compressed, 33 bytes
}

function compressedToUncompressed(compressed: Uint8Array): Uint8Array {
  const hex = Buffer.from(compressed).toString("hex");
  return secp256k1.Point.fromHex(hex).toBytes(false); // 0x04 + X(32) + Y(32)
}

function keccakAddressBytes(compressedPubKey: Uint8Array): Uint8Array {
  const uncompressed = compressedToUncompressed(compressedPubKey);
  const withoutPrefix = uncompressed.slice(1); // drop the 0x04 prefix
  const hash = keccak_256(withoutPrefix);
  return hash.slice(-20);
}

function toEip55Checksum(addressHexNo0x: string): string {
  const hash = keccak_256(new TextEncoder().encode(addressHexNo0x.toLowerCase()));
  let out = "";
  for (let i = 0; i < addressHexNo0x.length; i++) {
    const nibble = hash[i >> 1];
    const highNibble = i % 2 === 0;
    const bit = highNibble ? nibble >> 4 : nibble & 0x0f;
    const char = addressHexNo0x[i];
    out += bit >= 8 ? char.toUpperCase() : char.toLowerCase();
  }
  return out;
}

export function deriveEvmAddress(xpub: string, index: number): string {
  const pub = deriveChildPublicKey(xpub, index);
  const bytes = keccakAddressBytes(pub);
  const hex = Buffer.from(bytes).toString("hex");
  return "0x" + toEip55Checksum(hex);
}

export function deriveTronAddress(xpub: string, index: number): string {
  const pub = deriveChildPublicKey(xpub, index);
  const bytes = keccakAddressBytes(pub);
  const withPrefix = Buffer.concat([Buffer.from([0x41]), Buffer.from(bytes)]);
  return bs58check.encode(withPrefix);
}

function hash160(pubKey: Uint8Array): Uint8Array {
  return ripemd160(sha256(pubKey));
}

export function deriveBtcAddress(xpub: string, index: number): string {
  const pub = deriveChildPublicKey(xpub, index);
  const { address } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(pub),
    network: bitcoin.networks.bitcoin,
  });
  if (!address) throw new Error("Failed to derive BTC address");
  return address;
}

const LITECOIN_NETWORK: bitcoin.Network = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "ltc",
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

export function deriveLtcAddress(xpub: string, index: number): string {
  const pub = deriveChildPublicKey(xpub, index);
  const hash = hash160(pub);
  const withVersion = Buffer.concat([Buffer.from([LITECOIN_NETWORK.pubKeyHash]), Buffer.from(hash)]);
  return bs58check.encode(withVersion);
}
