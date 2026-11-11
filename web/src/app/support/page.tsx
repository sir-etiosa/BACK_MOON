"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Mail, MessageCircle, Phone, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { api, getToken, ApiError, type SupportTicket } from "@/lib/api";
import { cn } from "@/lib/utils";

function ticketRef(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function formatTicketDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const INSTAGRAM_URL = "https://instagram.com";
const WHATSAPP_URL = "https://wa.me";

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function SupportPage() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api.getSupportMessages().then((r) => setTickets(r.tickets));
  }, [router]);

  const openTicket = tickets?.find((t) => t.id === openTicketId) ?? null;

  function notifyComingSoon(channel: string) {
    toast.info(`${channel} is coming soon`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.sendSupportMessage(message);
      setSent(true);
      setMessage("");
      const { tickets: refreshed } = await api.getSupportMessages();
      setTickets(refreshed);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!openTicketId || !reply.trim()) return;
    setReplyLoading(true);
    try {
      await api.replySupportTicket(openTicketId, reply);
      setReply("");
      const { tickets: refreshed } = await api.getSupportMessages();
      setTickets(refreshed);
    } catch {
      toast.error("Couldn't send your reply. Try again.");
    } finally {
      setReplyLoading(false);
    }
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
        <h1 className="text-2xl font-bold tracking-tight">Contact support.</h1>
        <p className="text-muted-foreground text-sm">Something not working, or just have a question? Tell us.</p>
      </div>

      <div className="bg-card border-border flex flex-col gap-3 rounded-2xl border p-[18px]">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {sent ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <div className="bg-primary/15 text-primary flex h-11 w-11 items-center justify-center rounded-full">
              <MessageCircle className="size-5" />
            </div>
            <p className="font-semibold">Message sent</p>
            <p className="text-muted-foreground text-sm">We&rsquo;ll reply right here in your support history.</p>
            <Button variant="secondary" className="mt-2 h-11 w-full font-semibold" onClick={() => setSent(false)}>
              Send another message
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <span className="label-eyebrow">Your message</span>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe the issue or question..."
              rows={5}
              required
            />
            <Button type="submit" disabled={loading || !message.trim()} className="h-11 font-semibold">
              {loading ? "Sending..." : "Send message"}
            </Button>
          </form>
        )}
      </div>

      {tickets && tickets.length > 0 && (
        <div className="flex flex-col gap-3">
          <span className="label-eyebrow">Your support history</span>
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
                    <span className="font-mono text-xs font-semibold">#{ticketRef(t.id)}</span>
                    <span
                      className={cn(
                        "label-eyebrow rounded-full px-2 py-0.5",
                        t.status === "OPEN" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {t.status === "OPEN" ? "Open" : "Closed"}
                    </span>
                  </div>
                  {last && <p className="line-clamp-1 text-sm">{last.body}</p>}
                  <span className="text-muted-foreground text-xs">{formatTicketDate(t.updatedAt)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <span className="label-eyebrow">Other ways to reach us</span>
        <div className="bg-card border-border flex flex-col rounded-2xl border px-4">
          <Link
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:bg-accent border-border -mx-4 flex items-center gap-3 border-b px-4 py-3.5 transition-colors"
          >
            <div className="bg-primary/15 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
              <Phone className="size-4" />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-sm font-medium">WhatsApp</span>
              <span className="text-muted-foreground text-xs">Chat with us directly.</span>
            </div>
          </Link>

          <button
            type="button"
            onClick={() => notifyComingSoon("Email support")}
            className="hover:bg-accent border-border -mx-4 flex items-center gap-3 border-b px-4 py-3.5 text-left transition-colors"
          >
            <div className="bg-primary/15 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
              <Mail className="size-4" />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-sm font-medium">Email support</span>
              <span className="text-muted-foreground text-xs">Reach our support inbox.</span>
            </div>
            <span className="bg-muted text-muted-foreground label-eyebrow rounded-full px-2 py-0.5">Soon</span>
          </button>

          <Link
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:bg-accent -mx-4 flex items-center gap-3 px-4 py-3.5 transition-colors"
          >
            <div className="bg-primary/15 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
              <InstagramIcon className="size-4" />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-sm font-medium">Instagram</span>
              <span className="text-muted-foreground text-xs">Follow for updates.</span>
            </div>
          </Link>
        </div>
      </div>

      <Dialog open={openTicketId !== null} onOpenChange={(open) => !open && setOpenTicketId(null)}>
        <DialogContent className="flex max-w-[320px] flex-col">
          {openTicket && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between gap-2 pr-6">
                  <DialogTitle className="font-mono text-base">#{ticketRef(openTicket.id)}</DialogTitle>
                  <span
                    className={cn(
                      "label-eyebrow rounded-full px-2 py-0.5",
                      openTicket.status === "OPEN" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {openTicket.status === "OPEN" ? "Open" : "Closed"}
                  </span>
                </div>
                <DialogDescription>Opened {formatTicketDate(openTicket.createdAt)}</DialogDescription>
              </DialogHeader>

              <div className="flex max-h-80 flex-col gap-2 overflow-y-auto py-1">
                {openTicket.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn("flex flex-col gap-0.5", m.sender === "USER" ? "items-end" : "items-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                        m.sender === "USER" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                      )}
                    >
                      {m.body}
                    </div>
                    <span className="text-muted-foreground text-[10px]">{formatMessageTime(m.createdAt)}</span>
                  </div>
                ))}
              </div>

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
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
