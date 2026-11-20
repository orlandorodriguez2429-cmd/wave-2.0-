import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { prisma } from '@/lib/db';
import { readPendingMfa } from '@/lib/auth';
import { enrollmentSecret } from '@/lib/mfa';
import { newEnrollmentKeyAction } from '@/app/auth-actions';
import { otpauthUrl } from '@/lib/totp';
import { ContinueButton, MfaVerifyForm, MfaEnrollForm } from './mfa-forms';
import { BrandMark } from '@/components/brand-mark';

export const dynamic = 'force-dynamic';

export default async function MfaPage() {
  const pending = await readPendingMfa();
  if (!pending) redirect('/login');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: pending.userId } });

  if (pending.stage === 'verify') {
    return (
      <Shell title="Two-step verification" subtitle="Enter the 6-digit code from your authenticator app.">
        <MfaVerifyForm />
      </Shell>
    );
  }
  if (user.mfaEnabledAt) {
    // Enrolled during this sign-in (e.g. the page was refreshed after the codes were shown).
    return (
      <Shell title="Two-step verification is on" subtitle="Your backup codes were shown once when you set it up.">
        <ContinueButton label="Continue" />
      </Shell>
    );
  }
  const secret = await enrollmentSecret(user.id);
  const url = otpauthUrl(secret, user.email);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 200 });
  return (
    <Shell
      title="Set up two-step verification"
      subtitle="Required by law for accounts that can see client financial data. It takes about a minute."
    >
      <ol className="list-decimal pl-5 text-sm text-slate-600 space-y-1">
        <li>On your phone, install <strong>Google Authenticator</strong> or <strong>Microsoft Authenticator</strong> (free).</li>
        <li>In the app tap <strong>+</strong>, then <strong>Scan a QR code</strong>, and scan the code below.</li>
        <li>Type the 6-digit number the app shows for <strong>Your Tax Solution Books</strong> and press the button before it changes.</li>
      </ol>
      <div className="flex flex-col items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="QR code for your authenticator app" width={200} height={200} className="rounded border border-slate-200" />
        <p className="text-xs text-slate-500">Can&apos;t scan? Enter this key: <code className="select-all break-all">{secret.match(/.{1,4}/g)?.join(' ')}</code></p>
      </div>
      <MfaEnrollForm />
      <form action={newEnrollmentKeyAction}>
        <button className="text-xs text-slate-500 hover:underline">Start over with a new QR code</button>
      </form>
    </Shell>
  );
}

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-100 overflow-y-auto py-8">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <BrandMark />
        <h1 className="text-xl font-semibold text-[var(--brand-navy)]">{title}</h1>
          <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
