import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { W9Form } from '@/components/w9-form';
import { submitW9PublicAction } from '@/app/vendor-actions';

export const dynamic = 'force-dynamic';

// Public contractor-facing W-9 form, addressed by an unguessable token.
// The TIN goes straight to the server action and is stored encrypted; it is
// never echoed back.
export default async function PublicW9Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const vendor = await prisma.vendor.findUnique({
    where: { w9RequestToken: token },
    include: { business: { select: { name: true } } },
  });
  if (!vendor || vendor.w9Status !== 'REQUESTED') notFound();

  return (
    <div className="fixed inset-0 overflow-auto bg-slate-100 py-10">
      <div className="mx-auto max-w-2xl space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">Form W-9 — Request for Taxpayer Identification Number</h1>
          <p className="text-sm text-slate-500 mt-1">
            <strong>{vendor.business.name}</strong> has requested your taxpayer information to prepare
            information returns (1099). Your TIN is encrypted at rest and never displayed unmasked.
          </p>
        </div>
        <W9Form action={submitW9PublicAction} hidden={{ token }} isPublic submitLabel="Submit W-9" />
      </div>
    </div>
  );
}
