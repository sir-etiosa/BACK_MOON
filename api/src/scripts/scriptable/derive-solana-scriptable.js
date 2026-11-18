// MoonXch — offline Solana address derivation for Scriptable (iOS).
//
// WHY THIS FILE EXISTS: Scriptable has no Node.js, no npm, and no access to the
// @solana/web3.js / ed25519-hd-key / @scure/bip39 packages the server-side version of
// this script (api/src/scripts/offline-derive-solana-addresses.ts) depends on. Every
// crypto primitive needed — SHA-512, HMAC-SHA512, PBKDF2 (BIP39 seed), SLIP-0010 ed25519
// derivation, ed25519 scalar multiplication, base58 — is reimplemented below in plain
// JavaScript (BigInt, no dependencies). It was verified bit-for-bit against the real
// @solana/web3.js + ed25519-hd-key + @scure/bip39 stack across 6 (mnemonic, index) pairs,
// including large indices, before being trusted with this derivation. SELF_TEST below
// re-checks a subset of that on every run and refuses to proceed if anything mismatches.
//
// DO NOT run this on a phone you don't fully trust (jailbroken, shared, etc.) — same rule
// as the server-side script. Your mnemonic is typed into this file's EDIT ME section below;
// consider turning off iOS predictive text / QuickType before typing it in, since the
// system keyboard can cache word fragments — a risk the original command-line script
// didn't have. The private key only ever exists transiently in memory during this run; it
// is never printed, logged, or written to any file. Only the resulting public addresses
// (and which derivation index produced each one) are saved.
//
// OUTPUT: two local files in Scriptable's own sandboxed folder (never iCloud):
//   1. "<name>.index-map.csv" — "index,address". Keep this ON THIS DEVICE, treat it like
//      your mnemonic backup. If you ever need to sweep/spend from a specific address,
//      you need its index to re-derive the matching key from this same mnemonic. Never
//      export this file.
//   2. "<name>.txt" — bare addresses, one per line. This is the file you export (via the
//      Share Sheet this script opens for you) and copy to the server, then run:
//        npm run import-pool -- solana <file>
//
// Large batches: ~20ms/address on a modern iPhone is a reasonable estimate (benchmarked
// at ~21ms/address on a laptop CPU; phones are usually comparable or a bit slower for
// BigInt-heavy JS). 2000 addresses ≈ under a minute. For 10,000, either be patient (several
// minutes, this script logs progress every 500) or run in 2–3 smaller batches, bumping
// START_INDEX each time, same convention as the server-side script.

// ========================= EDIT ME BEFORE EACH RUN =========================
const MNEMONIC = "REPLACE WITH YOUR 12-24 WORD MNEMONIC";
const START_INDEX = 0;
const COUNT = 10000;
const OUTPUT_NAME = "solana-addresses-batch1"; // no extension
// =============================================================================

// ---------- exact big-integer sqrt / cbrt (no floating point) — used only to build the
// SHA-512 constant tables below from their mathematical definition, so nothing here is a
// hand-copied magic number that could've been transcribed wrong. ----------
function bigintSqrt(n) {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
function bigintCbrt(n) {
  if (n < 2n) return n;
  let x = n, y = (2n * x + n / (x * x)) / 3n;
  while (y < x) { x = y; y = (2n * x + n / (x * x)) / 3n; }
  return x;
}
function firstPrimes(count) {
  const out = [];
  let n = 2n;
  while (out.length < count) {
    let isPrime = true;
    for (const p of out) {
      if (p * p > n) break;
      if (n % p === 0n) { isPrime = false; break; }
    }
    if (isPrime) out.push(n);
    n += 1n;
  }
  return out;
}

const MASK64 = (1n << 64n) - 1n;
const SHA512_H = firstPrimes(8).map((p) => bigintSqrt(p * (1n << 128n)) & MASK64);
const SHA512_K = firstPrimes(80).map((p) => bigintCbrt(p * (1n << 192n)) & MASK64);

// ---------- SHA-512 ----------
function rotr64(x, n) { return ((x >> n) | (x << (64n - n))) & MASK64; }
function shr64(x, n) { return x >> n; }

function sha512(messageBytes) {
  const msgLenBits = BigInt(messageBytes.length) * 8n;
  const padLen = (112 - ((messageBytes.length + 1) % 128) + 128) % 128;
  const padded = new Uint8Array(messageBytes.length + 1 + padLen + 16);
  padded.set(messageBytes, 0);
  padded[messageBytes.length] = 0x80;
  const lenView = new DataView(padded.buffer, padded.length - 16, 16);
  lenView.setBigUint64(8, msgLenBits, false);

  let H = SHA512_H.slice();
  const W = new Array(80);

  for (let offset = 0; offset < padded.length; offset += 128) {
    const block = new DataView(padded.buffer, padded.byteOffset + offset, 128);
    for (let t = 0; t < 16; t++) W[t] = block.getBigUint64(t * 8, false);
    for (let t = 16; t < 80; t++) {
      const s0 = rotr64(W[t - 15], 1n) ^ rotr64(W[t - 15], 8n) ^ shr64(W[t - 15], 7n);
      const s1 = rotr64(W[t - 2], 19n) ^ rotr64(W[t - 2], 61n) ^ shr64(W[t - 2], 6n);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) & MASK64;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 80; t++) {
      const S1 = rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n);
      const ch = (e & f) ^ (~e & g) & MASK64;
      const temp1 = (h + S1 + ch + SHA512_K[t] + W[t]) & MASK64;
      const S0 = rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) & MASK64;
      h = g; g = f; f = e; e = (d + temp1) & MASK64;
      d = c; c = b; b = a; a = (temp1 + temp2) & MASK64;
    }
    H = H.map((hv, i) => (hv + [a, b, c, d, e, f, g, h][i]) & MASK64);
  }

  const out = new Uint8Array(64);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setBigUint64(i * 8, H[i], false);
  return out;
}

function concatBytes(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// ---------- HMAC-SHA512 ----------
function hmacSha512(keyBytes, dataBytes) {
  const blockSize = 128;
  let key = keyBytes;
  if (key.length > blockSize) key = sha512(key);
  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(key, 0);

  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = paddedKey[i] ^ 0x5c;
    iKeyPad[i] = paddedKey[i] ^ 0x36;
  }

  const inner = sha512(concatBytes(iKeyPad, dataBytes));
  return sha512(concatBytes(oKeyPad, inner));
}

// ---------- PBKDF2-HMAC-SHA512 (BIP39 mnemonic -> seed, 2048 iterations) ----------
function pbkdf2Sha512(password, salt, iterations, dkLenBytes) {
  const hLen = 64;
  const numBlocks = Math.ceil(dkLenBytes / hLen);
  const out = new Uint8Array(numBlocks * hLen);

  for (let blockIndex = 1; blockIndex <= numBlocks; blockIndex++) {
    const blockNumBytes = new Uint8Array(4);
    new DataView(blockNumBytes.buffer).setUint32(0, blockIndex, false);
    let u = hmacSha512(password, concatBytes(salt, blockNumBytes));
    const t = u.slice();
    for (let i = 1; i < iterations; i++) {
      u = hmacSha512(password, u);
      for (let j = 0; j < hLen; j++) t[j] ^= u[j];
    }
    out.set(t, (blockIndex - 1) * hLen);
  }
  return out.slice(0, dkLenBytes);
}

function utf8Encode(str) {
  // BIP39 mnemonics are plain ASCII English words, so a byte-per-char encoder is safe.
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.codePointAt(i);
    if (code === undefined || code > 0x7f) {
      throw new Error("Mnemonic contains a non-ASCII character — check for a typo or stray character.");
    }
    out.push(code);
  }
  return new Uint8Array(out);
}

function mnemonicToSeed(mnemonic) {
  const normalized = mnemonic.trim().split(/\s+/).join(" ");
  return pbkdf2Sha512(utf8Encode(normalized), utf8Encode("mnemonic"), 2048, 64);
}

// ---------- SLIP-0010 ed25519 hardened derivation ----------
function ser32(i) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, i >>> 0, false);
  return b;
}
function slip10MasterKey(seed) {
  const I = hmacSha512(utf8Encode("ed25519 seed"), seed);
  return { kL: I.slice(0, 32), cL: I.slice(32, 64) };
}
function slip10ChildKey(kL, cL, index) {
  const hardenedIndex = (index + 0x80000000) >>> 0;
  const data = concatBytes(new Uint8Array([0]), kL, ser32(hardenedIndex));
  const I = hmacSha512(cL, data);
  return { kL: I.slice(0, 32), cL: I.slice(32, 64) };
}
function deriveSolanaSeedKey(seed, accountIndex) {
  let { kL, cL } = slip10MasterKey(seed);
  for (const segment of [44, 501, accountIndex, 0]) {
    ({ kL, cL } = slip10ChildKey(kL, cL, segment));
  }
  return kL; // standard Solana path m/44'/501'/i'/0' — same one Phantom/Solflare use
}

// ---------- ed25519 (RFC 8032) scalar mult by base point + point encode ----------
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

function scalarMultBase(scalar) {
  let result = IDENTITY;
  let addend = getBasePoint();
  let k = scalar;
  while (k > 0n) {
    if (k & 1n) result = pointAdd(result, addend);
    addend = pointDouble(addend);
    k >>= 1n;
  }
  return result;
}

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

function publicKeyFromSeed(seed32) {
  const h = sha512(seed32);
  const a = h.slice(0, 32);
  a[0] &= 248;
  a[31] &= 127;
  a[31] |= 64;
  const A = scalarMultBase(bytesToLEBigInt(a));
  return encodePoint(A);
}

// ---------- base58 (Bitcoin/Solana alphabet) ----------
const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58_ALPHABET[Number(n % 58n)] + out;
    n = n / 58n;
  }
  let leadingZeros = 0;
  for (const b of bytes) { if (b === 0) leadingZeros++; else break; }
  return "1".repeat(leadingZeros) + out;
}

function deriveSolanaAddress(seed, accountIndex) {
  const seedKey = deriveSolanaSeedKey(seed, accountIndex);
  return base58Encode(publicKeyFromSeed(seedKey));
}

// ========================= self-test: refuse to run on broken crypto =========================
function selfTest() {
  const testMnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const testSeed = mnemonicToSeed(testMnemonic);
  const KNOWN = {
    0: "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk",
    1: "Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb",
    999: "HGAXX19oLTt9eSUkZ2xAYGwMbVAJGaT3tW9FcFcu1F6d",
  };
  for (const idx of Object.keys(KNOWN)) {
    const got = deriveSolanaAddress(testSeed, Number(idx));
    if (got !== KNOWN[idx]) {
      throw new Error(
        `SELF-TEST FAILED at index ${idx}: got ${got}, expected ${KNOWN[idx]}. ` +
          `Something in this device's JS engine is producing different crypto output than expected — ` +
          `DO NOT trust any address from this run. Stop and get help before using this script.`,
      );
    }
  }
}

// ========================= main =========================
async function main() {
  selfTest();
  console.log("Self-test passed — crypto matches known-good vectors.\n");

  if (!MNEMONIC || MNEMONIC.startsWith("REPLACE")) {
    throw new Error("Edit MNEMONIC at the top of this script before running it.");
  }
  if (COUNT <= 0 || START_INDEX < 0) {
    throw new Error("START_INDEX must be >= 0 and COUNT must be a positive integer.");
  }

  const seed = mnemonicToSeed(MNEMONIC);
  const rows = [];
  const startedAt = Date.now();

  for (let i = 0; i < COUNT; i++) {
    const index = START_INDEX + i;
    rows.push({ index, address: deriveSolanaAddress(seed, index) });
    if ((i + 1) % 500 === 0 || i + 1 === COUNT) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`Generated ${i + 1}/${COUNT} (${elapsed}s elapsed)`);
    }
  }

  const fm = FileManager.local();
  const dir = fm.documentsDirectory();
  const addressesPath = fm.joinPath(dir, `${OUTPUT_NAME}.txt`);
  const indexMapPath = fm.joinPath(dir, `${OUTPUT_NAME}.index-map.csv`);

  fm.writeString(addressesPath, rows.map((r) => r.address).join("\n") + "\n");
  fm.writeString(indexMapPath, rows.map((r) => `${r.index},${r.address}`).join("\n") + "\n");

  console.log(`\nWrote ${rows.length} addresses.`);
  console.log(`Index map (keep ON THIS DEVICE, never export): ${indexMapPath}`);
  console.log(`Bare addresses (safe to export to the server): ${addressesPath}`);
  console.log("No private key was printed or written anywhere — it only existed transiently in memory during this run.\n");

  // Opens the native preview for the bare-addresses file, which has its own Share button
  // (AirDrop / Save to Files / Mail / etc.) for getting it off the phone. Deliberately NOT
  // offered for the index-map file — that one stays local.
  await QuickLook.present(addressesPath);
}

await main();
