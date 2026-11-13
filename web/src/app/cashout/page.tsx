"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckIcon, Plus, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/theme-toggle";
import { AddBankAccountDialog } from "@/components/add-bank-account-dialog";
import {
  api,
  getToken,
  type CashoutProfileStatus,
  type Balance,
  type CashoutBankAccount,
  type CashoutRequest,
  ApiError,
} from "@/lib/api";
import { fromSmallestUnits } from "@/lib/units";
import { useLoading } from "@/components/loading-overlay";
import { cn, capitalizeWords } from "@/lib/utils";

type WizardStep = "name" | "otp" | "bank" | "done" | "amount" | "submitted";

const STEP_INDEX: Record<"name" | "otp" | "bank", number> = { name: 0, otp: 1, bank: 2 };

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
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [ngnRate, setNgnRate] = useState<number | null>(null);
  const [assetId, setAssetId] = useState("");
  const [ngnAmount, setNgnAmount] = useState("");
  const [submittedRequest, setSubmittedRequest] = useState<CashoutRequest | null>(null);

  const [accounts, setAccounts] = useState<CashoutBankAccount[] | null>(null);
  const [bankAccountId, setBankAccountId] = useState("");
  const [addAccountOpen, setAddAccountOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    show();
    api
      .getCashoutProfile()
      .then(async (s) => {
        setStatus(s);
        setFirstName(s.firstName ?? "");
        setMiddleName(s.middleName ?? "");
        setLastName(s.lastName ?? "");
        setBankName(s.bankName ?? "");
        setAccountNumber(s.accountNumber ?? "");
        if (s.step === "done") {
          setStep("amount");
          const [{ balances: b, ngnRate: r }, { accounts: a }] = await Promise.all([
            api.getBalances(),
            api.getCashoutAccounts(),
          ]);
          setBalances(b);
          setNgnRate(r);
          setAccounts(a);
          setBankAccountId(a.find((acc) => acc.isDefault)?.id ?? a[0]?.id ?? "");
        } else {
          setStep(s.step);
        }
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
      await api.saveCashoutBank(capitalizeWords(bankName.trim()), accountNumber.trim());
      const [{ balances: b, ngnRate: r }, { accounts: a }] = await Promise.all([
        api.getBalances(),
        api.getCashoutAccounts(),
      ]);
      setBalances(b);
      setNgnRate(r);
      setAccounts(a);
      setBankAccountId(a.find((acc) => acc.isDefault)?.id ?? a[0]?.id ?? "");
      setStep("amount");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const legalName = [firstName, middleName, lastName].filter(Boolean).join(" ").toUpperCase();

  const selectedAsset = balances?.find((b) => b.id === assetId) ?? null;

  function assetAmountNeeded(asset: Balance, ngn: string): number | null {
    const ngnNum = Number(ngn);
    if (!ngnRate || !Number.isFinite(ngnNum) || ngnNum <= 0) return null;
    const usdNeeded = ngnNum / ngnRate;
    if (asset.symbol === "USDC") return usdNeeded;
    const availableWhole = Number(fromSmallestUnits(asset.balance, asset.decimals));
    const usdValue = Number(asset.usdValue);
    if (!asset.usdValue || availableWhole <= 0 || usdValue <= 0) return null;
    const unitPriceUsd = usdValue / availableWhole;
    return usdNeeded / unitPriceUsd;
  }

  const neededAssetAmount = selectedAsset ? assetAmountNeeded(selectedAsset, ngnAmount) : null;
  const availableAssetAmount = selectedAsset ? Number(fromSmallestUnits(selectedAsset.balance, selectedAsset.decimals)) : null;
  const insufficientBalance =
    neededAssetAmount !== null && availableAssetAmount !== null && neededAssetAmount > availableAssetAmount;

  async function handleCashoutRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!assetId || !ngnAmount || !bankAccountId) return;
    setError(null);
    setLoading(true);
    try {
      const { request } = await api.createCashoutRequest(assetId, ngnAmount, bankAccountId);
      setSubmittedRequest(request);
      setStep("submitted");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

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

      {!status ? null : step === "submitted" && submittedRequest ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="bg-primary flex h-11 w-11 items-center justify-center rounded-full">
              <CheckIcon className="text-primary-foreground size-6" strokeWidth={3} />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Cash-out requested</h2>
              <p className="text-muted-foreground text-sm">
                ₦{Number(submittedRequest.ngnAmount).toLocaleString()} is on its way to {submittedRequest.bankName} ••••{" "}
                {submittedRequest.accountNumber.slice(-4)}. We&rsquo;ll notify you once it&rsquo;s paid out.
              </p>
            </div>
            <Button className="mt-2 h-11 w-full font-semibold" onClick={() => router.push("/dashboard")}>
              Back to dashboard
            </Button>
          </CardContent>
        </Card>
      ) : step === "amount" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Cash out</CardTitle>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {!balances ? (
              <p className="text-muted-foreground text-sm">Loading...</p>
            ) : (
              <form onSubmit={handleCashoutRequest} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label>Payout account</Label>
                    <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-500">
                      <ShieldCheck className="size-3.5" />
                      Verified name
                    </span>
                  </div>
                  <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
                    {accounts?.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setBankAccountId(a.id)}
                        className={cn(
                          "flex w-44 shrink-0 flex-col gap-2 rounded-xl border px-3.5 py-3 text-left transition-colors",
                          bankAccountId === a.id
                            ? "bg-primary/10 border-primary"
                            : "border-border hover:bg-accent",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold">{a.bankName}</span>
                          {a.isDefault && (
                            <span className="label-eyebrow bg-primary/15 text-primary shrink-0 rounded-full px-2 py-0.5">
                              Default
                            </span>
                          )}
                        </div>
                        <span className="text-muted-foreground font-mono text-xs">•••• {a.accountNumber.slice(-4)}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setAddAccountOpen(true)}
                      className="border-border hover:bg-accent text-muted-foreground flex w-28 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed py-3"
                    >
                      <Plus className="size-4" />
                      <span className="text-xs font-medium">Add account</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>Cash out from</Label>
                  <Select value={assetId} onValueChange={(v) => setAssetId(v ?? "")}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select asset">
                        {(value: string | null) => balances.find((b) => b.id === value)?.symbol ?? "Select asset"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {balances.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.symbol} ({fromSmallestUnits(b.balance, b.decimals)} available)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="ngnAmount">Amount (NGN)</Label>
                  <Input
                    id="ngnAmount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={ngnAmount}
                    onChange={(e) => setNgnAmount(e.target.value)}
                    required
                  />
                  {selectedAsset && neededAssetAmount !== null && (
                    <p className={cn("text-xs", insufficientBalance ? "text-destructive" : "text-muted-foreground")}>
                      ≈ {neededAssetAmount.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} {selectedAsset.symbol}
                      {insufficientBalance ? " — more than you have available" : ""}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={loading || !assetId || !ngnAmount || !bankAccountId || !!insufficientBalance}
                  className="mt-1 h-11 font-semibold"
                >
                  {loading ? "Requesting..." : "Cash out"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="gap-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-medium">
                Step {STEP_INDEX[step as "name" | "otp" | "bank"] + 1} of 3
              </span>
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={cn(
                    "h-1 flex-1 rounded-full",
                    i <= STEP_INDEX[step as "name" | "otp" | "bank"] ? "bg-primary" : "bg-muted",
                  )}
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
                  <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-500">
                    <ShieldCheck className="size-3.5" />
                    Verified
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="bankName">Bank name</Label>
                  <Input
                    id="bankName"
                    value={bankName}
                    onChange={(e) => setBankName(capitalizeWords(e.target.value))}
                    required
                    autoFocus
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="accountNumber">Account number</Label>
                  <Input
                    id="accountNumber"
                    inputMode="numeric"
                    maxLength={10}
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                    required
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading || !bankName.trim() || accountNumber.length < 10}
                  className="mt-1 h-11 font-semibold"
                >
                  {loading ? "Saving..." : "Save & continue to cash out"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      <AddBankAccountDialog
        open={addAccountOpen}
        onOpenChange={setAddAccountOpen}
        onAdded={(account) => {
          setAccounts((prev) => [...(prev ?? []), account]);
          setBankAccountId(account.id);
        }}
      />
    </div>
  );
}
