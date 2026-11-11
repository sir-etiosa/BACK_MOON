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

export default function SwapPage() {
  const router = useRouter();
  const { show, hide } = useLoading();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [fromId, setFromId] = useState<string>("");
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

  const fromAsset = balances?.find((b) => b.id === fromId);
  const toAsset = balances?.find((b) => b.id === toId);

  async function handleSwap(e: React.FormEvent) {
    e.preventDefault();
    if (!fromAsset || !toAsset) return;
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const smallest = toSmallestUnits(amount, fromAsset.decimals);
      const { amountTo } = await api.swap(fromId, smallest, toId);
      setSuccess(`Swapped ${amount} ${fromAsset.symbol} for ${fromSmallestUnits(amountTo, toAsset.decimals)} ${toAsset.symbol}`);
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
              <Select value={fromId} onValueChange={(v) => setFromId(v ?? "")}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Select asset">
                    {(value: string | null) => balances.find((b) => b.id === value)?.symbol ?? "Select asset"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {balances.map((b) => (
                    <SelectItem key={b.id} value={b.id} disabled={b.id === toId}>
                      {b.symbol} ({fromSmallestUnits(b.balance, b.decimals)} available)
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
                    {(value: string | null) => balances.find((b) => b.id === value)?.symbol ?? "Select asset"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {balances.map((b) => (
                    <SelectItem key={b.id} value={b.id} disabled={b.id === fromId}>
                      {b.symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="amount">Amount ({fromAsset?.symbol ?? "—"})</Label>
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

            <Button type="submit" disabled={loading || !fromId || !toId || !amount} className="h-11 font-semibold">
              {loading ? "Swapping..." : "Swap"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
