"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ArrowUpRight,
  Banknote,
  Eye,
  EyeOff,
  Home,
  MoreHorizontal,
  Receipt,
  Settings,
  Wallet,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import { useBalanceVisibility } from "@/components/balance-visibility";
import { api, getToken, clearToken, markExplicitLogout, type Balance, type Withdrawal } from "@/lib/api";
import { fromSmallestUnits } from "@/lib/units";
import { cn } from "@/lib/utils";

const ASSET_COLOR: Record<string, string> = {
  BTC: "bg-[#ffd24a] text-[#0b0818]",
  ETH: "bg-[#9d5cff] text-white",
  LTC: "bg-[#a69cc4] text-[#0b0818]",
  SOL: "bg-[#4ed9a4] text-[#0b0818]",
  XMR: "bg-[#f2705f] text-white",
  USDT: "bg-[#4ed9a4] text-[#0b0818]",
};

const QUICK_ACTIONS = [
  { href: "/buy", label: "Buy", icon: Wallet },
  { href: "/deposit", label: "Deposit", icon: ArrowDownToLine },
  { href: "/swap", label: "Swap", icon: ArrowLeftRight },
  { href: "/pay", label: "Bills", icon: Receipt },
  { href: "/more", label: "More", icon: MoreHorizontal },
] as const;

const FOOTER_NAV = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/cashout", label: "Cash out", icon: Banknote },
  { href: "/pay", label: "Pay", icon: Receipt },
  { href: "/more", label: "More", icon: MoreHorizontal },
] as const;

const STATUS_LABEL: Record<Withdrawal["status"], { text: string; className: string }> = {
  PENDING: { text: "Pending", className: "text-muted-foreground" },
  APPROVED: { text: "Pending", className: "text-muted-foreground" },
  SENT: { text: "Completed", className: "text-[#4ed9a4]" },
  CONFIRMED: { text: "Completed", className: "text-[#4ed9a4]" },
  REJECTED: { text: "Rejected", className: "text-[#f2705f]" },
};

function formatUsd(value: number): { whole: string; cents: string } {
  const [whole, cents] = value.toFixed(2).split(".");
  return { whole: Number(whole).toLocaleString("en-US"), cents };
}

function formatActivityDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `Today, ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function DashboardPage() {
  const router = useRouter();
  const { hidden: balancesHidden, toggle: toggleBalancesHidden } = useBalanceVisibility();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [ngnRate, setNgnRate] = useState<number | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[] | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api
      .getBalances()
      .then((r) => {
        setBalances(r.balances);
        setNgnRate(r.ngnRate);
      })
      .catch(() => {
        clearToken();
        router.push("/login");
      });
    api.getWithdrawals().then((r) => setWithdrawals(r.withdrawals.slice(0, 5)));
  }, [router]);

  function handleLogout() {
    api.logout().finally(() => {
      clearToken();
      markExplicitLogout();
      router.push("/login");
    });
  }

  const totalUsd = balances?.reduce((sum, b) => sum + (b.usdValue ? Number(b.usdValue) : 0), 0) ?? null;
  const totalNgn = totalUsd !== null && ngnRate !== null ? totalUsd * ngnRate : null;
  const nonZeroBalances = balances?.filter((b) => b.balance !== "0") ?? [];
  const assetById = new Map((balances ?? []).map((b) => [b.id, b]));

  // One row per symbol even when it spans multiple chains (e.g. ETH on Ethereum + Base).
  const groupedBalances = (() => {
    const map = new Map<string, { symbol: string; decimals: number; balance: string; usdValue: number | null }>();
    for (const b of balances ?? []) {
      const existing = map.get(b.symbol);
      if (!existing) {
        map.set(b.symbol, { symbol: b.symbol, decimals: b.decimals, balance: b.balance, usdValue: b.usdValue ? Number(b.usdValue) : null });
      } else {
        existing.balance = (BigInt(existing.balance) + BigInt(b.balance)).toString();
        if (b.usdValue) existing.usdValue = (existing.usdValue ?? 0) + Number(b.usdValue);
      }
    }
    return [...map.values()];
  })();

  return (
    <>
    <div className="mx-auto flex w-full min-h-screen max-w-md flex-col gap-7 px-5 pt-6 pb-24">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="" width={42} height={42} className="rounded-md" />
          <span className="text-sm font-bold tracking-tight">
            Moon<span className="text-primary">Xch</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="destructive" size="xs" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </div>

      <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="label-eyebrow">Total balance</span>
            <button
              type="button"
              onClick={toggleBalancesHidden}
              aria-label={balancesHidden ? "Show balances" : "Hide balances"}
              className="text-muted-foreground hover:text-foreground"
            >
              {balancesHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
          <Link href="/settings" aria-label="Settings" className={buttonVariants({ variant: "ghost", size: "icon-lg" })}>
            <Settings className="size-6" />
          </Link>
        </div>
        {totalUsd === null ? (
          <Skeleton className="h-10 w-40" />
        ) : balancesHidden ? (
          <div className="font-mono text-4xl font-bold tracking-tight">***</div>
        ) : (
          <>
            <div data-numeric className="flex items-baseline font-mono text-4xl font-bold tracking-tight">
              <span>${formatUsd(totalUsd).whole}</span>
              <span>.{formatUsd(totalUsd).cents}</span>
            </div>
            {totalNgn !== null && (
              <span data-numeric className="text-muted-foreground font-mono text-sm">
                ≈ ₦{totalNgn.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </span>
            )}
          </>
        )}
      </section>

      {nonZeroBalances.length > 0 && (
        <div className="-mt-4 flex flex-wrap gap-2">
          {nonZeroBalances.map((b) => (
            <div
              key={b.id}
              className="bg-card border-border flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium"
            >
              <span className={cn("size-1.5 rounded-full", ASSET_COLOR[b.symbol]?.split(" ")[0] ?? "bg-muted-foreground")} />
              {b.symbol} {balancesHidden ? "***" : fromSmallestUnits(b.balance, b.decimals)}
            </div>
          ))}
        </div>
      )}

      <div className="bg-card border-border -mt-4 flex flex-col gap-3 rounded-2xl border p-[18px]">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-semibold">Cash out to your bank</h2>
        </div>
        {ngnRate !== null && (
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span className="relative flex size-1.5">
              <span className="bg-primary absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
              <span className="bg-primary relative inline-flex size-1.5 rounded-full" />
            </span>
            1 USDT ≈ ₦{ngnRate.toLocaleString("en-US", { maximumFractionDigits: 0 })} ·{" "}
            <span className="animate-pulse font-medium text-green-600 dark:text-green-500">Live rate</span>
          </div>
        )}
        <Link href="/cashout" className={buttonVariants({ className: "h-11 justify-between font-semibold" })}>
          Cash out now
          <ArrowUpRight className="size-4" />
        </Link>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {QUICK_ACTIONS.map(({ href, label, icon: Icon }) => (
          <Link
            key={label}
            href={href}
            className={buttonVariants({
              variant: "secondary",
              className: "h-auto flex-col gap-1.5 px-1 py-3 text-xs font-semibold",
            })}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        ))}
      </div>

      <section className="flex flex-col gap-1">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="label-eyebrow">Recent activity</h2>
          <Link href="/activity" className="text-primary text-xs font-medium">
            See all
          </Link>
        </div>
        <div className="bg-card border-border rounded-2xl border px-4">
          {!withdrawals ? (
            <div className="flex flex-col gap-px py-1">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : withdrawals.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">No activity yet.</p>
          ) : (
            withdrawals.map((w, i) => {
              const asset = assetById.get(w.assetId);
              const status = STATUS_LABEL[w.status];
              return (
                <div
                  key={w.id}
                  className={cn(
                    "hover:bg-accent -mx-4 flex items-center gap-3 px-4 py-3 transition-colors",
                    i > 0 && "border-border border-t",
                  )}
                >
                  <div className="bg-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                    <ArrowUpFromLine className="text-muted-foreground size-4" />
                  </div>
                  <div className="flex flex-1 items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">Withdraw {asset?.symbol ?? ""}</span>
                      <span className="text-muted-foreground text-xs">{formatActivityDate(w.requestedAt)}</span>
                    </div>
                    <div data-numeric className="flex flex-col items-end">
                      <span className="font-mono text-sm">
                        -{asset ? fromSmallestUnits(w.amount, asset.decimals) : w.amount}
                      </span>
                      <span className={cn("text-xs", status.className)}>{status.text}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="label-eyebrow">Balances</h2>
          <Link href="/withdraw" className="text-primary flex items-center gap-1 text-xs font-medium">
            <ArrowUpFromLine className="size-3" />
            Withdraw
          </Link>
        </div>
        <div className="bg-card border-border rounded-2xl border px-4">
          {!balances ? (
            <div className="flex flex-col gap-px py-1">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : (
            groupedBalances.map((b, i) => (
              <Link
                key={b.symbol}
                href={`/asset/${b.symbol}`}
                className={cn(
                  "hover:bg-accent -mx-4 flex items-center gap-3 px-4 py-3 transition-colors",
                  i > 0 && "border-border border-t",
                )}
              >
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold",
                    ASSET_COLOR[b.symbol] ?? "bg-muted text-muted-foreground",
                  )}
                >
                  {b.symbol.slice(0, 1)}
                </div>
                <div className="flex flex-1 items-center justify-between">
                  <span className="font-medium">{b.symbol}</span>
                  <div data-numeric className="flex flex-col items-end">
                    <span className="font-mono text-sm">
                      {balancesHidden ? "***" : fromSmallestUnits(b.balance, b.decimals)}
                    </span>
                    {b.usdValue !== null && (
                      <span className="text-muted-foreground font-mono text-xs">
                        {balancesHidden ? "***" : `$${b.usdValue.toFixed(2)}`}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </div>

    <nav
      aria-label="Main"
      className="bg-card border-border fixed inset-x-0 bottom-0 border-t"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 18px)" }}
    >
      <div className="mx-auto flex max-w-md items-stretch justify-between px-2 pt-2">
        {FOOTER_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className="text-primary hover:bg-accent flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 transition-colors"
            >
              <Icon className="size-5" />
              <span className="text-[11px] font-semibold">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
    </>
  );
}
