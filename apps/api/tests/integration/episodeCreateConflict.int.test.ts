import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('Episode create conflict contract', () => {
  let token = '';
  let clinicId = '';
  let patientId = '';

  beforeAll(async () => {
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;
    patientId = randomUUID();

    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: clinicId,
      given_name: 'EpisodeConflict',
      family_name: `Patient-${Date.now()}`,
      emr_number: `EC-${Date.now()}`,
      date_of_birth: '1988-01-01',
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  afterAll(async () => {
    if (patientId) {
      await dbAdmin('episodes').where({ patient_id: patientId }).del();
      await dbAdmin('patients').where({ id: patientId }).del();
    }
  });

  it('returns 409 OPEN_EPISODE_TYPE_CONFLICT when a second open episode of the same type is created for one patient', async () => {
    const first = await request(app)
      .post('/api/v1/episodes')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({
        patientId,
        title: `Initial episode ${Date.now()}`,
        episodeType: 'community',
        startDate: '2026-01-01',
      });

    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/episodes')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({
        patientId,
        title: `Duplicate episode ${Date.now()}`,
        episodeType: 'community',
        startDate: '2026-01-02',
      });

    expect(second.status).toBe(409);
    expect(second.body?.code).toBe('OPEN_EPISODE_TYPE_CONFLICT');
    expect(typeof second.body?.error).toBe('string');
  });
});
