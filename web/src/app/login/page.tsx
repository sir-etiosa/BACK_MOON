"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api, setToken, ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.requestOtp(email);
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { accessToken } = await api.verifyOtp(email, code);
      setToken(accessToken);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-[340px] flex-col gap-10">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="" width={32} height={32} className="rounded-md" />
          <div className="flex flex-col leading-none">
            <span className="text-sm font-bold tracking-tight">MOONXCH</span>
            <span className="label-eyebrow mt-0.5">Exchange</span>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <h1 className="text-3xl leading-tight font-bold tracking-tight">
            {step === "email" ? (
              <>
                Deposit, swap, <span className="text-primary">cash out.</span>
              </>
            ) : (
              "Enter your code."
            )}
          </h1>
          <p className="text-muted-foreground text-sm">
            {step === "email" ? "Sign in or create an account with your email." : `Sent to ${email}`}
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {step === "email" ? (
          <form onSubmit={handleRequestOtp} className="flex flex-col gap-3">
            <span className="label-eyebrow">Email</span>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="h-11"
            />
            <Button type="submit" disabled={loading} className="mt-1 h-11 font-semibold">
              {loading ? "Sending..." : "Continue"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="flex flex-col gap-3">
            <span className="label-eyebrow">6-digit code</span>
            <Input
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
              className="h-11 font-mono text-lg tracking-[0.3em]"
            />
            <Button type="submit" disabled={loading} className="mt-1 h-11 font-semibold">
              {loading ? "Verifying..." : "Verify & sign in"}
            </Button>
            <button
              type="button"
              onClick={() => setStep("email")}
              className="text-muted-foreground hover:text-foreground py-1 text-sm transition-colors"
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
