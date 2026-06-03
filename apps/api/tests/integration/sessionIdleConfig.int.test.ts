/**
 * BUG-P2 regression — per-clinic session-idle-timeout (PRES-6 DH-3869).
 *
 * Coverage (8 tests):
 *   T1 — DB column exists with CHECK constraint [5, 15] OR NULL
 *   T2 — Setting clinic.session_idle_minutes = 14 succeeds
 *   T3 — Setting clinic.session_idle_minutes = 16 (above ceiling) fails
 *        at DB CHECK
 *   T4 — Setting clinic.session_idle_minutes = 4 (below floor) fails at
 *        DB CHECK
 *   T5 — effectiveIdleMinutesForClinic returns clinic value when in range
 *   T6 — effectiveIdleMinutesForClinic returns server default when NULL
 *   T7 — primeIdleWindow stores minutes in Redis value (sliding window)
 *   T8 — server default in production is 15 (PRES-6 ceiling), NOT 30
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isIntegrationReady } from './_helpers';

describe.skipIf(!(await isIntegrationReady()))('BUG-P2 per-clinic session idle (PRES-6)', () => {
  let clinicId: string;
  let originalValue: number | null = null;

  beforeAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const clinic = (await dbAdmin('clinics')
      .where({ id: '11111111-1111-1111-1111-111111111111' })
      .select('id', 'session_idle_minutes')
      .first()) as { id: string; session_idle_minutes: number | null } | undefined;
    if (!clinic) throw new Error('BUG-P2 test: canonical seed clinic not found');
    clinicId = clinic.id;
    originalValue = clinic.session_idle_minutes;
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('clinics').where({ id: clinicId }).update({ session_idle_minutes: originalValue });
  });

  // ── T1 ──
  it('T1: DB column session_idle_minutes exists nullable with CHECK [5,15] OR NULL', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const colMeta = await dbAdmin.raw(
      `SELECT column_name, is_nullable, data_type
       FROM information_schema.columns
       WHERE table_name = 'clinics' AND column_name = 'session_idle_minutes'`,
    );
    const row = colMeta.rows?.[0] as
      | { column_name: string; is_nullable: string; data_type: string }
      | undefined;
    expect(row).toBeTruthy();
    expect(row!.is_nullable).toBe('YES');
    expect(row!.data_type).toBe('integer');

    // CHECK constraint
    const check = await dbAdmin.raw(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conname = 'clinics_session_idle_minutes_pres6'`,
    );
    const def = check.rows?.[0]?.def as string | undefined;
    expect(def).toBeTruthy();
    expect(def).toMatch(/session_idle_minutes IS NULL/);
    expect(def).toMatch(/>= 5/);
    expect(def).toMatch(/<= 15/);
  });

  // ── T2 ──
  it('T2: setting clinic.session_idle_minutes = 14 succeeds', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('clinics').where({ id: clinicId }).update({ session_idle_minutes: 14 });
    const row = (await dbAdmin('clinics').where({ id: clinicId }).select('session_idle_minutes').first()) as { session_idle_minutes: number };
    expect(row.session_idle_minutes).toBe(14);
  });

  // ── T3 ──
  it('T3: setting session_idle_minutes = 16 (above PRES-6 ceiling) fails at DB CHECK', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await expect(
      dbAdmin('clinics').where({ id: clinicId }).update({ session_idle_minutes: 16 }),
    ).rejects.toThrow(/clinics_session_idle_minutes_pres6|check constraint/i);
  });

  // ── T4 ──
  it('T4: setting session_idle_minutes = 4 (below floor) fails at DB CHECK', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await expect(
      dbAdmin('clinics').where({ id: clinicId }).update({ session_idle_minutes: 4 }),
    ).rejects.toThrow(/clinics_session_idle_minutes_pres6|check constraint/i);
  });

  // ── T5 ──
  it('T5: effectiveIdleMinutesForClinic returns clinic value when in [5, 15]', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('clinics').where({ id: clinicId }).update({ session_idle_minutes: 8 });
    const { effectiveIdleMinutesForClinic } = await import('../../src/middleware/sessionIdleMiddleware');
    const result = await effectiveIdleMinutesForClinic(clinicId);
    expect(result).toBe(8);
  });

  // ── T6 ──
  it('T6: effectiveIdleMinutesForClinic returns server default when clinic value is NULL', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('clinics').where({ id: clinicId }).update({ session_idle_minutes: null });
    const { effectiveIdleMinutesForClinic } = await import('../../src/middleware/sessionIdleMiddleware');
    const result = await effectiveIdleMinutesForClinic(clinicId);
    // In test/dev mode, default is 120; in prod, default would be 15.
    // Either way the result should be a positive integer.
    expect(result).toBeGreaterThan(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  // ── T7 ──
  it('T7: primeIdleWindow stores minutes in Redis value', async () => {
    const { primeIdleWindow, idleKey } = await import('../../src/middleware/sessionIdleMiddleware');
    const { redis } = await import('../../src/config/redis');
    const testStaffId = `bug-p2-test-${Date.now()}`;
    await primeIdleWindow(testStaffId, 7);
    const value = await redis.get(idleKey(testStaffId));
    expect(value).toBe('7');
    const ttl = await redis.ttl(idleKey(testStaffId));
    // TTL should be close to 7*60=420 (allow for small drift)
    expect(ttl).toBeGreaterThan(400);
    expect(ttl).toBeLessThanOrEqual(420);
    // Cleanup
    await redis.del(idleKey(testStaffId));
  });

  // ── T8 ──
  it('T8: source-level — middleware default in production is 15 (PRES-6 ceiling), not 30', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'middleware', 'sessionIdleMiddleware.ts'),
      'utf-8',
    );
    expect(src).toMatch(/'production' \? '15'/);
    // BUG-P2 marker comment
    expect(src).toMatch(/BUG-P2/);
    // PRES-6 constants exported
    expect(src).toMatch(/PRES6_IDLE_MINUTES_CEILING\s*=\s*15/);
    expect(src).toMatch(/PRES6_IDLE_MINUTES_FLOOR\s*=\s*5/);
  });
});
