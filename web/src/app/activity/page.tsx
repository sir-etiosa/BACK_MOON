"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpFromLine } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { api, getToken, type Balance, type Withdrawal } from "@/lib/api";
import { fromSmallestUnits } from "@/lib/units";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<Withdrawal["status"], { text: string; className: string }> = {
  PENDING: { text: "Pending", className: "text-muted-foreground" },
  APPROVED: { text: "Pending", className: "text-muted-foreground" },
  SENT: { text: "Completed", className: "text-[#4ed9a4]" },
  CONFIRMED: { text: "Completed", className: "text-[#4ed9a4]" },
  REJECTED: { text: "Rejected", className: "text-[#f2705f]" },
};

function formatActivityDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `Today, ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ActivityPage() {
  const router = useRouter();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[] | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    Promise.all([api.getBalances(), api.getWithdrawals()])
      .then(([b, w]) => {
        setBalances(b.balances);
        setWithdrawals(w.withdrawals);
      })
      .catch(() => router.push("/login"));
  }, [router]);

  const assetById = new Map((balances ?? []).map((b) => [b.id, b]));

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col gap-6 px-5 pt-4 pb-16">
      <Link
        href="/dashboard"
        aria-label="Back"
        className="bg-primary text-primary-foreground -ml-1.5 flex h-9 w-9 items-center justify-center rounded-full"
      >
        <ArrowLeft className="size-4" />
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Activity</h1>
        <p className="text-muted-foreground text-sm">Everything that&rsquo;s moved in or out of your account.</p>
      </div>

      <div className="flex flex-col gap-1">
        {!withdrawals ? (
          <div className="flex flex-col gap-px">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : withdrawals.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">No activity yet.</p>
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
      </div>
    </div>
  );
}
