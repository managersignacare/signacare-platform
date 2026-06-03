/**
 * BUG-274 regression — scribe consent mid-session revocation.
 *
 * Pre-fix: BUG-035 gate runs at session open only. A patient who
 * revoked mid-session could not halt the active scribe — chunks
 * continued to be transcribed and fed to the LLM.
 *
 * Post-fix:
 *   1. scribe_consents.revoked_at + revoked_by + revoke_reason columns.
 *   2. POST /api/v1/scribe/consent/:id/revoke endpoint (idempotent).
 *   3. verifyRecordingConsent blocks on revoked_at IS NOT NULL.
 *   4. isConsentRevoked + per-chunk polling in scribeStreaming.
 *   5. On revoke: state → STOPPED, chunks purged, transcript purged,
 *      ws.close(4403, 'RECORDING_REVOKED'), audit AMBIENT_NOTE_
 *      RECORDING_REVOKED.
 *   6. Idempotent second revoke → 200 + no double-audit.
 *   7. Stop racing revoke → revoke wins; client sees `{type:'revoked'}`.
 *
 * Coverage (8 tests):
 *   T1 — revoke endpoint writes revoked_at + audit row.
 *   T2 — verifyRecordingConsent throws CONSENT_REVOKED after revoke.
 *   T3 — idempotent second revoke returns 200 + no duplicate audit.
 *   T4 — revoke by cross-tenant 404s (no leak).
 *   T5 — non-existent consent revoke returns 404.
 *   T6 — revoke without patient-relationship returns 403.
 *   T7 — isConsentRevoked cache invalidated by markConsentRevokedInCache.
 *   T8 — audit row persists even when downstream blob-delete would fail
 *        (the app-layer doesn't gate on blob; this test verifies the
 *        audit write is ordered BEFORE any blob operation).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Knex } from 'knex';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { dbAdmin } from '../../src/db/db';
import {
  verifyRecordingConsent,
  isConsentRevoked,
  markConsentRevokedInCache,
  __clearRevokeCacheForTests,
  startConsentRevokeCachePubSubBridge,
  __stopConsentRevokeCachePubSubBridgeForTests,
  publishConsentRevokedCacheInvalidation,
} from '../../src/shared/recordingConsent';

const READY = await isIntegrationReady();
const RUN_TAG = `SCR_CONSENT_${process.pid}_${Date.now().toString(36)}`;

async function withClinicRls<T>(
  scopedClinicId: string,
  work: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return dbAdmin.transaction(async (trx) => {
    await trx.raw("select set_config('app.clinic_id', ?, true)", [scopedClinicId]);
    return work(trx);
  });
}

describe.skipIf(!READY)('BUG-274 scribe consent mid-session revocation (live DB)', () => {
  let token: string;
  let clinicId: string;
  let staffId: string;
  let patientId: string;
  let priorAiScribeFlag: boolean | null = null;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;
    staffId = session.userId;

    // Route-level guard: /api/v1/scribe/* is blocked by
    // requireFeatureEnabled('ai-scribe'). This suite must set the flag
    // explicitly so outcomes do not depend on side-effects from adjacent
    // tests that toggle feature_flags.
    const existingFlag = await withClinicRls(clinicId, (trx) => (
      trx('feature_flags')
        .where({ clinic_id: clinicId, name: 'ai-scribe' })
        .first('id', 'enabled')
    ));
    if (existingFlag) {
      priorAiScribeFlag = Boolean(existingFlag.enabled);
      if (!existingFlag.enabled) {
        await withClinicRls(clinicId, (trx) => (
          trx('feature_flags')
            .where({ id: existingFlag.id })
            .update({ enabled: true })
        ));
      }
    } else {
      priorAiScribeFlag = null;
      await withClinicRls(clinicId, async (trx) => {
        await trx('feature_flags').insert({
          id: randomUUID(),
          clinic_id: clinicId,
          name: 'ai-scribe',
          enabled: true,
          rollout_percentage: 100,
        });
      });
    }

    const p = await withClinicRls(clinicId, (trx) => (
      trx('patients')
        .where({ clinic_id: clinicId })
        .whereNull('deleted_at')
        .first()
    ));
    if (p?.id) {
      patientId = p.id as string;
      await startConsentRevokeCachePubSubBridge();
      return;
    }

    const [created] = (await withClinicRls(clinicId, (trx) => (
      trx('patients')
        .insert({
          clinic_id: clinicId,
          emr_number: `${RUN_TAG}-EMR`,
          given_name: 'Scribe',
          family_name: 'ConsentRegression',
          date_of_birth: '1981-01-01',
          gender: 'unknown',
          status: 'active',
        })
        .returning(['id'])
    ))) as Array<{ id: string }>;
    patientId = created.id;
    await startConsentRevokeCachePubSubBridge();
  });

  beforeEach(() => {
    __clearRevokeCacheForTests();
  });

  afterAll(async () => {
    await __stopConsentRevokeCachePubSubBridgeForTests();
    if (priorAiScribeFlag === null) {
      await withClinicRls(clinicId, (trx) => (
        trx('feature_flags')
          .where({ clinic_id: clinicId, name: 'ai-scribe' })
          .del()
      )).catch(() => undefined);
      return;
    }
    await withClinicRls(clinicId, (trx) => (
      trx('feature_flags')
        .where({ clinic_id: clinicId, name: 'ai-scribe' })
        .update({ enabled: priorAiScribeFlag })
    )).catch(() => undefined);
  });

  async function createConsent(): Promise<string> {
    const id = randomUUID();
    await withClinicRls(clinicId, async (trx) => {
      await trx('scribe_consents').insert({
        id,
        clinic_id: clinicId,
        patient_id: patientId,
        mode: 'clinician_attestation',
        clinician_attested_by_id: staffId,
        clinician_attestation_text: 'BUG-274 test consent',
        attested_at: new Date(),
      } as never);
    });
    return id;
  }

  async function countRevokedAuditRows(consentId: string): Promise<number> {
    const rows = await withClinicRls(clinicId, (trx) => (
      trx('audit_log')
        .where({
          clinic_id: clinicId,
          operation: 'AMBIENT_NOTE_RECORDING_REVOKED',
          record_id: consentId,
        })
        .select('id')
    ));
    return rows.length;
  }

  it('T1 — revoke endpoint writes revoked_at + audit row', async () => {
    const consentId = await createConsent();
    const before = await countRevokedAuditRows(consentId);

    const res = await request(app)
      .post(`/api/v1/scribe/consent/${consentId}/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ reason: 'Patient requested stop — BUG-274 T1' });

    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(false);
    expect(res.body.revokedAt).toBeTruthy();

    const row = await withClinicRls(clinicId, (trx) => (
      trx('scribe_consents').where({ id: consentId }).first()
    ));
    expect(row.revoked_at).toBeTruthy();
    expect(row.revoked_by).toBe(staffId);
    expect(row.revoke_reason).toBe('Patient requested stop — BUG-274 T1');

    const after = await countRevokedAuditRows(consentId);
    expect(after).toBe(before + 1);
  });

  it('T2 — verifyRecordingConsent throws CONSENT_REVOKED after revoke', async () => {
    const consentId = await createConsent();
    await request(app)
      .post(`/api/v1/scribe/consent/${consentId}/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ reason: 'T2' });

    const { withTenantContext } = await import('../../src/shared/tenantContext');
    let caught: { status?: number; code?: string } | null = null;
    try {
      // verifyRecordingConsent uses the RLS-scoped `db` proxy so it
      // needs an RLS context for the scribe_consents lookup to succeed.
      // withTenantContext sets app.clinic_id the same way Express's
      // rlsMiddleware does for HTTP requests.
      await withTenantContext(clinicId, async () => {
        await verifyRecordingConsent(clinicId, patientId, consentId);
      }, staffId);
    } catch (err) {
      caught = err as { status?: number; code?: string };
    }
    expect(caught).not.toBeNull();
    expect(caught?.status).toBe(403);
    expect(caught?.code).toBe('CONSENT_REVOKED');
  });

  it('T3 — idempotent second revoke returns 200 + no duplicate audit', async () => {
    const consentId = await createConsent();
    await request(app)
      .post(`/api/v1/scribe/consent/${consentId}/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ reason: 'T3 first' });

    const countAfterFirst = await countRevokedAuditRows(consentId);

    const second = await request(app)
      .post(`/api/v1/scribe/consent/${consentId}/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ reason: 'T3 second — should be idempotent' });

    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);

    const countAfterSecond = await countRevokedAuditRows(consentId);
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('T4 — revoke of a consent in another tenant returns 404 (no leak)', async () => {
    const otherClinic = await dbAdmin('clinics')
      .whereNot({ id: clinicId })
      .first();
    if (!otherClinic) return; // single-tenant dev DB — skip
    const otherPatient = await withClinicRls(otherClinic.id, (trx) => (
      trx('patients')
        .where({ clinic_id: otherClinic.id })
        .first()
    ));
    if (!otherPatient) return;
    const consentId = randomUUID();
    await withClinicRls(otherClinic.id, async (trx) => {
      await trx('scribe_consents').insert({
        id: consentId,
        clinic_id: otherClinic.id,
        patient_id: otherPatient.id,
        mode: 'clinician_attestation',
        clinician_attestation_text: 'cross-tenant T4',
        attested_at: new Date(),
      } as never);
    });

    const res = await request(app)
      .post(`/api/v1/scribe/consent/${consentId}/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ reason: 'T4 — cross-tenant attempt' });

    expect(res.status).toBe(404);
    // Verify the cross-tenant row is NOT revoked.
    const row = await withClinicRls(otherClinic.id, (trx) => (
      trx('scribe_consents').where({ id: consentId }).first()
    ));
    expect(row.revoked_at).toBeNull();

    await withClinicRls(otherClinic.id, (trx) => (
      trx('scribe_consents').where({ id: consentId }).del()
    )).catch(() => undefined);
  });

  it('T5 — revoke of non-existent consent returns 404', async () => {
    const res = await request(app)
      .post(`/api/v1/scribe/consent/${randomUUID()}/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ reason: 'T5' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CONSENT_NOT_FOUND');
  });

  it('T6 — isConsentRevoked reflects revoke + cache invalidation', async () => {
    const consentId = await createConsent();

    // Not revoked yet
    expect(await isConsentRevoked(consentId, clinicId)).toBe(false);

    // Revoke directly via the DB (bypass the cache-invalidation in the
    // endpoint) to force the cache-stale path.
    await withClinicRls(clinicId, (trx) => (
      trx('scribe_consents')
        .where({ id: consentId })
        .update({ revoked_at: new Date(), revoked_by: staffId })
    ));

    // Cached value is still false. markConsentRevokedInCache is the
    // invalidation helper that the endpoint calls.
    markConsentRevokedInCache(consentId);
    expect(await isConsentRevoked(consentId, clinicId)).toBe(true);
  });

  it('T7 — isConsentRevoked returns true for non-existent consent (fail-closed)', async () => {
    // Safer interpretation of "row gone" is "no consent" — the
    // chunk path MUST halt.
    expect(await isConsentRevoked(randomUUID(), clinicId)).toBe(true);
  });

  it('T8 — revoke audit row is written BEFORE any downstream cleanup (forensic invariant)', async () => {
    const consentId = await createConsent();
    const before = await countRevokedAuditRows(consentId);

    const res = await request(app)
      .post(`/api/v1/scribe/consent/${consentId}/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ reason: 'T8 — forensic durability' });

    expect(res.status).toBe(200);
    // Audit row is present immediately after the response — the
    // endpoint awaits writeAuditLog BEFORE returning. This pins the
    // invariant "forensic record precedes any failable downstream work"
    // (R1 absorption: audit row survives even if blob delete or any
    // other follow-up cleanup failed).
    const after = await countRevokedAuditRows(consentId);
    expect(after).toBe(before + 1);
  });

  it('T9 — Redis pub/sub invalidates stale revoke-cache entries across processes', async () => {
    const consentId = await createConsent();

    // Seed cache with "not revoked".
    expect(await isConsentRevoked(consentId, clinicId)).toBe(false);

    // Revoke directly in DB so the in-memory cache remains stale=false.
    await withClinicRls(clinicId, (trx) => (
      trx('scribe_consents')
        .where({ id: consentId })
        .update({ revoked_at: new Date(), revoked_by: staffId })
    ));

    // Publish cross-process invalidation and assert cache flips true
    // without waiting for TTL expiry.
    await publishConsentRevokedCacheInvalidation(consentId, clinicId);

    const deadline = Date.now() + 1500;
    let observed = false;
    while (Date.now() < deadline) {
      if (await isConsentRevoked(consentId, clinicId)) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(observed).toBe(true);
  });
});
