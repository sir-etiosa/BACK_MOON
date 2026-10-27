import { env } from "../../config/env.js";

export interface Mailer {
  send(email: string, subject: string, text: string): Promise<void>;
}

class ConsoleMailer implements Mailer {
  async send(email: string, subject: string, text: string): Promise<void> {
    // Dev-only transport. Swap MAIL_TRANSPORT for a real provider (Resend/Postmark/etc) before go-live.
    console.log(`[mailer] to=${email} subject="${subject}" body="${text}"`);
  }
}

class ResendMailer implements Mailer {
  async send(email: string, subject: string, text: string): Promise<void> {
    if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
    const from = env.MAIL_FROM ?? "onboarding@resend.dev";

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: email, subject, text }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend send failed (${res.status}): ${body}`);
    }
  }
}

function buildMailer(): Mailer {
  switch (env.MAIL_TRANSPORT) {
    case "console":
      return new ConsoleMailer();
    case "resend":
      return new ResendMailer();
    default:
      throw new Error(`Unknown MAIL_TRANSPORT: ${env.MAIL_TRANSPORT}`);
  }
}

export const mailer: Mailer = buildMailer();
