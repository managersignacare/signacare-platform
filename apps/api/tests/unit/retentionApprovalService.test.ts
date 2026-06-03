/**
 * BUG-374b Part 2 — retention manager-approval workflow.
 *
 * Q-F triple-lock 3rd gate (memory `project_data_retention_policy.md`):
 *   Production purge requires ALL THREE:
 *     1. RETENTION_DRY_RUN=false env var
 *     2. clinic.retention_purge_enabled=true (superadmin per BUG-374a)
 *     3. clinic.retention_purge_manager_approved_at is set AND within
 *        last 30 days AND `manager_approved_by_staff_id` is DIFFERENT
 *        from `retention_purge_enabled_by_staff_id` (segregation of duties)
 *
 * This service owns gate #3.
 */
import { describe, it, expect, vi } from 'vitest';
import type { AuthContext } from '@signacare/shared';
import { isErr, isOk } from '@signacare/shared';
import {
  retentionApprovalService,
  isApprovalActive,
  type RetentionApprovalState,
  type RetentionApprovalContext,
} from '../../src/features/power-settings/retentionApprovalService';

const NOW = new Date('2026-04-27T00:00:00.000Z');

const SUPERADMIN_ENABLER: AuthContext = {
  staffId: '00000000-0000-0000-0000-0000000000s1',
  clinicId: '00000000-0000-0000-0000-0000000000c1',
  role: 'superadmin',
  permissions: [],
};

const MANAGER_APPROVER: AuthContext = {
  ...SUPERADMIN_ENABLER,
  staffId: '00000000-0000-0000-0000-0000000000s2',
  role: 'admin',
};

const SAME_PERSON_AS_ENABLER: AuthContext = { ...SUPERADMIN_ENABLER };
const CLINICIAN_AUTH: AuthContext = { ...SUPERADMIN_ENABLER, staffId: '00000000-0000-0000-0000-0000000000s3', role: 'clinician' };

function buildState(o: Partial<RetentionApprovalState> = {}): RetentionApprovalState {
  return {
    retentionPurgeEnabled: true,
    retentionPurgeEnabledByStaffId: SUPERADMIN_ENABLER.staffId,
    retentionPurgeEnabledAt: new Date('2026-04-26T00:00:00.000Z'),
    retentionPurgeManagerApprovedByStaffId: null,
    retentionPurgeManagerApprovedAt: null,
    ...o,
  };
}

type RetentionApprovalAuditCall = Parameters<RetentionApprovalContext['writeAudit']>[0];

function buildCtx(
  state: RetentionApprovalState = buildState(),
): RetentionApprovalContext & { auditCalls: RetentionApprovalAuditCall[] } {
  let s = state;
  const auditCalls: RetentionApprovalAuditCall[] = [];
  return {
    fetchState: vi.fn(async () => s),
    persistApproval: vi.fn(async (_clinicId, staffId, approvedAt) => {
      s = { ...s, retentionPurgeManagerApprovedByStaffId: staffId, retentionPurgeManagerApprovedAt: approvedAt };
    }),
    persistRevocation: vi.fn(async () => {
      s = { ...s, retentionPurgeManagerApprovedByStaffId: null, retentionPurgeManagerApprovedAt: null };
    }),
    writeAudit: vi.fn(async (entry) => {
      auditCalls.push(entry);
    }),
    auditCalls,
  };
}

describe('BUG-374b Part 2 — isApprovalActive (pure-function 30-day TTL)', () => {
  it('TP-APPR-1: NULL approval → not active', () => {
    expect(isApprovalActive(buildState({ retentionPurgeManagerApprovedAt: null }), NOW)).toBe(false);
  });

  it('TP-APPR-2: approved now → active', () => {
    expect(isApprovalActive(buildState({
      retentionPurgeManagerApprovedAt: NOW,
      retentionPurgeManagerApprovedByStaffId: MANAGER_APPROVER.staffId,
    }), NOW)).toBe(true);
  });

  it('TP-APPR-3: approved 29 days ago → active', () => {
    const t = new Date(NOW.getTime() - 29 * 24 * 60 * 60 * 1000);
    expect(isApprovalActive(buildState({
      retentionPurgeManagerApprovedAt: t,
      retentionPurgeManagerApprovedByStaffId: MANAGER_APPROVER.staffId,
    }), NOW)).toBe(true);
  });

  it('TP-APPR-4: approved 30 days ago → expired (boundary)', () => {
    const t = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(isApprovalActive(buildState({
      retentionPurgeManagerApprovedAt: t,
      retentionPurgeManagerApprovedByStaffId: MANAGER_APPROVER.staffId,
    }), NOW)).toBe(false);
  });

  it('TP-APPR-5: approved 31 days ago → expired', () => {
    const t = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000);
    expect(isApprovalActive(buildState({
      retentionPurgeManagerApprovedAt: t,
      retentionPurgeManagerApprovedByStaffId: MANAGER_APPROVER.staffId,
    }), NOW)).toBe(false);
  });

  it('TP-APPR-6: approver === enabler → segregation-of-duties violation, not active', () => {
    const s = buildState({
      retentionPurgeEnabledByStaffId: 'sX',
      retentionPurgeManagerApprovedByStaffId: 'sX',
      retentionPurgeManagerApprovedAt: NOW,
    });
    expect(isApprovalActive(s, NOW)).toBe(false);
  });

  it('TP-APPR-7: approver != enabler → active when fresh', () => {
    const s = buildState({
      retentionPurgeEnabledByStaffId: 'sX',
      retentionPurgeManagerApprovedByStaffId: 'sY',
      retentionPurgeManagerApprovedAt: NOW,
    });
    expect(isApprovalActive(s, NOW)).toBe(true);
  });

  it('TP-APPR-8: retentionPurgeEnabled=false → approval irrelevant, not active', () => {
    const s = buildState({
      retentionPurgeEnabled: false,
      retentionPurgeManagerApprovedByStaffId: 'sY',
      retentionPurgeManagerApprovedAt: NOW,
    });
    expect(isApprovalActive(s, NOW)).toBe(false);
  });

  it('TP-APPR-16: L4 absorb-1 fail-CLOSED — enabledByStaffId=null → not active', () => {
    // enabled=true with enabled_by=null is an out-of-band state (direct
    // DB write, partial restore, fixture leak, future broken migration).
    // Without an enabler we cannot enforce segregation of duties; refuse
    // to arm.
    const s = buildState({
      retentionPurgeEnabledByStaffId: null,
      retentionPurgeManagerApprovedByStaffId: 'sY',
      retentionPurgeManagerApprovedAt: NOW,
    });
    expect(isApprovalActive(s, NOW)).toBe(false);
  });
});

describe('BUG-374b Part 2 — retentionApprovalService.approve', () => {
  it('TP-APPR-9: rejects clinician with FORBIDDEN', async () => {
    const ctx = buildCtx();
    const r = await retentionApprovalService.approve(CLINICIAN_AUTH, 'pilot enable', ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('FORBIDDEN');
    expect(ctx.persistApproval).not.toHaveBeenCalled();
  });

  it('TP-APPR-10: rejects when caller is the same staff as enabler (segregation of duties)', async () => {
    const ctx = buildCtx(); // enabler is s1
    const r = await retentionApprovalService.approve(SAME_PERSON_AS_ENABLER, 'pilot enable', ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('SEGREGATION_OF_DUTIES_VIOLATION');
    expect(ctx.persistApproval).not.toHaveBeenCalled();
  });

  it('TP-APPR-11: rejects when retentionPurgeEnabled=false', async () => {
    const ctx = buildCtx(buildState({ retentionPurgeEnabled: false }));
    const r = await retentionApprovalService.approve(MANAGER_APPROVER, 'pilot', ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('PURGE_NOT_ENABLED');
  });

  it('TP-APPR-12: rejects empty/whitespace reason', async () => {
    const ctx = buildCtx();
    for (const reason of ['', '   ', '\t']) {
      const r = await retentionApprovalService.approve(MANAGER_APPROVER, reason, ctx);
      expect(isErr(r)).toBe(true);
      if (isErr(r)) expect(r.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('TP-APPR-13: admin approver != enabler → success + audit', async () => {
    const ctx = buildCtx();
    const r = await retentionApprovalService.approve(MANAGER_APPROVER, 'pilot enable', ctx);
    expect(isOk(r)).toBe(true);
    expect(ctx.persistApproval).toHaveBeenCalledWith(
      MANAGER_APPROVER.clinicId,
      MANAGER_APPROVER.staffId,
      expect.any(Date),
    );
    expect(ctx.auditCalls.length).toBe(1);
    expect(ctx.auditCalls[0].action).toBe('UPDATE');
    expect(ctx.auditCalls[0].newData?.retention_purge_manager_approved_by_staff_id).toBe(MANAGER_APPROVER.staffId);
    expect(ctx.auditCalls[0].newData?.reason).toBe('pilot enable');
  });
});

describe('BUG-374b Part 2 — retentionApprovalService.approve fail-CLOSED', () => {
  it('TP-APPR-17: L4 absorb-1 — rejects with PURGE_ENABLED_BY_MISSING when enabled=true but enabled_by=null', async () => {
    const ctx = buildCtx(buildState({ retentionPurgeEnabledByStaffId: null }));
    const r = await retentionApprovalService.approve(MANAGER_APPROVER, 'pilot enable', ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('PURGE_ENABLED_BY_MISSING');
    expect(ctx.persistApproval).not.toHaveBeenCalled();
  });
});

describe('BUG-374b Part 2 — retentionApprovalService.getState (L5 absorb-1 SSoT reader)', () => {
  it('TP-APPR-18: clinician cannot read approval state', async () => {
    const ctx = buildCtx();
    const r = await retentionApprovalService.getState(CLINICIAN_AUTH, ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('FORBIDDEN');
  });

  it('TP-APPR-19: admin sees server-computed managerApprovalActive=true for valid approval', async () => {
    const ctx = buildCtx(buildState({
      retentionPurgeManagerApprovedByStaffId: MANAGER_APPROVER.staffId,
      retentionPurgeManagerApprovedAt: NOW,
    }));
    const r = await retentionApprovalService.getState(MANAGER_APPROVER, ctx, NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.managerApprovalActive).toBe(true);
      expect(r.value.retentionPurgeManagerApprovedByStaffId).toBe(MANAGER_APPROVER.staffId);
    }
  });

  it('TP-APPR-20: admin sees managerApprovalActive=false when enabled_by=null (fail-CLOSED)', async () => {
    const ctx = buildCtx(buildState({
      retentionPurgeEnabledByStaffId: null,
      retentionPurgeManagerApprovedByStaffId: MANAGER_APPROVER.staffId,
      retentionPurgeManagerApprovedAt: NOW,
    }));
    const r = await retentionApprovalService.getState(MANAGER_APPROVER, ctx, NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.managerApprovalActive).toBe(false);
  });
});

describe('BUG-374b Part 2 — retentionApprovalService.revoke', () => {
  it('TP-APPR-14: any superadmin/admin can revoke; writes audit', async () => {
    const ctx = buildCtx(buildState({
      retentionPurgeManagerApprovedByStaffId: MANAGER_APPROVER.staffId,
      retentionPurgeManagerApprovedAt: NOW,
    }));
    const r = await retentionApprovalService.revoke(SUPERADMIN_ENABLER, 'rollback', ctx);
    expect(isOk(r)).toBe(true);
    expect(ctx.persistRevocation).toHaveBeenCalledWith(SUPERADMIN_ENABLER.clinicId);
    expect(ctx.auditCalls.length).toBe(1);
    expect(ctx.auditCalls[0].newData?.retention_purge_manager_approved_by_staff_id).toBeNull();
  });

  it('TP-APPR-15: clinician cannot revoke', async () => {
    const ctx = buildCtx();
    const r = await retentionApprovalService.revoke(CLINICIAN_AUTH, 'oops', ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('FORBIDDEN');
  });
});
