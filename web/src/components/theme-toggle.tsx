"use client";

import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {/* resolvedTheme is only known client-side — suppress the one-frame SSR/client
          mismatch on this icon rather than add a mounted-state dance that itself
          trips the set-state-in-effect lint rule. */}
      <span suppressHydrationWarning>{resolvedTheme === "dark" ? <Sun /> : <Moon />}</span>
    </Button>
  );
}
