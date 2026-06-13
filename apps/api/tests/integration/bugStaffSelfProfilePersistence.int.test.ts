import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { authedAgent, isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-STAFF-SELF-PROFILE-PERSISTENCE', () => {
  it('persists self-service discipline and credential helper fields without writing ghost columns', async () => {
    const adminSession = await loginAsAdmin();
    const adminAgent = authedAgent(adminSession.token);
    const clinicId = adminSession.clinicId;
    const email = `self-profile-${Date.now()}@example.test`.toLowerCase();
    const disciplineName = `Neuropsychology ${Date.now()}`;

    let staffId: string | null = null;
    let disciplineId: string | null = null;

    try {
      const [disciplineRow] = await dbAdmin('professional_disciplines')
        .insert({
          clinic_id: clinicId,
          name: disciplineName,
          is_active: true,
          sort_order: 999,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning(['id']);
      disciplineId = disciplineRow?.id ?? null;
      expect(disciplineId).toBeTruthy();

      const createRes = await adminAgent.post('/api/v1/staff').send({
        givenName: 'Self',
        familyName: 'Editor',
        email,
        role: 'clinician',
      });

      expect(createRes.status).toBe(201);
      expect(typeof createRes.body?.temporaryPassword).toBe('string');
      staffId = createRes.body?.id ?? null;
      expect(staffId).toBeTruthy();

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({ email, password: String(createRes.body?.temporaryPassword) });
      expect(loginRes.status).toBe(200);
      const staffToken = loginRes.body?.accessToken as string | undefined;
      expect(typeof staffToken).toBe('string');

      const staffAgent = authedAgent(staffToken!);
      const providerNumbers = [
        { type: 'Medicare', number: '1234567A', location: 'Main rooms' },
        { type: 'DVA', number: '7654321B', location: 'Outreach' },
      ];

      const updateRes = await staffAgent.put('/api/v1/staff/me').send({
        discipline: disciplineId,
        ahpraNumber: 'MED0001234567',
        ahpraExpiry: '2027-12-31',
        providerNumbers,
        phiProvider: 'HPIO clinic',
        phiNumber: '8003610000001234',
      });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body?.discipline).toBe(disciplineId);
      expect(updateRes.body?.ahpraNumber).toBe('MED0001234567');
      expect(updateRes.body?.ahpraExpiry).toBe('2027-12-31');
      expect(updateRes.body?.providerNumber).toBe('1234567A');
      expect(updateRes.body?.specialisation).toBe('HPIO clinic');
      expect(updateRes.body?.hpii).toBe('8003610000001234');

      const meRes = await staffAgent.get('/api/v1/staff/me');
      expect(meRes.status).toBe(200);
      expect(meRes.body?.discipline).toBe(disciplineId);
      expect(meRes.body?.ahpraExpiry).toBe('2027-12-31');
      expect(meRes.body?.providerNumber).toBe('1234567A');

      const savedRow = await dbAdmin('staff')
        .where({ id: staffId, clinic_id: clinicId })
        .first('discipline_id', 'provider_number', 'qualifications', 'specialisation', 'hpii');
      expect(savedRow?.discipline_id).toBe(disciplineId);
      expect(savedRow?.provider_number).toBe('1234567A');
      expect(savedRow?.specialisation).toBe('HPIO clinic');
      expect(savedRow?.hpii).toBe('8003610000001234');
      expect(JSON.parse(String(savedRow?.qualifications))).toEqual(providerNumbers);

      const ahpraExpiryRow = await dbAdmin('staff_settings')
        .where({ staff_id: staffId, setting_key: 'ahpra_expiry' })
        .first('setting_value');
      expect(ahpraExpiryRow?.setting_value).toBe('2027-12-31');
    } finally {
      if (staffId) {
        await dbAdmin('staff')
          .where({ id: staffId })
          .update({
            deleted_at: new Date(),
            is_active: false,
            email: `deleted+${staffId}@example.test`,
            updated_at: new Date(),
          })
          .catch(() => undefined);
        await dbAdmin('staff_settings')
          .where({ staff_id: staffId, setting_key: 'ahpra_expiry' })
          .delete()
          .catch(() => undefined);
      } else {
        await dbAdmin('staff')
          .where({ email })
          .update({
            deleted_at: new Date(),
            is_active: false,
            updated_at: new Date(),
          })
          .catch(() => undefined);
      }
      if (disciplineId) {
        await dbAdmin('professional_disciplines')
          .where({ id: disciplineId })
          .delete()
          .catch(() => undefined);
      }
    }
  });
});
