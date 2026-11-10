import { prisma } from '@/lib/db';
import { findInvite, MIN_PASSWORD_LENGTH } from '@/lib/invites';
import { AcceptInviteForm } from './accept-form';

export const dynamic = 'force-dynamic';

const PROBLEMS = {
  invalid: 'This invitation link is not valid.',
  used: 'This invitation link was already used. Sign in instead.',
  revoked: 'This invitation was replaced by a newer one. Use the latest email.',
  expired: 'This invitation link has expired (links last 72 hours). Ask your bookkeeper for a new one.',
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await findInvite(token);
  const business = found.invite ? await prisma.business.findUnique({ where: { id: found.invite.businessId } }) : null;
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-teal-700">Your Tax Solution Books</h1>
        {!found.invite || !business ? (
          <p className="text-sm text-slate-600">{PROBLEMS[found.problem ?? 'invalid']}</p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              You&apos;ve been invited to view the books for <strong>{business.name}</strong> as <strong>{found.invite.email}</strong>.
              {found.existingUser ? ' Enter your existing password to accept.' : ' Choose a password to finish.'}
            </p>
            <AcceptInviteForm token={token} existingUser={!!found.existingUser} minLength={MIN_PASSWORD_LENGTH} />
            <p className="text-xs text-slate-400">Next you&apos;ll set up two-step verification with an authenticator app.</p>
          </>
        )}
      </div>
    </div>
  );
}
