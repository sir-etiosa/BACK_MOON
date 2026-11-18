// XCH is the internal token backing the naira wallet (minted 1:1 on a confirmed bank
// deposit, non-swappable for now) — users should never see the name "XCH" anywhere.
const DISPLAY_OVERRIDES: Record<string, string> = {
  XCH: "NGN",
};

export function displaySymbol(symbol: string): string {
  return DISPLAY_OVERRIDES[symbol] ?? symbol;
}
