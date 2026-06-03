/**
 * BUG-374b — pure retention predicate tests.
 *
 * 3-clock predicate per locked policy (project_data_retention_policy.md
 * + Q-A/Q-B/Q-G):
 *   purgeable_at = MAX(
 *     last_contact_at + MAX(25, configured_years),
 *     dob + (MAX(25, configured_years) + 7) [when dob known],
 *     deceased_date + MAX(25, configured_years) [when deceased]
 *   )
 *
 * The MAX(25, configured) floor is the L5 belt — even if all upstream
 * layers (Zod L1+L2, service guard L3, DB CHECK L4) were bypassed, the
 * predicate would still floor at 25.
 */
import { describe, it, expect } from 'vitest';
import {
  isPurgeable,
  buildPurgeableSql,
  type RetentionRow,
} from '../../src/features/privacy/retentionPredicate';

const NOW = new Date('2026-04-27T00:00:00.000Z');

function row(o: Partial<RetentionRow> = {}): RetentionRow {
  return {
    last_contact_at: null,
    date_of_birth: null,
    deceased_date: null,
    created_at: NOW,
    ...o,
  };
}

function ymdOffset(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dateOffset(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

const TWENTY_FIVE_YEARS_DAYS = 25 * 365;

describe('BUG-374b — isPurgeable (3-clock + 25-year floor)', () => {
  it('TP-RPRED-1: rejects configuredYears below 25 (programmer-misuse)', () => {
    expect(() => isPurgeable(row(), 24, NOW)).toThrow(/floor/i);
    expect(() => isPurgeable(row(), 0, NOW)).toThrow(/floor/i);
    expect(() => isPurgeable(row(), -1, NOW)).toThrow(/floor/i);
  });

  it('TP-RPRED-2: adult — last_contact 26y ago, no dob, configured=25 → purgeable', () => {
    const r = row({ last_contact_at: dateOffset(NOW, -(TWENTY_FIVE_YEARS_DAYS + 365)) });
    expect(isPurgeable(r, 25, NOW)).toBe(true);
  });

  it('TP-RPRED-3: adult — last_contact 26y ago, configured=30 → NOT purgeable', () => {
    const r = row({ last_contact_at: dateOffset(NOW, -(TWENTY_FIVE_YEARS_DAYS + 365)) });
    expect(isPurgeable(r, 30, NOW)).toBe(false);
  });

  it('TP-RPRED-4: minor — last_contact 26y ago, dob 30y ago, configured=25 → NOT purgeable (dob_clock = dob+32 not yet)', () => {
    const r = row({
      last_contact_at: dateOffset(NOW, -(TWENTY_FIVE_YEARS_DAYS + 365)),
      date_of_birth: ymdOffset(NOW, -30 * 365),
    });
    // dob_clock = dob + 32y = 30y ago + 32y = +2y in future → NOT purgeable
    expect(isPurgeable(r, 25, NOW)).toBe(false);
  });

  it('TP-RPRED-5: deceased — last_contact 26y ago, deceased 10y ago, configured=25 → NOT purgeable (deceased_clock = deceased+25 in future)', () => {
    const r = row({
      last_contact_at: dateOffset(NOW, -(TWENTY_FIVE_YEARS_DAYS + 365)),
      deceased_date: ymdOffset(NOW, -10 * 365),
    });
    // deceased_clock = deceased + 25y = 10y ago + 25y = +15y in future → NOT purgeable
    expect(isPurgeable(r, 25, NOW)).toBe(false);
  });

  it('TP-RPRED-6: deceased — last_contact 26y ago, deceased 26y ago, configured=25 → purgeable', () => {
    const r = row({
      last_contact_at: dateOffset(NOW, -(TWENTY_FIVE_YEARS_DAYS + 365)),
      deceased_date: ymdOffset(NOW, -(TWENTY_FIVE_YEARS_DAYS + 365)),
    });
    expect(isPurgeable(r, 25, NOW)).toBe(true);
  });

  it('TP-RPRED-7: missing dob (NULL) — dob_clock skipped; only last_contact + deceased apply', () => {
    const r = row({
      last_contact_at: dateOffset(NOW, -(TWENTY_FIVE_YEARS_DAYS + 365)),
      date_of_birth: null,
    });
    expect(isPurgeable(r, 25, NOW)).toBe(true);
  });

  it('TP-RPRED-8: missing deceased_date (NULL) — deceased_clock skipped; living patient', () => {
    const r = row({
      last_contact_at: dateOffset(NOW, -(TWENTY_FIVE_YEARS_DAYS + 365)),
      deceased_date: null,
    });
    expect(isPurgeable(r, 25, NOW)).toBe(true);
  });

  it('TP-RPRED-9: missing last_contact_at (NULL) — fallback to created_at + configured', () => {
    const r = row({
      last_contact_at: null,
      created_at: dateOffset(NOW, -(TWENTY_FIVE_YEARS_DAYS + 365)),
    });
    expect(isPurgeable(r, 25, NOW)).toBe(true);
  });

  it('TP-RPRED-10: SQL builder includes 3 clauses + 25y/32y intervals', () => {
    const sql = buildPurgeableSql(25);
    expect(sql).toContain('GREATEST(');
    expect(sql).toContain("INTERVAL '25 years'");
    expect(sql).toContain("INTERVAL '32 years'"); // 25 + 7 minor protection
    expect(sql).toMatch(/last_contact_at|created_at/);
    expect(sql).toMatch(/date_of_birth/);
    expect(sql).toMatch(/deceased_date/);
  });

  it('TP-RPRED-11: SQL builder applies MAX(25, configured) floor — passing 24 still floors at 25', () => {
    const sql = buildPurgeableSql(24);
    expect(sql).toContain("INTERVAL '25 years'");
    expect(sql).not.toContain("INTERVAL '24 years'");
  });
});
