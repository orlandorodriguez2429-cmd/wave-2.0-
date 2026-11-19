'use client';

// W-9 data entry form, used both by the public contractor page (/w9/[token])
// and the owner-side manual entry. TIN is a password-type field; the value is
// only ever transmitted to the server action, encrypted at rest, and echoed
// back masked.
import { useActionState } from 'react';
import type { ActionResult } from '@/app/actions';

const ENTITY_TYPES = [
  ['INDIVIDUAL_SOLE_PROP', 'Individual / sole proprietor'],
  ['C_CORP', 'C corporation'],
  ['S_CORP', 'S corporation'],
  ['PARTNERSHIP', 'Partnership'],
  ['TRUST_ESTATE', 'Trust / estate'],
  ['LLC_C', 'LLC taxed as C corp'],
  ['LLC_S', 'LLC taxed as S corp'],
  ['LLC_P', 'LLC taxed as partnership'],
  ['OTHER', 'Other'],
] as const;

export function W9Form({
  action,
  hidden,
  isPublic,
  submitLabel,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  /** Hidden fields, e.g. { vendorId } or { token }. */
  hidden: Record<string, string>;
  isPublic?: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});
  const input = 'w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm';
  const label = 'block text-xs font-medium text-slate-500 mb-1';

  if (Object.keys(state).length > 0 && !state.error) {
    return (
      <p className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
        W-9 information saved. {isPublic ? 'You can close this page — thank you!' : ''}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={label}>Legal name (as on tax return)</span>
          <input name="legalName" required className={input} />
        </label>
        <label>
          <span className={label}>Business name / DBA (optional)</span>
          <input name="businessName" className={input} />
        </label>
        <label>
          <span className={label}>Federal tax classification</span>
          <select name="taxEntityType" className={`${input} bg-white`}>
            {ENTITY_TYPES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <div className="flex gap-3">
          <label className="flex-1">
            <span className={label}>TIN (SSN or EIN)</span>
            <input
              name="tin"
              type="password"
              inputMode="numeric"
              placeholder="•••••••••"
              required
              autoComplete="off"
              className={input}
            />
          </label>
          <label>
            <span className={label}>Type</span>
            <select name="tinType" className={`${input} bg-white`}>
              <option value="SSN">SSN</option>
              <option value="EIN">EIN</option>
            </select>
          </label>
        </div>
        <label className="sm:col-span-2">
          <span className={label}>Street address</span>
          <input name="taxStreet" required className={input} />
        </label>
        <label>
          <span className={label}>City</span>
          <input name="taxCity" required className={input} />
        </label>
        <div className="flex gap-3">
          <label className="w-24">
            <span className={label}>State</span>
            <input name="taxState" required maxLength={2} placeholder="NY" className={input} />
          </label>
          <label className="flex-1">
            <span className={label}>ZIP</span>
            <input name="taxZip" required placeholder="10013" className={input} />
          </label>
        </div>
      </div>
      <div className="space-y-2 text-sm text-slate-600">
        <label className="flex items-start gap-2">
          <input type="checkbox" name="backupWithholding" className="mt-0.5" />
          <span>I am subject to backup withholding.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="eDeliveryConsent" className="mt-0.5" />
          <span>
            I consent to receive my 1099 recipient copy (Copy B) <strong>electronically only</strong>. Without
            this consent a paper copy is mailed.
          </span>
        </label>
        {isPublic && (
          <label className="flex items-start gap-2">
            <input type="checkbox" name="certify" required className="mt-0.5" />
            <span>
              Under penalties of perjury, I certify the information provided is correct (per Form W-9
              certification instructions).
            </span>
          </label>
        )}
      </div>
      {state.error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-teal-600 px-5 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
