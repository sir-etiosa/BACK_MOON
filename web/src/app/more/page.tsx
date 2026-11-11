"use client";

import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, CalendarClock, Lock, LineChart, TrendingUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const SECTIONS = [
  {
    key: "spot",
    icon: LineChart,
    title: "Spot trading",
    subtitle: "Buy and sell BTC, ETH, SOL and more against USDT, with live charts.",
    cta: "Start trading",
  },
  {
    key: "futures",
    icon: TrendingUpDown,
    title: "Futures",
    subtitle: "Go long or short with set leverage limits and clear liquidation warnings.",
    cta: "Open futures",
  },
  {
    key: "lock",
    icon: Lock,
    title: "Lock & HODL",
    subtitle: "Lock tokens for a fixed term so you're not tempted to sell. Earn while you wait.",
    cta: "Lock tokens",
  },
  {
    key: "plan",
    icon: CalendarClock,
    title: "Plan ahead",
    subtitle: "Schedule future allocations: auto cash out on payday, recurring bill payments, savings goals.",
    cta: "Notify me at launch",
  },
];

export default function MorePage() {
  function notifyComingSoon(feature: string) {
    toast.info(`${feature} is coming soon`);
  }

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
        <h1 className="text-2xl font-bold tracking-tight">Grow your money.</h1>
        <p className="text-muted-foreground text-sm">Trade, lock and plan, all from one wallet.</p>
      </div>

      <div className="flex flex-col gap-3">
        {SECTIONS.map(({ key, icon: Icon, title, subtitle, cta }) => (
          <div key={key} className="bg-card border-border flex flex-col gap-3 rounded-2xl border p-[18px]">
            <div className="flex items-start gap-3">
              <div className="bg-primary/15 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                <Icon className="size-4" />
              </div>
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">{title}</h2>
                  <span className="bg-muted text-muted-foreground label-eyebrow rounded-full px-2 py-0.5">Soon</span>
                </div>
                <p className="text-muted-foreground text-sm">{subtitle}</p>
              </div>
            </div>
            <Button variant="secondary" className="h-11 font-semibold" onClick={() => notifyComingSoon(title)}>
              {cta}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
