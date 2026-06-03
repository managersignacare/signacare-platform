// apps/api/src/features/power-settings/retentionApprovalService.ts
//
// BUG-374b Part 2 — retention manager-approval workflow (Q-F triple-lock 3rd gate).
//
// Production purge requires ALL THREE gates:
//   1. RETENTION_DRY_RUN=false env var (default 'true')
//   2. clinic.retention_purge_enabled=true (BUG-374a; superadmin)
//   3. clinic.retention_purge_manager_approved_at is set AND within last
//      30 days AND `manager_approved_by_staff_id` is DIFFERENT from
//      `retention_purge_enabled_by_staff_id` (segregation of duties)
//
// This service owns gate #3.
//
// Pure-function `isApprovalActive(state, now)` is the predicate the
// scheduler invokes to decide whether to actually purge. Approve / revoke
// are the routes' service-layer entry points.
//
// fix-registry anchors: BUG-374B-MANAGER-APPROVAL-CHECK,
// BUG-374B-SEGREGATION-OF-DUTIES, BUG-374B-APPROVAL-30D-TTL.

import type { AuthContext } from '@signacare/shared';
import { Result } from '@signacare/shared';
import { AppError } from '../../shared/errors';
import { dbAdmin } from '../../db/db';
import { writeAuditLog } from '../../utils/audit';

export const MANAGER_APPROVAL_TTL_DAYS = 30 as const;

// ── Types ──────────────────────────────────────────────────────────────────

export interface RetentionApprovalState {
  retentionPurgeEnabled: boolean;
  retentionPurgeEnabledByStaffId: string | null;
  retentionPurgeEnabledAt: Date | null;
  retentionPurgeManagerApprovedByStaffId: string | null;
  retentionPurgeManagerApprovedAt: Date | null;
}

export interface RetentionApprovalAuditEntry {
  action: 'UPDATE';
  tableName: 'clinics';
  actorId: string;
  clinicId: string;
  recordId: string;
  oldData: Record<string, unknown>;
  newData: Record<string, unknown>;
}

export interface RetentionApprovalContext {
  fetchState(clinicId: string): Promise<RetentionApprovalState>;
  persistApproval(clinicId: string, staffId: string, approvedAt: Date): Promise<void>;
  persistRevocation(clinicId: string): Promise<void>;
  writeAudit(entry: RetentionApprovalAuditEntry): Promise<void>;
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * BUG-374b Part 2 — pure-function predicate the scheduler invokes per
 * clinic to decide whether the manager-approval gate (Q-F #3) is
 * currently active. Returns false on ANY of:
 *   - retentionPurgeEnabled=false (gate #2 not satisfied)
 *   - retentionPurgeEnabledByStaffId is null (fail-CLOSED L4 absorb-1: a
 *     row with enabled=true but enabled_by=null came from outside the
 *     supported `setPurgeEnabled` path — direct DB write, partial restore,
 *     test fixture leak, future broken migration. Without an enabler we
 *     cannot enforce segregation of duties; refuse to arm.)
 *   - approval timestamp is null (no approval yet)
 *   - approver_staff_id is null (fail-CLOSED, mirror of the enabler branch)
 *   - approval is older than MANAGER_APPROVAL_TTL_DAYS (expired)
 *   - approver_staff_id === enabler_staff_id (segregation of duties violation)
 *
 * Removing or weakening this predicate re-opens production-purge-without-
 * second-person-approval risk.
 */
export function isApprovalActive(state: RetentionApprovalState, now: Date): boolean {
  if (!state.retentionPurgeEnabled) return false;
  if (state.retentionPurgeEnabledByStaffId === null) return false;
  if (state.retentionPurgeManagerApprovedAt === null) return false;
  if (state.retentionPurgeManagerApprovedByStaffId === null) return false;

  // Segregation of duties: approver MUST differ from enabler.
  if (state.retentionPurgeManagerApprovedByStaffId === state.retentionPurgeEnabledByStaffId) {
    return false;
  }

  // 30-day TTL boundary: approval expires AT 30 days (>=30d → expired).
  const ageMs = now.getTime() - state.retentionPurgeManagerApprovedAt.getTime();
  const ttlMs = MANAGER_APPROVAL_TTL_DAYS * 24 * 60 * 60 * 1000;
  if (ageMs >= ttlMs) return false;

  return true;
}

function requireAdminOrSuperadmin(auth: AuthContext): AppError | null {
  if (auth.role !== 'admin' && auth.role !== 'superadmin') {
    return new AppError(
      'Retention manager-approval is restricted to admin or superadmin per BUG-374b Q-F policy',
      403,
      'FORBIDDEN',
    );
  }
  return null;
}

// ── Service ────────────────────────────────────────────────────────────────

export const retentionApprovalService = {
  /**
   * L5 absorb-1 — exported reader so the GET handler at
   * `retentionSettingRoutes` does not have to inline a `dbAdmin('clinics')`
   * SELECT. The same `liveContext().fetchState` is reused; the role guard
   * mirrors the existing GET handler's posture (admin or superadmin
   * readable). Returning `RetentionApprovalState` + `managerApprovalActive`
   * lets the UI consume the server-computed boolean instead of re-deriving
   * it client-side (BUG-416 anti-pattern).
   */
  async getState(
    auth: AuthContext,
    ctx: RetentionApprovalContext = liveContext(),
    now: Date = new Date(),
  ): Promise<Result<RetentionApprovalState & { managerApprovalActive: boolean }, AppError>> {
    if (auth.role !== 'admin' && auth.role !== 'superadmin') {
      return Result.err(
        new AppError(
          'Retention approval state is restricted to admin or superadmin per BUG-374b Q-F policy',
          403,
          'FORBIDDEN',
        ),
      );
    }
    try {
      const state = await ctx.fetchState(auth.clinicId);
      return Result.ok({
        ...state,
        managerApprovalActive: isApprovalActive(state, now),
      });
    } catch (err) {
      const e = err instanceof AppError
        ? err
        : new AppError('Failed to fetch retention approval state', 500, 'INTERNAL_ERROR');
      return Result.err(e);
    }
  },

  async approve(
    auth: AuthContext,
    reason: string,
    ctx: RetentionApprovalContext = liveContext(),
  ): Promise<Result<void, AppError>> {
    const roleErr = requireAdminOrSuperadmin(auth);
    if (roleErr) return Result.err(roleErr);

    if (typeof reason !== 'string' || reason.trim().length === 0) {
      return Result.err(
        new AppError('Approval reason is required (non-empty)', 422, 'VALIDATION_ERROR'),
      );
    }

    try {
      const before = await ctx.fetchState(auth.clinicId);

      if (!before.retentionPurgeEnabled) {
        return Result.err(
          new AppError(
            'Retention purge is not enabled on this clinic; cannot approve until superadmin enables it first',
            422,
            'PURGE_NOT_ENABLED',
          ),
        );
      }

      // Fail-CLOSED L4 absorb-1: enabled=true with enabled_by=null is an
      // out-of-band state (direct DB write, partial restore, fixture leak).
      // Without a recorded enabler we cannot enforce segregation of duties.
      if (before.retentionPurgeEnabledByStaffId === null) {
        return Result.err(
          new AppError(
            'Retention purge enabled-by attribution is missing; cannot approve until superadmin re-enables via supported route (segregation of duties cannot be enforced)',
            422,
            'PURGE_ENABLED_BY_MISSING',
          ),
        );
      }

      // Q-F segregation of duties: approver MUST differ from enabler.
      if (before.retentionPurgeEnabledByStaffId === auth.staffId) {
        return Result.err(
          new AppError(
            'Segregation of duties: the manager approving the purge must be a different staff member than the superadmin who enabled it',
            422,
            'SEGREGATION_OF_DUTIES_VIOLATION',
          ),
        );
      }

      const now = new Date();
      await ctx.persistApproval(auth.clinicId, auth.staffId, now);
      await ctx.writeAudit({
        action: 'UPDATE',
        tableName: 'clinics',
        actorId: auth.staffId,
        clinicId: auth.clinicId,
        recordId: auth.clinicId,
        oldData: {
          retention_purge_manager_approved_by_staff_id: before.retentionPurgeManagerApprovedByStaffId,
          retention_purge_manager_approved_at: before.retentionPurgeManagerApprovedAt,
        },
        newData: {
          retention_purge_manager_approved_by_staff_id: auth.staffId,
          retention_purge_manager_approved_at: now.toISOString(),
          reason: reason.trim(),
        },
      });
      return Result.ok(undefined);
    } catch (err) {
      const e = err instanceof AppError
        ? err
        : new AppError('Failed to record manager approval', 500, 'INTERNAL_ERROR');
      return Result.err(e);
    }
  },

  async revoke(
    auth: AuthContext,
    reason: string,
    ctx: RetentionApprovalContext = liveContext(),
  ): Promise<Result<void, AppError>> {
    const roleErr = requireAdminOrSuperadmin(auth);
    if (roleErr) return Result.err(roleErr);

    if (typeof reason !== 'string' || reason.trim().length === 0) {
      return Result.err(
        new AppError('Revocation reason is required (non-empty)', 422, 'VALIDATION_ERROR'),
      );
    }

    try {
      const before = await ctx.fetchState(auth.clinicId);
      await ctx.persistRevocation(auth.clinicId);
      await ctx.writeAudit({
        action: 'UPDATE',
        tableName: 'clinics',
        actorId: auth.staffId,
        clinicId: auth.clinicId,
        recordId: auth.clinicId,
        oldData: {
          retention_purge_manager_approved_by_staff_id: before.retentionPurgeManagerApprovedByStaffId,
          retention_purge_manager_approved_at: before.retentionPurgeManagerApprovedAt,
        },
        newData: {
          retention_purge_manager_approved_by_staff_id: null,
          retention_purge_manager_approved_at: null,
          reason: reason.trim(),
        },
      });
      return Result.ok(undefined);
    } catch (err) {
      const e = err instanceof AppError
        ? err
        : new AppError('Failed to revoke manager approval', 500, 'INTERNAL_ERROR');
      return Result.err(e);
    }
  },
};

// ── Live context (production binding) ──────────────────────────────────────

function liveContext(): RetentionApprovalContext {
  return {
    async fetchState(clinicId: string): Promise<RetentionApprovalState> {
      const row = (await dbAdmin('clinics')
        .where({ id: clinicId })
        .select(
          'retention_purge_enabled',
          'retention_purge_enabled_by_staff_id',
          'retention_purge_enabled_at',
          'retention_purge_manager_approved_by_staff_id',
          'retention_purge_manager_approved_at',
        )
        .first()) as Record<string, unknown> | undefined;
      if (!row) {
        return {
          retentionPurgeEnabled: false,
          retentionPurgeEnabledByStaffId: null,
          retentionPurgeEnabledAt: null,
          retentionPurgeManagerApprovedByStaffId: null,
          retentionPurgeManagerApprovedAt: null,
        };
      }
      return {
        retentionPurgeEnabled: Boolean(row.retention_purge_enabled),
        retentionPurgeEnabledByStaffId: (row.retention_purge_enabled_by_staff_id as string | null) ?? null,
        retentionPurgeEnabledAt: (row.retention_purge_enabled_at as Date | null) ?? null,
        retentionPurgeManagerApprovedByStaffId: (row.retention_purge_manager_approved_by_staff_id as string | null) ?? null,
        retentionPurgeManagerApprovedAt: (row.retention_purge_manager_approved_at as Date | null) ?? null,
      };
    },
    async persistApproval(clinicId, staffId, approvedAt) {
      await dbAdmin('clinics')
        .where({ id: clinicId })
        .update({
          retention_purge_manager_approved_by_staff_id: staffId,
          retention_purge_manager_approved_at: approvedAt,
          updated_at: new Date(),
        });
    },
    async persistRevocation(clinicId) {
      await dbAdmin('clinics')
        .where({ id: clinicId })
        .update({
          retention_purge_manager_approved_by_staff_id: null,
          retention_purge_manager_approved_at: null,
          updated_at: new Date(),
        });
    },
    async writeAudit(entry) {
      await writeAuditLog({
        actorId: entry.actorId,
        clinicId: entry.clinicId,
        action: entry.action,
        tableName: entry.tableName,
        recordId: entry.recordId,
        oldData: entry.oldData,
        newData: entry.newData,
      });
    },
  };
}
