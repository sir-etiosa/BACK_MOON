"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import confetti from "canvas-confetti";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  api,
  getLastEmail,
  setLastEmail,
  getToken,
  setToken,
  wasExplicitLogout,
  clearExplicitLogout,
  ApiError,
} from "@/lib/api";

type Step =
  | "landing"
  | "email-password"
  | "password"
  | "signup-email"
  | "otp"
  | "creating-wallet"
  | "set-password";

const COPY: Record<Step, { title: string; subtitle: (email: string) => string }> = {
  landing: {
    title: "Welcome back.",
    subtitle: () => "Choose how you'd like to continue.",
  },
  "email-password": {
    title: "Deposit, swap, cash out.",
    subtitle: () => "Sign in or create an account with your email.",
  },
  password: {
    title: "Welcome back.",
    subtitle: (email) => `Enter your password for ${email}.`,
  },
  "signup-email": {
    title: "Create your account.",
    subtitle: () => "We'll email you a code to verify.",
  },
  otp: {
    title: "Enter your code.",
    subtitle: (email) => `Sent to ${email}`,
  },
  "creating-wallet": {
    title: "Setting up your wallet.",
    subtitle: () => "Creating your deposit addresses — this only takes a second.",
  },
  "set-password": {
    title: "Create a password.",
    subtitle: () => "You'll use this to sign in next time.",
  },
};

function fireConfetti() {
  const colors = ["#ffd24a", "#9d5cff", "#ece6fa", "#4ed9a4"];
  const defaults = { colors, zIndex: 1000 };
  confetti({ ...defaults, particleCount: 90, spread: 100, startVelocity: 45, origin: { y: 0.55 } });
  setTimeout(() => confetti({ ...defaults, particleCount: 60, angle: 60, spread: 60, origin: { x: 0, y: 0.6 } }), 150);
  setTimeout(() => confetti({ ...defaults, particleCount: 60, angle: 120, spread: 60, origin: { x: 1, y: 0.6 } }), 150);
  setTimeout(() => confetti({ ...defaults, particleCount: 50, spread: 120, startVelocity: 35, origin: { y: 0.4 } }), 350);
}

export default function LoginPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step | null>(null);
  const [rememberedEmail, setRememberedEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCongrats, setShowCongrats] = useState(false);

  useEffect(() => {
    if (getToken()) {
      router.replace("/dashboard");
      return;
    }
    queueMicrotask(() => {
      const remembered = getLastEmail();
      if (remembered && wasExplicitLogout()) {
        setRememberedEmail(remembered);
        setEmail(remembered);
        setStep("password");
      } else if (remembered) {
        setRememberedEmail(remembered);
        setEmail(remembered);
        setStep("landing");
      } else {
        setStep("email-password");
      }
    });
  }, [router]);

  async function handleContinueAsRemembered() {
    setError(null);
    setLoading(true);
    const token = await api.refresh();
    setLoading(false);
    if (token) {
      clearExplicitLogout();
      router.push("/dashboard");
      return;
    }
    setPassword("");
    setStep("password");
  }

  async function handleEmailPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { hasPassword } = await api.identify(email);
      if (hasPassword) {
        const { accessToken } = await api.loginWithPassword(email, password);
        setToken(accessToken);
        setLastEmail(email);
        clearExplicitLogout();
        router.push("/dashboard");
      } else {
        await api.requestOtp(email);
        setStep("otp");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignupEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.requestOtp(email);
      setStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { accessToken } = await api.loginWithPassword(email, password);
      setToken(accessToken);
      setLastEmail(email);
      clearExplicitLogout();
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { accessToken, needsPassword } = await api.verifyOtp(email, code);
      setToken(accessToken);
      if (!needsPassword) {
        setLastEmail(email);
        clearExplicitLogout();
        router.push("/dashboard");
        return;
      }
      setStep("creating-wallet");
      try {
        await api.getAddresses();
      } catch {}
      setStep("set-password");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleSetPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    try {
      await api.setPassword(newPassword);
      setLastEmail(email);
      clearExplicitLogout();
      setShowCongrats(true);
      fireConfetti();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function goToFreshEntry() {
    setEmail("");
    setPassword("");
    setError(null);
    setStep("email-password");
  }

  function goToSignup() {
    setEmail("");
    setPassword("");
    setError(null);
    setStep("signup-email");
  }

  if (!step) return null;

  const { title, subtitle } = COPY[step];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-[340px] flex-col gap-10">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="" width={32} height={32} className="rounded-md" />
          <span className="text-sm font-bold tracking-tight">
            Moon<span className="text-primary">Xch</span>
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <h1 className="text-3xl leading-tight font-bold tracking-tight">
            {step === "email-password" ? (
              <>
                Deposit, swap, <span className="text-primary">cash out.</span>
              </>
            ) : (
              title
            )}
          </h1>
          <p className="text-muted-foreground text-sm">{subtitle(email)}</p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {step === "landing" && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleContinueAsRemembered}
              disabled={loading}
              className="border-border hover:bg-accent flex items-center gap-3 rounded-xl border p-3.5 text-left transition-colors disabled:opacity-60"
            >
              <div className="bg-primary/15 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold">
                {rememberedEmail?.[0]?.toUpperCase()}
              </div>
              <div className="flex flex-1 flex-col overflow-hidden">
                <span className="text-muted-foreground label-eyebrow">Continue as</span>
                <span className="truncate font-medium">{rememberedEmail}</span>
              </div>
              <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
            </button>
            <Button variant="secondary" disabled={loading} onClick={goToFreshEntry} className="h-11 font-semibold">
              Log in with another email
            </Button>
            <Button disabled={loading} onClick={goToSignup} className="h-11 font-semibold">
              Sign up
            </Button>
          </div>
        )}

        {step === "email-password" && (
          <form onSubmit={handleEmailPasswordSubmit} className="flex flex-col gap-3">
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
            <span className="label-eyebrow mt-1">Password</span>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11"
            />
            <Button type="submit" disabled={loading} className="mt-1 h-11 font-semibold">
              {loading ? "Checking..." : "Login"}
            </Button>
            <Button type="button" disabled={loading} onClick={goToSignup} className="h-11 font-semibold">
              Sign up
            </Button>
            {rememberedEmail && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep("landing");
                }}
                className="text-muted-foreground hover:text-foreground py-1 text-sm transition-colors"
              >
                Back
              </button>
            )}
          </form>
        )}

        {step === "signup-email" && (
          <form onSubmit={handleSignupEmailSubmit} className="flex flex-col gap-3">
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
              {loading ? "Sending code..." : "Sign up"}
            </Button>
            <button
              type="button"
              onClick={goToFreshEntry}
              className="text-muted-foreground hover:text-foreground py-1 text-sm transition-colors"
            >
              Already have an account? Log in
            </button>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="label-eyebrow">Password</span>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep("landing");
                }}
                className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              >
                Not you?
              </button>
            </div>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              className="h-11"
            />
            <Button type="submit" disabled={loading} className="mt-1 h-11 font-semibold">
              {loading ? "Signing in..." : "Log in"}
            </Button>
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={handleOtpSubmit} className="flex flex-col gap-3">
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
              {loading ? "Verifying..." : "Verify & continue"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setCode("");
                setError(null);
                setStep("email-password");
              }}
              className="text-muted-foreground hover:text-foreground py-1 text-sm transition-colors"
            >
              Use a different email
            </button>
          </form>
        )}

        {step === "creating-wallet" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="border-border border-t-primary h-8 w-8 animate-spin rounded-full border-2" />
          </div>
        )}

        {step === "set-password" && (
          <form onSubmit={handleSetPasswordSubmit} className="flex flex-col gap-3">
            <span className="label-eyebrow">New password</span>
            <Input
              type="password"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoFocus
              className="h-11"
            />
            <span className="label-eyebrow mt-1">Confirm password</span>
            <Input
              type="password"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              className="h-11"
            />
            <Button type="submit" disabled={loading} className="mt-1 h-11 font-semibold">
              {loading ? "Saving..." : "Finish setup"}
            </Button>
          </form>
        )}
      </div>

      <Dialog open={showCongrats} onOpenChange={setShowCongrats}>
        <DialogContent className="max-w-[320px]">
          <DialogHeader>
            <div className="bg-primary animate-in zoom-in-50 mb-2 flex h-11 w-11 items-center justify-center rounded-full duration-500 ease-out">
              <CheckIcon
                className="text-primary-foreground animate-in zoom-in-0 size-6 delay-200 duration-300 ease-out fill-mode-both"
                strokeWidth={3}
              />
            </div>
            <DialogTitle className="text-xl">You&rsquo;re all set!</DialogTitle>
            <DialogDescription>
              Your MoonXch account is ready. Your deposit addresses have been created — head to your dashboard to get
              started.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button className="h-11 w-full font-semibold" onClick={() => router.push("/dashboard")}>
              Go to dashboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
