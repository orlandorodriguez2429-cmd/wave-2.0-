// Outbound email behind one interface, same pattern as bank feeds (Plaid),
// invoice payments (Stripe), and e-file (IRIS): a working sandbox by default,
// a real adapter behind env config.
//
// ConsoleEmailProvider is the sandbox: it "sends" by returning a deterministic
// fake message id — callers still get a real EmailMessage row recorded (see
// src/lib/invoicing/reminders.ts), so the audit trail and UI are real even
// though no network call happens. SmtpEmailProvider is the real path, gated
// behind SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM; without them it
// fails loudly instead of silently no-op'ing.

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

export interface SendResult {
  providerMessageId: string;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutboundEmail): Promise<SendResult>;
}

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  async send(email: OutboundEmail): Promise<SendResult> {
    console.log(`[email:sandbox] to=${email.to} subject="${email.subject}"\n${email.text}\n`);
    return { providerMessageId: `SANDBOX-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  }
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';

  async send(email: OutboundEmail): Promise<SendResult> {
    const host = process.env.SMTP_HOST;
    const from = process.env.SMTP_FROM;
    if (!host || !from) {
      throw new Error(
        'Real email delivery is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ' +
          'and SMTP_FROM, or use EMAIL_PROVIDER=console (the sandbox default) until then.',
      );
    }
    const { createTransport } = await import('nodemailer');
    const port = Number(process.env.SMTP_PORT ?? 587);
    const transport = createTransport({
      host,
      port,
      secure: port === 465, // 587 upgrades with STARTTLS
      requireTLS: port !== 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
    });
    const info = await transport.sendMail({ from, to: email.to, subject: email.subject, text: email.text });
    return { providerMessageId: String(info.messageId ?? `smtp-${Date.now()}`) };
  }
}

export function getEmailProvider(name: string = process.env.EMAIL_PROVIDER ?? 'console'): EmailProvider {
  if (name === 'smtp') return new SmtpEmailProvider();
  return new ConsoleEmailProvider();
}
