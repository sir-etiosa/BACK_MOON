"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
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
import { ThemeToggle } from "@/components/theme-toggle";
import { api, getToken } from "@/lib/api";
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
  const [ngnRate, setNgnRate] = useState<number | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    show();
    api
      .getBalances()
      .then((r) => setNgnRate(r.ngnRate))
      .catch(() => router.push("/login"))
      .finally(hide);
  }, [router, show, hide]);

  function notifyComingSoon() {
    toast.info("Pay bills is coming soon");
  }

  const usdtEquivalent = amount && ngnRate ? Number(amount) / ngnRate : null;

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
        <p className="text-muted-foreground text-sm">Pay straight from your USDT or USDC. No cash out needed.</p>
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
          {usdtEquivalent !== null && (
            <span data-numeric className="text-muted-foreground font-mono text-xs">
              ≈ {usdtEquivalent.toFixed(2)} USDT
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="label-eyebrow">Pay with</span>
          <div className="border-border bg-background flex h-11 items-center rounded-lg border px-3 text-sm">
            USDT
          </div>
        </div>

        <Button className="h-11 font-semibold" onClick={notifyComingSoon}>
          Pay ₦{amount ? Number(amount).toLocaleString("en-US") : "0"}
        </Button>
      </div>
    </div>
  );
}
