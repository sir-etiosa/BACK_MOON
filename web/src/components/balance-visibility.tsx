"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

const STORAGE_KEY = "moonxch_balances_hidden";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

function getServerSnapshot(): boolean {
  return false;
}

interface BalanceVisibilityContextValue {
  hidden: boolean;
  toggle: () => void;
}

const BalanceVisibilityContext = createContext<BalanceVisibilityContextValue | null>(null);

export function BalanceVisibilityProvider({ children }: { children: ReactNode }) {
  const hidden = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    localStorage.setItem(STORAGE_KEY, hidden ? "0" : "1");
    window.dispatchEvent(new Event("storage"));
  }

  return (
    <BalanceVisibilityContext.Provider value={{ hidden, toggle }}>{children}</BalanceVisibilityContext.Provider>
  );
}

export function useBalanceVisibility(): BalanceVisibilityContextValue {
  const ctx = useContext(BalanceVisibilityContext);
  if (!ctx) throw new Error("useBalanceVisibility must be used within BalanceVisibilityProvider");
  return ctx;
}
