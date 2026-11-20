import { redirect } from 'next/navigation';
import { readSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { firmIdentity, needsConsent, TERMS_EFFECTIVE } from '@/lib/legal';
import { ConsentForm } from './consent-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Privacy notice and terms · Your Tax Solution Books' };

export default async function ConsentPage() {
  const session = await readSession();
  if (!session) redirect('/login');
  const user = await prisma.user.findUnique({ where: { id: session.userId }, include: { memberships: true } });
  if (!user) redirect('/login');
  const isClient = user.memberships.some((m) => m.role === 'CLIENT');
  if (!needsConsent(user)) redirect(isClient ? '/client' : '/');
  const firm = firmIdentity();
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-xl px-6 py-12">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/yts-logo.jpg" alt="Your Tax Solution" className="h-14 w-auto" />
          <h1 className="text-xl font-semibold text-slate-900">Before you continue</h1>
          <p className="text-sm text-slate-600">
            {firm.legalName} keeps your books and prepares tax filings with this system. Please read how we handle your
            information (effective {TERMS_EFFECTIVE}):
          </p>
          <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
            <li>We use your financial information only to keep your books and prepare your tax filings, including 1099s.</li>
            <li>Bank connections go through Plaid. Your bank password goes to your bank through Plaid — we never see or store it.</li>
            <li>We do not sell your information or share it for marketing.</li>
            <li>Service providers (hosting, Plaid, email, and an AI service that sees only masked transaction text) process data for us under contract.</li>
          </ul>
          <p className="text-sm">
            <a href="/privacy" target="_blank" className="text-teal-700 underline">Privacy notice</a> ·{' '}
            <a href="/terms" target="_blank" className="text-teal-700 underline">Terms of use</a>
          </p>
          <ConsentForm isClient={isClient} />
        </div>
      </div>
    </div>
  );
}
