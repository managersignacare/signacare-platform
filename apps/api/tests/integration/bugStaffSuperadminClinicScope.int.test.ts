import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { dbAdmin } from '../../src/db/db';
import app from '../../src/server';
import { withTenantContext } from '../../src/shared/tenantContext';
import {
  CANONICAL_CLINIC_IDS,
  CANONICAL_PASSWORD,
  CANONICAL_PERSONAS,
} from '../fixtures/canonical-personas';
import { authedAgent, isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

interface StaffLookupRow {
  id: string;
  givenName: string;
  familyName: string;
  email: string;
  role: string;
  discipline: string | null;
}

describe.skipIf(!READY)('BUG-STAFF-SUPERADMIN-CLINIC-SCOPE', () => {
  async function loginAs(email: string) {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({ email, password: CANONICAL_PASSWORD });
    expect(res.status).toBe(200);
    expect(typeof res.body?.accessToken).toBe('string');
    return res.body.accessToken as string;
  }

  it('rejects superadmin role assignment by non-superadmin actors', async () => {
    const adminToken = await loginAs(CANONICAL_PERSONAS.admin.email);
    const agent = authedAgent(adminToken);

    const createRes = await agent.post('/api/v1/staff').send({
      clinicId: CANONICAL_CLINIC_IDS.primary,
      givenName: 'Blocked',
      familyName: 'Promotion',
      email: `blocked-super-${Date.now()}@signacare.net`,
      role: 'superadmin',
    });

    expect(createRes.status).toBe(403);
    expect(createRes.body?.code).toBe('FORBIDDEN');
  });

  it('rejects superadmin accounts on non-Signacare email domains', async () => {
    const session = await loginAsAdmin();
    const agent = authedAgent(session.token);

    const createRes = await agent.post('/api/v1/staff').send({
      clinicId: CANONICAL_CLINIC_IDS.primary,
      givenName: 'Bad',
      familyName: 'Domain',
      email: `bad-domain-${Date.now()}@clinic.example`,
      role: 'superadmin',
    });

    expect(createRes.status).toBe(422);
    expect(createRes.body?.code).toBe('VALIDATION_ERROR');
  });

  it('creates staff in the explicitly selected clinic for superadmin flows', async () => {
    const session = await loginAsAdmin();
    const agent = authedAgent(session.token);
    const targetClinicId = CANONICAL_CLINIC_IDS.secondary;
    const email = `staff-scope-${Date.now()}@example.test`.toLowerCase();
    let createdStaffId: string | null = null;

    try {
      const createRes = await agent.post('/api/v1/staff').send({
        clinicId: targetClinicId,
        givenName: 'Scoped',
        familyName: 'Staff',
        email,
        role: 'clinician',
      });

      expect(createRes.status).toBe(201);
      expect(createRes.body?.clinicId).toBe(targetClinicId);
      expect(typeof createRes.body?.temporaryPassword).toBe('string');
      createdStaffId = createRes.body?.id ?? null;
      expect(createdStaffId).toBeTruthy();

      const row = await withTenantContext(targetClinicId, async () =>
        dbAdmin('staff')
          .where({ id: createdStaffId })
          .first('clinic_id', 'email'),
      );
      expect(row?.clinic_id).toBe(targetClinicId);
      expect(row?.email).toBe(email);

      const lookupRes = await agent
        .get('/api/v1/staff/lookup')
        .query({ clinicId: targetClinicId });
      expect(lookupRes.status).toBe(200);
      const rows = lookupRes.body as StaffLookupRow[];
      expect(rows.some((candidate) => candidate.email.toLowerCase() === email)).toBe(true);
    } finally {
      if (createdStaffId) {
        await withTenantContext(targetClinicId, async () =>
          dbAdmin('staff').where({ id: createdStaffId }).del(),
        ).catch(() => undefined);
      } else {
        await withTenantContext(targetClinicId, async () =>
          dbAdmin('staff').where({ email }).del(),
        ).catch(() => undefined);
      }
    }
  });

  it('resolves lookup discipline from discipline_id for newly onboarded staff', async () => {
    const session = await loginAsAdmin();
    const agent = authedAgent(session.token);
    const targetClinicId = CANONICAL_CLINIC_IDS.secondary;
    const email = `staff-discipline-${Date.now()}@example.test`.toLowerCase();
    const disciplineName = `Consultation-Liaison Psychiatry ${Date.now()}`;
    let createdStaffId: string | null = null;
    let disciplineId: string | null = null;

    try {
      const [disciplineRow] = await withTenantContext(targetClinicId, async () =>
        dbAdmin('professional_disciplines')
          .insert({
            clinic_id: targetClinicId,
            name: disciplineName,
            is_active: true,
            sort_order: 999,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .returning(['id']),
      );
      disciplineId = disciplineRow?.id ?? null;
      expect(disciplineId).toBeTruthy();

      const createRes = await agent.post('/api/v1/staff').send({
        clinicId: targetClinicId,
        givenName: 'Discipline',
        familyName: 'Lookup',
        email,
        role: 'clinician',
        discipline: disciplineId,
      });

      expect(createRes.status).toBe(201);
      createdStaffId = createRes.body?.id ?? null;
      expect(createdStaffId).toBeTruthy();

      const lookupRes = await agent
        .get('/api/v1/staff/lookup')
        .query({ clinicId: targetClinicId });
      expect(lookupRes.status).toBe(200);
      const rows = lookupRes.body as StaffLookupRow[];
      const createdRow = rows.find((candidate) => candidate.email.toLowerCase() === email);
      expect(createdRow).toBeDefined();
      expect(createdRow?.discipline).toBe(disciplineName);
    } finally {
      if (createdStaffId) {
        await withTenantContext(targetClinicId, async () =>
          dbAdmin('staff').where({ id: createdStaffId }).del(),
        ).catch(() => undefined);
      } else {
        await withTenantContext(targetClinicId, async () =>
          dbAdmin('staff').where({ email }).del(),
        ).catch(() => undefined);
      }
      if (disciplineId) {
        await withTenantContext(targetClinicId, async () =>
          dbAdmin('professional_disciplines').where({ id: disciplineId }).del(),
        ).catch(() => undefined);
      }
    }
  });
});
