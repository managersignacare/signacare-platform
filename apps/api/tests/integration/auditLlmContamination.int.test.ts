/**
 * BUG-280 regression — retrospective llm_interactions contamination audit.
 *
 * Integration test because the audit SQL exercises real tables
 * (episodes, patient_team_assignments, staff_team_assignments,
 * appointments, appointment_attendees, break_glass_sessions,
 * staff.role). A unit test with mocks would duplicate the SQL and
 * drift over time; the integration path pins the actual semantics.
 *
 * Each test:
 *   1. Seeds synthetic fixtures with a known relationship or lack
 *      thereof.
 *   2. Calls hasRelationship(...) directly (exported from the audit
 *      script).
 *   3. Asserts the expected boolean.
 *
 * Bypass_roles classification is separately verified via a
 * scalar role check in the audit script; tests here focus on the
 * 4 non-role relationship paths + time-boundary edges.
 *
 * Skipped when Postgres isn't reachable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { dbAdmin } from '../../src/db/db';
import { hasRelationship } from '../../scripts/audit-llm-interactions-contamination';

const READY = await isIntegrationReady();

let clinicId = '';
let orgUnitId = '';
// Disposable test staff and patient — isolated per run.
const testStaffId = randomUUID();
const testPatientId = randomUUID();
const unrelatedPatientId = randomUUID();

beforeAll(async () => {
  if (!READY) return;
  const session = await loginAsAdmin();
  clinicId = session.clinicId;

  // Seed a minimal staff row (clinician role — NOT in BYPASS_ROLES).
  await dbAdmin('staff').insert({
    id: testStaffId,
    clinic_id: clinicId,
    given_name: 'BUG-280',
    family_name: 'AuditStaff',
    email: `bug280-${Date.now()}@test.local`,
    password_hash: 'x',
    role: 'clinician',
    is_active: true,
  });

  // Seed target + unrelated patients.
  await dbAdmin('patients').insert([
    { id: testPatientId, clinic_id: clinicId, given_name: 'BUG280', family_name: 'Target', date_of_birth: '1990-01-01' },
    { id: unrelatedPatientId, clinic_id: clinicId, given_name: 'BUG280', family_name: 'Unrelated', date_of_birth: '1990-01-01' },
  ]);

  // Seed an org unit we can attach team-assignment fixtures to.
  const orgRow = await dbAdmin('org_units').insert({
    id: randomUUID(),
    clinic_id: clinicId,
    name: 'BUG-280 Org Unit',
    level: 'team',
    sort_order: 999,
    is_active: true,
  }).returning('id').catch(() => null);
  if (orgRow) orgUnitId = (orgRow[0] as { id: string }).id;
});

afterAll(async () => {
  if (!READY) return;
  // Cleanup all fixtures; break_glass_sessions are append-only behaviour,
  // but the table itself is not append-trigger-protected so we can DELETE.
  await dbAdmin('appointment_attendees').where({ staff_id: testStaffId }).del().catch(() => undefined);
  await dbAdmin('appointments').where({ clinic_id: clinicId, patient_id: testPatientId }).del().catch(() => undefined);
  await dbAdmin('staff_team_assignments').where({ staff_id: testStaffId }).del().catch(() => undefined);
  await dbAdmin('patient_team_assignments').where({ patient_id: testPatientId }).del().catch(() => undefined);
  await dbAdmin('episodes').where({ patient_id: testPatientId }).del().catch(() => undefined);
  await dbAdmin('break_glass_sessions').where({ staff_id: testStaffId }).del().catch(() => undefined);
  if (orgUnitId) await dbAdmin('org_units').where({ id: orgUnitId }).del().catch(() => undefined);
  await dbAdmin('patients').whereIn('id', [testPatientId, unrelatedPatientId]).del().catch(() => undefined);
  await dbAdmin('staff').where({ id: testStaffId }).del().catch(() => undefined);
});

describe.skipIf(!READY)('BUG-280 — hasRelationship() retrospective audit semantics', () => {
  it('A1 — open episode with staff as primary clinician, created before T → PASS', async () => {
    const episodeId = randomUUID();
    const T = new Date();
    const createdBefore = new Date(T.getTime() - 60_000);
    await dbAdmin('episodes').insert({
      id: episodeId,
      clinic_id: clinicId,
      patient_id: testPatientId,
      primary_clinician_id: testStaffId,
      status: 'open',
      start_date: createdBefore.toISOString().slice(0, 10),
      specialty_code: 'mental_health',
      created_at: createdBefore,
      updated_at: createdBefore,
    });
    const ok = await hasRelationship(clinicId, testStaffId, testPatientId, T);
    expect(ok).toBe(true);
    await dbAdmin('episodes').where({ id: episodeId }).del();
  });

  it('A2 — NO episode / team / appointment / break-glass → FAIL (candidate contamination)', async () => {
    const T = new Date();
    const ok = await hasRelationship(clinicId, testStaffId, testPatientId, T);
    expect(ok).toBe(false);
  });

  it('A5 — episode created AFTER T → FAIL (time-boundary edge, R2 absorption)', async () => {
    const episodeId = randomUUID();
    const T = new Date();
    const createdAfter = new Date(T.getTime() + 60_000);
    await dbAdmin('episodes').insert({
      id: episodeId,
      clinic_id: clinicId,
      patient_id: testPatientId,
      primary_clinician_id: testStaffId,
      status: 'open',
      start_date: createdAfter.toISOString().slice(0, 10),
      specialty_code: 'mental_health',
      created_at: createdAfter,
      updated_at: createdAfter,
    });
    const ok = await hasRelationship(clinicId, testStaffId, testPatientId, T);
    expect(ok).toBe(false);
    await dbAdmin('episodes').where({ id: episodeId }).del();
  });

  it('A6 — team assignment with staff end_date BEFORE T → FAIL (time-boundary edge)', async () => {
    if (!orgUnitId) return;
    const T = new Date();
    const startedBefore = new Date(T.getTime() - 10 * 24 * 60 * 60_000); // 10 days ago
    const endedBefore = new Date(T.getTime() - 1 * 24 * 60 * 60_000); // 1 day ago (before T)

    const ptaId = randomUUID();
    const staId = randomUUID();
    await dbAdmin('patient_team_assignments').insert({
      id: ptaId,
      patient_id: testPatientId,
      org_unit_id: orgUnitId,
      is_active: true,
      created_at: startedBefore,
      updated_at: startedBefore,
    });
    await dbAdmin('staff_team_assignments').insert({
      id: staId,
      clinic_id: clinicId,
      staff_id: testStaffId,
      org_unit_id: orgUnitId,
      start_date: startedBefore.toISOString().slice(0, 10),
      end_date: endedBefore.toISOString().slice(0, 10),
      is_active: true, // row still flagged active but end_date is in the past → audit must reject
      created_at: startedBefore,
      updated_at: startedBefore,
    });

    const ok = await hasRelationship(clinicId, testStaffId, testPatientId, T);
    expect(ok).toBe(false);
    await dbAdmin('staff_team_assignments').where({ id: staId }).del();
    await dbAdmin('patient_team_assignments').where({ id: ptaId }).del();
  });

  it('A7 — active approved break-glass session covering T → PASS (session-wide, any patient)', async () => {
    const T = new Date();
    const bgId = randomUUID();
    const approvedAt = new Date(T.getTime() - 60_000);
    const expiresAt = new Date(T.getTime() + 60_000);
    await dbAdmin('break_glass_sessions').insert({
      id: bgId,
      clinic_id: clinicId,
      staff_id: testStaffId,
      reason: 'BUG-280 test',
      status: 'approved',
      approved_at: approvedAt,
      expires_at: expiresAt,
    });
    // Passes even for unrelated patient — break-glass is session-wide.
    const ok = await hasRelationship(clinicId, testStaffId, unrelatedPatientId, T);
    expect(ok).toBe(true);
    await dbAdmin('break_glass_sessions').where({ id: bgId }).del();
  });

  it('A8 — expired break-glass session (expires_at < T) → FAIL', async () => {
    const T = new Date();
    const bgId = randomUUID();
    const approvedAt = new Date(T.getTime() - 2 * 60 * 60_000); // 2 hours ago
    const expiresAt = new Date(T.getTime() - 60 * 60_000);      // 1 hour ago, BEFORE T
    await dbAdmin('break_glass_sessions').insert({
      id: bgId,
      clinic_id: clinicId,
      staff_id: testStaffId,
      reason: 'BUG-280 test expired',
      status: 'approved',
      approved_at: approvedAt,
      expires_at: expiresAt,
    });
    const ok = await hasRelationship(clinicId, testStaffId, testPatientId, T);
    expect(ok).toBe(false);
    await dbAdmin('break_glass_sessions').where({ id: bgId }).del();
  });

  it('A9 — appointment attendance with staff → PASS', async () => {
    const apptId = randomUUID();
    const attId = randomUUID();
    const T = new Date();
    const createdBefore = new Date(T.getTime() - 60_000);
    await dbAdmin('appointments').insert({
      id: apptId,
      clinic_id: clinicId,
      patient_id: testPatientId,
      clinician_id: testStaffId,
      type: 'consultation',
      start_time: createdBefore,
      end_time: new Date(createdBefore.getTime() + 30 * 60_000),
      status: 'scheduled',
      created_at: createdBefore,
      updated_at: createdBefore,
    });
    await dbAdmin('appointment_attendees').insert({
      id: attId,
      clinic_id: clinicId,
      appointment_id: apptId,
      staff_id: testStaffId,
      role: 'primary',
      attendance_status: 'attended',
      created_at: createdBefore,
      updated_at: createdBefore,
    });
    const ok = await hasRelationship(clinicId, testStaffId, testPatientId, T);
    expect(ok).toBe(true);
    await dbAdmin('appointment_attendees').where({ id: attId }).del();
    await dbAdmin('appointments').where({ id: apptId }).del();
  });
});
