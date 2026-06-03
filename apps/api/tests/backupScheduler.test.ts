/**
 * S1.3 — backupScheduler.shouldRunNow unit tests
 *
 * shouldRunNow is the pure scheduling decision function. Pulled out of
 * the cron tick so the schedule semantics (hourly debounce, daily
 * wall-clock, weekly Sunday) can be tested without time travel.
 *
 * The cron tick itself, the DB read, and the actual pg_dump are NOT
 * tested here — they belong in integration tests against a real
 * Postgres + a real filesystem in a follow-up.
 */

import { describe, it, expect } from 'vitest';
import {
  shouldRunNow,
  isUnrecoverableBackupConfigAccessError,
} from '../src/jobs/schedulers/backupScheduler';

function at(year: number, month: number, day: number, hours: number, minutes: number): Date {
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

describe('backupScheduler.shouldRunNow', () => {
  const baseCfg = {
    schedule_enabled: true,
    frequency: 'daily' as const,
    time_of_day: '02:00',
    last_run_at: null as Date | null,
  };

  it('returns due=false when the schedule is disabled', () => {
    const r = shouldRunNow({ ...baseCfg, schedule_enabled: false }, at(2026, 4, 11, 2, 0));
    expect(r.due).toBe(false);
    expect(r.reason).toBe('schedule_disabled');
  });

  // ── hourly ────────────────────────────────────────────────────────────────

  it('hourly: due if more than 60 minutes since last run', () => {
    const r = shouldRunNow(
      { ...baseCfg, frequency: 'hourly', last_run_at: at(2026, 4, 11, 1, 0) },
      at(2026, 4, 11, 2, 5),
    );
    expect(r.due).toBe(true);
  });

  it('hourly: not due if last run was within the past hour', () => {
    const r = shouldRunNow(
      { ...baseCfg, frequency: 'hourly', last_run_at: at(2026, 4, 11, 1, 30) },
      at(2026, 4, 11, 2, 0),
    );
    expect(r.due).toBe(false);
  });

  it('hourly: due if there has never been a run', () => {
    const r = shouldRunNow(
      { ...baseCfg, frequency: 'hourly', last_run_at: null },
      at(2026, 4, 11, 9, 17),
    );
    expect(r.due).toBe(true);
  });

  // ── daily ─────────────────────────────────────────────────────────────────

  it('daily: due at the configured time of day if not run in the last 23 hours', () => {
    const r = shouldRunNow(
      { ...baseCfg, frequency: 'daily', time_of_day: '02:00', last_run_at: at(2026, 4, 10, 2, 0) },
      at(2026, 4, 11, 2, 0),
    );
    expect(r.due).toBe(true);
    expect(r.reason).toBe('daily_at_time');
  });

  it('daily: not due if it is the wrong minute of the day', () => {
    const r = shouldRunNow(
      { ...baseCfg, frequency: 'daily', time_of_day: '02:00', last_run_at: null },
      at(2026, 4, 11, 2, 1),
    );
    expect(r.due).toBe(false);
    expect(r.reason).toBe('wrong_minute');
  });

  it('daily: not due if a backup already ran less than 23h ago', () => {
    const r = shouldRunNow(
      { ...baseCfg, frequency: 'daily', time_of_day: '02:00', last_run_at: at(2026, 4, 11, 1, 0) },
      at(2026, 4, 11, 2, 0),
    );
    expect(r.due).toBe(false);
    expect(r.reason).toBe('daily_already_ran_today');
  });

  // ── weekly ────────────────────────────────────────────────────────────────

  it('weekly: due on Sunday at the configured time if not run in the last 6 days', () => {
    // 2026-04-12 is a Sunday
    const r = shouldRunNow(
      { ...baseCfg, frequency: 'weekly', time_of_day: '03:00', last_run_at: at(2026, 4, 5, 3, 0) },
      at(2026, 4, 12, 3, 0),
    );
    expect(r.due).toBe(true);
  });

  it('weekly: not due on a non-Sunday', () => {
    const r = shouldRunNow(
      { ...baseCfg, frequency: 'weekly', time_of_day: '03:00', last_run_at: null },
      at(2026, 4, 11, 3, 0), // Saturday
    );
    expect(r.due).toBe(false);
    expect(r.reason).toBe('weekly_wrong_day');
  });

  it('weekly: rejects an invalid time_of_day string gracefully', () => {
    const r = shouldRunNow(
      { ...baseCfg, frequency: 'daily', time_of_day: 'banana', last_run_at: null },
      at(2026, 4, 11, 2, 0),
    );
    expect(r.due).toBe(false);
    expect(r.reason).toBe('invalid_time_of_day');
  });
});

describe('backupScheduler.isUnrecoverableBackupConfigAccessError', () => {
  it('detects direct RLS errors on backup_config', () => {
    const err = {
      code: '42501',
      message: 'insert into "backup_config" violated row-level security policy',
    };
    expect(isUnrecoverableBackupConfigAccessError(err)).toBe(true);
  });

  it('detects nested knex-style errors (err.cause)', () => {
    const wrapped = {
      message: 'top-level wrapper',
      cause: {
        code: '42501',
        message: 'new row violates row-level security policy for table "backup_config"',
      },
    };
    expect(isUnrecoverableBackupConfigAccessError(wrapped)).toBe(true);
  });

  it('does not classify unrelated database errors as unrecoverable backup errors', () => {
    const err = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    };
    expect(isUnrecoverableBackupConfigAccessError(err)).toBe(false);
  });
});
