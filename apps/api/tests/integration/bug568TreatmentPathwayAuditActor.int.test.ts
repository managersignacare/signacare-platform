/**
 * BUG-568 — treatment_pathways actor-stamp + forensic audit trail.
 *
 * Verifies three invariants:
 *  1. CREATE stamps `updated_by_staff_id`.
 *  2. PATCH mutation stamps `updated_by_staff_id` and writes audit row.
 *  3. POST /:id/session mutation stamps `updated_by_staff_id` and writes audit row.
 *
 * R-FIX-BUG-568-INT-CREATE-ACTOR-STAMP
 * R-FIX-BUG-568-INT-UPDATE-AUDIT
 * R-FIX-BUG-568-INT-SESSION-AUDIT
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-568 treatment pathway actor stamp + audit', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  let patientId = '';

  async function withClinicContext<T>(
    clinicId: string,
    work: (trx: Awaited<ReturnType<typeof dbAdmin.transaction>>) => Promise<T>,
  ): Promise<T> {
    return dbAdmin.transaction(async (trx: Awaited<ReturnType<typeof dbAdmin.transaction>>) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
      return work(trx);
    });
  }

  async function createPathway(): Promise<{ id: string; lockVersion: number }> {
    const res = await request(app)
      .post('/api/v1/pathways/')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        patientId,
        pathwayType: 'cbt',
        pathwayName: 'CBT',
        name: 'CBT',
        totalSessions: 12,
        startDate: '2026-05-13',
      });

    expect(res.status).toBe(201);
    const responseId = res.body.id as string | undefined;
    const responseLockVersion = res.body.lockVersion as number | undefined;
    if (responseId && responseLockVersion) {
      return { id: responseId, lockVersion: responseLockVersion };
    }

    // Safety fallback: if response drift ever strips id/lockVersion,
    // derive from the freshly inserted row so the test still validates
    // BUG-568 invariants on the real persisted record.
    const latest = await withClinicContext(session.clinicId, async (trx) => (
      trx('treatment_pathways')
        .where({ patient_id: patientId, clinic_id: session.clinicId })
        .orderBy('created_at', 'desc')
        .first('id', 'lock_version')
    ));
    expect(latest).toBeTruthy();
    return { id: latest.id as string, lockVersion: latest.lock_version as number };
  }

  async function findAuditEvidence(
    recordId: string,
    operation: 'CREATE' | 'UPDATE',
  ): Promise<{ source: 'audit_log' | 'outbox'; staffId: string | null; mutation: string | null } | null> {
    const auditRow = await withClinicContext(session.clinicId, async (trx) => (
      trx('audit_log')
        .where({
          clinic_id: session.clinicId,
          table_name: 'treatment_pathways',
          record_id: recordId,
          operation,
        })
        .orderBy('created_at', 'desc')
        .first('staff_id', 'new_data')
    ));
    if (auditRow) {
      const newData =
        typeof auditRow.new_data === 'string' ? JSON.parse(auditRow.new_data) : auditRow.new_data;
      return {
        source: 'audit_log',
        staffId: (auditRow.staff_id as string | null) ?? null,
        mutation: (newData?.mutation as string | undefined) ?? null,
      };
    }

    const { redis } = await import('../../src/config/redis');
    const { AUDIT_OUTBOX_KEY } = await import('../../src/shared/auditOutbox');
    const entries = await redis.lrange(AUDIT_OUTBOX_KEY, 0, -1);
    for (const raw of entries) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const row = (parsed as { row?: Record<string, unknown> }).row;
      if (!row) continue;
      if (row.table_name !== 'treatment_pathways') continue;
      if (row.record_id !== recordId) continue;
      if (row.operation !== operation) continue;
      const newData =
        typeof row.new_data === 'string'
          ? JSON.parse(row.new_data as string)
          : row.new_data;
      return {
        source: 'outbox',
        staffId: (row.staff_id as string | null) ?? null,
        mutation: (newData as { mutation?: string } | null | undefined)?.mutation ?? null,
      };
    }

    return null;
  }

  beforeAll(async () => {
    if (!READY) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));
    patientId = randomUUID();

    await withClinicContext(session.clinicId, async (trx) => {
      await trx('patients').insert({
        id: patientId,
        clinic_id: session.clinicId,
        given_name: 'Bug568',
        family_name: `Audit-${Date.now()}`,
        emr_number: `BUG568-${Date.now()}`,
        date_of_birth: '1990-01-01',
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
  });

  afterAll(async () => {
    if (!READY) return;
    await withClinicContext(session.clinicId, async (trx) => {
      await trx('treatment_pathways').where({ patient_id: patientId }).del();
      await trx('patients').where({ id: patientId }).del();
    });
  });

  it('TP-AUD-568-1: CREATE stamps updated_by_staff_id and writes CREATE audit row', async () => {
    const created = await createPathway();

    const row = await withClinicContext(session.clinicId, async (trx) => (
      trx('treatment_pathways')
        .where({ id: created.id, clinic_id: session.clinicId })
        .first('updated_by_staff_id')
    ));
    expect(row).toBeTruthy();
    expect(row.updated_by_staff_id).toBe(session.userId);

    const evidence = await findAuditEvidence(created.id, 'CREATE');
    expect(evidence).toBeTruthy();
    expect(evidence?.staffId).toBe(session.userId);
    expect(evidence?.mutation).toBe('pathway_create');
  });

  it('TP-AUD-568-2: PATCH stamps updated_by_staff_id and writes UPDATE audit row', async () => {
    const created = await createPathway();
    const patched = await request(app)
      .patch(`/api/v1/pathways/${created.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({ notes: 'update-marker', expectedLockVersion: created.lockVersion });
    expect(patched.status).toBe(200);

    const row = await withClinicContext(session.clinicId, async (trx) => (
      trx('treatment_pathways')
        .where({ id: created.id, clinic_id: session.clinicId })
        .first('updated_by_staff_id')
    ));
    expect(row.updated_by_staff_id).toBe(session.userId);

    const evidence = await findAuditEvidence(created.id, 'UPDATE');
    expect(evidence).toBeTruthy();
    expect(evidence?.staffId).toBe(session.userId);
    expect(evidence?.mutation).toBe('pathway_update');
  });

  it('TP-AUD-568-3: POST /:id/session stamps updated_by_staff_id and writes UPDATE audit row', async () => {
    const created = await createPathway();
    const recorded = await request(app)
      .post(`/api/v1/pathways/${created.id}/session`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({ expectedLockVersion: created.lockVersion });
    expect(recorded.status).toBe(200);

    const row = await withClinicContext(session.clinicId, async (trx) => (
      trx('treatment_pathways')
        .where({ id: created.id, clinic_id: session.clinicId })
        .first('updated_by_staff_id')
    ));
    expect(row.updated_by_staff_id).toBe(session.userId);

    const evidence = await findAuditEvidence(created.id, 'UPDATE');
    expect(evidence).toBeTruthy();
    expect(evidence?.staffId).toBe(session.userId);
    expect(evidence?.mutation).toBe('pathway_record_session');
  });
});
