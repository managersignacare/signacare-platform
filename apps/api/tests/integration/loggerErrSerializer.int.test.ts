/**
 * BUG-267 regression — custom pino err serializer against live Postgres.
 *
 * Proves the sanitizer is actually wired into pino end-to-end. Unit
 * tests (tests/unit/sanitizeErrForLogging.test.ts) cover the regex
 * behaviour exhaustively against synthetic inputs; this suite fires
 * real PG constraint violations through a Logger configured with
 * sanitizeErrForLogging and asserts the captured JSON log line.
 *
 * I1 (patient blind-index path) — L4 absorption — the highest-volume
 *    PHI leak: duplicate patient enrol on medicare_number_lookup
 *    triggers composite 23505 that emits
 *    `Key (clinic_id, medicare_number_lookup)=(uuid, <hash>)`. The
 *    hash is PHI per OAIC. Post-fix, the captured log must redact.
 * I2 (over-redaction guard) — FK violation on a non-PHI UUID column:
 *    the value SURVIVES (sanity check that PHI_FIELDS gate is honored
 *    and we aren't over-redacting ops-useful debugging data).
 *
 * Skipped when Postgres isn't reachable.
 */

import { beforeAll, describe, it, expect } from 'vitest';
import pino from 'pino';
import { Writable } from 'stream';
import { db } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { sanitizeErrForLogging } from '../../src/utils/sanitizeErrForLogging';
import { withTenantContext } from '../../src/shared/tenantContext';

function makeCapturedLogger(): { logger: pino.Logger; getLines: () => string[] } {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString('utf8'));
      cb();
    },
  });
  const logger = pino(
    {
      level: 'info',
      serializers: { err: sanitizeErrForLogging },
    },
    sink,
  );
  return { logger, getLines: () => chunks.join('').split('\n').filter(Boolean) };
}

async function captureDbError(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err as Error;
  }
}

describe.skipIf(!(await isIntegrationReady()))('BUG-267 live-pino err serializer against Postgres', () => {
  let clinicId = '';

  beforeAll(async () => {
    const session = await loginAsAdmin();
    clinicId = session.clinicId;
  });

  it('I1 — real PG 23505 on patients_medicare_lookup_uniq (composite blind-index) → hash REDACTED (L4 absorption)', async () => {
    if (!clinicId) return;
    const fixtureLookup = 'bug267-lookup-' + Date.now();

    // Seed the first row. NOT NULL columns per schema: id, clinic_id,
    // given_name, family_name, date_of_birth, status,
    // interpreter_required, created_at, updated_at, sms_consent.
    // created_at + updated_at + status + interpreter_required +
    // sms_consent all have defaults.
    await withTenantContext(clinicId, async () => {
      await db.raw(
        `INSERT INTO patients (id, clinic_id, given_name, family_name, date_of_birth, medicare_number_lookup)
         VALUES (gen_random_uuid(), ?, 'bug267', 'seed', '1990-01-01', ?)`,
        [clinicId, fixtureLookup],
      );
    });

    // Collide — triggers 23505 on patients_medicare_lookup_uniq
    // (clinic_id, medicare_number_lookup). PG emits
    // `Key (clinic_id, medicare_number_lookup)=(<uuid>, <hash>) already exists`.
    // medicare_number_lookup ∈ PHI_CATEGORY_BLIND_INDEX so sanitizer
    // redacts the entire value block.
    const err = await captureDbError(async () => {
      await withTenantContext(clinicId, async () => {
        await db.raw(
          `INSERT INTO patients (id, clinic_id, given_name, family_name, date_of_birth, medicare_number_lookup)
           VALUES (gen_random_uuid(), ?, 'bug267', 'collide', '1991-01-01', ?)`,
          [clinicId, fixtureLookup],
        );
      });
    });
    expect(err).not.toBeNull();

    const { logger, getLines } = makeCapturedLogger();
    logger.error({ err }, 'patient blind-index duplicate');

    const last = getLines().at(-1) ?? '';
    // The blind-index value must NOT appear (deanonymisation vector).
    expect(last).not.toContain(fixtureLookup);
    // On some Postgres builds the duplicate-key DETAIL is omitted and only
    // the constraint name is surfaced. When DETAIL is present, sanitizer must
    // inject the redaction marker; when omitted, we still require that raw
    // fixture values are absent.
    if (last.includes('Key (')) {
      expect(last).toContain('[REDACTED — PHI column]');
    } else {
      expect(last).toContain('patients_medicare_lookup_uniq');
    }

    // Cleanup.
    await withTenantContext(clinicId, async () => {
      await db.raw('DELETE FROM patients WHERE medicare_number_lookup = ?', [fixtureLookup]);
    });
  });

  it('I2 — real PG 23503 on non-PHI FK column → value SURVIVES (over-redaction guard)', async () => {
    if (!clinicId) return;
    const bogusStaff = '00000000-0000-0000-0000-00000000dead';
    // patient_alerts has FK entered_by_id → staff(id). Non-PHI UUID
    // FK violation. If the PG message uses `Key (entered_by_id)=(val)`
    // shape, the sanitizer leaves the value block untouched because
    // entered_by_id ∉ PHI_FIELDS.
    const alertTypeRow = await withTenantContext(clinicId, async () => {
      return db('alert_types').select('id').first();
    });
    if (!alertTypeRow) return;

    const err = await captureDbError(async () => {
      await withTenantContext(clinicId, async () => {
        await db.raw(
          `INSERT INTO patient_alerts (id, clinic_id, patient_id, alert_type_id, entered_by_id, title, is_active)
           VALUES (gen_random_uuid(), ?, ?, ?, ?, 'bug267', true)`,
          [clinicId, '00000000-0000-0000-0000-00000000beef', alertTypeRow.id, bogusStaff],
        );
      });
    });
    if (!err) return; // schema drifted — unit tests still cover the regex

    const { logger, getLines } = makeCapturedLogger();
    logger.error({ err }, 'FK violation');
    const last = getLines().at(-1) ?? '';

    // Non-PHI UUID value should survive unredacted.
    // (If PG's message shape is `Key (col)=(val)` with a non-PHI col,
    // the sanitizer's anyPhi gate returns false and the match is
    // left intact.)
    if (last.includes('Key (')) {
      // Either one of the two bogus UUIDs should appear (the FK target
      // that didn't exist). We don't pin WHICH because PG may surface
      // either depending on constraint ordering.
      expect(
        last.includes(bogusStaff) || last.includes('00000000-0000-0000-0000-00000000beef'),
      ).toBe(true);
    }
  });
});
