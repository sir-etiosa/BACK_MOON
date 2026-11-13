"use client";

import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, ArrowLeftRight, ArrowUpFromLine, Landmark, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const STEPS = [
  {
    key: "fund",
    icon: Landmark,
    title: "Fund with card or bank transfer",
    subtitle: "Pay in naira straight from your card or bank — no crypto needed to get started.",
  },
  {
    key: "swap",
    icon: ArrowLeftRight,
    title: "Swap into any asset",
    subtitle: "Your naira balance converts into BTC, ETH, USDT and more at the live rate.",
  },
  {
    key: "withdraw",
    icon: ArrowUpFromLine,
    title: "Or just hold and withdraw",
    subtitle: "Keep it as a naira balance and cash it back out to your bank whenever you like.",
  },
];

export default function BuyPage() {
  function notifyComingSoon() {
    toast.info("Buy NGN is coming soon");
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
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Buy naira.</h1>
          <span className="bg-muted text-muted-foreground label-eyebrow rounded-full px-2 py-0.5">Soon</span>
        </div>
        <p className="text-muted-foreground text-sm">Fund your wallet in NGN, then swap it or cash it back out.</p>
      </div>

      <div className="flex flex-col gap-3">
        {STEPS.map(({ key, icon: Icon, title, subtitle }) => (
          <div key={key} className="bg-card border-border flex items-start gap-3 rounded-2xl border p-[18px]">
            <div className="bg-primary/15 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
              <Icon className="size-4" />
            </div>
            <div className="flex flex-1 flex-col gap-0.5">
              <h2 className="font-semibold">{title}</h2>
              <p className="text-muted-foreground text-sm">{subtitle}</p>
            </div>
          </div>
        ))}
      </div>

      <Button className="h-11 font-semibold" onClick={notifyComingSoon}>
        <Wallet className="size-4" />
        Notify me at launch
      </Button>
    </div>
  );
}
