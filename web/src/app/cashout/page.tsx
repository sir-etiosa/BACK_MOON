"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckIcon, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/theme-toggle";
import { api, getToken, type CashoutProfileStatus, ApiError } from "@/lib/api";
import { useLoading } from "@/components/loading-overlay";
import { cn } from "@/lib/utils";

type WizardStep = "name" | "otp" | "bank" | "done";

const STEP_INDEX: Record<WizardStep, number> = { name: 0, otp: 1, bank: 2, done: 3 };

const COMMON_BANKS = ["GTBank", "Access", "Kuda", "Opay", "Zenith"];
const MORE_BANKS = [
  "First Bank",
  "UBA",
  "Stanbic IBTC",
  "Union Bank",
  "Fidelity",
  "FCMB",
  "Sterling",
  "Wema",
  "Polaris",
  "Ecobank",
  "Providus",
  "Moniepoint",
  "PalmPay",
  "Heritage",
];

export default function CashoutPage() {
  const router = useRouter();
  const { show, hide } = useLoading();

  const [status, setStatus] = useState<CashoutProfileStatus | null>(null);
  const [step, setStep] = useState<WizardStep>("name");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [code, setCode] = useState("");
  const [showMoreBanks, setShowMoreBanks] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    show();
    api
      .getCashoutProfile()
      .then((s) => {
        setStatus(s);
        setStep(s.step);
        setFirstName(s.firstName ?? "");
        setMiddleName(s.middleName ?? "");
        setLastName(s.lastName ?? "");
        setBankName(s.bankName ?? "");
        setAccountNumber(s.accountNumber ?? "");
      })
      .catch(() => router.push("/login"))
      .finally(hide);
  }, [router, show, hide]);

  async function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.submitCashoutName(firstName.trim(), middleName.trim() || undefined, lastName.trim());
      setCode("");
      setStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError(null);
    try {
      await api.resendCashoutOtp();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  async function handleVerifySubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.verifyCashoutOtp(code);
      setStep("bank");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleBankSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.saveCashoutBank(bankName, accountNumber.trim());
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const legalName = [firstName, middleName, lastName].filter(Boolean).join(" ").toUpperCase();

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 p-4 pt-4">
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

      {!status ? null : step === "done" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="bg-primary flex h-11 w-11 items-center justify-center rounded-full">
              <CheckIcon className="text-primary-foreground size-6" strokeWidth={3} />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Cash-out profile ready</h2>
              <p className="text-muted-foreground text-sm">
                {bankName} •••• {accountNumber.slice(-4)} will receive your payouts. Cash-out execution is launching soon.
              </p>
            </div>
            <Button className="mt-2 h-11 w-full font-semibold" onClick={() => router.push("/dashboard")}>
              Back to dashboard
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="gap-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-medium">Step {STEP_INDEX[step] + 1} of 3</span>
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={cn("h-1 flex-1 rounded-full", i <= STEP_INDEX[step] ? "bg-primary" : "bg-muted")}
                />
              ))}
            </div>
            <CardTitle className="text-xl">
              {step === "name" && "First, your legal name"}
              {step === "otp" && "Enter the 6-digit code"}
              {step === "bank" && "Add your bank account"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {step === "name" && (
              <form onSubmit={handleNameSubmit} className="flex flex-col gap-4">
                <p className="text-muted-foreground -mt-2 text-sm">
                  Use the name exactly as it appears on your bank account. We only pay out to accounts in this name.
                </p>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="firstName">First name</Label>
                  <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoFocus />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="middleName">Middle name (optional)</Label>
                  <Input
                    id="middleName"
                    placeholder="As on your bank account"
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                </div>
                <Button
                  type="submit"
                  disabled={loading || !firstName.trim() || !lastName.trim()}
                  className="mt-1 h-11 font-semibold"
                >
                  {loading ? "Sending code..." : "Send code"}
                </Button>
              </form>
            )}

            {step === "otp" && (
              <form onSubmit={handleVerifySubmit} className="flex flex-col gap-4">
                <p className="text-muted-foreground -mt-2 text-sm">Sent by email to {status.email}.</p>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="code">6-digit code</Label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    required
                    autoFocus
                    className="font-mono text-lg tracking-[0.3em]"
                  />
                </div>
                <Button type="submit" disabled={loading || code.length !== 6} className="mt-1 h-11 font-semibold">
                  {loading ? "Verifying..." : "Verify"}
                </Button>
                <button
                  type="button"
                  onClick={handleResend}
                  className="text-muted-foreground hover:text-foreground py-1 text-sm transition-colors"
                >
                  Didn&rsquo;t get it? Resend code
                </button>
              </form>
            )}

            {step === "bank" && (
              <form onSubmit={handleBankSubmit} className="flex flex-col gap-4">
                <div className="bg-primary/10 border-primary/30 flex items-center justify-between rounded-xl border px-3.5 py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-xs">Account must be in this name</span>
                    <span className="text-sm font-semibold">{legalName}</span>
                  </div>
                  <span className="text-primary flex items-center gap-1 text-xs font-medium">
                    <ShieldCheck className="size-3.5" />
                    Verified
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>Bank</Label>
                  <div className="flex flex-wrap gap-2">
                    {COMMON_BANKS.map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setBankName(b)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                          bankName === b
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-border hover:bg-accent",
                        )}
                      >
                        {b}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowMoreBanks((v) => !v)}
                      className="border-border hover:bg-accent rounded-full border px-3 py-1.5 text-sm font-medium transition-colors"
                    >
                      More banks
                    </button>
                  </div>
                  {(showMoreBanks || (bankName && !COMMON_BANKS.includes(bankName))) && (
                    <Select value={bankName} onValueChange={(v) => setBankName(v ?? "")}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a bank">
                          {(value: string | null) => value ?? "Select a bank"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {MORE_BANKS.map((b) => (
                          <SelectItem key={b} value={b}>
                            {b}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="accountNumber">Account number</Label>
                  <Input
                    id="accountNumber"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="0123456789"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                    required
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading || !bankName || accountNumber.length < 10}
                  className="mt-1 h-11 font-semibold"
                >
                  {loading ? "Saving..." : "Save & continue to cash out"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
