"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, getToken, type Balance, ApiError } from "@/lib/api";
import { fromSmallestUnits, toSmallestUnits } from "@/lib/units";

export default function WithdrawPage() {
  const router = useRouter();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function refresh() {
    return api.getBalances().then((b) => setBalances(b.balances));
  }

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    refresh().catch(() => router.push("/login"));
  }, [router]);

  const asset = balances?.find((b) => b.id === assetId);

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    if (!asset) return;
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const smallest = toSmallestUnits(amount, asset.decimals);
      await api.requestWithdrawal(assetId, smallest, toAddress);
      setSuccess("Withdrawal requested — it's queued for manual processing.");
      setAmount("");
      setToAddress("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 p-4 pt-4">
      <Link
        href="/dashboard"
        aria-label="Back"
        className="bg-primary text-primary-foreground -ml-1.5 flex h-9 w-9 items-center justify-center rounded-full"
      >
        <ArrowLeft className="size-4" />
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Withdraw</CardTitle>
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
            <form onSubmit={handleWithdraw} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>Asset</Label>
                <Select value={assetId} onValueChange={(v) => setAssetId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select asset">
                      {(value: string | null) => balances.find((b) => b.id === value)?.symbol ?? "Select asset"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {balances.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.symbol} ({fromSmallestUnits(b.balance, b.decimals)} available)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="amount">Amount ({asset?.symbol ?? "—"})</Label>
                <Input
                  id="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="toAddress">Destination address</Label>
                <Input
                  id="toAddress"
                  placeholder="Paste the destination address"
                  value={toAddress}
                  onChange={(e) => setToAddress(e.target.value)}
                  required
                />
              </div>

              <Button type="submit" disabled={loading || !assetId || !amount || !toAddress} className="w-full">
                {loading ? "Requesting..." : "Request withdrawal"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
