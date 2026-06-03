/**
 * BUG-564 regression — `risk_assessments` opt-locking column + response field.
 *
 * Sibling pattern of BUG-371a (prescriptions/patient_medications/episodes)
 * + BUG-402 (treatment_pathways). Today no UPDATE path exists; the fix is
 * preventive — adding `lock_version` so any future UPDATE wiring is forced
 * through `updateWithOptimisticLock` (which requires the column).
 *
 * Coverage (5 tests):
 *   T1 — DB column exists with NOT NULL + DEFAULT 1
 *   T2 — repository.create returns lock_version=1 on a fresh row
 *   T3 — service.create returns RiskAssessmentResponse with lockVersion field
 *   T4 — service.getById surfaces lockVersion to the consumer
 *   T5 — Source-level mutation resistance: CLAUDE.md §1.6 roster lists
 *        risk_assessments + the migration file declares lock_version
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';
import type { AuthContext } from '@signacare/shared';

describe.skipIf(!(await isIntegrationReady()))('BUG-564 risk_assessments opt-locking column', () => {
  let clinicId: string;
  let patientId: string;
  let staffId: string;
  let auth: AuthContext;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const clinic = (await dbAdmin('clinics')
      .where({ id: '11111111-1111-1111-1111-111111111111' })
      .select('id')
      .first()) as { id: string } | undefined;
    if (!clinic) throw new Error('BUG-564 test: canonical seed clinic not found');
    clinicId = clinic.id;
    const p = (await dbAdmin('patients')
      .where({ clinic_id: clinicId })
      .select('id')
      .first()) as { id: string };
    patientId = p.id;
    const s = (await dbAdmin('staff')
      .where({ clinic_id: clinicId })
      .select('id')
      .first()) as { id: string };
    staffId = s.id;
    auth = {
      staffId,
      clinicId,
      role: 'clinician',
      permissions: ['risk:create', 'risk:read'],
      patientId,
      requestId: randomUUID(),
      // Test-only break-glass to bypass requirePatientRelationship —
      // the test seed does not establish a clinical episode / team /
      // appointment edge between staffId and patientId; seeding would
      // bloat the fixture without exercising risk_assessments behaviour.
      // Production path retains the full relationship gate.
      breakGlassSessionId: randomUUID(),
    } as AuthContext;
  });

  afterEach(async () => {
    if (createdIds.length === 0) return;
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('risk_assessments').whereIn('id', createdIds).del();
    createdIds.length = 0;
  });

  // ── T1 ──
  it('T1: DB column lock_version exists with NOT NULL + DEFAULT 1', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const meta = await dbAdmin.raw(
      `SELECT column_name, is_nullable, column_default, data_type
       FROM information_schema.columns
       WHERE table_name = 'risk_assessments' AND column_name = 'lock_version'`,
    );
    const row = meta.rows?.[0] as
      | { column_name: string; is_nullable: string; column_default: string; data_type: string }
      | undefined;
    expect(row).toBeTruthy();
    expect(row!.is_nullable).toBe('NO');
    expect(row!.column_default).toMatch(/^1\b/);
    expect(row!.data_type).toBe('integer');
  });

  // ── T2 ──
  it('T2: repository.create returns lock_version=1 on a fresh row', async () => {
    await withTenantContext(clinicId, async () => {
      const { riskRepository } = await import('../../src/features/risk/riskRepository');
      const row = await riskRepository.create(clinicId, staffId, {
        patientId,
        assessmentType: 'clinical',
        overallRiskLevel: 'low',
        suicideRisk: false,
        selfHarmRisk: false,
        harmToOthersRisk: false,
        abscondingRisk: false,
        vulnerabilityRisk: false,
        safetyPlanInPlace: false,
        assessmentDate: '2026-05-01',
      });
      createdIds.push(row.id);
      expect(row.lock_version).toBe(1);
    });
  });

  // ── T3 ──
  it('T3: service.create returns RiskAssessmentResponse with lockVersion field', async () => {
    await withTenantContext(clinicId, async () => {
      const { riskService } = await import('../../src/features/risk/riskService');
      const result = await riskService.create(auth, {
        patientId,
        assessmentType: 'clinical',
        overallRiskLevel: 'medium',
        suicideRisk: true,
        selfHarmRisk: false,
        harmToOthersRisk: false,
        abscondingRisk: false,
        vulnerabilityRisk: false,
        safetyPlanInPlace: true,
        assessmentDate: '2026-05-01',
      });
      createdIds.push(result.id);
      expect(result.lockVersion).toBe(1);
      expect(result.suicideRisk).toBe(true);
      expect(result.overallRiskLevel).toBe('medium');
    });
  });

  // ── T4 ──
  it('T4: service.getById surfaces lockVersion to the consumer', async () => {
    await withTenantContext(clinicId, async () => {
      const { riskService } = await import('../../src/features/risk/riskService');
      const created = await riskService.create(auth, {
        patientId,
        assessmentType: 'clinical',
        overallRiskLevel: 'high',
        suicideRisk: true,
        selfHarmRisk: true,
        harmToOthersRisk: false,
        abscondingRisk: false,
        vulnerabilityRisk: false,
        safetyPlanInPlace: true,
        assessmentDate: '2026-05-01',
      });
      createdIds.push(created.id);
      const fetched = await riskService.getById(auth, created.id);
      expect(fetched.lockVersion).toBe(1);
      expect(fetched.id).toBe(created.id);
    });
  });

  // ── T5 ──
  it('T5: source-level — CLAUDE.md §1.6 lists risk_assessments + migration declares lock_version', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const claudeMd = readFileSync(resolve(repoRoot, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toMatch(/risk_assessments.*BUG-564/);
    const migration = readFileSync(
      resolve(__dirname, '..', '..', 'migrations', '20260701000042_bug_564_risk_assessments_lock_version.ts'),
      'utf-8',
    );
    expect(migration).toMatch(/risk_assessments/);
    expect(migration).toMatch(/lock_version/);
    expect(migration).toMatch(/notNullable\(\)\.defaultTo\(1\)/);
  });
});
