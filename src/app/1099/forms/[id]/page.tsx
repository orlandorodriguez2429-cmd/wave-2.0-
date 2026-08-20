import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatAmount, formatMoney } from '@/lib/money';
import { amountsFromJson } from '@/lib/forms1099/forms';
import { BOXES } from '@/lib/forms1099/boxes';
import { ActionButton } from '@/components/action-button';
import { SimpleRecordForm } from '@/components/simple-record-form';
import {
  correctFormAction,
  deliverCopyBAction,
  markReadyAction,
  updateFormAmountsAction,
} from '@/app/forms1099-actions';

export const dynamic = 'force-dynamic';

export default async function FormDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await getCurrentContext();
  const form = await prisma.form1099.findUnique({
    where: { id },
    include: { corrects: { select: { id: true, version: true, submissionId: true } }, correctedBy: { select: { id: true, version: true } } },
  });
  if (!form || form.businessId !== business.id) notFound();
  const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: form.vendorId } });
  const amounts = amountsFromJson(form.amounts);
  const cur = business.functionalCurrency;
  const boxes = BOXES.filter((b) => b.form === form.formKind);
  const filed = ['SUBMITTED', 'ACCEPTED'].includes(form.status);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">
            <Link href="/1099/forms" className="hover:underline">1099 Forms</Link> / {vendor.name}
          </p>
          <h1 className="text-2xl font-semibold mt-1">
            1099-{form.formKind} · {form.taxYear} · v{form.version}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {vendor.name} · status <strong>{form.status.toLowerCase()}</strong>
            {form.submissionId && ` · submission ${form.submissionId}`}
          </p>
          <div className="mt-2 flex gap-2 text-xs">
            {form.corrects && (
              <Link href={`/1099/forms/${form.corrects.id}`} className="rounded bg-violet-100 px-2 py-0.5 text-violet-700 hover:underline">
                Corrects v{form.corrects.version} ({form.corrects.submissionId})
              </Link>
            )}
            {form.correctedBy && (
              <Link href={`/1099/forms/${form.correctedBy.id}`} className="rounded bg-amber-100 px-2 py-0.5 text-amber-700 hover:underline">
                Corrected by v{form.correctedBy.version}
              </Link>
            )}
            {(['A', 'B', 'C'] as const).map((copy) => (
              <a key={copy} href={`/1099/forms/${form.id}/pdf?copy=${copy}`} className="rounded bg-slate-100 px-2 py-0.5 text-slate-600 hover:underline">
                Copy {copy} PDF
              </a>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          {form.status === 'DRAFT' && (
            <ActionButton action={markReadyAction.bind(null, form.id)} label="Mark ready to file" variant="primary" />
          )}
          {filed && !form.correctedBy && (
            <ActionButton
              action={correctFormAction.bind(null, form.id)}
              label="File a correction…"
              confirmLabel="Create correction draft"
            />
          )}
        </div>
      </div>

      {form.rejectionReason && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          Rejected: {form.rejectionReason}
        </p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-2 text-sm">
        <h2 className="font-medium">Box amounts</h2>
        {form.status === 'DRAFT' ? (
          <SimpleRecordForm
            action={updateFormAmountsAction}
            submitLabel="Save amounts"
            fields={[
              { name: 'formId', label: '', defaultValue: form.id, width: 'hidden' },
              ...boxes.flatMap((b) => [
                { name: 'boxNumber', label: '', defaultValue: b.box, width: 'hidden' as const },
                {
                  name: 'boxAmount',
                  label: `Box ${b.box} — ${b.label} (${cur})`,
                  defaultValue: amounts[b.box] ? formatAmount(amounts[b.box], cur) : '',
                  width: 'w-44',
                },
              ]),
            ]}
          />
        ) : (
          boxes.map((b) => (
            <p key={b.box} className="flex justify-between">
              <span>Box {b.box} — {b.label}</span>
              <span className="tabular-nums font-medium">{formatMoney(amounts[b.box] ?? 0n, cur)}</span>
            </p>
          ))
        )}
        {form.status !== 'DRAFT' && (
          <p className="text-xs text-slate-400 pt-2 border-t border-slate-100">
            Filed forms are immutable — corrections create a new linked version.
          </p>
        )}
      </div>

      {filed && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3 text-sm">
          <h2 className="font-medium">Recipient copy (Copy B) — due January 31</h2>
          {form.copyBDeliveredAt ? (
            <p className="text-green-700">
              Delivered {form.copyBDeliveryMethod} on {form.copyBDeliveredAt.toISOString().slice(0, 10)}.
            </p>
          ) : (
            <div className="flex gap-2">
              <ActionButton
                action={deliverCopyBAction.bind(null, form.id, 'electronic')}
                label={vendor.eDeliveryConsentAt ? 'Deliver electronically (consented)' : 'Deliver electronically (no consent!)'}
              />
              <ActionButton action={deliverCopyBAction.bind(null, form.id, 'mail')} label="Mark mailed" />
            </div>
          )}
          {!vendor.eDeliveryConsentAt && (
            <p className="text-xs text-amber-700">
              No e-delivery consent on file — the IRS requires affirmative consent for electronic-only
              delivery; otherwise mail the paper copy.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
