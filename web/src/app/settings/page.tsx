"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import { ArrowLeft, Building2, ChevronRight, EyeOff, KeyRound, LifeBuoy, Moon, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AddBankAccountDialog } from "@/components/add-bank-account-dialog";
import { useBalanceVisibility } from "@/components/balance-visibility";
import { api, getToken, clearToken, markExplicitLogout, type CashoutBankAccount, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { hidden: balancesHidden, toggle: toggleBalancesHidden } = useBalanceVisibility();

  const [accounts, setAccounts] = useState<CashoutBankAccount[] | null>(null);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [defaultLoadingId, setDefaultLoadingId] = useState<string | null>(null);

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api.getCashoutAccounts().then((r) => setAccounts(r.accounts)).catch(() => setAccounts([]));
  }, [router]);

  function handleLogout() {
    api.logout().finally(() => {
      clearToken();
      markExplicitLogout();
      router.push("/login");
    });
  }

  async function handleSetDefault(id: string) {
    setDefaultLoadingId(id);
    try {
      await api.setDefaultCashoutAccount(id);
      const { accounts: refreshed } = await api.getCashoutAccounts();
      setAccounts(refreshed);
    } finally {
      setDefaultLoadingId(null);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords don't match");
      return;
    }
    setPasswordLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setPasswordSuccess("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setPasswordLoading(false);
    }
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

      <div className="flex gap-3">
        <div className="bg-card border-border flex flex-1 items-center justify-between gap-2 rounded-xl border px-3 py-2">
          <div className="flex items-center gap-2">
            <Moon className="text-primary size-4 shrink-0" />
            <span className="text-sm font-medium">Dark mode</span>
          </div>
          <Switch
            checked={resolvedTheme === "dark"}
            onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
            suppressHydrationWarning
          />
        </div>

        <div className="bg-card border-border flex flex-1 items-center justify-between gap-2 rounded-xl border px-3 py-2">
          <div className="flex items-center gap-2">
            <EyeOff className="text-primary size-4 shrink-0" />
            <span className="text-sm font-medium">Hide balances</span>
          </div>
          <Switch checked={balancesHidden} onCheckedChange={toggleBalancesHidden} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <span className="label-eyebrow">Security</span>
        <div className="bg-card border-border flex flex-col rounded-2xl border px-4">
          <button
            type="button"
            onClick={() => setPasswordOpen(true)}
            className="hover:bg-accent -mx-4 flex w-[calc(100%+2rem)] items-center gap-3 px-4 py-3.5 text-left transition-colors"
          >
            <div className="bg-primary/15 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
              <KeyRound className="size-4" />
            </div>
            <span className="flex-1 text-sm font-medium">Change password</span>
            <ChevronRight className="text-muted-foreground size-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="label-eyebrow">Cash-out accounts</span>
          <button
            type="button"
            onClick={() => setAddAccountOpen(true)}
            className="text-primary flex items-center gap-1 text-xs font-medium"
          >
            <Plus className="size-3.5" />
            Add account
          </button>
        </div>
        <div className="bg-card border-border flex flex-col rounded-2xl border px-4">
          {accounts === null ? (
            <p className="text-muted-foreground py-3.5 text-sm">Loading...</p>
          ) : accounts.length === 0 ? (
            <p className="text-muted-foreground py-3.5 text-sm">No accounts yet.</p>
          ) : (
            accounts.map((a, i) => (
              <div
                key={a.id}
                className={cn("flex items-center gap-3 py-3.5", i > 0 && "border-border border-t")}
              >
                <div className="bg-primary/15 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                  <Building2 className="size-4" />
                </div>
                <div className="flex flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{a.bankName}</span>
                  <span className="text-muted-foreground font-mono text-xs">•••• {a.accountNumber.slice(-4)}</span>
                </div>
                {a.isDefault ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-500">
                    <ShieldCheck className="size-3.5" />
                    Default
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={defaultLoadingId === a.id}
                    onClick={() => handleSetDefault(a.id)}
                  >
                    Set default
                  </Button>
                )}
              </div>
            ))
          )}
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

      <AddBankAccountDialog
        open={addAccountOpen}
        onOpenChange={setAddAccountOpen}
        onAdded={(account) =>
          setAccounts((prev) => {
            const withoutNew = (prev ?? []).map((a) => (account.isDefault ? { ...a, isDefault: false } : a));
            return [...withoutNew, account];
          })
        }
      />

      <Dialog
        open={passwordOpen}
        onOpenChange={(open) => {
          setPasswordOpen(open);
          if (!open) {
            setPasswordError(null);
            setPasswordSuccess(null);
          }
        }}
      >
        <DialogContent className="max-w-[320px]">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>Enter your current password, then set a new one.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
            {passwordError && (
              <Alert variant="destructive">
                <AlertDescription>{passwordError}</AlertDescription>
              </Alert>
            )}
            {passwordSuccess && (
              <Alert>
                <AlertDescription>{passwordSuccess}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="h-11"
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-11"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-11"
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={passwordLoading || !currentPassword || newPassword.length < 8 || !confirmPassword}
                className="h-11 w-full font-semibold"
              >
                {passwordLoading ? "Saving..." : "Update password"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
