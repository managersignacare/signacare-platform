/*
 * scripts/guards/__tests__/check-row-interface-matches-db.test.ts
 *
 * BUG-529 — reverse-direction §15 guard tests.
 *
 * Each case writes a synthetic snapshot.json + TS source + (optional)
 * allowlist into os.tmpdir(), invokes runCheck() directly, asserts the
 * shape. Tests do NOT mutate the real apps/api/src/db/schema-snapshot.json.
 *
 * Pre-fix RED gate: DR-3, DR-5, DR-5b, DR-6, DR-6b, DR-8, DR-9, DR-10
 * fail before the reverse-direction extension lands. DR-1, DR-2, DR-4,
 * DR-7 are baseline regression tests that must continue passing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCheck } from '../check-row-interface-matches-db';

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'bug-529-'));
  mkdirSync(join(workdir, 'apps/api/src/db'), { recursive: true });
  mkdirSync(join(workdir, 'apps/api/src/features'), { recursive: true });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function writeSnapshot(tables: Record<string, string[]>): string {
  const path = join(workdir, 'apps/api/src/db/schema-snapshot.json');
  writeFileSync(
    path,
    JSON.stringify({ generatedAt: 'test', database: 'test', tables }),
  );
  return path;
}

function writeSrc(relPath: string, content: string): void {
  const abs = join(workdir, 'apps/api/src/features', relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function writeAllowlist(content: string): string {
  const path = join(workdir, 'allowlist.txt');
  writeFileSync(path, content);
  return path;
}

const NO_ALLOWLIST = '/dev/null/no-allowlist-here';

describe('BUG-529 check-row-interface-matches-db reverse direction', () => {
  it('DR-1: interface fully matches table → exit 0', () => {
    const snap = writeSnapshot({ users: ['id', 'name', 'email'] });
    writeSrc(
      'foo/foo.ts',
      `export interface UserDb {
  id: string;
  name: string;
  email: string;
}
const q = db<UserDb>('users').first();
`,
    );
    const r = runCheck(workdir, snap, NO_ALLOWLIST);
    expect(r.exitCode).toBe(0);
    expect(r.violations).toEqual([]);
  });

  it('DR-2: interface declares phantom column NOT in DB → exit 1 (forward direction regression)', () => {
    const snap = writeSnapshot({ users: ['id', 'name'] });
    writeSrc(
      'foo/foo.ts',
      `export interface UserDb {
  id: string;
  name: string;
  phantom_x: string;
}
const q = db<UserDb>('users').first();
`,
    );
    const r = runCheck(workdir, snap, NO_ALLOWLIST);
    expect(r.exitCode).toBe(1);
    expect(r.violations.some((v) => v.includes('phantom_x'))).toBe(true);
  });

  it('DR-3: interface OMITS DB column → exit 1 (NEW reverse direction; PRE-FIX RED)', () => {
    const snap = writeSnapshot({ users: ['id', 'name', 'email', 'phone'] });
    writeSrc(
      'foo/foo.ts',
      `export interface UserDb {
  id: string;
  name: string;
}
const q = db<UserDb>('users').first();
`,
    );
    const r = runCheck(workdir, snap, NO_ALLOWLIST);
    expect(r.exitCode).toBe(1);
    expect(r.violations.some((v) => v.includes('email') && v.includes('phone'))).toBe(true);
    expect(r.violations.some((v) => v.includes('DB has columns NOT declared'))).toBe(true);
  });

  it('DR-4: @schema-drift-exempt: select-aliased skips both directions', () => {
    const snap = writeSnapshot({ users: ['id', 'name'] });
    writeSrc(
      'foo/foo.ts',
      `/**
 * @schema-drift-exempt select-aliased
 */
export interface UserDb {
  id: string;
  name: string;
  phantom_x: string;
}
const q = db<UserDb>('users').first();
`,
    );
    const r = runCheck(workdir, snap, NO_ALLOWLIST);
    expect(r.exitCode).toBe(0);
  });

  it('DR-5: @schema-drift-exempt: partial-shape skips reverse direction', () => {
    const snap = writeSnapshot({ users: ['id', 'name', 'email', 'phone'] });
    writeSrc(
      'foo/foo.ts',
      `/**
 * @schema-drift-exempt partial-shape
 * Sub-projection: BUG-NNN cite
 */
export interface UserDb {
  id: string;
  name: string;
}
const q = db<UserDb>('users').first();
`,
    );
    const r = runCheck(workdir, snap, NO_ALLOWLIST);
    expect(r.exitCode).toBe(0);
  });

  it('DR-5b: partial-shape does NOT skip forward direction (declared phantom still fails)', () => {
    const snap = writeSnapshot({ users: ['id', 'name'] });
    writeSrc(
      'foo/foo.ts',
      `/**
 * @schema-drift-exempt partial-shape
 */
export interface UserDb {
  id: string;
  name: string;
  phantom_x: string;
}
const q = db<UserDb>('users').first();
`,
    );
    const r = runCheck(workdir, snap, NO_ALLOWLIST);
    expect(r.exitCode).toBe(1);
    expect(r.violations.some((v) => v.includes('phantom_x'))).toBe(true);
  });

  it('DR-6: per-column allowlist <table>.<column> exempts that column from reverse check', () => {
    const snap = writeSnapshot({ users: ['id', 'name', 'email', 'phone'] });
    writeSrc(
      'foo/foo.ts',
      `export interface UserDb {
  id: string;
  name: string;
  email: string;
}
const q = db<UserDb>('users').first();
`,
    );
    const allowlist = writeAllowlist('users.phone # BUG-NNN — write-only field\n');
    const r = runCheck(workdir, snap, allowlist);
    expect(r.exitCode).toBe(0);
  });

  it('DR-6b: partial allowlist (covers 1 of 2 missing) → still fails on un-allowlisted column', () => {
    const snap = writeSnapshot({ users: ['id', 'name', 'email', 'phone'] });
    writeSrc(
      'foo/foo.ts',
      `export interface UserDb {
  id: string;
  name: string;
}
const q = db<UserDb>('users').first();
`,
    );
    const allowlist = writeAllowlist('users.phone # BUG-NNN — write-only\n');
    const r = runCheck(workdir, snap, allowlist);
    expect(r.exitCode).toBe(1);
    expect(r.violations.some((v) => v.includes('email'))).toBe(true);
    expect(r.violations.some((v) => v.includes('phone'))).toBe(false);
  });

  it('DR-7: interface defined but no db<X>(t) binding → no violation', () => {
    const snap = writeSnapshot({ users: ['id'] });
    writeSrc(
      'foo/foo.ts',
      `export interface UnboundDb {
  random: string;
}
`,
    );
    const r = runCheck(workdir, snap, NO_ALLOWLIST);
    expect(r.exitCode).toBe(0);
  });

  it('DR-8: real-world sanity — 38-col table with 25-col interface → exit 1, lists 13 missing', () => {
    const snap = writeSnapshot({
      appointments: [
        'id', 'clinic_id', 'patient_id', 'clinician_id', 'staff_id',
        'episode_id', 'specialty_code', 'appointment_start', 'appointment_end',
        'appointment_type', 'type', 'status', 'notes', 'telehealth',
        'telehealth_url', 'telehealth_link', 'telehealth_provider',
        'telehealth_passcode', 'cancellation_reason', 'cancelled_by_id',
        'rescheduled_from_id', 'reminder_scheduled', 'reminder_sent',
        'reminder_sent_at', 'outlook_event_id', 'created_at', 'updated_at',
        'deleted_at', 'mode', 'mbs_item', 'patient_response', 'location',
        'duration_minutes', 'recurrence_rule', 'recurrence_end_date',
        'recurrence_parent_id', 'start_time', 'end_time',
      ],
    });
    writeSrc(
      'appointments/appointmentRepository.ts',
      `export interface AppointmentDb {
  id: string;
  clinic_id: string;
  patient_id: string;
  clinician_id: string;
  episode_id: string;
  specialty_code: string;
  appointment_start: Date;
  appointment_end: Date;
  appointment_type: string;
  status: string;
  notes: string;
  telehealth: boolean;
  telehealth_url: string;
  telehealth_provider: string;
  telehealth_passcode: string;
  cancellation_reason: string;
  cancelled_by_id: string;
  rescheduled_from_id: string;
  reminder_scheduled: boolean;
  reminder_sent: boolean;
  reminder_sent_at: Date;
  outlook_event_id: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date;
}
const q = db<AppointmentDb>('appointments').first();
`,
    );
    const r = runCheck(workdir, snap, NO_ALLOWLIST);
    expect(r.exitCode).toBe(1);
    // 13 columns missing: staff_id, type, telehealth_link, mode, mbs_item,
    // patient_response, location, duration_minutes, recurrence_rule,
    // recurrence_end_date, recurrence_parent_id, start_time, end_time
    const allMissing = r.violations.join('\n');
    for (const col of ['staff_id', 'type', 'telehealth_link', 'mode', 'mbs_item',
                       'patient_response', 'location', 'duration_minutes',
                       'recurrence_rule', 'start_time', 'end_time']) {
      expect(allMissing).toContain(col);
    }
  });

  it('DR-9: malformed allowlist line (no .) → exit 2', () => {
    const snap = writeSnapshot({ users: ['id'] });
    const allowlist = writeAllowlist('badline_no_dot # BUG-NNN — reason\n');
    const r = runCheck(workdir, snap, allowlist);
    expect(r.exitCode).toBe(2);
  });

  it('DR-10: allowlist references non-existent column → exit 2 (self-cleaning)', () => {
    const snap = writeSnapshot({ users: ['id', 'name'] });
    const allowlist = writeAllowlist('users.zzz_nonexistent # BUG-NNN — reason\n');
    const r = runCheck(workdir, snap, allowlist);
    expect(r.exitCode).toBe(2);
  });
});
