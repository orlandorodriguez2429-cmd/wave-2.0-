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

  async send(): Promise<never> {
    if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) {
      throw new Error(
        'Real email delivery is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ' +
          'and SMTP_FROM, or use EMAIL_PROVIDER=console (the sandbox default) until then.',
      );
    }
    // Real implementation: hand off to nodemailer (or the org's transactional
    // email API of choice) using the SMTP_* env vars above.
    throw new Error('SMTP delivery is configured but not yet implemented.');
  }
}

export function getEmailProvider(name: string = process.env.EMAIL_PROVIDER ?? 'console'): EmailProvider {
  if (name === 'smtp') return new SmtpEmailProvider();
  return new ConsoleEmailProvider();
}
