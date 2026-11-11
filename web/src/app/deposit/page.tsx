"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, Copy, Plus, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ThemeToggle } from "@/components/theme-toggle";
import { api, getToken, ApiError } from "@/lib/api";
import { useLoading } from "@/components/loading-overlay";
import { cn } from "@/lib/utils";

interface AddressRow {
  chain: string;
  address: string | null;
  error: string | null;
}

const ASSETS = [
  { symbol: "USDT", dot: "bg-[#4ed9a4]", networks: [{ label: "Tron (TRC20)", addressChain: "tron" }] },
  {
    symbol: "USDC",
    dot: "bg-[#4ed9a4]",
    networks: [
      { label: "Ethereum (ERC20)", addressChain: "evm" },
      { label: "Base", addressChain: "evm" },
    ],
  },
  {
    symbol: "ETH",
    dot: "bg-[#9d5cff]",
    networks: [
      { label: "Ethereum", addressChain: "evm" },
      { label: "Base", addressChain: "evm" },
    ],
  },
  { symbol: "BTC", dot: "bg-[#ffd24a]", networks: [{ label: "Bitcoin", addressChain: "bitcoin" }] },
  { symbol: "LTC", dot: "bg-[#a69cc4]", networks: [{ label: "Litecoin", addressChain: "litecoin" }] },
] as const;

export default function DepositPage() {
  const router = useRouter();
  const { show, hide } = useLoading();
  const [addresses, setAddresses] = useState<AddressRow[] | null>(null);
  const [assetIndex, setAssetIndex] = useState(0);
  const [networkIndex, setNetworkIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  const [requestOpen, setRequestOpen] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [requestNetwork, setRequestNetwork] = useState("");
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    show();
    api
      .getAddresses()
      .then((r) => setAddresses(r.addresses))
      .catch(() => router.push("/login"))
      .finally(hide);
  }, [router, show, hide]);

  function selectAsset(index: number) {
    setAssetIndex(index);
    setNetworkIndex(0);
    setCopied(false);
  }

  function handleCopy(address: string) {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleShare(address: string) {
    if (navigator.share) {
      navigator.share({ text: address }).catch(() => {});
    } else {
      handleCopy(address);
    }
  }

  async function handleRequestSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRequestError(null);
    setRequestLoading(true);
    try {
      await api.requestAsset(tokenName, requestNetwork);
      setRequestSent(true);
      setTokenName("");
      setRequestNetwork("");
    } catch (err) {
      setRequestError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setRequestLoading(false);
    }
  }

  function closeRequestDialog() {
    setRequestOpen(false);
    setRequestError(null);
    setRequestSent(false);
  }

  const asset = ASSETS[assetIndex];
  const network = asset.networks[networkIndex];
  const addressByChain = new Map((addresses ?? []).map((a) => [a.chain, a]));
  const selectedAddress = addressByChain.get(network.addressChain);

  return (
    <div className="mx-auto flex w-full min-h-screen max-w-sm flex-col gap-6 px-5 pt-4 pb-16">
      <div className="relative flex items-center justify-center">
        <Link
          href="/dashboard"
          aria-label="Back"
          className="bg-primary text-primary-foreground absolute left-0 flex h-9 w-9 items-center justify-center rounded-full"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-bold tracking-tight">Deposit</h1>
        <div className="absolute right-0">
          <ThemeToggle />
        </div>
      </div>

      {!addresses ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className="label-eyebrow">Asset</span>
            <div className="flex flex-wrap gap-2">
              {ASSETS.map((a, i) => (
                <button
                  key={a.symbol}
                  type="button"
                  onClick={() => selectAsset(i)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors",
                    assetIndex === i
                      ? "bg-foreground text-background border-foreground"
                      : "border-border bg-card hover:bg-accent",
                  )}
                >
                  <span className={cn("size-2 rounded-full", a.dot)} />
                  {a.symbol}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setRequestOpen(true)}
                className="border-border bg-card hover:bg-accent text-muted-foreground flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors"
              >
                <Plus className="size-3.5" />
                Request token
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="label-eyebrow">Network</span>
            <div className="flex flex-wrap gap-2">
              {asset.networks.map((n, i) => (
                <button
                  key={n.label}
                  type="button"
                  onClick={() => setNetworkIndex(i)}
                  className={cn(
                    "rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors",
                    networkIndex === i
                      ? "bg-foreground text-background border-foreground"
                      : "border-border bg-card hover:bg-accent",
                  )}
                >
                  {n.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-card border-border flex flex-col items-center gap-4 rounded-2xl border p-5">
            {selectedAddress?.address ? (
              <>
                <div className="rounded-xl bg-white p-3">
                  <QRCodeSVG value={selectedAddress.address} size={176} marginSize={0} />
                </div>

                <div className="flex flex-col items-center gap-1 text-center">
                  <span className="text-muted-foreground text-xs">
                    Your {asset.symbol} address · {network.label}
                  </span>
                  <code className="font-mono text-sm font-semibold break-all">{selectedAddress.address}</code>
                </div>

                <div className="grid w-full grid-cols-2 gap-2.5">
                  <Button className="h-11 font-semibold" onClick={() => handleCopy(selectedAddress.address!)}>
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-11 font-semibold"
                    onClick={() => handleShare(selectedAddress.address!)}
                  >
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

          <div className="border-primary/30 bg-primary/10 flex items-start gap-2.5 rounded-xl border p-3.5">
            <AlertTriangle className="text-primary mt-0.5 size-4 shrink-0" />
            <p className="text-sm">
              Send only <span className="font-semibold">{asset.symbol}</span> on{" "}
              <span className="font-semibold">{network.label}</span>. Anything else sent here can&rsquo;t be
              recovered.
            </p>
          </div>
        </>
      )}

      <Dialog open={requestOpen} onOpenChange={(open) => (open ? setRequestOpen(true) : closeRequestDialog())}>
        <DialogContent className="max-w-[320px]">
          {requestSent ? (
            <>
              <DialogHeader>
                <DialogTitle>Request sent</DialogTitle>
                <DialogDescription>
                  We&rsquo;ll review it and reach out if we need anything else.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button className="h-11 w-full font-semibold" onClick={closeRequestDialog}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={handleRequestSubmit} className="flex flex-col gap-3">
              <DialogHeader>
                <DialogTitle>Request a token</DialogTitle>
                <DialogDescription>Don&rsquo;t see what you need? Tell us what to add.</DialogDescription>
              </DialogHeader>

              {requestError && (
                <Alert variant="destructive">
                  <AlertDescription>{requestError}</AlertDescription>
                </Alert>
              )}

              <span className="label-eyebrow">Token name</span>
              <Input
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="e.g. Dogecoin"
                required
                className="h-11"
              />
              <span className="label-eyebrow mt-1">Network</span>
              <Input
                value={requestNetwork}
                onChange={(e) => setRequestNetwork(e.target.value)}
                placeholder="e.g. BNB Chain"
                required
                className="h-11"
              />
              <Button type="submit" disabled={requestLoading} className="mt-1 h-11 font-semibold">
                {requestLoading ? "Sending..." : "Send request"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
