"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ArrowUpRight,
  Banknote,
  Bell,
  Home,
  MoreHorizontal,
  Receipt,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
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
  { href: "/deposit", label: "Deposit", icon: ArrowDownToLine },
  { href: "/swap", label: "Swap", icon: ArrowLeftRight },
  { label: "Pay bills", icon: Receipt, comingSoon: true },
  { label: "Trade & more", icon: MoreHorizontal, comingSoon: true },
] as const;

const FOOTER_NAV = [
  { href: "/dashboard", label: "Home", icon: Home },
  { label: "Cash out", icon: Banknote, comingSoon: true },
  { label: "Pay", icon: Receipt, comingSoon: true },
  { label: "More", icon: MoreHorizontal, comingSoon: true },
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

  function notifyComingSoon(feature: string) {
    toast.info(`${feature} is coming soon`);
  }

  const totalUsd = balances?.reduce((sum, b) => sum + (b.usdValue ? Number(b.usdValue) : 0), 0) ?? null;
  const totalNgn = totalUsd !== null && ngnRate !== null ? totalUsd * ngnRate : null;
  const nonZeroBalances = balances?.filter((b) => b.balance !== "0") ?? [];
  const assetById = new Map((balances ?? []).map((b) => [b.id, b]));

  return (
    <>
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-7 px-5 pt-6 pb-24">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="" width={28} height={28} className="rounded-md" />
          <span className="text-sm font-bold tracking-tight">MOONXCH</span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon-sm" aria-label="Notifications" onClick={() => notifyComingSoon("Notifications")}>
            <Bell className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </div>

      <section className="flex flex-col gap-1">
        <span className="label-eyebrow">Total balance</span>
        {totalUsd === null ? (
          <Skeleton className="h-10 w-40" />
        ) : (
          <>
            <div data-numeric className="flex items-baseline font-mono text-4xl font-bold tracking-tight">
              <span>${formatUsd(totalUsd).whole}</span>
              <span className="text-muted-foreground text-2xl">.{formatUsd(totalUsd).cents}</span>
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
        <div className="flex flex-wrap gap-2">
          {nonZeroBalances.map((b) => (
            <div
              key={b.id}
              className="bg-card border-border flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium"
            >
              <span className={cn("size-1.5 rounded-full", ASSET_COLOR[b.symbol]?.split(" ")[0] ?? "bg-muted-foreground")} />
              {b.symbol} {fromSmallestUnits(b.balance, b.decimals)}
            </div>
          ))}
        </div>
      )}

      <div className="bg-card border-border flex flex-col gap-3 rounded-2xl border p-[18px]">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-semibold">Cash out to your bank</h2>
          <p className="text-muted-foreground text-sm">Crypto & stables to naira — launching soon.</p>
        </div>
        {ngnRate !== null && (
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span className="bg-primary size-1.5 rounded-full" />1 USDT ≈ ₦{ngnRate.toLocaleString("en-US", { maximumFractionDigits: 0 })} · Live rate
          </div>
        )}
        <Button className="h-11 justify-between font-semibold" onClick={() => notifyComingSoon("Cash-out")}>
          Cash out now
          <ArrowUpRight className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-2.5">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          const className = buttonVariants({
            variant: "secondary",
            className: "h-auto flex-col gap-1.5 px-1 py-3 text-xs font-semibold",
          });
          if ("href" in action) {
            return (
              <Link key={action.label} href={action.href} className={className}>
                <Icon className="size-5" />
                {action.label}
              </Link>
            );
          }
          return (
            <button key={action.label} type="button" onClick={() => notifyComingSoon(action.label)} className={className}>
              <Icon className="size-5" />
              {action.label}
            </button>
          );
        })}
      </div>

      <section className="flex flex-col gap-1">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="label-eyebrow">Recent activity</h2>
          <Link href="/withdraw" className="text-primary text-xs font-medium">
            See all
          </Link>
        </div>
        {!withdrawals ? (
          <div className="flex flex-col gap-px">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : withdrawals.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">No activity yet.</p>
        ) : (
          withdrawals.map((w, i) => {
            const asset = assetById.get(w.assetId);
            const status = STATUS_LABEL[w.status];
            return (
              <div key={w.id} className={cn("flex items-center gap-3 py-3", i > 0 && "border-border border-t")}>
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
      </section>

      <section className="flex flex-col gap-1">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="label-eyebrow">Balances</h2>
          <Link href="/withdraw" className="text-primary flex items-center gap-1 text-xs font-medium">
            <ArrowUpFromLine className="size-3" />
            Withdraw
          </Link>
        </div>
        {!balances ? (
          <div className="flex flex-col gap-px">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          balances.map((b, i) => (
            <div key={b.id} className={cn("flex items-center gap-3 py-3", i > 0 && "border-border border-t")}>
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
                  <span className="font-mono text-sm">{fromSmallestUnits(b.balance, b.decimals)}</span>
                  {b.usdValue && (
                    <span className="text-muted-foreground font-mono text-xs">${Number(b.usdValue).toFixed(2)}</span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
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
          const content = (
            <>
              <Icon className="size-5" />
              <span className="text-[11px] font-semibold">{item.label}</span>
            </>
          );
          if ("href" in item) {
            return (
              <Link
                key={item.label}
                href={item.href}
                className="text-primary flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5"
              >
                {content}
              </Link>
            );
          }
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => notifyComingSoon(item.label)}
              className="text-muted-foreground flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5"
            >
              {content}
            </button>
          );
        })}
      </div>
    </nav>
    </>
  );
}
