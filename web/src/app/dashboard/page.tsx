"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, getToken, clearToken, type Balance } from "@/lib/api";
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

export default function DashboardPage() {
  const router = useRouter();
  const [balances, setBalances] = useState<Balance[] | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api
      .getBalances()
      .then((r) => setBalances(r.balances))
      .catch(() => {
        clearToken();
        router.push("/login");
      });
  }, [router]);

  function handleLogout() {
    api.logout().finally(() => {
      clearToken();
      router.push("/login");
    });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-5 pb-16 pt-6">
      <div className="border-border flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="" width={28} height={28} className="rounded-md" />
          <span className="text-sm font-bold tracking-tight">MOONXCH</span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          Log out
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Link href="/deposit" className={buttonVariants({ variant: "secondary", className: "h-11 font-semibold" })}>
          Receive
        </Link>
        <Link href="/swap" className={buttonVariants({ className: "h-11 font-semibold" })}>
          Swap
        </Link>
        <Link href="/withdraw" className={buttonVariants({ variant: "secondary", className: "h-11 font-semibold" })}>
          Withdraw
        </Link>
      </div>

      <section className="flex flex-col gap-1">
        <h2 className="label-eyebrow mb-2">Balances</h2>
        {!balances ? (
          <div className="flex flex-col gap-px">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          balances.map((b, i) => (
            <div key={b.id} className={cn("flex items-center gap-3 py-3", i > 0 && "border-border border-t")}>
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold",
                  ASSET_COLOR[b.symbol] ?? "bg-muted text-muted-foreground",
                )}
              >
                {b.symbol.slice(0, 1)}
              </div>
              <div className="flex flex-1 items-center justify-between">
                <span className="font-medium">{b.symbol}</span>
                <span data-numeric className="font-mono text-sm">
                  {fromSmallestUnits(b.balance, b.decimals)}
                </span>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
