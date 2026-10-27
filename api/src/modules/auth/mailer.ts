import { env } from "../../config/env.js";

export interface Mailer {
  sendOtp(email: string, code: string): Promise<void>;
}

class ConsoleMailer implements Mailer {
  async sendOtp(email: string, code: string): Promise<void> {
    // Dev-only transport. Swap MAIL_TRANSPORT for a real provider (Resend/Postmark/etc) before go-live.
    console.log(`[mailer] OTP for ${email}: ${code}`);
  }
}

function buildMailer(): Mailer {
  switch (env.MAIL_TRANSPORT) {
    case "console":
      return new ConsoleMailer();
    case "resend":
      throw new Error("Resend transport not wired up yet — set MAIL_TRANSPORT=console for now");
    default:
      throw new Error(`Unknown MAIL_TRANSPORT: ${env.MAIL_TRANSPORT}`);
  }
}

export const mailer: Mailer = buildMailer();
