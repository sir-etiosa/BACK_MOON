"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import { ArrowLeft, ChevronRight, LifeBuoy, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useBalanceVisibility } from "@/components/balance-visibility";
import { api, getToken, clearToken, markExplicitLogout } from "@/lib/api";

export default function SettingsPage() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { hidden: balancesHidden, toggle: toggleBalancesHidden } = useBalanceVisibility();

  useEffect(() => {
    if (!getToken()) router.push("/login");
  }, [router]);

  function handleLogout() {
    api.logout().finally(() => {
      clearToken();
      markExplicitLogout();
      router.push("/login");
    });
  }

  return (
    <div className="mx-auto flex w-full min-h-screen max-w-sm flex-col gap-6 px-5 pt-4 pb-16">
      <Link
        href="/dashboard"
        aria-label="Back"
        className="bg-primary text-primary-foreground -ml-1.5 flex h-9 w-9 items-center justify-center rounded-full"
      >
        <ArrowLeft className="size-4" />
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">Manage how MoonXch looks and works for you.</p>
      </div>

      <div className="flex flex-col gap-3">
        <span className="label-eyebrow">Appearance</span>
        <div className="bg-card border-border flex flex-col rounded-2xl border px-4">
          <div className="flex items-center justify-between gap-3 py-3.5">
            <div className="flex items-center gap-3">
              <div className="bg-primary/15 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                <Moon className="size-4" />
              </div>
              <span className="text-sm font-medium">Dark mode</span>
            </div>
            <Switch
              checked={resolvedTheme === "dark"}
              onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
              suppressHydrationWarning
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <span className="label-eyebrow">Privacy</span>
        <div className="bg-card border-border flex flex-col rounded-2xl border px-4">
          <div className="flex items-center justify-between gap-3 py-3.5">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Hide balances</span>
              <span className="text-muted-foreground text-xs">Mask amounts on the home screen.</span>
            </div>
            <Switch checked={balancesHidden} onCheckedChange={toggleBalancesHidden} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <span className="label-eyebrow">Support</span>
        <div className="bg-card border-border flex flex-col rounded-2xl border px-4">
          <Link href="/support" className="hover:bg-accent -mx-4 flex items-center gap-3 px-4 py-3.5 transition-colors">
            <div className="bg-primary/15 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
              <LifeBuoy className="size-4" />
            </div>
            <span className="flex-1 text-sm font-medium">Contact support</span>
            <ChevronRight className="text-muted-foreground size-4" />
          </Link>
        </div>
      </div>

      <Button variant="destructive" className="h-11 font-semibold" onClick={handleLogout}>
        Log out
      </Button>
    </div>
  );
}
