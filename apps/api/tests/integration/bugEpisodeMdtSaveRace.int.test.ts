/**
 * BUG-EPISODE-MDT-SAVE-RACE (S2) — concurrent MDT save serialization.
 *
 * Pre-fix state (pre-commit a0ac22a... actually pre-this-fix): the
 * `POST /episodes/:id/allocate` MDT save sequence in episodeRoutes.ts
 * (lines 152-280 prior to the BUG fix) ran the deactivate-then-insert
 * loop OUTSIDE a transaction. Two simultaneous calls for the same
 * `(clinic_id, org_unit_id)` would interleave:
 *
 *   T1 deactivate role assignments → commits.
 *   T2 deactivate role assignments → no-op (already inactive).
 *   T1 SELECT existing → sees only deactivated rows.
 *   T2 SELECT existing → sees only deactivated rows (independently).
 *   T1 INSERT new active rows R1.
 *   T2 INSERT new active rows R2.
 *   Final state: R1 ∪ R2 both active — duplicate active role rows.
 *
 * Post-fix: route handler wraps the critical section in
 * `db.transaction(async (trx) => { ... })` and acquires
 * `pg_advisory_xact_lock(hashtext(clinic_id || ':' || org_unit_id))` at
 * the start. Same-team concurrent saves serialize on the lock; final
 * state is exactly one of the submitted MDT compositions (last-writer-
 * wins) with no duplicate active rows.
 *
 * This suite proves the post-fix behavior:
 *   - Concurrent submit of two distinct MDT compositions A and B for
 *     the same episode + org_unit
 *   - Assert: no duplicate (staff_id, clinical_role_id) active rows
 *   - Assert: the final active set equals exactly one of A or B (NOT
 *     a UNION)
 *
 * Pre-fix RED gate: this test would have shown UNION outcome (>4 active
 * rows when both A and B submit 4-row MDTs with distinct staff_ids) OR
 * mixed-attribution. Post-fix GREEN: exactly 4 active rows, all from
 * one of the two submitted compositions.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const ready = await isIntegrationReady();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  intervalMs = 25,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  while (!predicate(last)) {
    if (Date.now() >= deadline) return last;
    await sleep(intervalMs);
    last = await read();
  }
  return last;
}

describe.skipIf(!ready)('BUG-EPISODE-MDT-SAVE-RACE concurrent serialization', () => {
  let token: string;
  let clinicId: string;
  let patientId: string;
  let episodeId: string;
  let orgUnitId: string;
  let consultantA: string;
  let registrarA: string;
  let consultantB: string;
  let registrarB: string;
  let clinicianAId: string;
  let clinicianBId: string;
  // Cross-handler test (L5 cycle-1 absorb option A): seed a referral row
  // so we can fire `POST /referrals/:id/allocate` concurrently with
  // `POST /episodes/:id/allocate` and prove both serialize on the same
  // (clinic_id, org_unit_id) advisory lock.
  let referralId: string;

  beforeAll(async () => {
    const s = await loginAsAdmin();
    token = s.token;
    clinicId = s.clinicId;

    const { dbAdmin } = await import('../../src/db/db');

    // Seed an org_unit (team)
    const [u] = (await dbAdmin('org_units')
      .insert({ id: randomUUID(), clinic_id: clinicId, name: `MDT-Race-Test-${Date.now()}`, level: 'team' })
      .returning(['id'])) as Array<{ id: string }>;
    orgUnitId = u.id;

    // Seed 4 distinct staff: 2 for composition A (consultantA + registrarA),
    // 2 for composition B (consultantB + registrarB).
    const seedStaff = async (suffix: string) => {
      const [row] = (await dbAdmin('staff')
        .insert({
          id: randomUUID(),
          clinic_id: clinicId,
          email: `mdt-race-${suffix}-${Date.now()}@example.invalid`,
          password_hash: 'x',
          given_name: `Race${suffix}`,
          family_name: 'Test',
          role: 'admin',
        })
        .returning(['id'])) as Array<{ id: string }>;
      return row.id;
    };
    consultantA = await seedStaff('cA');
    registrarA = await seedStaff('rA');
    consultantB = await seedStaff('cB');
    registrarB = await seedStaff('rB');
    clinicianAId = consultantA; // doubles as primary clinician for variety
    clinicianBId = consultantB;

    // Seed clinical roles (Consultant Psychiatrist + Psychiatry Registrar) if
    // missing so they're matched by name in the route handler instead of
    // auto-created (auto-create path is tested elsewhere; this test focuses
    // on the race on the deactivate-then-insert loop). No UNIQUE constraint
    // on (clinic_id, name) per schema, so we check-then-insert.
    for (const roleName of ['Consultant Psychiatrist', 'Psychiatry Registrar']) {
      const existing = await dbAdmin('clinical_roles').where({ clinic_id: clinicId, name: roleName }).first();
      if (!existing) {
        await dbAdmin('clinical_roles').insert({
          id: randomUUID(), clinic_id: clinicId, name: roleName, is_active: true, sort_order: 100, created_at: new Date(), updated_at: new Date(),
        });
      }
    }

    // Seed a patient + episode for the test
    const [p] = (await dbAdmin('patients')
      .insert({
        clinic_id: clinicId,
        given_name: 'MDT',
        family_name: 'Race',
        date_of_birth: '1990-01-01',
        gender: 'Male',
      })
      .returning(['id'])) as Array<{ id: string }>;
    patientId = p.id;

    const [ep] = (await dbAdmin('episodes')
      .insert({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: patientId,
        status: 'open',
        start_date: '2026-05-06',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(['id'])) as Array<{ id: string }>;
    episodeId = ep.id;

    // Seed a referral row for the cross-handler race test (L5 cycle-1
    // absorb option A). Minimum-required-fields shape per migration
    // 20260701000000 baseline: clinic_id + patient_id + referral_number +
    // referral_date + source + from_service + reason + urgency + status +
    // received_at (defaulted) + has_attachment (defaulted) +
    // sla_breached (defaulted) + target_specialty_code (defaulted) +
    // service_request_status (defaulted) + task_status (defaulted).
    const [refRow] = (await dbAdmin('referrals')
      .insert({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: patientId,
        referral_number: `MDT-RACE-${Date.now()}`,
        referral_date: '2026-05-06',
        source: 'external',
        from_service: 'MDT-Race-Test',
        reason: 'Race-test seed for BUG-EPISODE-MDT-SAVE-RACE cross-handler integration proof',
        urgency: 'routine',
        status: 'received',
      })
      .returning(['id'])) as Array<{ id: string }>;
    referralId = refRow.id;
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Cleanup in dependency order; best-effort.
    await dbAdmin('staff_role_assignments').where({ org_unit_id: orgUnitId }).delete().catch(() => {});
    await dbAdmin('patient_team_assignments').where({ org_unit_id: orgUnitId }).delete().catch(() => {});
    if (referralId) await dbAdmin('referrals').where({ id: referralId }).delete().catch(() => {});
    await dbAdmin('episodes').where({ id: episodeId }).delete().catch(() => {});
    await dbAdmin('patients').where({ id: patientId }).delete().catch(() => {});
    for (const sid of [consultantA, registrarA, consultantB, registrarB]) {
      if (sid) await dbAdmin('staff').where({ id: sid }).delete().catch(() => {});
    }
    if (orgUnitId) await dbAdmin('org_units').where({ id: orgUnitId }).delete().catch(() => {});
  });

  test.sequential('concurrent MDT saves serialize: final state is exactly one composition (no UNION)', async () => {
    // Two MDT compositions targeting the same episode + org_unit:
    //   Composition A: consultantA + registrarA
    //   Composition B: consultantB + registrarB
    // Race-vulnerable code would interleave the deactivate-then-insert
    // sequence and produce ≥3 active rows (UNION). Race-free code
    // serializes on the advisory lock and produces exactly 2 active rows
    // (matching one of A or B; last-writer-wins).
    const compositionA = {
      orgUnitId,
      primaryClinicianId: clinicianAId,
      consultantId: consultantA,
      juniorMedicalId: registrarA,
    };
    const compositionB = {
      orgUnitId,
      primaryClinicianId: clinicianBId,
      consultantId: consultantB,
      juniorMedicalId: registrarB,
    };

    // Fire both requests concurrently.
    const [resA, resB] = await Promise.all([
      request(app)
        .post(`/api/v1/episodes/${episodeId}/allocate`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', 'test')
        .send(compositionA),
      request(app)
        .post(`/api/v1/episodes/${episodeId}/allocate`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', 'test')
        .send(compositionB),
    ]);

    // Both requests should succeed (200) — the lock serializes, doesn't fail.
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    // Inspect the final state via dbAdmin (RLS-bypass).
    const { dbAdmin } = await import('../../src/db/db');
    const activeRows = await waitFor(
      async () => dbAdmin('staff_role_assignments')
        .where({ org_unit_id: orgUnitId, is_active: true, role_type: 'additional' })
        .select('staff_id', 'clinical_role_id'),
      (rows) => {
        const ids = new Set(rows.map((r) => r.staff_id));
        const isCompA = ids.size === 2 && ids.has(consultantA) && ids.has(registrarA);
        const isCompB = ids.size === 2 && ids.has(consultantB) && ids.has(registrarB);
        return isCompA || isCompB;
      },
      1_500,
    );
    // Assertion 1: no duplicate (staff_id, clinical_role_id) active rows.
    const seen = new Set<string>();
    for (const row of activeRows) {
      const key = `${row.staff_id}:${row.clinical_role_id}`;
      expect(seen.has(key)).toBe(false); // post-fix: no dup; pre-fix: could be dup
      seen.add(key);
    }

    // Assertion 2: final active staff_id set is EXACTLY one composition,
    // not a UNION. Composition A = {consultantA, registrarA}; Composition
    // B = {consultantB, registrarB}. Race-free: the active staff_id set
    // is exactly 2 elements and matches one of these two pairs.
    const activeStaffIds = new Set(activeRows.map(r => r.staff_id));
    const isCompA = activeStaffIds.size === 2 && activeStaffIds.has(consultantA) && activeStaffIds.has(registrarA);
    const isCompB = activeStaffIds.size === 2 && activeStaffIds.has(consultantB) && activeStaffIds.has(registrarB);
    expect(isCompA || isCompB).toBe(true);

    // Belt-and-suspenders: explicitly fail if the active set is a UNION
    // (would be size 3 or 4 with mixed staff ids). This is the failure
    // mode the BUG describes pre-fix.
    expect(activeStaffIds.size).toBe(2);
  });

  test.sequential('deactivated rows carry non-null end_date (effective-dating preserved)', async () => {
    // L4 cycle-1 absorb (option a, 2026-05-06): the deactivate transition
    // now also stamps end_date = today, so point-in-time queries against
    // staff_role_assignments correctly bound the row's effective range.
    // Pre-fix posture set is_active=false but left end_date NULL —
    // open-ended despite logical termination → silent corruption of the
    // temporal audit trail used by AHPRA Standard 8 record-keeping and
    // coronial review.
    //
    // Procedure:
    //   1. Allocate composition A (active rows for cA + rA).
    //   2. Allocate composition B (deactivates A rows; activates cB + rB).
    //   3. Inspect rows for the staff_id set from composition A: each must
    //      have is_active=false AND end_date IS NOT NULL.
    const compositionA = {
      orgUnitId,
      primaryClinicianId: clinicianAId,
      consultantId: consultantA,
      juniorMedicalId: registrarA,
    };
    const compositionB = {
      orgUnitId,
      primaryClinicianId: clinicianBId,
      consultantId: consultantB,
      juniorMedicalId: registrarB,
    };

    // Isolate this test from the prior concurrency test in this file.
    // Without a local reset, residual rows from the earlier test can
    // make the "A then B" effective-dating assertion nondeterministic.
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('staff_role_assignments')
      .where({ clinic_id: clinicId, org_unit_id: orgUnitId })
      .delete();

    // Sequential save (not concurrent) so we can assert ordering: A then B.
    const resA = await request(app)
      .post(`/api/v1/episodes/${episodeId}/allocate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send(compositionA);
    expect(resA.status).toBe(200);

    const resB = await request(app)
      .post(`/api/v1/episodes/${episodeId}/allocate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send(compositionB);
    expect(resB.status).toBe(200);

    // Inspect deactivated rows for composition A staff_ids.
    const deactivatedRows = await waitFor(
      async () => dbAdmin('staff_role_assignments')
        .where({ clinic_id: clinicId, org_unit_id: orgUnitId, role_type: 'additional', is_active: false })
        .whereIn('staff_id', [consultantA, registrarA])
        .select('staff_id', 'is_active', 'end_date'),
      (rows) => rows.length > 0 && rows.every((r) => r.end_date !== null && r.end_date !== undefined),
      1_500,
    );
    // Each composition-A row should now be deactivated AND have a non-null end_date.
    expect(deactivatedRows.length).toBeGreaterThan(0);
    for (const row of deactivatedRows) {
      expect(row.is_active).toBe(false);
      // end_date may come back as a Date or 'YYYY-MM-DD' string depending on
      // pg-types config; the contract is "not null", not a specific type.
      expect(row.end_date).not.toBeNull();
      expect(row.end_date).toBeDefined();
    }
  });

  test.sequential('cross-handler race: episode-allocate × referral-allocate serialize on shared advisory lock', async () => {
    // L5 cycle-1 absorb (option A, 2026-05-06): both `POST /episodes/:id/allocate`
    // and `POST /referrals/:id/allocate` write to the same
    // (clinic_id, org_unit_id) slice of `staff_role_assignments` +
    // `patient_team_assignments`. Pre-fix, the referral handler's
    // INSERTs ran outside any transaction and outside the advisory lock
    // domain, so a referral-allocate concurrent with an episode-allocate
    // could interleave with the episode-allocate's deactivate-then-insert
    // sequence — the episode's deactivate could blow away rows the
    // referral just inserted (data loss), or the referral's INSERTs could
    // land between the episode's deactivate and INSERTs (producing
    // chaotic mid-race states like 3 active rows when 2 distinct
    // 2-row compositions interleave). Post-fix: both handlers acquire
    // the same `pg_advisory_xact_lock(hashtext(? || ':' || ?))` keyed by
    // (clinic_id, org_unit_id), so cross-handler saves serialize cleanly.
    //
    // INTENTIONAL SEMANTIC ASYMMETRY (L4 cycle-3 absorb F1(a), 2026-05-06):
    // the two handlers encode DIFFERENT clinical workflows on the same
    // table — episode-allocate is REPLACE SEMANTICS (deactivate-then-
    // insert; episode owner is authoritative on "who is on this team
    // right now"); referral-allocate is ADDITIVE SEMANTICS (INSERT
    // only; referral letter adds names; episode owner curates). The
    // two outcomes below are therefore the EXPECTED, CLINICALLY-CORRECT
    // serialized states given the workflow each handler models — they
    // are NOT vague nondeterminism. The lock domain guarantees these
    // are the ONLY reachable outcomes; chaotic mid-race states are
    // mechanically impossible.
    //
    // Procedure:
    //   - Composition E (episode-allocate, REPLACE): {consultantA, registrarA}
    //   - Composition R (referral-allocate, ADDITIVE): {consultantB, registrarB}
    //     (both share the same `org_unit_id`, share the same clinic, but
    //     use disjoint staff_ids so post-fix outcomes are unambiguous)
    //   - Promise.all([episode-allocate, referral-allocate])
    //
    // Post-fix valid serialized outcomes (lock-mediated, semantics-aware):
    //   E-then-R (episode then referral):
    //     T1 episode (REPLACE): deactivates pre-existing additionals
    //                           (none on first save) → inserts E (cA, rA).
    //     T2 referral (ADDITIVE): adds R (cB, rB) on top of E.
    //     Final: 4 active rows = E ∪ R = {cA, rA, cB, rB}.
    //   R-then-E (referral then episode):
    //     T1 referral (ADDITIVE): inserts R (cB, rB).
    //     T2 episode (REPLACE): deactivates ALL role_type='additional'
    //                           (incl R) → inserts E (cA, rA).
    //     Final: 2 active rows = E only = {cA, rA}.
    //                           (R rows now deactivated with end_date
    //                            populated per L4 cycle-1 absorb.)
    //
    // Invariants asserted (post-fix):
    //   - Both 200 (lock serializes; doesn't fail).
    //   - Final active staff_id set is EXACTLY one of:
    //       size=4, members={cA, rA, cB, rB}  (E-then-R)
    //       size=2, members={cA, rA}          (R-then-E)
    //   - NO duplicate (staff_id, clinical_role_id) active rows.
    //   - No size-3 outcome (would indicate non-serialized interleave —
    //     the canonical pre-fix race shape; mechanically impossible
    //     post-fix).

    // Reset the org_unit's MDT state before this test so prior test
    // leftovers don't pollute the cross-handler assertion.
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('staff_role_assignments').where({ org_unit_id: orgUnitId }).delete();

    const compositionE = {
      orgUnitId,
      primaryClinicianId: clinicianAId,
      consultantId: consultantA,
      juniorMedicalId: registrarA,
    };
    const compositionR = {
      // Note: referral handler's DTO uses `episodeId` (target episode)
      // alongside `orgUnitId`. We aim it at the same episode the episode
      // handler is targeting so both handlers act on the same write
      // surface in the same clinic.
      episodeId,
      orgUnitId,
      primaryClinicianId: clinicianBId,
      consultantId: consultantB,
      juniorMedicalId: registrarB,
    };

    // Fire both requests concurrently — different routes, same lock domain.
    const [resE, resR] = await Promise.all([
      request(app)
        .post(`/api/v1/episodes/${episodeId}/allocate`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', 'test')
        .send(compositionE),
      request(app)
        .post(`/api/v1/referrals/${referralId}/allocate`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', 'test')
        .send(compositionR),
    ]);

    expect(resE.status).toBe(200);
    expect(resR.status).toBe(200);

    // Inspect final active rows.
    const activeRows = await waitFor(
      async () => dbAdmin('staff_role_assignments')
        .where({ org_unit_id: orgUnitId, is_active: true, role_type: 'additional' })
        .select('staff_id', 'clinical_role_id'),
      (rows) => {
        const ids = new Set(rows.map((r) => r.staff_id));
        const isEThenR =
          ids.size === 4
          && ids.has(consultantA)
          && ids.has(registrarA)
          && ids.has(consultantB)
          && ids.has(registrarB);
        const isRThenE =
          ids.size === 2
          && ids.has(consultantA)
          && ids.has(registrarA);
        return isEThenR || isRThenE;
      },
      1_500,
    );

    // Assertion 1: no duplicate (staff_id, clinical_role_id) active rows.
    const seen = new Set<string>();
    for (const row of activeRows) {
      const key = `${row.staff_id}:${row.clinical_role_id}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }

    // Assertion 2: final active staff_id set matches one of the two
    // valid serialized outcomes (E-then-R OR R-then-E). NOT a chaotic
    // race-mid-state.
    const activeStaffIds = new Set(activeRows.map(r => r.staff_id));

    const isEThenR =
      activeStaffIds.size === 4
      && activeStaffIds.has(consultantA)
      && activeStaffIds.has(registrarA)
      && activeStaffIds.has(consultantB)
      && activeStaffIds.has(registrarB);

    const isRThenE =
      activeStaffIds.size === 2
      && activeStaffIds.has(consultantA)
      && activeStaffIds.has(registrarA);

    expect(isEThenR || isRThenE).toBe(true);

    // Belt-and-suspenders: explicitly fail on size-3 (the canonical
    // pre-fix mid-race state — referral inserted one role; episode's
    // deactivate caught it; episode's insert added 2 more; one R-row
    // survives unattributed). Post-fix lock serializes → impossible.
    expect(activeStaffIds.size).not.toBe(3);
  });
});
