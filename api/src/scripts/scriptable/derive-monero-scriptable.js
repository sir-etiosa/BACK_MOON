// MoonXch — offline Monero subaddress derivation for Scriptable (iOS).
//
// INPUT FORMAT: this script takes your Monero account's PRIVATE SPEND KEY as a 64-character
// hex string, not the 25-word mnemonic. Any real Monero wallet can export it: Monero GUI
// wallet ("Account" -> "Keys" -> show private spend key), the official CLI wallet
// (`spendkey` command), Feather Wallet, or monero-wallet-rpc's `query_key` method. Decoding
// Monero's 25-word Electrum-style mnemonic directly needs its own 1626-word list and
// checksum algorithm — a separate, unrelated piece of complexity from the actual address
// math, so it was deliberately left out of scope here in favor of the hex key, which any
// wallet can give you in two taps.
//
// WHY THIS EXISTS, AND AN IMPORTANT DISTINCTION FROM THE SOLANA SCRIPT: Monero splits
// custody into a private SPEND key (full control, moves funds) and a private VIEW key
// (can only see incoming funds, can't spend). The server's monero-wallet-rpc already only
// ever holds the view key — it was never unsafe to mint addresses live with it. What this
// script buys you is avoiding a continuous server-side `create_address` RPC call per user,
// pre-generating a batch of subaddresses offline instead, same pattern as the Solana pool.
//
// WHAT THIS DOES **NOT** REPLACE: detecting an incoming deposit on a given subaddress still
// requires a continuously-running process holding the private view key, scanning the chain
// (monero-wallet-rpc + a synced node, or an equivalent view-key-based scanner). That's
// inherent to how Monero works — a one-shot phone script can't watch a blockchain while
// it's closed. This script only replaces address *minting*, not deposit *detection*.
//
// OUTPUTS (all local to Scriptable's sandbox, never iCloud):
//   1. "<name>.subaddresses.txt" — bare subaddresses, one per line. Safe to copy to the
//      server and import into a Monero address pool (mirrors the Solana import-pool flow).
//   2. "<name>.index-map.csv" — "minorIndex,address". Keep this ON THIS DEVICE.
//   3. "<name>.account-keys.txt" — written ONCE per run, contains your PRIVATE VIEW KEY and
//      PUBLIC SPEND KEY (NOT the private spend key — that never leaves this derivation).
//      This pair is what you feed to `monero-wallet-rpc --generate-from-keys` to create the
//      view-only wallet that watches for deposits. This file is sensitive (it lets whoever
//      holds it see every incoming transfer and amount on the account, though not spend
//      anything) — treat it like a password, transfer it deliberately to wherever
//      monero-wallet-rpc will run, and delete it afterward rather than leaving it on the
//      phone indefinitely.
//
// Your private SPEND key is typed into the EDIT ME section below and only ever used
// in-memory during this run — never printed, logged, or written to any file. Consider
// disabling iOS predictive text before typing it in, same caveat as the Solana script.

// ========================= EDIT ME BEFORE EACH RUN =========================
const PRIVATE_SPEND_KEY_HEX = "REPLACE WITH YOUR 64-CHARACTER HEX PRIVATE SPEND KEY";
const START_INDEX = 0;
const COUNT = 2000;
const OUTPUT_NAME = "monero-subaddresses-batch1"; // no extension
// =============================================================================

// ---------- Keccak-256 (NOT NIST SHA3-256 — different padding) ----------
const KECCAK_ROUND_CONSTANTS = (() => {
  // Computed via the standard LFSR-based RC generation algorithm (Keccak reference),
  // rather than copied from a table, to remove transcription-error risk.
  function lfsr8() {
    const out = [];
    let state = 0x01;
    for (let i = 0; i < 255; i++) {
      out.push(state & 1);
      const bit = (state & 1) ^ ((state >> 4) & 1) ^ ((state >> 5) & 1) ^ ((state >> 6) & 1);
      state = (state >> 1) | (bit << 7);
    }
    return out;
  }
  const lfsrBits = lfsr8();
  const constants = [];
  for (let round = 0; round < 24; round++) {
    let rcWord = 0n;
    for (let j = 0; j <= 6; j++) {
      const bitPosition = (1 << j) - 1;
      const lfsrIndex = (7 * round + j) % 255;
      if (lfsrBits[lfsrIndex]) rcWord |= 1n << BigInt(bitPosition);
    }
    constants.push(rcWord);
  }
  return constants;
})();

// r[x][y], standard Keccak rotation-offset table.
const ROTATION_OFFSETS = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

const MASK64K = (1n << 64n) - 1n;
function rotl64(x, n) {
  n = n % 64n;
  if (n === 0n) return x & MASK64K;
  return ((x << n) | (x >> (64n - n))) & MASK64K;
}

function keccakF1600(state) {
  for (let round = 0; round < 24; round++) {
    const C = [0n, 0n, 0n, 0n, 0n];
    for (let x = 0; x < 5; x++) C[x] = state[x][0] ^ state[x][1] ^ state[x][2] ^ state[x][3] ^ state[x][4];
    const Dc = [0n, 0n, 0n, 0n, 0n];
    for (let x = 0; x < 5; x++) Dc[x] = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) state[x][y] ^= Dc[x];

    const B = Array.from({ length: 5 }, () => [0n, 0n, 0n, 0n, 0n]);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y][(2 * x + 3 * y) % 5] = rotl64(state[x][y], BigInt(ROTATION_OFFSETS[x][y]));
      }
    }

    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x][y] = B[x][y] ^ (~B[(x + 1) % 5][y] & B[(x + 2) % 5][y] & MASK64K);
      }
    }

    state[0][0] ^= KECCAK_ROUND_CONSTANTS[round];
  }
  return state;
}

function keccak256(messageBytes) {
  const rateBytes = 136;
  const padLen = rateBytes - (messageBytes.length % rateBytes);
  const padded = new Uint8Array(messageBytes.length + padLen);
  padded.set(messageBytes, 0);
  padded[messageBytes.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const state = Array.from({ length: 5 }, () => [0n, 0n, 0n, 0n, 0n]);
  for (let offset = 0; offset < padded.length; offset += rateBytes) {
    const block = new DataView(padded.buffer, padded.byteOffset + offset, rateBytes);
    for (let i = 0; i < rateBytes / 8; i++) {
      const x = i % 5, y = Math.floor(i / 5);
      state[x][y] ^= block.getBigUint64(i * 8, true);
    }
    keccakF1600(state);
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) {
    const x = i % 5, y = Math.floor(i / 5);
    outView.setBigUint64(i * 8, state[x][y], true);
  }
  return out;
}

// ---------- ed25519 field/group arithmetic ----------
const P = (1n << 255n) - 19n;
function mod(a, m) { const r = a % m; return r >= 0n ? r : r + m; }
function modPow(base, exp, m) {
  base = mod(base, m);
  let result = 1n;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    base = (base * base) % m;
    exp >>= 1n;
  }
  return result;
}
function modInverse(a, m) { return modPow(a, m - 2n, m); }
const D = mod(-121665n * modInverse(121666n, P), P);
const L = 2n ** 252n + 27742317777372353535851937790883648493n;

const IDENTITY = { X: 0n, Y: 1n, Z: 1n, T: 0n };
function pointAdd(p1, p2) {
  const A = mod((p1.Y - p1.X) * (p2.Y - p2.X), P);
  const B = mod((p1.Y + p1.X) * (p2.Y + p2.X), P);
  const C = mod(((2n * p1.T * p2.T) % P) * D, P);
  const Dd = mod(2n * p1.Z * p2.Z, P);
  const E = B - A, F = Dd - C, G = Dd + C, H = B + A;
  return { X: mod(E * F, P), Y: mod(G * H, P), Z: mod(F * G, P), T: mod(E * H, P) };
}
function pointDouble(p) { return pointAdd(p, p); }
function toExtended(x, y) { return { X: mod(x, P), Y: mod(y, P), Z: 1n, T: mod(x * y, P) }; }

function recoverX(y, sign) {
  const y2 = mod(y * y, P);
  const u = mod(y2 - 1n, P);
  const v = mod(D * y2 + 1n, P);
  const uv3 = mod(u * modPow(v, 3n, P), P);
  const uv7 = mod(u * modPow(v, 7n, P), P);
  let x = mod(uv3 * modPow(uv7, (P - 5n) / 8n, P), P);
  const vx2 = mod(v * x * x, P);
  if (mod(vx2 - u, P) !== 0n) {
    const sqrtM1 = modPow(2n, (P - 1n) / 4n, P);
    x = mod(x * sqrtM1, P);
  }
  if ((x & 1n) !== sign) x = P - x;
  return x;
}

let BASE_POINT = null;
function getBasePoint() {
  if (BASE_POINT) return BASE_POINT;
  const By = mod(4n * modInverse(5n, P), P);
  const Bx = recoverX(By, 0n);
  BASE_POINT = toExtended(Bx, By);
  return BASE_POINT;
}

function pointFromBytes(bytes) {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]);
  const sign = (y >> 255n) & 1n;
  y &= (1n << 255n) - 1n;
  return toExtended(recoverX(y, sign), y);
}

function scalarMult(point, scalar) {
  let result = IDENTITY;
  let addend = point;
  let k = scalar;
  while (k > 0n) {
    if (k & 1n) result = pointAdd(result, addend);
    addend = pointDouble(addend);
    k >>= 1n;
  }
  return result;
}
function scalarMultBase(scalar) { return scalarMult(getBasePoint(), scalar); }

function encodePoint(p) {
  const zInv = modInverse(p.Z, P);
  const x = mod(p.X * zInv, P);
  const y = mod(p.Y * zInv, P);
  const bytes = new Uint8Array(32);
  let yVal = y;
  for (let i = 0; i < 32; i++) { bytes[i] = Number(yVal & 0xffn); yVal >>= 8n; }
  if (x & 1n) bytes[31] |= 0x80;
  return bytes;
}

function bytesToLEBigInt(bytes) {
  let v = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]);
  return v;
}
function bigIntToLEBytes32(v) {
  const bytes = new Uint8Array(32);
  let x = v;
  for (let i = 0; i < 32; i++) { bytes[i] = Number(x & 0xffn); x >>= 8n; }
  return bytes;
}
function scReduce32(bytes32) { return mod(bytesToLEBigInt(bytes32), L); }
function hashToScalar(bytes) { return scReduce32(keccak256(bytes)); }

function concatBytes(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}
function hexToBytes(hexStr) {
  const clean = hexStr.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error("PRIVATE_SPEND_KEY_HEX must be exactly 64 hex characters (32 bytes).");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) { return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(""); }

// ---------- Monero base58 (block-based, 8 bytes -> 11 chars) ----------
const MONERO_B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ENCODED_BLOCK_SIZES = [0, 2, 3, 5, 6, 7, 9, 10, 11];

function encodeBlock(blockBytes) {
  let num = 0n;
  for (const b of blockBytes) num = (num << 8n) | BigInt(b);
  const encodedSize = ENCODED_BLOCK_SIZES[blockBytes.length];
  const chars = new Array(encodedSize).fill(MONERO_B58_ALPHABET[0]);
  let i = encodedSize - 1;
  while (num > 0n) {
    chars[i--] = MONERO_B58_ALPHABET[Number(num % 58n)];
    num = num / 58n;
  }
  return chars.join("");
}
function moneroBase58Encode(bytes) {
  let out = "";
  let i = 0;
  while (i + 8 <= bytes.length) { out += encodeBlock(bytes.slice(i, i + 8)); i += 8; }
  if (i < bytes.length) out += encodeBlock(bytes.slice(i));
  return out;
}

// ---------- Monero address encoding ----------
const NETWORK_BYTE_MAINNET_PRIMARY = 18;
const NETWORK_BYTE_MAINNET_SUBADDRESS = 42;

function moneroAddressBytes(networkByte, publicSpendKey, publicViewKey) {
  const body = concatBytes(new Uint8Array([networkByte]), publicSpendKey, publicViewKey);
  const checksum = keccak256(body).slice(0, 4);
  return concatBytes(body, checksum);
}

function deriveAccountKeys(privateSpendKeyHex) {
  const privSpendBytes = bigIntToLEBytes32(scReduce32(hexToBytes(privateSpendKeyHex)));
  const privViewScalar = hashToScalar(privSpendBytes);
  const privViewBytes = bigIntToLEBytes32(privViewScalar);
  const pubSpendBytes = encodePoint(scalarMultBase(bytesToLEBigInt(privSpendBytes)));
  const pubViewBytes = encodePoint(scalarMultBase(privViewScalar));
  return { privSpendBytes, privViewBytes, pubSpendBytes, pubViewBytes };
}

function primaryAddress(keys) {
  return moneroBase58Encode(moneroAddressBytes(NETWORK_BYTE_MAINNET_PRIMARY, keys.pubSpendBytes, keys.pubViewBytes));
}

function deriveSubaddress(keys, majorIndex, minorIndex) {
  if (majorIndex === 0 && minorIndex === 0) return primaryAddress(keys);

  const majorBytes = new Uint8Array(4);
  new DataView(majorBytes.buffer).setUint32(0, majorIndex, true);
  const minorBytes = new Uint8Array(4);
  new DataView(minorBytes.buffer).setUint32(0, minorIndex, true);

  const prefix = new Uint8Array([0x53, 0x75, 0x62, 0x41, 0x64, 0x64, 0x72, 0x00]); // "SubAddr\0"
  const m = hashToScalar(concatBytes(prefix, keys.privViewBytes, majorBytes, minorBytes));

  const subPubSpendPoint = pointAdd(pointFromBytes(keys.pubSpendBytes), scalarMultBase(m));
  const subPubViewPoint = scalarMult(subPubSpendPoint, bytesToLEBigInt(keys.privViewBytes));

  return moneroBase58Encode(
    moneroAddressBytes(NETWORK_BYTE_MAINNET_SUBADDRESS, encodePoint(subPubSpendPoint), encodePoint(subPubViewPoint)),
  );
}

// ========================= self-test: refuse to run on broken crypto =========================
function selfTest() {
  const KNOWN_SPEND_KEY = "37afcaccc792b48b7149661e4de7d42b6fc0cea2d7b6de48112fa8a512dcac07";
  const keys = deriveAccountKeys(KNOWN_SPEND_KEY);
  const checks = [
    [bytesToHex(keys.privViewBytes), "0138acf4d2f6c0a02454e261a232f607f042e4e78ef2ed7b115f3172be9df40a"],
    [bytesToHex(keys.pubSpendBytes), "99469ca3506727bc76d007b9d54f850ad77c7e12d24d1c5c87ec46d645120e03"],
    [primaryAddress(keys), "47Rzw8Hk4oxYXLburFYvyA2pBMSps37AjGUfdoye4Pp91YGTs2JmpRMNG6PFzhS7T6JKxoYZT1bPEdsSZ4pdKXN4NdGEc2c"],
    [deriveSubaddress(keys, 0, 1), "84tgWS54mXu4iNvSLS4WQDTJaLcHVy1A3ikK8hxU83eUFoVz9ZZrk1EjiTkxuW2BSkEF2wQhPYYY7afaMYyvMLGS65wuVrx"],
    [deriveSubaddress(keys, 0, 50), "83o3MJXJYb3JFbneJZjMFMafHD15wL6P1LF8jqHmjvZ3Y3FZi1yKT7ReoHfGdtijzxJXHEfCNE4UsBYQugP49RXm884hAtT"],
  ];
  for (const [got, expected] of checks) {
    if (got !== expected) {
      throw new Error(
        `SELF-TEST FAILED: got ${got}, expected ${expected}. Something in this device's JS engine ` +
          `is producing different crypto output than expected — DO NOT trust this run. Stop and get help.`,
      );
    }
  }
}

// ========================= main =========================
async function main() {
  selfTest();
  console.log("Self-test passed — crypto matches known-good vectors.\n");

  if (!PRIVATE_SPEND_KEY_HEX || PRIVATE_SPEND_KEY_HEX.startsWith("REPLACE")) {
    throw new Error("Edit PRIVATE_SPEND_KEY_HEX at the top of this script before running it.");
  }
  if (COUNT <= 0 || START_INDEX < 0) {
    throw new Error("START_INDEX must be >= 0 and COUNT must be a positive integer.");
  }

  const keys = deriveAccountKeys(PRIVATE_SPEND_KEY_HEX);
  const rows = [];
  const startedAt = Date.now();

  for (let i = 0; i < COUNT; i++) {
    const minorIndex = START_INDEX + i;
    rows.push({ index: minorIndex, address: deriveSubaddress(keys, 0, minorIndex) });
    if ((i + 1) % 500 === 0 || i + 1 === COUNT) {
      console.log(`Generated ${i + 1}/${COUNT} (${((Date.now() - startedAt) / 1000).toFixed(1)}s elapsed)`);
    }
  }

  const fm = FileManager.local();
  const dir = fm.documentsDirectory();
  const subaddressesPath = fm.joinPath(dir, `${OUTPUT_NAME}.subaddresses.txt`);
  const indexMapPath = fm.joinPath(dir, `${OUTPUT_NAME}.index-map.csv`);
  const accountKeysPath = fm.joinPath(dir, `${OUTPUT_NAME}.account-keys.txt`);

  fm.writeString(subaddressesPath, rows.map((r) => r.address).join("\n") + "\n");
  fm.writeString(indexMapPath, rows.map((r) => `${r.index},${r.address}`).join("\n") + "\n");
  fm.writeString(
    accountKeysPath,
    `private_view_key=${bytesToHex(keys.privViewBytes)}\n` +
      `public_spend_key=${bytesToHex(keys.pubSpendBytes)}\n` +
      `primary_address=${primaryAddress(keys)}\n` +
      `\nUse private_view_key + public_spend_key with monero-wallet-rpc --generate-from-keys to create\n` +
      `the view-only wallet that watches for deposits. Delete this file once you've transferred it.\n`,
  );

  console.log(`\nWrote ${rows.length} subaddresses.`);
  console.log(`Index map (keep ON THIS DEVICE): ${indexMapPath}`);
  console.log(`Bare subaddresses (safe to export to the server pool): ${subaddressesPath}`);
  console.log(`Account keys (sensitive — view-only, transfer deliberately then delete): ${accountKeysPath}`);
  console.log("Your private SPEND key was never printed or written anywhere.\n");

  await QuickLook.present(subaddressesPath);
}

await main();
