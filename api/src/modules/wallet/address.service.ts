import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import {
  deriveEvmAddress,
  deriveTronAddress,
  deriveBtcAddress,
  deriveLtcAddress,
} from "../../chains/address-derivation.js";

const XPUB_DERIVERS: Record<string, (xpub: string, index: number) => string> = {
  evm: deriveEvmAddress,
  tron: deriveTronAddress,
  bitcoin: deriveBtcAddress,
  litecoin: deriveLtcAddress,
};

export const ALL_CHAINS = ["evm", "tron", "bitcoin", "litecoin", "solana", "monero"] as const;

async function findExistingAddress(userId: string, chain: string) {
  return prisma.userAddress.findUnique({ where: { userId_chain: { userId, chain } } });
}

/** xpub chains: atomically claim the next derivation index, then derive the address from public key material only. */
async function issueXpubAddress(userId: string, chain: string) {
  const deriver = XPUB_DERIVERS[chain];
  if (!deriver) throw new Error(`${chain} is not an xpub-based chain`);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.userAddress.findUnique({ where: { userId_chain: { userId, chain } } });
    if (existing) return existing;

    const rows = await tx.$queryRaw<{ xpub: string | null; next_index: number }[]>`
      UPDATE chain_configs SET next_index = next_index + 1
      WHERE chain = ${chain}
      RETURNING xpub, next_index
    `;
    const row = rows[0];
    if (!row) throw new Error(`No chain_config row for ${chain} — run the seed script`);
    if (!row.xpub) {
      throw new Error(
        `No xpub loaded for ${chain} yet — run the seed-generation runbook, then \`npm run load-xpubs\``,
      );
    }
    const index = row.next_index - 1;
    const address = deriver(row.xpub, index);

    return tx.userAddress.create({ data: { userId, chain, derivationIndex: index, address } });
  });
}

/**
 * Pool-based chains: Solana (ed25519 can't do public-only derivation) and Monero (not BIP32 at
 * all — real subaddress minting needs a live view-only wallet-rpc we haven't deployed yet).
 * Both draw from a pre-generated batch of addresses instead of deriving on demand. For Monero
 * specifically this means deposit addresses work today; detecting/crediting deposits on that
 * chain stays a manual, paused process until wallet-rpc is deployed — intentional for now.
 */
async function issuePoolAddress(userId: string, chain: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.userAddress.findUnique({ where: { userId_chain: { userId, chain } } });
    if (existing) return existing;

    const claimed = await tx.$queryRaw<{ id: string; address: string }[]>`
      UPDATE address_pool SET assigned_user_id = ${userId}, assigned_at = now()
      WHERE id = (
        SELECT id FROM address_pool
        WHERE chain = ${chain} AND assigned_user_id IS NULL
        LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, address
    `;
    const row = claimed[0];
    if (!row) {
      throw new Error(`${chain} address pool is exhausted — run the pre-generation script to top it up`);
    }

    const rows = await tx.$queryRaw<{ next_index: number }[]>`
      UPDATE chain_configs SET next_index = next_index + 1 WHERE chain = ${chain} RETURNING next_index
    `;
    const index = rows[0].next_index - 1;

    return tx.userAddress.create({
      data: { userId, chain, derivationIndex: index, address: row.address },
    });
  });
}

const POOL_CHAINS = new Set(["solana", "monero"]);

export async function issueAddress(userId: string, chain: string) {
  if (POOL_CHAINS.has(chain)) return issuePoolAddress(userId, chain);
  return issueXpubAddress(userId, chain);
}

export interface AddressResult {
  chain: string;
  address: string | null;
  error: string | null;
}

/** Idempotent: issues whatever's missing, leaves existing addresses untouched, never throws per-chain. */
export async function issueAllAddressesForUser(userId: string): Promise<AddressResult[]> {
  const results: AddressResult[] = [];
  for (const chain of ALL_CHAINS) {
    try {
      const existing = await findExistingAddress(userId, chain);
      const row = existing ?? (await issueAddress(userId, chain));
      results.push({ chain, address: row.address, error: null });
    } catch (err) {
      results.push({ chain, address: null, error: (err as Error).message });
    }
  }
  return results;
}
