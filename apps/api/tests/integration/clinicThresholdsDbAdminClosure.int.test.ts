/**
 * BUG-592-FOLLOWUP-DBADMIN-THRESHOLDS regression test.
 *
 * Closes BUG-592-FOLLOWUP-DBADMIN-THRESHOLDS (S1). Sibling pattern of
 * BUG-583 RLS-zero closure. Proves end-to-end that:
 *
 *   1. `settingsService.getThresholds(clinicId)` (default `db`,
 *      RLS-scoped) returns ZERO clinic_thresholds rows when called
 *      OUTSIDE Express middleware (no `app.clinic_id` GUC) — the
 *      pre-fix scheduler-context behaviour. Result falls back to
 *      DEFAULT_THRESHOLDS only.
 *
 *   2. `settingsService.getThresholds(clinicId, dbAdmin)` returns the
 *      configured `clinic_thresholds` overrides — the post-fix
 *      scheduler-context behaviour. Per-clinic Power Settings now
 *      take effect.
 *
 *   3. Both `getThreshold` and `getEscalationThreshold` on the live
 *      pathology scheduler `buildLiveContext()` now read the
 *      configured value (proves the call-site fix). Same property
 *      sibling-applicable to MHA / appointment-reminder /
 *      therapeutic-level schedulers.
 *
 * Pre-fix clinical-safety harm: per-clinic threshold customisation in
 * Power Settings was INERT for 4 schedulers. An operator who set
 * `pathology_escalation_minutes = 30` would still see the scheduler
 * use the 120-minute default. This test mechanically prevents
 * regression.
 *
 * fix-registry anchors: R-FIX-BUG-592-FU-DBADMIN-CONN-PARAM +
 * R-FIX-BUG-592-FU-PATHOLOGY-DBADMIN +
 * R-FIX-BUG-592-FU-RLS-ZERO-NEGATIVE-CONTROL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-592-FOLLOWUP-DBADMIN-THRESHOLDS — settingsService dbAdmin closure', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  let settingsService: any;
  let buildLiveContext: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const canonicalKey = 'pathology_escalation_minutes';
  const customValue = 17; // unique enough not to collide with any default

  // Track inserted clinic_thresholds rows for FK-safe afterAll cleanup
  // (clinic_thresholds is RLS-scoped but NOT immutable — DELETE works).
  const insertedThresholdRows: string[] = [];

  beforeAll(async () => {
    if (!ready) return;
    session = await loginAsAdmin();
    const dbModule = await import('../../src/db/db');
    dbAdmin = dbModule.dbAdmin;
    settingsService = (await import('../../src/features/settings/settingsService')).settingsService;
    ({ buildLiveContext } = await import('../../src/jobs/schedulers/pathologyCriticalScheduler'));

    // Seed a clinic_thresholds row using dbAdmin so RLS does not block
    // the INSERT outside Express middleware. Use the canonical
    // pathology_escalation_minutes key so the live scheduler context
    // picks it up via getEscalationThreshold.
    const id = randomUUID();
    await dbAdmin('clinic_thresholds').insert({
      id,
      clinic_id: session.clinicId,
      threshold_key: canonicalKey,
      threshold_value: customValue,
      updated_at: new Date(),
    }).onConflict(['clinic_id', 'threshold_key']).merge({
      threshold_value: customValue,
      updated_at: new Date(),
    });
    insertedThresholdRows.push(id);
  });

  afterAll(async () => {
    if (!ready || !session) return;
    if (insertedThresholdRows.length > 0) {
      // Use dbAdmin so the DELETE bypasses RLS (no GUC in afterAll).
      await dbAdmin('clinic_thresholds')
        .where({ clinic_id: session.clinicId, threshold_key: canonicalKey })
        .del();
    }
  });

  it('TP-DBADMIN-THR-1: settingsService.getThresholds(clinicId) — default db RLS-zeros outside Express → returns DEFAULTS only', async () => {
    // No conn passed → uses `db` (RLS-scoped). Outside Express the
    // `app.clinic_id` GUC is unset, so the policy
    // `clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid`
    // evaluates `clinic_id = NULL` and returns ZERO rows. The merge
    // therefore yields DEFAULT_THRESHOLDS only — the seeded override
    // for `pathology_escalation_minutes` is INVISIBLE to this code path.
    const thresholds = await settingsService.getThresholds(session.clinicId);
    expect(thresholds[canonicalKey]).toBe(120); // default, NOT 17
  });

  it('TP-DBADMIN-THR-2: settingsService.getThresholds(clinicId, dbAdmin) — bypasses RLS → returns clinic_thresholds override', async () => {
    // dbAdmin is the table-owner role (signacare_owner) so RLS
    // policies do not apply. Pre-fix scheduler-context call paths used
    // the default db; the post-fix paths now pass dbAdmin so per-clinic
    // overrides are visible.
    const thresholds = await settingsService.getThresholds(session.clinicId, dbAdmin);
    expect(thresholds[canonicalKey]).toBe(customValue); // 17, NOT 120
  });

  it('TP-DBADMIN-THR-3: live pathologyCriticalScheduler buildLiveContext.getEscalationThreshold reads the override (post-fix call-site behaviour)', async () => {
    // Proves the call-site fix at pathologyCriticalScheduler.ts
    // getEscalationThreshold — passes dbAdmin to settingsService.
    // Mutation test: removing the dbAdmin argument would re-introduce
    // the silent-zero and this assertion would fail (returning 120
    // instead of 17).
    const ctx = await buildLiveContext();
    const value = await ctx.getEscalationThreshold(session.clinicId);
    expect(value).toBe(customValue);
  });

  it('TP-DBADMIN-THR-4: live pathologyCriticalScheduler buildLiveContext.getThreshold reads through dbAdmin path too', async () => {
    // Sibling site fix: getThreshold at pathologyCriticalScheduler.ts
    // also passes dbAdmin. Seed the canonical pathology_critical_minutes
    // override and verify the read.
    const id = randomUUID();
    const customCritical = 13;
    await dbAdmin('clinic_thresholds').insert({
      id,
      clinic_id: session.clinicId,
      threshold_key: 'pathology_critical_minutes',
      threshold_value: customCritical,
      updated_at: new Date(),
    }).onConflict(['clinic_id', 'threshold_key']).merge({
      threshold_value: customCritical,
      updated_at: new Date(),
    });
    insertedThresholdRows.push(id);

    try {
      const ctx = await buildLiveContext();
      const value = await ctx.getThreshold(session.clinicId);
      expect(value).toBe(customCritical);
    } finally {
      await dbAdmin('clinic_thresholds')
        .where({ clinic_id: session.clinicId, threshold_key: 'pathology_critical_minutes' })
        .del();
    }
  });

  it('TP-DBADMIN-THR-5: settingsService.setThreshold(clinicId, key, value) — default db request path (Power Settings UI) honoured by dbAdmin reads', async () => {
    // The setThreshold default `conn=db` is for HTTP-request callers
    // (Power Settings UI inside Express middleware where the GUC IS
    // set). For this test we bypass with dbAdmin since we are outside
    // Express, but the asymmetric default is the intended contract:
    // request-path reads/writes use db (RLS-scoped, tenant-correct);
    // cron reads use dbAdmin (RLS-bypass). Mutation test: tests 1+2
    // already prove the request/cron asymmetry. This test pins the
    // setThreshold conn-injection contract by explicitly passing
    // dbAdmin and confirming the upsert lands.
    const newValue = 42;
    await settingsService.setThreshold(session.clinicId, canonicalKey, newValue, dbAdmin);
    const row = await dbAdmin('clinic_thresholds')
      .where({ clinic_id: session.clinicId, threshold_key: canonicalKey })
      .first();
    expect(row).toBeTruthy();
    expect(Number(row.threshold_value)).toBe(newValue);
  });
});
