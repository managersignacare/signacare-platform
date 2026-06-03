import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';

import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { CANONICAL_CLINIC_IDS } from '../fixtures/canonical-personas';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

let session: Session;
let ownPatientId = '';
let foreignPatientId = '';
let foreignPatientName = '';
let foreignPatientEmr = '';
const seededPatientIds: string[] = [];

const EXPORT_ROUTE_SET: ReadonlyArray<{
  name: string;
  path: (patientId: string) => string;
}> = [
  { name: 'demographics', path: (id) => `/api/v1/patients/${id}` },
  { name: 'episodes', path: (id) => `/api/v1/episodes/patient/${id}` },
  { name: 'notes', path: (id) => `/api/v1/patients/${id}/notes` },
  { name: 'medications', path: (id) => `/api/v1/medications/patients/${id}/medications` },
  { name: 'alerts', path: (id) => `/api/v1/patients/${id}/alerts` },
  { name: 'legal-orders', path: (id) => `/api/v1/patients/${id}/legal-orders` },
  { name: 'pathology', path: (id) => `/api/v1/patients/${id}/pathology` },
  { name: 'appointments', path: (id) => `/api/v1/appointments?patientId=${encodeURIComponent(id)}` },
  { name: 'correspondence', path: (id) => `/api/v1/correspondence/letters?patientId=${encodeURIComponent(id)}` },
  { name: 'assessments', path: (id) => `/api/v1/nursing-assessments?patientId=${encodeURIComponent(id)}` },
  { name: 'risk-assessments', path: (id) => `/api/v1/risk-assessments/patient/${id}` },
  { name: 'referrals', path: (id) => `/api/v1/referrals?patientId=${encodeURIComponent(id)}` },
  { name: 'privacy-export', path: (id) => `/api/v1/privacy/patient/${id}/export` },
];

function collectRows(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== 'object') return [];
  const rec = body as Record<string, unknown>;
  const candidates = [
    rec.data,
    rec.notes,
    rec.alerts,
    rec.orders,
    rec.reports,
    rec.items,
    rec.rows,
    rec.referrals,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
    }
  }
  if (Array.isArray(body)) {
    return body.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
  }
  return [];
}

function rowPatientId(row: Record<string, unknown>): string | null {
  const value = row.patientId ?? row.patient_id ?? row.id;
  return typeof value === 'string' ? value : null;
}

describe.skipIf(!READY)('Data export module routes are clinic-isolated', () => {
  beforeAll(async () => {
    session = await loginAsAdmin();

    const now = new Date();
    ownPatientId = randomUUID();
    foreignPatientId = randomUUID();
    foreignPatientName = `ExportLeakProbeSecondary-${Date.now()}`;
    foreignPatientEmr = `XLEAK-${Date.now()}`;

    await withTenantContext(CANONICAL_CLINIC_IDS.primary, async () => {
      await dbAdmin('patients').insert({
        id: ownPatientId,
        clinic_id: CANONICAL_CLINIC_IDS.primary,
        given_name: `ExportLeakProbePrimary-${Date.now()}`,
        family_name: 'Isolation',
        emr_number: `XOWN-${Date.now()}`,
        date_of_birth: '1990-01-01',
        status: 'active',
        created_at: now,
        updated_at: now,
      });
    });

    await withTenantContext(CANONICAL_CLINIC_IDS.secondary, async () => {
      await dbAdmin('patients').insert({
        id: foreignPatientId,
        clinic_id: CANONICAL_CLINIC_IDS.secondary,
        given_name: foreignPatientName,
        family_name: 'Isolation',
        emr_number: foreignPatientEmr,
        date_of_birth: '1991-02-02',
        status: 'active',
        created_at: now,
        updated_at: now,
      });
    });

    seededPatientIds.push(ownPatientId, foreignPatientId);
  });

  afterAll(async () => {
    if (!READY) return;
    if (seededPatientIds.length === 0) return;
    await dbAdmin('patients').whereIn('id', seededPatientIds).del().catch(() => undefined);
  });

  it('returns data for own-clinic patient on representative endpoints', async () => {
    const res = await request(app)
      .get(`/api/v1/patients/${ownPatientId}`)
      .set('Authorization', `Bearer ${session.token}`);
    expect(res.status).toBe(200);
  });

  it('does not surface foreign-clinic patient in export patient search/list routes', async () => {
    const [searchRes, listRes] = await Promise.all([
      request(app)
        .get(`/api/v1/patients?search=${encodeURIComponent(foreignPatientName)}&limit=20`)
        .set('Authorization', `Bearer ${session.token}`),
      request(app)
        .get('/api/v1/patients?limit=100')
        .set('Authorization', `Bearer ${session.token}`),
    ]);

    expect(searchRes.status).toBe(200);
    expect(listRes.status).toBe(200);

    const searchRows = collectRows(searchRes.body);
    const listRows = collectRows(listRes.body);

    for (const row of [...searchRows, ...listRows]) {
      const pid = rowPatientId(row);
      if (pid) expect(pid).not.toBe(foreignPatientId);

      const name = `${String(row.givenName ?? row.given_name ?? '')} ${String(row.familyName ?? row.family_name ?? '')}`.trim();
      expect(name).not.toContain(foreignPatientName);

      const emr = String(row.emrNumber ?? row.emr_number ?? '');
      expect(emr).not.toBe(foreignPatientEmr);
    }
  });

  for (const entry of EXPORT_ROUTE_SET) {
    it(`does not leak cross-clinic patient data on ${entry.name}`, async () => {
      const res = await request(app)
        .get(entry.path(foreignPatientId))
        .set('Authorization', `Bearer ${session.token}`);

      expect([200, 403, 404]).toContain(res.status);

      if (res.status !== 200) return;

      const bodyText = JSON.stringify(res.body ?? {});
      // Never include the known foreign patient identity tuple in payload.
      expect(bodyText).not.toContain(foreignPatientId);
      if (foreignPatientName) expect(bodyText).not.toContain(foreignPatientName);
      if (foreignPatientEmr) expect(bodyText).not.toContain(foreignPatientEmr);

      // For list-style responses, enforce per-row patient and clinic scope.
      const rows = collectRows(res.body);
      for (const row of rows) {
        const pid = rowPatientId(row);
        if (pid) expect(pid).not.toBe(foreignPatientId);

        const clinic =
          (typeof row.clinicId === 'string' && row.clinicId)
          || (typeof row.clinic_id === 'string' && row.clinic_id)
          || null;
        if (clinic) expect(clinic).toBe(session.clinicId);
      }
    });
  }
});
