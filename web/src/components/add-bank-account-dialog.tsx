"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api, type CashoutBankAccount, ApiError } from "@/lib/api";
import { capitalizeWords } from "@/lib/utils";

interface AddBankAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (account: CashoutBankAccount) => void;
}

export function AddBankAccountDialog({ open, onOpenChange, onAdded }: AddBankAccountDialogProps) {
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { account } = await api.addCashoutAccount(capitalizeWords(bankName.trim()), accountNumber.trim());
      onAdded(account);
      onOpenChange(false);
      setBankName("");
      setAccountNumber("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[320px]">
        <DialogHeader>
          <DialogTitle>Add bank account</DialogTitle>
          <DialogDescription>Payouts only go to accounts in your verified legal name.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="newBankName">Bank name</Label>
            <Input
              id="newBankName"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="h-11"
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="newAccountNumber">Account number</Label>
            <Input
              id="newAccountNumber"
              inputMode="numeric"
              maxLength={10}
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
              className="h-11"
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={loading || !bankName.trim() || accountNumber.length < 10}
              className="h-11 w-full font-semibold"
            >
              {loading ? "Saving..." : "Add account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
