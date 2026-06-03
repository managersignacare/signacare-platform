/**
 * BUG-374a — retention setter service.
 *
 * Pure-function unit tests for the 25-year-floor enforcement + the
 * superadmin guard + audit-log-on-set contract. Live-DB exercise of
 * the GET/PUT round-trip lives in the corresponding integration test.
 *
 * Policy locked 2026-04-26 (project_data_retention_policy.md):
 *   - 25-year minimum floor; NO purge before.
 *   - data_retention_years setter superadmin-only (Q3b).
 *   - retention_purge_enabled toggle superadmin-only (Q3b).
 *   - DB CHECK + Zod min(25) + service guard = 4-layer defence-in-depth.
 *
 * Tests use an injected RetentionSettingContext so the service is
 * testable without a live DB (matches BUG-372 sibling pattern).
 */
import { describe, it, expect, vi } from 'vitest';
import type { AuthContext } from '@signacare/shared';
import { isErr, isOk } from '@signacare/shared';
import {
  retentionSettingService,
  type RetentionSettingContext,
  type RetentionState,
} from '../../src/features/power-settings/retentionSettingService';

const SUPERADMIN_AUTH: AuthContext = {
  staffId: '00000000-0000-0000-0000-0000000000s1',
  clinicId: '00000000-0000-0000-0000-0000000000c1',
  role: 'superadmin',
  permissions: [],
};

const ADMIN_AUTH: AuthContext = {
  ...SUPERADMIN_AUTH,
  role: 'admin',
};

const CLINICIAN_AUTH: AuthContext = {
  ...SUPERADMIN_AUTH,
  role: 'clinician',
};

type RetentionWriteCall =
  | { kind: 'years'; clinicId: string; years: number }
  | { kind: 'purge'; clinicId: string; enabled: boolean; staffId: string };
type RetentionAuditCall = Parameters<RetentionSettingContext['writeAudit']>[0];

function buildCtx(initialState?: Partial<RetentionState>): RetentionSettingContext & {
  writeCalls: RetentionWriteCall[];
  auditCalls: RetentionAuditCall[];
} {
  let state: RetentionState = {
    dataRetentionYears: 25,
    retentionPurgeEnabled: false,
    retentionPurgeEnabledAt: null,
    retentionPurgeEnabledByStaffId: null,
    ...initialState,
  };
  const writeCalls: RetentionWriteCall[] = [];
  const auditCalls: RetentionAuditCall[] = [];
  return {
    fetchState: vi.fn(async () => state),
    persistRetentionYears: vi.fn(async (clinicId, years) => {
      writeCalls.push({ kind: 'years', clinicId, years });
      state = { ...state, dataRetentionYears: years };
    }),
    persistPurgeEnabled: vi.fn(async (clinicId, enabled, staffId) => {
      writeCalls.push({ kind: 'purge', clinicId, enabled, staffId });
      state = {
        ...state,
        retentionPurgeEnabled: enabled,
        retentionPurgeEnabledAt: enabled ? new Date() : null,
        retentionPurgeEnabledByStaffId: enabled ? staffId : null,
      };
    }),
    writeAudit: vi.fn(async (entry) => {
      auditCalls.push(entry);
    }),
    writeCalls,
    auditCalls,
  };
}

describe('BUG-374a — retentionSettingService.setRetention', () => {
  it('TP-RET-1: rejects 24 with RETENTION_BELOW_FLOOR', async () => {
    const ctx = buildCtx();
    const r = await retentionSettingService.setRetention(SUPERADMIN_AUTH, 24, ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe('RETENTION_BELOW_FLOOR');
      expect(r.error.status).toBe(422);
    }
    expect(ctx.persistRetentionYears).not.toHaveBeenCalled();
  });

  it('TP-RET-2: accepts 25 / 30 / 50 / 100', async () => {
    for (const years of [25, 30, 50, 100]) {
      const ctx = buildCtx();
      const r = await retentionSettingService.setRetention(SUPERADMIN_AUTH, years, ctx);
      expect(isOk(r)).toBe(true);
      expect(ctx.persistRetentionYears).toHaveBeenCalledWith(SUPERADMIN_AUTH.clinicId, years);
    }
  });

  it('TP-RET-3: rejects negative / NaN / fractional / zero', async () => {
    for (const years of [-1, 0, 7, 24, NaN, 25.5, Number.POSITIVE_INFINITY]) {
      const ctx = buildCtx();
      const r = await retentionSettingService.setRetention(SUPERADMIN_AUTH, years, ctx);
      expect(isErr(r)).toBe(true);
      expect(ctx.persistRetentionYears).not.toHaveBeenCalled();
    }
  });

  it('TP-RET-4: rejects non-superadmin caller with FORBIDDEN', async () => {
    for (const auth of [ADMIN_AUTH, CLINICIAN_AUTH]) {
      const ctx = buildCtx();
      const r = await retentionSettingService.setRetention(auth, 30, ctx);
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.error.code).toBe('FORBIDDEN');
        expect(r.error.status).toBe(403);
      }
      expect(ctx.persistRetentionYears).not.toHaveBeenCalled();
    }
  });

  it('TP-RET-5: writes audit_log row with old + new value on accepted set', async () => {
    const ctx = buildCtx({ dataRetentionYears: 25 });
    const r = await retentionSettingService.setRetention(SUPERADMIN_AUTH, 30, ctx);
    expect(isOk(r)).toBe(true);
    expect(ctx.auditCalls.length).toBe(1);
    const audit = ctx.auditCalls[0];
    expect(audit.action).toBe('UPDATE');
    expect(audit.tableName).toBe('clinics');
    expect(audit.actorId).toBe(SUPERADMIN_AUTH.staffId);
    expect(audit.clinicId).toBe(SUPERADMIN_AUTH.clinicId);
    expect(audit.oldData?.data_retention_years).toBe(25);
    expect(audit.newData?.data_retention_years).toBe(30);
  });

  it('TP-RET-6: rejects non-integer with VALIDATION_ERROR (defence-in-depth at L3)', async () => {
    const ctx = buildCtx();
    const r = await retentionSettingService.setRetention(SUPERADMIN_AUTH, 25.5, ctx);
    expect(isErr(r)).toBe(true);
  });
});

describe('BUG-374a — retentionSettingService.setPurgeEnabled', () => {
  it('TP-RET-7: superadmin can enable; writes audit_log + captures actor + timestamp', async () => {
    const ctx = buildCtx({ retentionPurgeEnabled: false });
    const r = await retentionSettingService.setPurgeEnabled(SUPERADMIN_AUTH, true, 'pilot-clinic enablement', ctx);
    expect(isOk(r)).toBe(true);
    expect(ctx.persistPurgeEnabled).toHaveBeenCalledWith(SUPERADMIN_AUTH.clinicId, true, SUPERADMIN_AUTH.staffId);
    expect(ctx.auditCalls.length).toBe(1);
    expect(ctx.auditCalls[0].newData?.retention_purge_enabled).toBe(true);
    expect(ctx.auditCalls[0].newData?.reason).toBe('pilot-clinic enablement');
  });

  it('TP-RET-8: non-superadmin cannot toggle the flag', async () => {
    for (const auth of [ADMIN_AUTH, CLINICIAN_AUTH]) {
      const ctx = buildCtx();
      const r = await retentionSettingService.setPurgeEnabled(auth, true, 'unauthorised', ctx);
      expect(isErr(r)).toBe(true);
      if (isErr(r)) expect(r.error.code).toBe('FORBIDDEN');
      expect(ctx.persistPurgeEnabled).not.toHaveBeenCalled();
    }
  });

  it('TP-RET-9: superadmin can disable (rollback)', async () => {
    const ctx = buildCtx({ retentionPurgeEnabled: true });
    const r = await retentionSettingService.setPurgeEnabled(SUPERADMIN_AUTH, false, 'rollback after dry-run review', ctx);
    expect(isOk(r)).toBe(true);
    expect(ctx.persistPurgeEnabled).toHaveBeenCalledWith(SUPERADMIN_AUTH.clinicId, false, SUPERADMIN_AUTH.staffId);
  });
});

describe('BUG-374a — retentionSettingService.getRetention', () => {
  it('TP-RET-10: returns current state for clinic', async () => {
    const ctx = buildCtx({ dataRetentionYears: 30, retentionPurgeEnabled: true });
    const r = await retentionSettingService.getRetention(SUPERADMIN_AUTH, ctx);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.dataRetentionYears).toBe(30);
      expect(r.value.retentionPurgeEnabled).toBe(true);
    }
  });

  it('TP-RET-11: returns 25 default for clinic without explicit setting', async () => {
    const ctx = buildCtx();
    const r = await retentionSettingService.getRetention(SUPERADMIN_AUTH, ctx);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.dataRetentionYears).toBe(25);
  });

  it('TP-RET-12: non-superadmin can read (read-access is admin-allowed)', async () => {
    const ctx = buildCtx({ dataRetentionYears: 30 });
    const r = await retentionSettingService.getRetention(ADMIN_AUTH, ctx);
    expect(isOk(r)).toBe(true);
  });
});
