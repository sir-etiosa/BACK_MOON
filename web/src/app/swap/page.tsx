"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, getToken, type Balance, ApiError } from "@/lib/api";
import { fromSmallestUnits, toSmallestUnits } from "@/lib/units";

export default function SwapPage() {
  const router = useRouter();
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
    api
      .getBalances()
      .then((r) => setBalances(r.balances))
      .catch(() => router.push("/login"));
  }, [router]);

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
    <div className="mx-auto flex max-w-sm flex-col gap-4 p-4 pt-8">
      <Link href="/dashboard" className={buttonVariants({ variant: "ghost", size: "sm", className: "w-fit" })}>
        &larr; Back
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Swap</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {success && (
            <Alert className="mb-4">
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          {!balances ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : (
            <form onSubmit={handleSwap} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>From</Label>
                <Select value={fromId} onValueChange={(v) => setFromId(v ?? "")}>
                  <SelectTrigger className="w-full">
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

              <div className="flex flex-col gap-2">
                <Label>To</Label>
                <Select value={toId} onValueChange={(v) => setToId(v ?? "")}>
                  <SelectTrigger className="w-full">
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

              <div className="flex flex-col gap-2">
                <Label htmlFor="amount">Amount ({fromAsset?.symbol ?? "—"})</Label>
                <Input
                  id="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>

              <Button type="submit" disabled={loading || !fromId || !toId || !amount} className="w-full">
                {loading ? "Swapping..." : "Swap"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
