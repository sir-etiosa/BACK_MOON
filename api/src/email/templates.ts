const LOGO_URL = "https://www.moonxch.com/logo.png";

const INK = "#0b0818";
const CARD = "#150f26";
const FOREGROUND = "#ece6fa";
const MUTED = "#a69cc4";
const VIOLET = "#9d5cff";
const GOLD = "#ffd24a";
const BORDER = "#2a2340";

function layout(opts: { preheader: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MoonXch</title>
  </head>
  <body style="margin:0; padding:0; background-color:${INK}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${opts.preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${INK};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px; max-width:100%;">
            <tr>
              <td style="padding-bottom:28px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle; padding-right:10px;">
                      <img src="${LOGO_URL}" width="28" height="28" alt="MoonXch" style="display:block; border-radius:6px;" />
                    </td>
                    <td style="vertical-align:middle;">
                      <span style="font-size:14px; font-weight:700; letter-spacing:0.02em; color:${FOREGROUND};">Moon<span style="color:${GOLD};">Xch</span></span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background-color:${CARD}; border:1px solid ${BORDER}; border-radius:12px; padding:32px;">
                ${opts.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding-top:24px;">
                <p style="margin:0; font-size:12px; line-height:1.6; color:${MUTED};">
                  You're receiving this because it was requested on MoonXch. If this wasn't you, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function otpBlock(code: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
      <tr>
        <td align="center" style="background-color:${INK}; border:1px solid ${BORDER}; border-radius:10px; padding:18px;">
          <span style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace; font-size:32px; font-weight:700; letter-spacing:0.3em; color:${GOLD};">${code}</span>
        </td>
      </tr>
    </table>
    <p style="margin:0; font-size:13px; line-height:1.6; color:${MUTED};">This code expires in 5 minutes. Never share it with anyone — MoonXch staff will never ask you for it.</p>`;
}

export function welcomeOtpEmail(code: string): { subject: string; text: string; html: string } {
  const subject = "Welcome to MoonXch — verify your email";
  const text = `Welcome to MoonXch.\n\nYour verification code is ${code}. It expires in 5 minutes.\n\nIf you didn't request this, you can ignore this email.`;
  const bodyHtml = `
    <h1 style="margin:0 0 6px; font-size:20px; font-weight:700; color:${FOREGROUND};">Welcome to <span style="color:${GOLD};">MoonXch</span>.</h1>
    <p style="margin:0 0 4px; font-size:14px; line-height:1.6; color:${MUTED};">Your account has been created. Enter this code to verify your email and finish signing in.</p>
    ${otpBlock(code)}`;
  return { subject, text, html: layout({ preheader: `Your MoonXch verification code is ${code}`, bodyHtml }) };
}

export function loginOtpEmail(code: string): { subject: string; text: string; html: string } {
  const subject = "Your MoonXch login code";
  const text = `Your login code is ${code}. It expires in 5 minutes.`;
  const bodyHtml = `
    <h1 style="margin:0 0 6px; font-size:20px; font-weight:700; color:${FOREGROUND};">Enter your code.</h1>
    <p style="margin:0 0 4px; font-size:14px; line-height:1.6; color:${MUTED};">Use this code to sign in to your MoonXch account.</p>
    ${otpBlock(code)}`;
  return { subject, text, html: layout({ preheader: `Your MoonXch login code is ${code}`, bodyHtml }) };
}

export function depositCreditedEmail(amount: string, symbol: string): { subject: string; text: string; html: string } {
  const subject = `Deposit received: ${amount} ${symbol}`;
  const text = `We've credited ${amount} ${symbol} to your MoonXch balance. It's available to use now.`;
  const bodyHtml = `
    <h1 style="margin:0 0 6px; font-size:20px; font-weight:700; color:${FOREGROUND};">Deposit received.</h1>
    <p style="margin:0 0 20px; font-size:14px; line-height:1.6; color:${MUTED};">We've credited the following to your MoonXch balance. It's available to use now.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:4px;">
      <tr>
        <td align="center" style="background-color:${INK}; border:1px solid ${BORDER}; border-radius:10px; padding:20px;">
          <span style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace; font-size:28px; font-weight:700; color:${VIOLET};">+${amount}</span>
          <span style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace; font-size:16px; font-weight:600; color:${MUTED};"> ${symbol}</span>
        </td>
      </tr>
    </table>`;
  return { subject, text, html: layout({ preheader: `+${amount} ${symbol} credited to your MoonXch balance`, bodyHtml }) };
}
