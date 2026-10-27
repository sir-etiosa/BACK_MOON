// This file gets bundled into a single dependency-free script for Scriptable (iOS).
// See npm run bundle-phone-script. Do not run this .ts file directly with real key material.

// Scriptable's JS engine (JavaScriptCore) isn't guaranteed to expose these — polyfill them
// so the bundle can't fail with a missing-global error on-device. UTF-8 only, which is all
// BIP39 (English wordlist, ASCII) needs.
if (typeof (globalThis as any).TextEncoder === "undefined") {
  (globalThis as any).TextEncoder = class {
    encode(str: string): Uint8Array {
      const bytes: number[] = [];
      for (let i = 0; i < str.length; i++) {
        let code = str.codePointAt(i)!;
        if (code > 0xffff) i++;
        if (code < 0x80) bytes.push(code);
        else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        else if (code < 0x10000)
          bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        else
          bytes.push(
            0xf0 | (code >> 18),
            0x80 | ((code >> 12) & 0x3f),
            0x80 | ((code >> 6) & 0x3f),
            0x80 | (code & 0x3f),
          );
      }
      return new Uint8Array(bytes);
    }
  };
}
if (typeof (globalThis as any).TextDecoder === "undefined") {
  (globalThis as any).TextDecoder = class {
    decode(bytes: Uint8Array): string {
      let out = "";
      let i = 0;
      while (i < bytes.length) {
        const b0 = bytes[i];
        let codePoint: number;
        let len: number;
        if (b0 < 0x80) {
          codePoint = b0;
          len = 1;
        } else if ((b0 & 0xe0) === 0xc0) {
          codePoint = b0 & 0x1f;
          len = 2;
        } else if ((b0 & 0xf0) === 0xe0) {
          codePoint = b0 & 0x0f;
          len = 3;
        } else {
          codePoint = b0 & 0x07;
          len = 4;
        }
        for (let j = 1; j < len; j++) codePoint = (codePoint << 6) | (bytes[i + j] & 0x3f);
        out += String.fromCodePoint(codePoint);
        i += len;
      }
      return out;
    }
  };
}

import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";

// EDIT THIS before running on your phone — paste your real mnemonic here, run once, then
// delete it from this file / close Scriptable without saving if you're on a shared device.
const MNEMONIC = "REPLACE_WITH_YOUR_MNEMONIC";

function run() {
  if (MNEMONIC === "REPLACE_WITH_YOUR_MNEMONIC") {
    console.log("Edit the MNEMONIC constant at the top of this script first.");
    return;
  }
  if (!validateMnemonic(MNEMONIC, wordlist)) {
    console.log("That doesn't look like a valid BIP39 mnemonic — check the words/checksum.");
    return;
  }

  const seed = mnemonicToSeedSync(MNEMONIC);
  const master = HDKey.fromMasterSeed(seed);

  const chains: { coinType: number; envVar: string }[] = [
    { coinType: 60, envVar: "EVM_XPUB" },
    { coinType: 195, envVar: "TRON_XPUB" },
    { coinType: 2, envVar: "LTC_XPUB" },
    { coinType: 0, envVar: "BTC_XPUB" },
  ];

  const lines = chains.map(({ coinType, envVar }) => {
    const node = master.derive(`m/44'/${coinType}'/0'/0`);
    return `${envVar}="${node.publicExtendedKey}"`;
  });
  const output = lines.join("\n");

  console.log("Copy these lines into api/.env on your laptop, replacing the test-only xpubs:\n");
  console.log(output);

  // Scriptable-only API — copies straight to the iOS clipboard so there's nothing to
  // manually select off the console. Guarded so this still runs fine under plain Node
  // (e.g. when verifying the bundle) where Pasteboard doesn't exist.
  if (typeof (globalThis as any).Pasteboard !== "undefined") {
    (globalThis as any).Pasteboard.copy(output);
    console.log("\n(Copied to your clipboard — just paste it wherever you need it.)");
  }
}

run();
