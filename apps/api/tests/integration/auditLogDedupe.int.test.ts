/**
 * A2 foundation — audit_log dedupe key.
 *
 * Proves the schema/runtime prerequisite for timeout-safe audit
 * decoupling: repeated writes of the same logical audit event in the
 * same 5-second bucket persist only one append-only audit row.
 *
 * audit_log is immutable (BUG-039), so this suite deliberately does
 * not clean up its audit rows. Each run uses a fresh UUID record id.
 */

import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { buildAuditDedupeKey } from '../../src/shared/auditDedupeKey';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('A2 foundation — audit_log dedupe key', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeAll(async () => {
    if (!ready) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('A2-DK-1: two identical writeAuditLog calls in the same bucket persist one row', async () => {
    vi.useFakeTimers();
    const frozen = new Date('2026-05-07T12:00:00.000Z');
    vi.setSystemTime(frozen);

    const { writeAuditLog } = await import('../../src/utils/audit');
    const recordId = randomUUID();
    const tableName = 'a2_audit_dedupe_probe';
    const newData = { run: 'A2-DK-1' };

    await writeAuditLog({
      clinicId: session.clinicId,
      actorId: session.userId,
      action: 'LOGIN',
      tableName,
      recordId,
      newData,
    });
    await writeAuditLog({
      clinicId: session.clinicId,
      actorId: session.userId,
      action: 'LOGIN',
      tableName,
      recordId,
      newData,
    });

    vi.useRealTimers();

    const legacyBaseKey = buildAuditDedupeKey({
      clinicId: session.clinicId,
      tableName,
      recordId,
      action: 'LOGIN',
      eventTimeIso: frozen.toISOString(),
    });

    const rows = await dbAdmin('audit_log')
      .where({
        clinic_id: session.clinicId,
        table_name: tableName,
        record_id: recordId,
        operation: 'LOGIN',
      })
      .where('created_at', '>=', frozen.toISOString())
      .select('record_id', 'operation', 'dedupe_key');

    expect(rows).toHaveLength(1);
    expect(rows[0].record_id).toBe(recordId);
    expect(rows[0].operation).toBe('LOGIN');
    expect(rows[0].dedupe_key).toBeTypeOf('string');
    expect(rows[0].dedupe_key.startsWith(`${legacyBaseKey}:`)).toBe(true);
  });
});
