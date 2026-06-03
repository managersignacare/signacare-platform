import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { redis } from '../../src/config/redis';
import { workflowEvents } from '../../src/features/workflows/workflowEvents';
import { WORKFLOW_OUTBOX_KEY } from '../../src/features/workflows/workflowOutbox';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('A1a/B1 lane closure proofs', () => {
  let token: string;
  let clinicId: string;
  const created = {
    orgUnitIds: [] as string[],
    patientIds: [] as string[],
    episodeIds: [] as string[],
    referralIds: [] as string[],
    staffIds: [] as string[],
  };

  beforeAll(async () => {
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    for (const id of created.referralIds) {
      await dbAdmin('referrals').where({ id }).delete().catch(() => {});
    }
    for (const id of created.episodeIds) {
      await dbAdmin('episodes').where({ id }).delete().catch(() => {});
    }
    for (const id of created.patientIds) {
      await dbAdmin('patients').where({ id }).delete().catch(() => {});
    }
    for (const id of created.staffIds) {
      await dbAdmin('staff').where({ id }).delete().catch(() => {});
    }
    for (const id of created.orgUnitIds) {
      await dbAdmin('staff_role_assignments').where({ org_unit_id: id }).delete().catch(() => {});
      await dbAdmin('patient_team_assignments').where({ org_unit_id: id }).delete().catch(() => {});
      await dbAdmin('org_units').where({ id }).delete().catch(() => {});
    }
    await redis.del(WORKFLOW_OUTBOX_KEY).catch(() => {});
  });

  async function seedOrgUnit(nameSuffix: string): Promise<string> {
    const { dbAdmin } = await import('../../src/db/db');
    const id = randomUUID();
    await dbAdmin('org_units').insert({
      id,
      clinic_id: clinicId,
      name: `LaneClose-${nameSuffix}-${Date.now()}`,
      level: 'team',
      created_at: new Date(),
      updated_at: new Date(),
    });
    created.orgUnitIds.push(id);
    return id;
  }

  async function seedStaff(nameSuffix: string): Promise<string> {
    const { dbAdmin } = await import('../../src/db/db');
    const id = randomUUID();
    await dbAdmin('staff').insert({
      id,
      clinic_id: clinicId,
      email: `lane-close-${nameSuffix}-${Date.now()}@example.invalid`,
      password_hash: 'x',
      given_name: `Lane${nameSuffix}`,
      family_name: 'Test',
      role: 'admin',
      created_at: new Date(),
      updated_at: new Date(),
    });
    created.staffIds.push(id);
    return id;
  }

  async function seedPatient(nameSuffix: string): Promise<string> {
    const { dbAdmin } = await import('../../src/db/db');
    const [row] = await dbAdmin('patients').insert({
      clinic_id: clinicId,
      given_name: `Lane${nameSuffix}`,
      family_name: 'Patient',
      date_of_birth: '1990-01-01',
      gender: 'Male',
      created_at: new Date(),
      updated_at: new Date(),
    }).returning(['id']);
    created.patientIds.push(row.id);
    return row.id as string;
  }

  async function seedEpisode(patientId: string, status: 'open' | 'closed' = 'open'): Promise<string> {
    const { dbAdmin } = await import('../../src/db/db');
    const id = randomUUID();
    await dbAdmin('episodes').insert({
      id,
      clinic_id: clinicId,
      patient_id: patientId,
      status,
      start_date: '2026-05-11',
      end_date: status === 'closed' ? '2026-05-11' : null,
      closure_reason: status === 'closed' ? 'preclosed' : null,
      closure_summary: status === 'closed' ? 'Pre-closed episode for rollback test.' : null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    created.episodeIds.push(id);
    return id;
  }

  async function seedReferral(patientId: string, linkedEpisodeId: string): Promise<string> {
    const { dbAdmin } = await import('../../src/db/db');
    const id = randomUUID();
    await dbAdmin('referrals').insert({
      id,
      clinic_id: clinicId,
      patient_id: patientId,
      linked_episode_id: linkedEpisodeId,
      referral_number: `LANE-${Date.now()}-${Math.floor(Math.random() * 1_000)}`,
      referral_date: '2026-05-11',
      source: 'external',
      from_service: 'Lane close test',
      reason: 'Lane closure integration test',
      urgency: 'routine',
      status: 'received',
      created_at: new Date(),
      updated_at: new Date(),
    });
    created.referralIds.push(id);
    return id;
  }

  test.sequential('BUG-REFERRAL-INTAKE-CLOSE-LIE-ABOUT-SUCCESS: linked intake episode closes in same transaction', async () => {
    const orgUnitId = await seedOrgUnit('tx-close-ok');
    const staffId = await seedStaff('tx-close-ok');
    const patientId = await seedPatient('tx-close-ok');
    const careEpisodeId = await seedEpisode(patientId, 'open');
    const intakeEpisodeId = await seedEpisode(patientId, 'open');
    const referralId = await seedReferral(patientId, intakeEpisodeId);

    const res = await request(app)
      .post(`/api/v1/referrals/${referralId}/allocate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({
        episodeId: careEpisodeId,
        orgUnitId,
        primaryClinicianId: staffId,
      });

    expect(res.status).toBe(200);

    const { dbAdmin } = await import('../../src/db/db');
    const intake = await dbAdmin('episodes').where({ id: intakeEpisodeId, clinic_id: clinicId }).first();
    expect(intake?.status).toBe('closed');
    expect(intake?.closure_reason).toBe('Referral accepted — allocated to care team');
  });

  test.sequential('BUG-REFERRAL-INTAKE-CLOSE-LIE-ABOUT-SUCCESS: close failure rolls back allocation side-effects', async () => {
    const orgUnitId = await seedOrgUnit('tx-close-rollback');
    const staffId = await seedStaff('tx-close-rollback');
    const patientId = await seedPatient('tx-close-rollback');
    const careEpisodeId = await seedEpisode(patientId, 'open');
    const alreadyClosedIntakeId = await seedEpisode(patientId, 'closed');
    const referralId = await seedReferral(patientId, alreadyClosedIntakeId);

    const res = await request(app)
      .post(`/api/v1/referrals/${referralId}/allocate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({
        episodeId: careEpisodeId,
        orgUnitId,
        primaryClinicianId: staffId,
      });

    expect(res.status).toBe(422);
    expect(String(res.body?.code ?? '')).toBe('INVALID_STATE_TRANSITION');

    const { dbAdmin } = await import('../../src/db/db');
    const careEpisode = await dbAdmin('episodes').where({ id: careEpisodeId, clinic_id: clinicId }).first();
    expect(careEpisode?.team_id ?? null).toBeNull();

    const assignment = await dbAdmin('patient_team_assignments')
      .where({ patient_id: patientId, org_unit_id: orgUnitId })
      .first();
    expect(assignment).toBeFalsy();
  });

  test.sequential('BUG-CLINICAL-ROLES-DUPLICATE-AUTOCREATE: concurrent first-use role create resolves to one row', async () => {
    const orgUnitA = await seedOrgUnit('role-race-a');
    const orgUnitB = await seedOrgUnit('role-race-b');
    const staffId = await seedStaff('role-race');
    const patientA = await seedPatient('role-race-a');
    const patientB = await seedPatient('role-race-b');
    const episodeA = await seedEpisode(patientA, 'open');
    const episodeB = await seedEpisode(patientB, 'open');
    const roleName = `Race Role ${Date.now()}`;

    const bodyA = {
      orgUnitId: orgUnitA,
      primaryClinicianId: staffId,
      additionalMdt: [{ role: roleName, staffId }],
    };
    const bodyB = {
      orgUnitId: orgUnitB,
      primaryClinicianId: staffId,
      additionalMdt: [{ role: roleName, staffId }],
    };

    const [resA, resB] = await Promise.all([
      request(app)
        .post(`/api/v1/episodes/${episodeA}/allocate`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', 'test')
        .send(bodyA),
      request(app)
        .post(`/api/v1/episodes/${episodeB}/allocate`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', 'test')
        .send(bodyB),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const { dbAdmin } = await import('../../src/db/db');
    const rows = await dbAdmin('clinical_roles')
      .where({ clinic_id: clinicId, name: roleName })
      .select('id');
    expect(rows).toHaveLength(1);
  });

  test.sequential('BUG-EPISODE-WORKFLOW-EVENT-SILENT-CATCH: emits become visible and recoverable when listener missing', async () => {
    const orgUnitId = await seedOrgUnit('workflow-outbox');
    const staffId = await seedStaff('workflow-outbox');
    const patientId = await seedPatient('workflow-outbox');
    const episodeId = await seedEpisode(patientId, 'open');

    await redis.del(WORKFLOW_OUTBOX_KEY);

    const listeners = workflowEvents.listeners('episode_opened');
    workflowEvents.removeAllListeners('episode_opened');

    try {
      const res = await request(app)
        .post(`/api/v1/episodes/${episodeId}/allocate`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', 'test')
        .send({
          orgUnitId,
          primaryClinicianId: staffId,
          additionalMdt: [{ role: `Outbox Role ${Date.now()}`, staffId }],
        });

      expect(res.status).toBe(200);

      const outboxLength = Number(await redis.llen(WORKFLOW_OUTBOX_KEY));
      expect(outboxLength).toBeGreaterThan(0);

      const newest = await redis.lindex(WORKFLOW_OUTBOX_KEY, 0);
      expect(newest).toBeTruthy();
      const parsed = JSON.parse(String(newest)) as {
        event?: string;
        data?: { episodeId?: string; clinicId?: string };
      };
      expect(parsed.event).toBe('episode_opened');
      expect(parsed.data?.episodeId).toBe(episodeId);
      expect(parsed.data?.clinicId).toBe(clinicId);
    } finally {
      workflowEvents.removeAllListeners('episode_opened');
      for (const listener of listeners) {
        workflowEvents.on('episode_opened', listener as (...args: unknown[]) => void);
      }
    }
  });
});
