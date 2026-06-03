import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetPerClinicIntegrationConfigDriftCacheForTests,
  evaluatePerClinicIntegrationConfigDrift,
  runPerClinicIntegrationConfigDriftCheck,
} from '../../src/shared/perClinicIntegrationConfigDrift';

describe('BUG-310 per-clinic integration config drift evaluator', () => {
  it('flags feature-enabled runtime-missing drift', () => {
    const issues = evaluatePerClinicIntegrationConfigDrift({
      featureFlags: {
        integrationMhrDocref: true,
        integrationRadiologyHl7: false,
        integrationHealthlink: false,
      },
      runtimeConfigured: {
        mhr: false,
        radiology: true,
        healthlink: true,
        npds: false,
        erxAdapter: false,
        erxRest: false,
      },
      clinicConfig: {
        hpio: '8003620000000000',
        npdsConformanceId: 'npds-clinic-1',
      },
    });

    expect(issues.map((i) => i.key)).toContain('integration-mhr-docref');
  });

  it('flags missing clinic HPIO when any eRx runtime is configured', () => {
    const issues = evaluatePerClinicIntegrationConfigDrift({
      featureFlags: {
        integrationMhrDocref: false,
        integrationRadiologyHl7: false,
        integrationHealthlink: false,
      },
      runtimeConfigured: {
        mhr: false,
        radiology: false,
        healthlink: false,
        npds: true,
        erxAdapter: false,
        erxRest: false,
      },
      clinicConfig: {
        hpio: null,
        npdsConformanceId: 'npds-clinic-1',
      },
    });

    expect(issues.map((i) => i.key)).toContain('clinic-hpio-missing');
  });

  it('flags missing NPDS conformance id when NPDS is runtime configured', () => {
    const issues = evaluatePerClinicIntegrationConfigDrift({
      featureFlags: {
        integrationMhrDocref: false,
        integrationRadiologyHl7: false,
        integrationHealthlink: false,
      },
      runtimeConfigured: {
        mhr: false,
        radiology: false,
        healthlink: false,
        npds: true,
        erxAdapter: false,
        erxRest: false,
      },
      clinicConfig: {
        hpio: '8003620000000000',
        npdsConformanceId: null,
      },
    });

    expect(issues.map((i) => i.key)).toContain('clinic-npds-conformance-id-missing');
  });
});

describe('BUG-310 per-clinic integration config drift runner', () => {
  beforeEach(() => {
    __resetPerClinicIntegrationConfigDriftCacheForTests();
  });

  it('checks only once per clinic and emits audit + warning once', async () => {
    const getFeatureFlag = vi.fn(async (flag: string) => flag === 'integration-mhr-docref');
    const getRuntimeConfigured = vi.fn(async () => ({
      mhr: false,
      radiology: true,
      healthlink: true,
      npds: false,
      erxAdapter: false,
      erxRest: false,
    }));
    const getClinicConfig = vi.fn(async () => ({
      hpio: '8003620000000000',
      npdsConformanceId: 'npds-clinic-1',
    }));
    const writeDriftAudit = vi.fn(async () => {});
    const sendWarning = vi.fn(async () => {});

    const deps = {
      getFeatureFlag,
      getRuntimeConfigured,
      getClinicConfig,
      writeDriftAudit,
      sendWarning,
    };

    const first = await runPerClinicIntegrationConfigDriftCheck(
      { clinicId: 'clinic-a', actorId: 'staff-a', role: 'admin' },
      deps,
    );
    const second = await runPerClinicIntegrationConfigDriftCheck(
      { clinicId: 'clinic-a', actorId: 'staff-a', role: 'admin' },
      deps,
    );

    expect(first.checked).toBe(true);
    expect(first.issues.map((i) => i.key)).toContain('integration-mhr-docref');
    expect(second.checked).toBe(false);
    expect(writeDriftAudit).toHaveBeenCalledTimes(1);
    expect(sendWarning).toHaveBeenCalledTimes(1);
  });

  it('skips non-admin roles', async () => {
    const writeDriftAudit = vi.fn(async () => {});
    const sendWarning = vi.fn(async () => {});

    const result = await runPerClinicIntegrationConfigDriftCheck(
      { clinicId: 'clinic-a', actorId: 'staff-a', role: 'clinician' },
      {
        getFeatureFlag: vi.fn(async () => false),
        getRuntimeConfigured: vi.fn(async () => ({
          mhr: true,
          radiology: true,
          healthlink: true,
          npds: true,
          erxAdapter: true,
          erxRest: true,
        })),
        getClinicConfig: vi.fn(async () => ({
          hpio: '8003620000000000',
          npdsConformanceId: 'npds-clinic-1',
        })),
        writeDriftAudit,
        sendWarning,
      },
    );

    expect(result.checked).toBe(false);
    expect(writeDriftAudit).not.toHaveBeenCalled();
    expect(sendWarning).not.toHaveBeenCalled();
  });
});
