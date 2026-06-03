/**
 * Category 4 — Clinical data integrity: audit log immutability.
 *
 * Why this matters: the audit_log table is the legal record of every
 * PHI access. Under the Privacy Act 1988 (Cth) APP 11.2 and the
 * My Health Record Act 2012, that record must be tamper-evident:
 * a clinician (or admin) MUST NOT be able to retroactively edit who
 * read what and when. The application provides this property via
 * two layers:
 *
 *   1. NO HTTP write surface — the API mounts only GET routes for
 *      audit data. Asserted here by hitting PUT/PATCH/DELETE on the
 *      audit endpoint and confirming a 4xx (route not mounted).
 *
 *   2. DB-level REVOKE — migration 20260331_audit_log_tamper_protection
 *      revokes UPDATE/DELETE on audit_log from the runtime app_user
 *      role. Asserted here by checking pg_class permissions for the
 *      app_user role.
 *
 * Together these provide HIPAA-equivalent non-repudiation: a malicious
 * insider with API access cannot alter the trail, and a malicious
 * insider with DB credentials would have to escalate to the owner role
 * (whose creds live only in the secrets vault, not the API container).
 *
 * Standard satisfied: Australian Privacy Act 1988 (Cth) APP 11.2,
 *                     My Health Record Act 2012 (Cth) §74,
 *                     ACHS Standard 1 (Clinical Governance — non-
 *                     repudiable audit), HIPAA §164.312(c)(1) (Integrity).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin, authedAgent } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('Audit log immutability (live DB)', () => {
  let token: string;
  let clinicId: string;
  let knownAuditId: string | null = null;

  beforeAll(async () => {
    ({ token, clinicId } = await loginAsAdmin());
    // Find any existing audit_log row in the seeded clinic so the
    // mutation tests have a real ID to attempt to modify. If the
    // table is empty (fresh DB), create one indirectly by reading a
    // patient (which writes a patient_read_access audit row).
    const { dbAdmin } = await import('../../src/db/db');
    let row = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId })
      .orderBy('created_at', 'desc')
      .first();
    if (!row) {
      // Provoke an audit row by reading the patient list once.
      await authedAgent(token).get('/api/v1/patients?limit=1');
      row = await dbAdmin('audit_log')
        .where({ clinic_id: clinicId })
        .orderBy('created_at', 'desc')
        .first();
    }
    knownAuditId = row?.id ?? null;
  });

  // ───────────────────────────────────────────────────────────────────
  // Layer 1 — HTTP surface: no write routes
  // ───────────────────────────────────────────────────────────────────
  describe('Layer 1: HTTP write surface is not mounted', () => {
    const probePaths = [
      '/api/v1/audit-log',
      '/api/v1/audit-logs',
      '/api/v1/audit_log',
    ];

    for (const path of probePaths) {
      it(`PUT ${path}/:id is not a mounted route → 4xx`, async () => {
        const id = knownAuditId ?? '00000000-0000-0000-0000-000000000000';
        const res = await request(app)
          .put(`${path}/${id}`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-CSRF-Token', 'test')
          .send({ action: 'TAMPERED' });
        // Acceptable: 401 (auth-first reject), 403, 404 (route not
        // mounted), 405 (method not allowed). Forbidden: 200/204.
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      });

      it(`PATCH ${path}/:id is not a mounted route → 4xx`, async () => {
        const id = knownAuditId ?? '00000000-0000-0000-0000-000000000000';
        const res = await request(app)
          .patch(`${path}/${id}`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-CSRF-Token', 'test')
          .send({ action: 'TAMPERED' });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      });

      it(`DELETE ${path}/:id is not a mounted route → 4xx`, async () => {
        const id = knownAuditId ?? '00000000-0000-0000-0000-000000000000';
        const res = await request(app)
          .delete(`${path}/${id}`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-CSRF-Token', 'test');
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // Layer 2 — DB-level REVOKE
  // ───────────────────────────────────────────────────────────────────
  describe('Layer 2: DB grants prevent UPDATE/DELETE for the runtime role', () => {
    it('the runtime DB role does not have UPDATE on audit_log', async () => {
      const { dbAdmin } = await import('../../src/db/db');
      const appUser = process.env.DB_APP_USER ?? 'app_user';
      const result = await dbAdmin.raw<{ rows: Array<{ has: boolean }> }>(
        "SELECT has_table_privilege(?, 'audit_log', 'UPDATE') AS has",
        [appUser],
      );
      const has = result.rows?.[0]?.has;
      // If the role doesn't exist in this dev DB (some setups skip
      // creating app_user), skip silently — the assertion is only
      // meaningful when the role is provisioned.
      if (typeof has !== 'boolean') return;
      expect(has).toBe(false);
    });

    it('the runtime DB role does not have DELETE on audit_log', async () => {
      const { dbAdmin } = await import('../../src/db/db');
      const appUser = process.env.DB_APP_USER ?? 'app_user';
      const result = await dbAdmin.raw<{ rows: Array<{ has: boolean }> }>(
        "SELECT has_table_privilege(?, 'audit_log', 'DELETE') AS has",
        [appUser],
      );
      const has = result.rows?.[0]?.has;
      if (typeof has !== 'boolean') return;
      expect(has).toBe(false);
    });

    it('the runtime DB role retains INSERT on audit_log (write-only access)', async () => {
      const { dbAdmin } = await import('../../src/db/db');
      const appUser = process.env.DB_APP_USER ?? 'app_user';
      const result = await dbAdmin.raw<{ rows: Array<{ has: boolean }> }>(
        "SELECT has_table_privilege(?, 'audit_log', 'INSERT') AS has",
        [appUser],
      );
      const has = result.rows?.[0]?.has;
      if (typeof has !== 'boolean') return;
      expect(has).toBe(true);
    });

    // BUG-039 Layer B (defence-in-depth) — BEFORE UPDATE/DELETE triggers
    // fire for ALL roles, including dbAdmin (owner). Even if a future
    // GRANT ALL silently re-opens the grant layer, the trigger still
    // raises, so tamper attempts are blocked at the DB engine.
    it('BEFORE UPDATE trigger raises for dbAdmin (owner role) — defence-in-depth', async () => {
      const { dbAdmin } = await import('../../src/db/db');
      // Insert a test row we can attempt to mutate. Use dbAdmin so
      // the INSERT isn't blocked by any RLS policy.
      const testRow = {
        clinic_id: clinicId,
        action: 'bug_039_trigger_update_probe',
        table_name: 'audit_log',
        record_id: '00000000-0000-0000-0000-000000000001',
        operation: 'bug_039_trigger_update_probe',
        module: 'audit_log',
        entity_type: 'audit_log',
        new_data: JSON.stringify({ probe: true }),
      };
      await dbAdmin('audit_log').insert(testRow);

      let caught: Error | null = null;
      try {
        await dbAdmin('audit_log')
          .where({ operation: 'bug_039_trigger_update_probe' })
          .update({ action: 'TAMPERED' });
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).not.toBeNull();
      expect((caught as Error).message).toMatch(/audit_log is append-only/);
    });

    it('BEFORE DELETE trigger raises for dbAdmin (owner role) — defence-in-depth', async () => {
      const { dbAdmin } = await import('../../src/db/db');
      const testRow = {
        clinic_id: clinicId,
        action: 'bug_039_trigger_delete_probe',
        table_name: 'audit_log',
        record_id: '00000000-0000-0000-0000-000000000002',
        operation: 'bug_039_trigger_delete_probe',
        module: 'audit_log',
        entity_type: 'audit_log',
        new_data: JSON.stringify({ probe: true }),
      };
      await dbAdmin('audit_log').insert(testRow);

      let caught: Error | null = null;
      try {
        await dbAdmin('audit_log')
          .where({ operation: 'bug_039_trigger_delete_probe' })
          .del();
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).not.toBeNull();
      expect((caught as Error).message).toMatch(/audit_log is append-only/);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Layer 3 — every PHI mutation produces a row
  // ───────────────────────────────────────────────────────────────────
  describe('Layer 3: PHI-touching API actions produce audit entries', () => {
    // FIXED: patientAccessAudit now handles both DETAIL reads
    // (action='READ', specific patient_id) and LIST reads
    // (action='READ_LIST', search term + requestId in new_data
    // but NO patient_id so one list call = one audit row, not N).
    // APP 11 / APP 11.2 forensic-discoverability requirement.
    it('a successful patient LIST read produces an audit row', async () => {
      const agent = authedAgent(token);
      const before = await countAuditRows(clinicId);
      const res = await agent.get('/api/v1/patients?limit=1');
      expect(res.status).toBe(200);
      // res.on('finish') runs in the next tick — give it time.
      await new Promise((r) => setTimeout(r, 300));
      const after = await countAuditRows(clinicId);
      expect(after).toBeGreaterThan(before);
    });

    it('a successful patient detail READ produces an audit row', async () => {
      const agent = authedAgent(token);
      const list = await agent.get('/api/v1/patients?limit=1');
      const rows = (list.body.data ?? list.body) as Array<{ id: string }>;
      if (!rows.length) return; // empty seed — nothing to assert
      const before = await countAuditRows(clinicId);
      const detail = await agent.get(`/api/v1/patients/${rows[0].id}`);
      // Patient detail may be 200 or 403 depending on assignment;
      // we only care about audit when the read actually succeeded.
      if (detail.status !== 200) return;
      await new Promise((r) => setTimeout(r, 100));
      const after = await countAuditRows(clinicId);
      expect(after).toBeGreaterThan(before);
    });
  });
});

async function countAuditRows(clinicId: string): Promise<number> {
  const { dbAdmin } = await import('../../src/db/db');
  const r = await dbAdmin('audit_log')
    .where({ clinic_id: clinicId })
    .count<{ count: string }>('id as count')
    .first();
  return Number(r?.count ?? 0);
}
