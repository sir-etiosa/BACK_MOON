"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { api, getToken, clearToken } from "@/lib/api";

interface Balance {
  symbol: string;
  chain: string;
  balance: string;
}

interface AddressRow {
  chain: string;
  address: string | null;
  error: string | null;
}

export default function DashboardPage() {
  const router = useRouter();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [addresses, setAddresses] = useState<AddressRow[] | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    Promise.all([api.getBalances(), api.getAddresses()])
      .then(([b, a]) => {
        setBalances(b.balances);
        setAddresses(a.addresses);
      })
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
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4 pt-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">MoonXch</h1>
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          Log out
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Balances</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!balances ? (
            <>
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </>
          ) : (
            balances.map((b, i) => (
              <div key={b.symbol}>
                <div className="flex items-center justify-between py-1">
                  <span className="font-medium">{b.symbol}</span>
                  <span className="text-muted-foreground tabular-nums">{b.balance}</span>
                </div>
                {i < balances.length - 1 && <Separator />}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deposit addresses</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!addresses ? (
            <>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </>
          ) : (
            addresses.map((a) => (
              <div key={a.chain} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="uppercase">
                    {a.chain}
                  </Badge>
                  {a.error && (
                    <Badge variant="outline" className="text-muted-foreground">
                      not available
                    </Badge>
                  )}
                </div>
                {a.address ? (
                  <code className="bg-muted rounded-md px-2 py-1 text-xs break-all">{a.address}</code>
                ) : (
                  <p className="text-muted-foreground text-xs">{a.error}</p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
