"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOut, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  adminApi,
  getAdminToken,
  clearAdminToken,
  isOwnerAdmin,
  AdminApiError,
  type AdminWithdrawal,
  type AdminAssetRequest,
  type AdminSupportTicket,
  type AdminAccount,
  type AdminCashoutRequest,
} from "@/lib/admin-api";
import { fromSmallestUnits } from "@/lib/units";
import { cn } from "@/lib/utils";

function ticketRef(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function AdminDashboardPage() {
  const router = useRouter();

  const [tickets, setTickets] = useState<AdminSupportTicket[] | null>(null);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);

  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[] | null>(null);
  const [markSentId, setMarkSentId] = useState<string | null>(null);
  const [txHash, setTxHash] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const [assetRequests, setAssetRequests] = useState<AdminAssetRequest[] | null>(null);

  const isOwner = isOwnerAdmin();
  const [cashoutRequests, setCashoutRequests] = useState<AdminCashoutRequest[] | null>(null);
  const [cashoutActionLoading, setCashoutActionLoading] = useState(false);

  const [rate, setRate] = useState<number | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [rateLoading, setRateLoading] = useState(false);

  const [admins, setAdmins] = useState<AdminAccount[] | null>(null);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [adminCreateLoading, setAdminCreateLoading] = useState(false);

  useEffect(() => {
    if (!getAdminToken()) {
      router.push("/admin/login");
      return;
    }
    function handleAuthError(err: unknown) {
      if (err instanceof AdminApiError && err.status === 401) {
        router.push("/admin/login");
      }
    }
    adminApi
      .getSupportTickets()
      .then((r) => setTickets(r.tickets))
      .catch(handleAuthError);
    adminApi
      .getWithdrawals()
      .then((r) => setWithdrawals(r.withdrawals))
      .catch(handleAuthError);
    adminApi
      .getAssetRequests()
      .then((r) => setAssetRequests(r.requests))
      .catch(handleAuthError);
    adminApi
      .getCashoutRequests()
      .then((r) => setCashoutRequests(r.requests))
      .catch(handleAuthError);
    if (isOwner) {
      adminApi
        .getRate()
        .then((r) => setRate(r.rate))
        .catch(handleAuthError);
      adminApi
        .getAdmins()
        .then((r) => setAdmins(r.admins))
        .catch(handleAuthError);
    }
  }, [router, isOwner]);

  function handleLogout() {
    clearAdminToken();
    router.push("/admin/login");
  }

  const openTicket = tickets?.find((t) => t.id === openTicketId) ?? null;

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!openTicketId || !reply.trim()) return;
    setReplyLoading(true);
    try {
      await adminApi.replySupportTicket(openTicketId, reply);
      setReply("");
      const { tickets: refreshed } = await adminApi.getSupportTickets();
      setTickets(refreshed);
    } catch {
      toast.error("Couldn't send reply.");
    } finally {
      setReplyLoading(false);
    }
  }

  async function handleClearTicket(id: string) {
    try {
      await adminApi.clearSupportTicket(id);
      const { tickets: refreshed } = await adminApi.getSupportTickets();
      setTickets(refreshed);
      setOpenTicketId(null);
      toast.success("Ticket cleared");
    } catch {
      toast.error("Couldn't clear ticket.");
    }
  }

  async function handleMarkSent(e: React.FormEvent) {
    e.preventDefault();
    if (!markSentId || !txHash.trim()) return;
    setActionLoading(true);
    try {
      await adminApi.markWithdrawalSent(markSentId, txHash.trim());
      setMarkSentId(null);
      setTxHash("");
      const { withdrawals: refreshed } = await adminApi.getWithdrawals();
      setWithdrawals(refreshed);
      toast.success("Marked sent");
    } catch (err) {
      toast.error(err instanceof AdminApiError ? err.message : "Couldn't mark sent.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirm(id: string) {
    try {
      await adminApi.confirmWithdrawal(id);
      const { withdrawals: refreshed } = await adminApi.getWithdrawals();
      setWithdrawals(refreshed);
      toast.success("Confirmed");
    } catch (err) {
      toast.error(err instanceof AdminApiError ? err.message : "Couldn't confirm.");
    }
  }

  async function handleReject(id: string) {
    try {
      await adminApi.rejectWithdrawal(id);
      const { withdrawals: refreshed } = await adminApi.getWithdrawals();
      setWithdrawals(refreshed);
      toast.success("Rejected and refunded");
    } catch (err) {
      toast.error(err instanceof AdminApiError ? err.message : "Couldn't reject.");
    }
  }

  async function handleMarkCashoutPaid(id: string) {
    setCashoutActionLoading(true);
    try {
      await adminApi.markCashoutPaid(id);
      const { requests: refreshed } = await adminApi.getCashoutRequests();
      setCashoutRequests(refreshed);
      toast.success("Marked paid");
    } catch (err) {
      toast.error(err instanceof AdminApiError ? err.message : "Couldn't mark paid.");
    } finally {
      setCashoutActionLoading(false);
    }
  }

  async function handleRejectCashout(id: string) {
    setCashoutActionLoading(true);
    try {
      await adminApi.rejectCashoutRequest(id);
      const { requests: refreshed } = await adminApi.getCashoutRequests();
      setCashoutRequests(refreshed);
      toast.success("Rejected and refunded");
    } catch (err) {
      toast.error(err instanceof AdminApiError ? err.message : "Couldn't reject.");
    } finally {
      setCashoutActionLoading(false);
    }
  }

  async function handleSetRate(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Number(rateInput);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setRateLoading(true);
    try {
      const { rate: saved } = await adminApi.setRate(parsed);
      setRate(saved);
      setRateInput("");
      toast.success("Rate updated");
    } catch (err) {
      toast.error(err instanceof AdminApiError ? err.message : "Couldn't update rate.");
    } finally {
      setRateLoading(false);
    }
  }

  async function handleCreateSubAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (!newAdminEmail.trim() || newAdminPassword.length < 12) return;
    setAdminCreateLoading(true);
    try {
      await adminApi.createSubAdmin(newAdminEmail.trim(), newAdminPassword);
      const { admins: refreshed } = await adminApi.getAdmins();
      setAdmins(refreshed);
      setNewAdminEmail("");
      setNewAdminPassword("");
      toast.success("Sub-admin created");
    } catch (err) {
      toast.error(err instanceof AdminApiError ? err.message : "Couldn't create sub-admin.");
    } finally {
      setAdminCreateLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full min-h-screen max-w-2xl flex-col gap-6 px-5 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">
          Moon<span className="text-primary">Xch</span> admin
        </h1>
        <Button variant="destructive" size="xs" onClick={handleLogout}>
          <LogOut className="size-3.5" />
          Log out
        </Button>
      </div>

      <Tabs defaultValue="support">
        <TabsList>
          <TabsTrigger value="support">Support</TabsTrigger>
          <TabsTrigger value="withdrawals">Withdrawals</TabsTrigger>
          <TabsTrigger value="cashouts">Cash-outs</TabsTrigger>
          <TabsTrigger value="requests">Asset requests</TabsTrigger>
          {isOwner && <TabsTrigger value="rate">Rate</TabsTrigger>}
          {isOwner && <TabsTrigger value="admins">Admins</TabsTrigger>}
        </TabsList>

        <TabsContent value="support" className="flex flex-col gap-2 pt-4">
          {tickets === null ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : tickets.length === 0 ? (
            <p className="text-muted-foreground text-sm">No support tickets.</p>
          ) : (
            <div className="bg-card border-border flex flex-col rounded-2xl border px-4">
              {tickets.map((t, i) => {
                const last = t.messages[t.messages.length - 1];
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setOpenTicketId(t.id)}
                    className={cn(
                      "hover:bg-accent -mx-4 flex flex-col gap-1 px-4 py-3.5 text-left transition-colors",
                      i > 0 && "border-border border-t",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{t.user.email}</span>
                      <span
                        className={cn(
                          "label-eyebrow rounded-full px-2 py-0.5",
                          t.status === "OPEN" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {t.status === "OPEN" ? "Open" : "Closed"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">#{ticketRef(t.id)}</span>
                      <span className="text-muted-foreground text-xs">{formatDate(t.updatedAt)}</span>
                    </div>
                    {last && <p className="text-muted-foreground line-clamp-1 text-sm">{last.body}</p>}
                  </button>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="withdrawals" className="flex flex-col gap-2 pt-4">
          {withdrawals === null ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : withdrawals.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing awaiting action.</p>
          ) : (
            <div className="bg-card border-border flex flex-col rounded-2xl border px-4">
              {withdrawals.map((w, i) => (
                <div
                  key={w.id}
                  className={cn("flex flex-col gap-2 py-3.5", i > 0 && "border-border border-t")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{w.user.email}</span>
                    <span className="label-eyebrow bg-muted text-muted-foreground rounded-full px-2 py-0.5">
                      {w.status}
                    </span>
                  </div>
                  <div data-numeric className="font-mono text-sm">
                    {fromSmallestUnits(w.amount, w.asset.decimals)} {w.asset.symbol}
                  </div>
                  <div className="text-muted-foreground font-mono text-xs break-all">{w.toAddress}</div>
                  <span className="text-muted-foreground text-xs">{formatDate(w.requestedAt)}</span>
                  <div className="flex gap-2">
                    {(w.status === "PENDING" || w.status === "APPROVED") && (
                      <>
                        <Button size="sm" onClick={() => setMarkSentId(w.id)}>
                          Mark sent
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleReject(w.id)}>
                          Reject
                        </Button>
                      </>
                    )}
                    {w.status === "SENT" && (
                      <Button size="sm" onClick={() => handleConfirm(w.id)}>
                        Confirm
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="cashouts" className="flex flex-col gap-2 pt-4">
          {cashoutRequests === null ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : cashoutRequests.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing awaiting action.</p>
          ) : (
            <div className="bg-card border-border flex flex-col rounded-2xl border px-4">
              {cashoutRequests.map((r, i) => (
                <div key={r.id} className={cn("flex flex-col gap-2 py-3.5", i > 0 && "border-border border-t")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{r.user.email}</span>
                    <span className="label-eyebrow bg-muted text-muted-foreground rounded-full px-2 py-0.5">
                      {r.status}
                    </span>
                  </div>
                  <div data-numeric className="font-mono text-sm">
                    ₦{Number(r.ngnAmount).toLocaleString()}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {r.bankName} &middot; {r.accountNumber} &middot; {r.accountName}
                  </div>
                  <span className="text-muted-foreground text-xs">{formatDate(r.requestedAt)}</span>
                  {r.status === "PENDING" && (
                    <div className="flex gap-2">
                      <Button size="sm" disabled={cashoutActionLoading} onClick={() => handleMarkCashoutPaid(r.id)}>
                        Mark paid
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={cashoutActionLoading}
                        onClick={() => handleRejectCashout(r.id)}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="requests" className="flex flex-col gap-2 pt-4">
          {assetRequests === null ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : assetRequests.length === 0 ? (
            <p className="text-muted-foreground text-sm">No requests yet.</p>
          ) : (
            <div className="bg-card border-border flex flex-col rounded-2xl border px-4">
              {assetRequests.map((r, i) => (
                <div key={r.id} className={cn("flex flex-col gap-0.5 py-3.5", i > 0 && "border-border border-t")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {r.tokenName} &middot; {r.network}
                    </span>
                    <span className="text-muted-foreground text-xs">{formatDate(r.createdAt)}</span>
                  </div>
                  <span className="text-muted-foreground text-xs">{r.user.email}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {isOwner && (
          <TabsContent value="rate" className="flex flex-col gap-3 pt-4">
            <div className="bg-card border-border flex flex-col gap-3 rounded-2xl border p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground text-xs">Current rate</span>
                <span className="font-mono text-lg font-semibold">
                  {rate === null ? "Not set" : `₦${rate.toLocaleString()} / $1`}
                </span>
              </div>
              <form onSubmit={handleSetRate} className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor="rateInput">New USD → NGN rate</Label>
                  <Input
                    id="rateInput"
                    inputMode="decimal"
                    placeholder="e.g. 1360"
                    value={rateInput}
                    onChange={(e) => setRateInput(e.target.value)}
                    className="h-11"
                  />
                </div>
                <Button type="submit" disabled={rateLoading || !rateInput} className="h-11 font-semibold">
                  {rateLoading ? "Saving..." : "Set rate"}
                </Button>
              </form>
              <p className="text-muted-foreground text-xs">
                This rate prices every cash-out request and the app&rsquo;s NGN balance display.
              </p>
            </div>
          </TabsContent>
        )}

        {isOwner && (
          <TabsContent value="admins" className="flex flex-col gap-3 pt-4">
            <form
              onSubmit={handleCreateSubAdmin}
              className="bg-card border-border flex flex-col gap-3 rounded-2xl border p-4"
            >
              <span className="text-sm font-semibold">Create sub-admin</span>
              <div className="flex flex-col gap-1">
                <Label htmlFor="newAdminEmail">Email</Label>
                <Input
                  id="newAdminEmail"
                  type="email"
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  className="h-11"
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="newAdminPassword">Password</Label>
                <Input
                  id="newAdminPassword"
                  type="password"
                  minLength={12}
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.target.value)}
                  className="h-11"
                  required
                />
              </div>
              <Button type="submit" disabled={adminCreateLoading} className="h-11 font-semibold">
                {adminCreateLoading ? "Creating..." : "Create sub-admin"}
              </Button>
            </form>

            {admins === null ? (
              <p className="text-muted-foreground text-sm">Loading...</p>
            ) : (
              <div className="bg-card border-border flex flex-col rounded-2xl border px-4">
                {admins.map((a, i) => (
                  <div
                    key={a.id}
                    className={cn("flex items-center justify-between gap-2 py-3.5", i > 0 && "border-border border-t")}
                  >
                    <span className="text-sm font-medium">{a.email}</span>
                    <span className="label-eyebrow bg-muted text-muted-foreground rounded-full px-2 py-0.5">
                      {a.role}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={openTicketId !== null} onOpenChange={(open) => !open && setOpenTicketId(null)}>
        <DialogContent className="flex max-w-[360px] flex-col">
          {openTicket && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between gap-2 pr-6">
                  <DialogTitle className="text-base">{openTicket.user.email}</DialogTitle>
                  <span
                    className={cn(
                      "label-eyebrow rounded-full px-2 py-0.5",
                      openTicket.status === "OPEN" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {openTicket.status === "OPEN" ? "Open" : "Closed"}
                  </span>
                </div>
                <DialogDescription className="font-mono text-xs">#{ticketRef(openTicket.id)}</DialogDescription>
              </DialogHeader>

              <div className="flex max-h-80 flex-col gap-2 overflow-y-auto py-1">
                {openTicket.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn("flex flex-col gap-0.5", m.sender === "ADMIN" ? "items-end" : "items-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                        m.sender === "ADMIN" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                      )}
                    >
                      {m.body}
                    </div>
                    <span className="text-muted-foreground text-[10px]">{formatDate(m.createdAt)}</span>
                  </div>
                ))}
              </div>

              {openTicket.status === "OPEN" ? (
                <>
                  <form onSubmit={handleReply} className="flex items-end gap-2 pt-1">
                    <Textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Write a reply..."
                      rows={1}
                      className="min-h-9 resize-none"
                    />
                    <Button
                      type="submit"
                      size="icon"
                      disabled={replyLoading || !reply.trim()}
                      aria-label="Send reply"
                      className="shrink-0"
                    >
                      <Send className="size-4" />
                    </Button>
                  </form>
                  <Button variant="secondary" className="font-semibold" onClick={() => handleClearTicket(openTicket.id)}>
                    Clear ticket
                  </Button>
                </>
              ) : (
                <p className="text-muted-foreground pt-1 text-sm">
                  This ticket is closed and no longer visible to the user.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={markSentId !== null} onOpenChange={(open) => !open && setMarkSentId(null)}>
        <DialogContent className="max-w-[320px]">
          <DialogHeader>
            <DialogTitle>Mark as sent</DialogTitle>
            <DialogDescription>Paste the on-chain transaction hash you sent from the phone wallet.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleMarkSent} className="flex flex-col gap-3">
            <Input
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              placeholder="Transaction hash"
              className="h-11"
              required
            />
            <DialogFooter>
              <Button type="submit" disabled={actionLoading} className="h-11 w-full font-semibold">
                {actionLoading ? "Saving..." : "Mark sent"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
