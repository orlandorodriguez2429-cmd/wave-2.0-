import { describe, expect, it } from 'vitest';
import { addMonths, incidentDeadlines } from './compliance';

const base = { discoveredAt: new Date('2026-11-01T00:00:00Z'), peopleAffected: 0, floridaResidents: 0, unencryptedData: false, individualsNotifiedAt: null, ftcNotifiedAt: null, floridaAgNotifiedAt: null };

describe('breach notification deadlines', () => {
  it('none when nobody was affected', () => {
    expect(incidentDeadlines(base)).toEqual([]);
  });
  it('none when the data was encrypted (and the key not exposed)', () => {
    expect(incidentDeadlines({ ...base, peopleAffected: 900, floridaResidents: 900 })).toEqual([]);
  });
  it('individuals within 30 days', () => {
    const d = incidentDeadlines({ ...base, peopleAffected: 3, floridaResidents: 3, unencryptedData: true });
    expect(d).toHaveLength(1);
    expect(d[0].due.toISOString().slice(0, 10)).toBe('2026-12-01');
  });
  it('Florida AG at 500+ Floridians; FTC only for 500+ with unencrypted data', () => {
    expect(incidentDeadlines({ ...base, peopleAffected: 600, floridaResidents: 600, unencryptedData: true }).map((x) => x.label)).toEqual([
      expect.stringMatching(/individuals/),
      expect.stringMatching(/Attorney General/),
      expect.stringMatching(/FTC/),
    ]);
    expect(incidentDeadlines({ ...base, peopleAffected: 600, floridaResidents: 10, unencryptedData: true }).map((x) => x.label)).toEqual([
      expect.stringMatching(/individuals/),
      expect.stringMatching(/FTC/),
    ]);
  });
  it('adds months for duty due dates', () => {
    expect(addMonths(new Date('2026-01-15T00:00:00Z'), 3).toISOString().slice(0, 10)).toBe('2026-04-15');
  });
});
