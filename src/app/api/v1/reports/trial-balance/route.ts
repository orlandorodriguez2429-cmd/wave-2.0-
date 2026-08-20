import { NextRequest, NextResponse } from 'next/server';
import { resolveApiToken } from '@/lib/api-auth';
import { trialBalance } from '@/lib/ledger/reports';

export async function GET(req: NextRequest) {
  const token = await resolveApiToken(req.headers.get('authorization'));
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const to = req.nextUrl.searchParams.get('to');
  const tb = await trialBalance(token.businessId, { to: to ? new Date(to) : undefined });
  return NextResponse.json({
    data: {
      rows: tb.rows.map((r) => ({
        accountId: r.accountId,
        code: r.code,
        name: r.name,
        type: r.type,
        debit: r.debitBalance.toString(),
        credit: r.creditBalance.toString(),
      })),
      totalDebits: tb.totalDebits.toString(),
      totalCredits: tb.totalCredits.toString(),
    },
  });
}
