"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/theme-toggle";
import { api, getToken, type Balance, ApiError } from "@/lib/api";
import { fromSmallestUnits, toSmallestUnits } from "@/lib/units";
import { useLoading } from "@/components/loading-overlay";
import { networkLabel } from "@/lib/asset-networks";

export default function SwapPage() {
  const router = useRouter();
  const { show, hide } = useLoading();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [fromSymbol, setFromSymbol] = useState<string>("");
  const [toId, setToId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    show();
    api
      .getBalances()
      .then((r) => setBalances(r.balances))
      .catch(() => router.push("/login"))
      .finally(hide);
  }, [router, show, hide]);

  // "From" is combined across chains — one symbol, one spendable total. "To" stays per-chain
  // since that's choosing exactly where the new funds land.
  const fromGroups = (() => {
    const map = new Map<string, { symbol: string; decimals: number; balance: string }>();
    for (const b of balances ?? []) {
      const existing = map.get(b.symbol);
      if (!existing) map.set(b.symbol, { symbol: b.symbol, decimals: b.decimals, balance: b.balance });
      else existing.balance = (BigInt(existing.balance) + BigInt(b.balance)).toString();
    }
    return [...map.values()];
  })();
  const fromGroup = fromGroups.find((g) => g.symbol === fromSymbol);
  const toAsset = balances?.find((b) => b.id === toId);

  const symbolCounts = new Map<string, number>();
  for (const b of balances ?? []) symbolCounts.set(b.symbol, (symbolCounts.get(b.symbol) ?? 0) + 1);
  function displayLabel(b: Balance): string {
    return (symbolCounts.get(b.symbol) ?? 0) > 1 ? `${b.symbol} · ${networkLabel(b.symbol, b.chain)}` : b.symbol;
  }

  async function handleSwap(e: React.FormEvent) {
    e.preventDefault();
    if (!fromGroup || !toAsset) return;
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const smallest = toSmallestUnits(amount, fromGroup.decimals);
      const { amountTo } = await api.swap(fromSymbol, smallest, toId);
      setSuccess(`Swapped ${amount} ${fromGroup.symbol} for ${fromSmallestUnits(amountTo, toAsset.decimals)} ${toAsset.symbol}`);
      setAmount("");
      const refreshed = await api.getBalances();
      setBalances(refreshed.balances);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full min-h-screen max-w-sm flex-col gap-6 px-5 pt-4 pb-16">
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard"
          aria-label="Back"
          className="bg-primary text-primary-foreground -ml-1.5 flex h-9 w-9 items-center justify-center rounded-full"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <ThemeToggle />
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Swap.</h1>
        <p className="text-muted-foreground text-sm">Trade one asset for another at the live rate.</p>
      </div>

      <div className="bg-card border-border flex flex-col gap-3 rounded-2xl border p-[18px]">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        {!balances ? (
          <p className="text-muted-foreground text-sm">Loading...</p>
        ) : (
          <form onSubmit={handleSwap} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label>From</Label>
              <Select value={fromSymbol} onValueChange={(v) => setFromSymbol(v ?? "")}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Select asset">
                    {(value: string | null) => fromGroups.find((g) => g.symbol === value)?.symbol ?? "Select asset"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {fromGroups.map((g) => (
                    <SelectItem key={g.symbol} value={g.symbol}>
                      {g.symbol} ({fromSmallestUnits(g.balance, g.decimals)} available)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label>To</Label>
              <Select value={toId} onValueChange={(v) => setToId(v ?? "")}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Select asset">
                    {(value: string | null) => {
                      const b = balances.find((b) => b.id === value);
                      return b ? displayLabel(b) : "Select asset";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {balances.map((b) => (
                    <SelectItem key={b.id} value={b.id} disabled={b.symbol === fromSymbol}>
                      {displayLabel(b)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="amount">Amount ({fromGroup?.symbol ?? "—"})</Label>
              <Input
                id="amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-11"
                required
              />
            </div>

            <Button type="submit" disabled={loading || !fromSymbol || !toId || !amount} className="h-11 font-semibold">
              {loading ? "Swapping..." : "Swap"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
