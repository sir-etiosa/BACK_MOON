"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, getToken } from "@/lib/api";
import { cn } from "@/lib/utils";

interface AddressRow {
  chain: string;
  address: string | null;
  error: string | null;
}

export default function DepositPage() {
  const router = useRouter();
  const [addresses, setAddresses] = useState<AddressRow[] | null>(null);
  const [copiedChain, setCopiedChain] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api
      .getAddresses()
      .then((r) => setAddresses(r.addresses))
      .catch(() => router.push("/login"));
  }, [router]);

  function handleCopy(chain: string, address: string) {
    navigator.clipboard.writeText(address);
    setCopiedChain(chain);
    setTimeout(() => setCopiedChain((c) => (c === chain ? null : c)), 1500);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col gap-6 px-5 pt-6">
      <Link href="/dashboard" className={buttonVariants({ variant: "ghost", size: "sm", className: "w-fit" })}>
        &larr; Back
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Receive</h1>
        <p className="text-muted-foreground text-sm">Your deposit address per chain.</p>
      </div>

      <div className="flex flex-col gap-1">
        {!addresses ? (
          <div className="flex flex-col gap-px">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          addresses.map((a, i) => (
            <div key={a.chain} className={cn("flex flex-col gap-1 py-3", i > 0 && "border-border border-t")}>
              <span className="label-eyebrow">{a.chain}</span>
              {a.address ? (
                <button
                  onClick={() => handleCopy(a.chain, a.address!)}
                  className="flex items-center justify-between gap-2 text-left"
                >
                  <code className="truncate font-mono text-sm">{a.address}</code>
                  <span className="text-primary shrink-0 text-xs font-semibold">
                    {copiedChain === a.chain ? "Copied" : "Copy"}
                  </span>
                </button>
              ) : (
                <p className="text-muted-foreground text-xs">{a.error}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
