"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  GraduationCap,
  Globe,
  Smartphone,
  Tv,
  Wifi,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/theme-toggle";
import { api, getToken, type Balance, type BillPaymentRequest, ApiError } from "@/lib/api";
import { fromSmallestUnits } from "@/lib/units";
import { displaySymbol } from "@/lib/display-symbol";
import { useLoading } from "@/components/loading-overlay";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { key: "airtime", label: "Airtime", icon: Smartphone },
  { key: "data", label: "Data", icon: Wifi },
  { key: "electricity", label: "Electricity", icon: Zap },
  { key: "cable", label: "Cable TV", icon: Tv },
  { key: "internet", label: "Internet", icon: Globe },
  { key: "school", label: "School fees", icon: GraduationCap },
];

export default function PayBillsPage() {
  const router = useRouter();
  const { show, hide } = useLoading();
  const [category, setCategory] = useState("electricity");
  const [meterNumber, setMeterNumber] = useState("");
  const [amount, setAmount] = useState("10000");
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [ngnRate, setNgnRate] = useState<number | null>(null);
  const [assetSymbol, setAssetSymbol] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedRequest, setSubmittedRequest] = useState<BillPaymentRequest | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    show();
    api
      .getBalances()
      .then((r) => {
        setBalances(r.balances);
        setNgnRate(r.ngnRate);
        const stable = r.balances.find((b) => b.symbol === "USDT") ?? r.balances.find((b) => b.symbol === "USDC");
        setAssetSymbol(stable?.symbol ?? r.balances[0]?.symbol ?? "");
      })
      .catch(() => router.push("/login"))
      .finally(hide);
  }, [router, show, hide]);

  // Combine balances by symbol — same convention as the swap page's "from" side.
  const symbols = (() => {
    const seen = new Set<string>();
    const list: { symbol: string; decimals: number }[] = [];
    for (const b of balances ?? []) {
      if (seen.has(b.symbol)) continue;
      seen.add(b.symbol);
      list.push({ symbol: b.symbol, decimals: b.decimals });
    }
    return list;
  })();
  const selectedSymbol = symbols.find((s) => s.symbol === assetSymbol);

  const usdEquivalent = amount && ngnRate ? Number(amount) / ngnRate : null;

  async function handlePay() {
    if (!assetSymbol || !amount || Number(amount) <= 0) return;
    setError(null);
    setLoading(true);
    try {
      const { request } = await api.createBillRequest(amount, assetSymbol, category, meterNumber || undefined);
      setSubmittedRequest(request);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (submittedRequest) {
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
        <div className="bg-card border-border flex flex-col items-center gap-3 rounded-2xl border p-6 text-center">
          <h2 className="text-lg font-semibold">Bill payment queued</h2>
          <p className="text-muted-foreground text-sm">
            ₦{Number(submittedRequest.billAmountNgn).toLocaleString()} to {CATEGORIES.find((c) => c.key === submittedRequest.billerCategory)?.label ?? submittedRequest.billerCategory}
            {submittedRequest.billerRef ? ` (${submittedRequest.billerRef})` : ""} is queued for settlement. We&rsquo;ll
            notify you once it&rsquo;s paid.
          </p>
          <div className="bg-muted/50 mt-1 flex w-full flex-col gap-1.5 rounded-xl p-3 text-left text-sm">
            {submittedRequest.whtTokenAmount !== "0" && selectedSymbol && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">WHT withheld</span>
                <span>
                  {fromSmallestUnits(submittedRequest.whtTokenAmount, selectedSymbol.decimals)} {displaySymbol(assetSymbol)}
                </span>
              </div>
            )}
            {submittedRequest.feeNgnAmount !== "0" && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fee</span>
                <span>₦{Number(submittedRequest.feeNgnAmount).toLocaleString()}</span>
              </div>
            )}
            {submittedRequest.vatNgnAmount !== "0" && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">VAT</span>
                <span>₦{Number(submittedRequest.vatNgnAmount).toLocaleString()}</span>
              </div>
            )}
            <div className="border-border mt-1 flex justify-between border-t pt-1.5 font-semibold">
              <span>Charged</span>
              <span>
                {selectedSymbol ? fromSmallestUnits(submittedRequest.soldTokenAmount, selectedSymbol.decimals) : submittedRequest.soldTokenAmount} {displaySymbol(assetSymbol)}
              </span>
            </div>
          </div>
          <Button className="mt-2 h-11 w-full font-semibold" onClick={() => router.push("/dashboard")}>
            Back to dashboard
          </Button>
        </div>
      </div>
    );
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
        <h1 className="text-2xl font-bold tracking-tight">Pay bills.</h1>
        <p className="text-muted-foreground text-sm">Pay straight from your crypto balance. WHT/fee/VAT apply per the active tax rules.</p>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {CATEGORIES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setCategory(key)}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-xl border px-1 py-3 text-xs font-semibold transition-colors",
              category === key ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-accent",
            )}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </div>

      <div className="bg-card border-border flex flex-col gap-3 rounded-2xl border p-[18px]">
        <div className="flex flex-col gap-1">
          <span className="label-eyebrow">Provider</span>
          <div className="border-border bg-background flex h-11 items-center rounded-lg border px-3 text-sm">
            Ikeja Electric · Prepaid
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="label-eyebrow">Meter number</span>
          <Input
            value={meterNumber}
            onChange={(e) => setMeterNumber(e.target.value)}
            placeholder="Enter meter number"
            className="h-11"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="label-eyebrow">Amount</span>
          <Input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
            className="h-11"
          />
          {assetSymbol === "XCH" ? (
            <span className="text-muted-foreground text-xs">Paid from your NGN balance, plus fee/VAT — exact amount shown after you submit</span>
          ) : (
            usdEquivalent !== null &&
            selectedSymbol && (
              <span data-numeric className="text-muted-foreground font-mono text-xs">
                ≈ {usdEquivalent.toFixed(2)} {displaySymbol(assetSymbol)} (before tax/fee — exact amount charged shown after you submit)
              </span>
            )
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="label-eyebrow">Pay with</span>
          <Select value={assetSymbol} onValueChange={(v) => setAssetSymbol(v ?? "")}>
            <SelectTrigger className="h-11">
              <SelectValue placeholder="Choose asset" />
            </SelectTrigger>
            <SelectContent>
              {symbols.map((s) => (
                <SelectItem key={s.symbol} value={s.symbol}>
                  {displaySymbol(s.symbol)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <Button
          className="h-11 font-semibold"
          disabled={loading || !assetSymbol || !amount || Number(amount) <= 0}
          onClick={handlePay}
        >
          {loading ? "Paying..." : `Pay ₦${amount ? Number(amount).toLocaleString("en-US") : "0"}`}
        </Button>
      </div>
    </div>
  );
}
