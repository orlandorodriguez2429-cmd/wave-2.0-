// FTC Safeguards Rule (16 CFR Part 314) duties for the office, the live
// checks the app can make itself, and breach-notification deadlines
// (FTC: 30 days for 500+ people with unencrypted data; Florida §501.171:
// individuals within 30 days, Attorney General if 500+ Floridians).
import { prisma } from '@/lib/db';
import { firmIdentity } from '@/lib/legal';

export interface Duty {
  key: string;
  label: string;
  everyMonths: number;
  rule: string;
  how: string;
}

export const DUTIES: Duty[] = [
  { key: 'risk_assessment', label: 'Written risk assessment', everyMonths: 12, rule: '314.4(b)', how: 'List what client data you hold, where, the threats, and what protects it. SECURITY.md §1–§8 is the starting point; note changes.' },
  { key: 'wisp_review', label: 'Review the written information security plan (WISP)', everyMonths: 12, rule: '314.4(g)', how: 'Re-read SECURITY.md, fill any [bracketed] items, update after any change in staff, vendors or systems.' },
  { key: 'annual_report', label: "Qualified Individual's written report to the owner", everyMonths: 12, rule: '314.4(i)', how: 'Print Compliance → Annual report, sign and file it.' },
  { key: 'staff_training', label: 'Security awareness training for everyone with access', everyMonths: 12, rule: '314.4(e)', how: 'E.g. IRS Publication 4557 + phishing awareness; note who attended.' },
  { key: 'access_review', label: 'Review who has access; remove people who left', everyMonths: 3, rule: '314.4(c)(1)', how: 'Team page for every client business; remove former staff and clients.' },
  { key: 'vendor_review', label: 'Review service providers (Render, Plaid, Anthropic, email)', everyMonths: 12, rule: '314.4(f)', how: 'Check each still meets your requirements (SOC 2 reports / security pages); note the date.' },
  { key: 'vuln_scan', label: 'Vulnerability assessment', everyMonths: 6, rule: '314.4(d)(2)', how: 'Run `npm audit`, update dependencies, scan the site (e.g. a free external scanner); note findings.' },
  { key: 'pen_test', label: 'Penetration test', everyMonths: 12, rule: '314.4(d)(2)', how: 'Have an independent tester test the app; keep the report.' },
  { key: 'restore_test', label: 'Test restoring the database backup', everyMonths: 3, rule: '314.4(c)', how: 'Restore the latest backup into a scratch database and open it (DEPLOY.md §7).' },
  { key: 'incident_plan_review', label: 'Review the incident response plan', everyMonths: 12, rule: '314.4(h)', how: 'SECURITY.md §10; confirm contacts are current.' },
  { key: 'secret_rotation', label: 'Rotate secrets (Plaid secret, CRON_SECRET, email password)', everyMonths: 12, rule: '314.4(c)(3)', how: 'Rotate in each provider, update Render → Environment.' },
  { key: 'ptin_renewal', label: 'Renew PTIN; confirm EFIN and IRIS TCC details', everyMonths: 12, rule: 'IRS', how: 'PTIN renews every year by December 31 (IRS Tax Pro Account).' },
];

export type DutyStatus = { duty: Duty; lastDone: Date | null; due: Date | null; overdue: boolean };

export function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + months);
  return x;
}

export async function dutyStatuses(today = new Date()): Promise<DutyStatus[]> {
  const rows = await prisma.complianceEvent.groupBy({ by: ['item'], _max: { doneAt: true } });
  const last = new Map(rows.map((r) => [r.item, r._max.doneAt]));
  return DUTIES.map((duty) => {
    const lastDone = last.get(duty.key) ?? null;
    const due = lastDone ? addMonths(lastDone, duty.everyMonths) : null;
    return { duty, lastDone, due, overdue: !due || due < today };
  });
}

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

export async function liveChecks(env: Record<string, string | undefined> = process.env): Promise<Check[]> {
  const users = await prisma.user.findMany({ where: { passwordHash: { not: null } }, select: { mfaEnabledAt: true, termsVersion: true } });
  const noMfa = users.filter((u) => !u.mfaEnabledAt).length;
  const { TERMS_VERSION } = await import('@/lib/legal');
  const noTerms = users.filter((u) => u.termsVersion !== TERMS_VERSION).length;
  const firm = firmIdentity(env);
  return [
    { label: 'Two-step verification required for every login', ok: env.REQUIRE_MFA !== 'false', detail: env.REQUIRE_MFA === 'false' ? 'REQUIRE_MFA=false — set it to true on the server.' : 'On.' },
    { label: 'Every person has two-step verification set up', ok: noMfa === 0, detail: noMfa ? `${noMfa} login(s) have not set it up yet (they will be made to at next sign-in).` : 'Yes.' },
    { label: 'Everyone accepted the current privacy notice and terms', ok: noTerms === 0, detail: noTerms ? `${noTerms} login(s) will be asked at next sign-in.` : 'Yes.' },
    { label: 'Office identity on the privacy notice', ok: firm.complete, detail: firm.complete ? `${firm.legalName}, ${firm.email}` : 'Set FIRM_LEGAL_NAME, FIRM_ADDRESS and FIRM_PRIVACY_EMAIL on the server.' },
    { label: 'HTTPS address', ok: !!env.APP_URL?.startsWith('https://'), detail: env.APP_URL || 'APP_URL not set.' },
    { label: 'Encryption key present (bank tokens, tax IDs, two-step secrets encrypted)', ok: !!env.ENCRYPTION_KEY, detail: env.ENCRYPTION_KEY ? 'Set. Keep a copy in your password manager.' : 'Missing.' },
    { label: 'Database on a plan with automatic backups', ok: env.DB_BACKUPS_CONFIRMED === 'true', detail: env.DB_BACKUPS_CONFIRMED === 'true' ? 'Confirmed by the owner.' : 'Render free databases have no backups and expire. Upgrade, then set DB_BACKUPS_CONFIRMED=true.' },
  ];
}

export interface Deadline {
  label: string;
  due: Date;
  done: Date | null;
}

export function incidentDeadlines(i: {
  discoveredAt: Date;
  peopleAffected: number;
  floridaResidents: number;
  unencryptedData: boolean;
  individualsNotifiedAt: Date | null;
  ftcNotifiedAt: Date | null;
  floridaAgNotifiedAt: Date | null;
}): Deadline[] {
  const in30 = new Date(i.discoveredAt.getTime() + 30 * 86_400_000);
  const out: Deadline[] = [];
  // Florida and the FTC rule only count unencrypted data (or data whose key
  // was also exposed — mark it unencrypted in that case).
  if (!i.unencryptedData) return out;
  if (i.peopleAffected > 0 || i.floridaResidents > 0) out.push({ label: 'Notify affected individuals (Florida §501.171: within 30 days)', due: in30, done: i.individualsNotifiedAt });
  if (i.floridaResidents >= 500) out.push({ label: 'Notify the Florida Attorney General (500+ Floridians)', due: in30, done: i.floridaAgNotifiedAt });
  if (i.peopleAffected >= 500 && i.unencryptedData) out.push({ label: 'Notify the FTC (Safeguards Rule: 500+ people, unencrypted) — ftc.gov/safeguards', due: in30, done: i.ftcNotifiedAt });
  return out;
}
