// Privacy layer for the chat assistant (strict rule chosen by the owner):
// nothing that identifies a client or a person reaches the AI.
//   * each business the user works on becomes "Client A", "Client B", … (stable
//     order: oldest membership first);
//   * each contractor/vendor becomes "Contractor 1", "Contractor 2", … per client;
//   * transaction text goes through cleanDescription (person names after
//     Zelle/Venmo/transfer words, account and reference numbers, emails removed);
//   * account numbers (even last 4) are never included — accounts are just
//     "checking" / "credit card".
// The user's own message is aliased the same way before it's sent, and the
// model's reply is de-aliased only for display.
import { prisma } from '@/lib/db';
import { nameKey } from '@/lib/banking/statement-info';

export interface AliasMap {
  businesses: Array<{ id: string; name: string; alias: string }>;
  vendors: Array<{ id: string; businessId: string; name: string; alias: string }>;
  businessIdOf(alias: string): string | null;
  aliasOfBusiness(id: string): string;
  aliasOfVendor(id: string): string;
  /** Real names → aliases (for text going TO the model). */
  mask(text: string): string;
  /** Aliases → real names (for text shown to the user). */
  unmask(text: string): string;
}

const letters = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function buildAliasMap(userId: string): Promise<AliasMap> {
  const memberships = await prisma.membership.findMany({
    where: { userId, role: { in: ['OWNER', 'ACCOUNTANT'] } },
    include: { business: true },
    orderBy: { createdAt: 'asc' },
  });
  const businesses = memberships.map((m, i) => ({ id: m.businessId, name: m.business.name, alias: `Client ${letters(i)}` }));
  const vendorRows = await prisma.vendor.findMany({
    where: { businessId: { in: businesses.map((b) => b.id) } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, businessId: true, name: true },
  });
  const counters = new Map<string, number>();
  const vendors = vendorRows.map((v) => {
    const n = (counters.get(v.businessId) ?? 0) + 1;
    counters.set(v.businessId, n);
    const client = businesses.find((b) => b.id === v.businessId)!.alias;
    return { ...v, alias: `${client} Contractor ${n}` };
  });

  // Patterns for masking, longest first so "Sunrise Cleaning LLC" wins over "Sunrise".
  const patterns: Array<{ re: RegExp; alias: string; len: number }> = [];
  const firstWords = new Map<string, number>();
  for (const b of businesses) {
    const w = nameKey(b.name).split(' ')[0];
    if (w) firstWords.set(w, (firstWords.get(w) ?? 0) + 1);
  }
  const add = (phrase: string, alias: string) => {
    const p = phrase.trim();
    if (p.length < 3) return;
    patterns.push({ re: new RegExp(`\\b${escape(p).replace(/\s+/g, '\\s+')}\\b`, 'gi'), alias, len: p.length });
  };
  for (const b of businesses) {
    add(b.name, b.alias);
    const core = nameKey(b.name);
    add(core, b.alias);
    const first = core.split(' ')[0];
    // A distinctive first word ("Sunrise") also counts, unless two clients share it.
    if (first && first.length >= 4 && firstWords.get(first) === 1) add(first, b.alias);
  }
  for (const v of vendors) {
    add(v.name, v.alias);
    const parts = v.name.trim().split(/\s+/);
    if (parts.length > 1 && parts[0].length >= 3) add(parts[0], v.alias); // "Maria" for "Maria Garcia"
  }
  patterns.sort((a, b) => b.len - a.len);

  const realByAlias = new Map<string, string>([...businesses.map((b) => [b.alias, b.name] as const), ...vendors.map((v) => [v.alias, v.name] as const)]);
  const aliasRe = new RegExp(
    [...realByAlias.keys()].sort((a, b) => b.length - a.length).map(escape).join('|') || '(?!)',
    'g',
  );

  return {
    businesses,
    vendors,
    businessIdOf: (alias) => businesses.find((b) => b.alias.toLowerCase() === alias.trim().toLowerCase())?.id ?? null,
    aliasOfBusiness: (id) => businesses.find((b) => b.id === id)?.alias ?? 'Client ?',
    aliasOfVendor: (id) => vendors.find((v) => v.id === id)?.alias ?? 'Contractor ?',
    mask: (text) => patterns.reduce((t, p) => t.replace(p.re, p.alias), text),
    unmask: (text) => text.replace(aliasRe, (a) => realByAlias.get(a) ?? a),
  };
}
