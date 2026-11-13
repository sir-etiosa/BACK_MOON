// Maps a symbol to the networks it can be deposited/held on. `assetChain` is the Asset.chain
// value (how the ledger tracks/watches that balance); `addressChain` is the UserAddress.chain
// value (which deposit address to show) — these differ for Base, which shares its address with
// Ethereum mainnet (same xpub/derivation) but is tracked as a distinct Asset for the watcher.
export interface AssetNetwork {
  label: string;
  assetChain: string;
  addressChain: string;
}

export const ASSET_NETWORKS: Record<string, AssetNetwork[]> = {
  USDT: [{ label: "Tron (TRC20)", assetChain: "tron", addressChain: "tron" }],
  USDC: [
    { label: "Ethereum (ERC20)", assetChain: "evm", addressChain: "evm" },
    { label: "Base", assetChain: "base", addressChain: "evm" },
  ],
  ETH: [
    { label: "Ethereum", assetChain: "evm", addressChain: "evm" },
    { label: "Base", assetChain: "base", addressChain: "evm" },
  ],
  BTC: [{ label: "Bitcoin", assetChain: "bitcoin", addressChain: "bitcoin" }],
  LTC: [{ label: "Litecoin", assetChain: "litecoin", addressChain: "litecoin" }],
  SOL: [{ label: "Solana", assetChain: "solana", addressChain: "solana" }],
  XMR: [{ label: "Monero", assetChain: "monero", addressChain: "monero" }],
};

/** Best-effort fallback for a symbol/chain combo with no explicit entry above. */
export function networksForSymbol(symbol: string, fallbackChain: string): AssetNetwork[] {
  return (
    ASSET_NETWORKS[symbol] ?? [
      { label: fallbackChain.charAt(0).toUpperCase() + fallbackChain.slice(1), assetChain: fallbackChain, addressChain: fallbackChain },
    ]
  );
}

/** Human label for one specific Asset.chain value of a symbol — e.g. ("ETH", "base") -> "Base". */
export function networkLabel(symbol: string, assetChain: string): string {
  const match = networksForSymbol(symbol, assetChain).find((n) => n.assetChain === assetChain);
  return match?.label ?? assetChain.charAt(0).toUpperCase() + assetChain.slice(1);
}
