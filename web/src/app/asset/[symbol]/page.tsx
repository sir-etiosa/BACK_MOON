"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Check, Clock, Copy, History, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import { api, getToken, type Balance, type Deposit, type Withdrawal } from "@/lib/api";
import { fromSmallestUnits } from "@/lib/units";
import { networksForSymbol, type AssetNetwork } from "@/lib/asset-networks";
import { useLoading } from "@/components/loading-overlay";
import { cn } from "@/lib/utils";

interface AddressRow {
  chain: string;
  address: string | null;
  error: string | null;
}

type HistoryEntry =
  | { kind: "deposit"; id: string; amount: string; status: string; at: string }
  | { kind: "withdrawal"; id: string; amount: string; status: string; at: string };

function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `Today, ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function AssetDetailPage() {
  const router = useRouter();
  const params = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(params.symbol).toUpperCase();
  const { show, hide } = useLoading();

  const [variants, setVariants] = useState<Balance[] | null>(null);
  const [addresses, setAddresses] = useState<AddressRow[] | null>(null);
  const [deposits, setDeposits] = useState<Deposit[] | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[] | null>(null);
  const [selectedNetwork, setSelectedNetwork] = useState<AssetNetwork | null>(null);
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    show();
    Promise.all([api.getBalances(), api.getAddresses(), api.getDeposits(), api.getWithdrawals()])
      .then(([b, a, d, w]) => {
        const matches = b.balances.filter((x) => x.symbol === symbol);
        setVariants(matches);
        setAddresses(a.addresses);
        setDeposits(d.deposits);
        setWithdrawals(w.withdrawals);
        if (matches.length === 1) {
          const networks = networksForSymbol(symbol, matches[0].chain);
          setSelectedNetwork(networks.find((n) => n.assetChain === matches[0].chain) ?? networks[0]);
        }
      })
      .catch(() => router.push("/login"))
      .finally(hide);
  }, [router, show, hide, symbol]);

  if (!variants) {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-col gap-4 p-4 pt-4">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const networks = networksForSymbol(symbol, variants[0]?.chain ?? symbol.toLowerCase());
  const hasMultipleNetworks = networks.length > 1 && variants.length > 0;

  const totalBalance = variants.reduce((sum, v) => sum + BigInt(v.balance), BigInt(0)).toString();
  const decimals = variants[0]?.decimals ?? 0;
  const totalUsd = variants.reduce((sum, v) => sum + (v.usdValue ? Number(v.usdValue) : 0), 0);

  const selectedVariant = selectedNetwork ? variants.find((v) => v.chain === selectedNetwork.assetChain) ?? null : null;
  const addressByChain = new Map((addresses ?? []).map((a) => [a.chain, a]));
  const selectedAddress = selectedNetwork ? addressByChain.get(selectedNetwork.addressChain) : undefined;

  function handleCopy(address: string) {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleShare(address: string) {
    if (navigator.share) {
      navigator.share({ text: address }).catch(() => {});
    } else {
      handleCopy(address);
    }
  }

  const historyEntries: HistoryEntry[] = selectedVariant
    ? [
        ...(deposits ?? [])
          .filter((d) => d.assetId === selectedVariant.id)
          .map((d): HistoryEntry => ({ kind: "deposit", id: d.id, amount: d.amount, status: d.status, at: d.detectedAt })),
        ...(withdrawals ?? [])
          .filter((w) => w.assetId === selectedVariant.id)
          .map((w): HistoryEntry => ({ kind: "withdrawal", id: w.id, amount: w.amount, status: w.status, at: w.requestedAt })),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    : [];

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-5 p-4 pt-4">
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
        <h1 className="text-2xl font-bold tracking-tight">{symbol}</h1>
        <div data-numeric className="flex items-baseline gap-2">
          <span className="font-mono text-xl font-semibold">{fromSmallestUnits(totalBalance, decimals)}</span>
          {totalUsd > 0 && <span className="text-muted-foreground font-mono text-sm">${totalUsd.toFixed(2)}</span>}
        </div>
      </div>

      {hasMultipleNetworks && (
        <div className="flex flex-col gap-2">
          <span className="label-eyebrow">Select network</span>
          <div className="flex flex-wrap gap-2">
            {networks.map((n) => (
              <button
                key={n.label}
                type="button"
                onClick={() => {
                  setSelectedNetwork(n);
                  setCopied(false);
                  setHistoryOpen(false);
                }}
                className={cn(
                  "rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors",
                  selectedNetwork?.label === n.label
                    ? "bg-foreground text-background border-foreground"
                    : "border-border bg-card hover:bg-accent",
                )}
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedNetwork && (
        <>
          <div className="bg-card border-border flex flex-col items-center gap-4 rounded-2xl border p-5">
            {selectedAddress?.address ? (
              <>
                <div className="rounded-xl bg-white p-3">
                  <QRCodeSVG value={selectedAddress.address} size={176} marginSize={0} />
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                  <span className="text-muted-foreground text-xs">
                    Your {symbol} address · {selectedNetwork.label}
                  </span>
                  <code className="font-mono text-sm font-semibold break-all">{selectedAddress.address}</code>
                </div>
                <div className="grid w-full grid-cols-2 gap-2.5">
                  <Button className="h-11 font-semibold" onClick={() => handleCopy(selectedAddress.address!)}>
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button variant="secondary" className="h-11 font-semibold" onClick={() => handleShare(selectedAddress.address!)}>
                    <Share2 className="size-4" />
                    Share
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground py-4 text-center text-sm">
                {selectedAddress?.error ?? "Loading address..."}
              </p>
            )}
          </div>

          <Button variant="secondary" className="h-11 font-semibold" onClick={() => setHistoryOpen((v) => !v)}>
            <History className="size-4" />
            History
          </Button>

          {historyOpen && (
            <div className="bg-card border-border rounded-2xl border px-4">
              {historyEntries.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">No activity yet on this network.</p>
              ) : (
                historyEntries.map((h, i) => (
                  <div
                    key={`${h.kind}-${h.id}`}
                    className={cn("flex items-center gap-3 py-3", i > 0 && "border-border border-t")}
                  >
                    <div className="bg-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                      {h.kind === "deposit" ? (
                        <ArrowDownToLine className="text-muted-foreground size-4" />
                      ) : (
                        <ArrowUpFromLine className="text-muted-foreground size-4" />
                      )}
                    </div>
                    <div className="flex flex-1 items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{h.kind === "deposit" ? "Deposit" : "Withdraw"}</span>
                        <span className="text-muted-foreground flex items-center gap-1 text-xs">
                          <Clock className="size-3" />
                          {formatDate(h.at)}
                        </span>
                      </div>
                      <div data-numeric className="flex flex-col items-end">
                        <span className="font-mono text-sm">
                          {h.kind === "deposit" ? "+" : "-"}
                          {fromSmallestUnits(h.amount, decimals)}
                        </span>
                        <span className="text-muted-foreground text-xs">{h.status}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
