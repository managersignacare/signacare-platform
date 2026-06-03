// apps/api/src/features/power-settings/retentionSettingService.ts
//
// BUG-374a — retention setter service.
//
// Policy locked 2026-04-26 (project_data_retention_policy.md):
//   - 25-year minimum floor; NO purge before that floor.
//   - data_retention_years setter superadmin-only (Q3b).
//   - retention_purge_enabled toggle superadmin-only (Q3b).
//   - DB CHECK + Zod min(25) + service guard = 4-layer defence-in-depth.
//
// This file is the L3 (service-layer) defence: even if the route's Zod
// (L1+L2) is somehow bypassed, the service rejects sub-25 with
// `RETENTION_BELOW_FLOOR`. The DB CHECK constraint (L4) is the final
// line; the cron predicate using `MAX(25, configured)` (L5) closes the
// bottom.
//
// Dependency-injected RetentionSettingContext makes the service unit-
// testable without a live DB (mirrors BUG-372 sibling pattern).
//
// fix-registry anchors: R-FIX-BUG-374A-SERVICE-FLOOR-GUARD,
// R-FIX-BUG-374A-SUPERADMIN-GUARD, R-FIX-BUG-374A-AUDIT-ON-SET.

import type { AuthContext } from '@signacare/shared';
import { Result } from '@signacare/shared';
import { AppError } from '../../shared/errors';
import { writeAuditLog } from '../../utils/audit';
import { dbAdmin } from '../../db/db';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RetentionState {
  dataRetentionYears: number;
  retentionPurgeEnabled: boolean;
  retentionPurgeEnabledAt: Date | null;
  retentionPurgeEnabledByStaffId: string | null;
}

export interface RetentionAuditEntry {
  action: 'UPDATE';
  tableName: 'clinics';
  actorId: string;
  clinicId: string;
  recordId: string;
  oldData: Record<string, unknown>;
  newData: Record<string, unknown>;
}

export interface RetentionSettingContext {
  fetchState(clinicId: string): Promise<RetentionState>;
  persistRetentionYears(clinicId: string, years: number): Promise<void>;
  persistPurgeEnabled(clinicId: string, enabled: boolean, staffId: string): Promise<void>;
  writeAudit(entry: RetentionAuditEntry): Promise<void>;
}

// ── Floor constants ───────────────────────────────────────────────────────

/**
 * BUG-374 — hard 25-year floor for patient/clinical record retention.
 * Enforced at every layer (Zod min(25), service guard, DB CHECK,
 * cron predicate via MAX(25, configured)). NO clinic can opt below.
 */
export const DATA_RETENTION_YEARS_FLOOR = 25 as const;

/**
 * Sanity ceiling. 200 years is well past any conceivable record-life
 * use case; rejects pathological inputs (e.g. accidental year-2200).
 */
export const DATA_RETENTION_YEARS_CEILING = 200 as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function requireSuperadmin(auth: AuthContext): AppError | null {
  if (auth.role !== 'superadmin') {
    return new AppError(
      'Retention configuration is restricted to platform superadmins per policy (BUG-374 Q3b)',
      403,
      'FORBIDDEN',
    );
  }
  return null;
}

function validateYears(years: number): AppError | null {
  if (!Number.isInteger(years)) {
    return new AppError(
      `Retention years must be an integer; got ${String(years)}`,
      422,
      'VALIDATION_ERROR',
    );
  }
  if (years < DATA_RETENTION_YEARS_FLOOR) {
    return new AppError(
      `Retention years must be at least ${DATA_RETENTION_YEARS_FLOOR} (policy floor); got ${years}`,
      422,
      'RETENTION_BELOW_FLOOR',
    );
  }
  if (years > DATA_RETENTION_YEARS_CEILING) {
    return new AppError(
      `Retention years exceeds sanity ceiling of ${DATA_RETENTION_YEARS_CEILING}; got ${years}`,
      422,
      'VALIDATION_ERROR',
    );
  }
  return null;
}

// ── Service ────────────────────────────────────────────────────────────────

export const retentionSettingService = {
  async getRetention(
    auth: AuthContext,
    ctx: RetentionSettingContext = liveContext(),
  ): Promise<Result<RetentionState, AppError>> {
    try {
      const state = await ctx.fetchState(auth.clinicId);
      return Result.ok(state);
    } catch (err) {
      const e = err instanceof AppError
        ? err
        : new AppError('Failed to read retention state', 500, 'INTERNAL_ERROR');
      return Result.err(e);
    }
  },

  async setRetention(
    auth: AuthContext,
    years: number,
    ctx: RetentionSettingContext = liveContext(),
  ): Promise<Result<void, AppError>> {
    const roleErr = requireSuperadmin(auth);
    if (roleErr) return Result.err(roleErr);

    const valErr = validateYears(years);
    if (valErr) return Result.err(valErr);

    try {
      const before = await ctx.fetchState(auth.clinicId);
      await ctx.persistRetentionYears(auth.clinicId, years);
      await ctx.writeAudit({
        action: 'UPDATE',
        tableName: 'clinics',
        actorId: auth.staffId,
        clinicId: auth.clinicId,
        recordId: auth.clinicId,
        oldData: { data_retention_years: before.dataRetentionYears },
        newData: { data_retention_years: years },
      });
      return Result.ok(undefined);
    } catch (err) {
      const e = err instanceof AppError
        ? err
        : new AppError('Failed to set retention years', 500, 'INTERNAL_ERROR');
      return Result.err(e);
    }
  },

  async setPurgeEnabled(
    auth: AuthContext,
    enabled: boolean,
    reason: string,
    ctx: RetentionSettingContext = liveContext(),
  ): Promise<Result<void, AppError>> {
    const roleErr = requireSuperadmin(auth);
    if (roleErr) return Result.err(roleErr);

    if (typeof enabled !== 'boolean') {
      return Result.err(
        new AppError('enabled must be boolean', 422, 'VALIDATION_ERROR'),
      );
    }

    try {
      const before = await ctx.fetchState(auth.clinicId);
      await ctx.persistPurgeEnabled(auth.clinicId, enabled, auth.staffId);
      await ctx.writeAudit({
        action: 'UPDATE',
        tableName: 'clinics',
        actorId: auth.staffId,
        clinicId: auth.clinicId,
        recordId: auth.clinicId,
        oldData: { retention_purge_enabled: before.retentionPurgeEnabled },
        newData: { retention_purge_enabled: enabled, reason },
      });
      return Result.ok(undefined);
    } catch (err) {
      const e = err instanceof AppError
        ? err
        : new AppError('Failed to toggle retention purge flag', 500, 'INTERNAL_ERROR');
      return Result.err(e);
    }
  },
};

// ── Live context (production binding) ──────────────────────────────────────

interface ClinicRetentionRow {
  data_retention_years: number;
  retention_purge_enabled: boolean;
  retention_purge_enabled_at: Date | null;
  retention_purge_enabled_by_staff_id: string | null;
}

function liveContext(): RetentionSettingContext {
  // SCHEDULER + SUPERADMIN ONLY — uses dbAdmin per BUG-583. The
  // retention table is tenant-scoped at the row level (clinic.id);
  // dbAdmin bypasses RLS but the service-layer guard restricts
  // mutations to superadmin role, so the security posture is
  // role-based rather than RLS-based here.
  return {
    async fetchState(clinicId: string): Promise<RetentionState> {
      const row = (await dbAdmin('clinics')
        .where({ id: clinicId })
        .select(
          'data_retention_years',
          'retention_purge_enabled',
          'retention_purge_enabled_at',
          'retention_purge_enabled_by_staff_id',
        )
        .first()) as ClinicRetentionRow | undefined;
      if (!row) {
        // Defensive default — should never fire in practice (auth
        // means the clinic exists), but a missing-row case yields
        // the policy floor rather than crashing.
        return {
          dataRetentionYears: DATA_RETENTION_YEARS_FLOOR,
          retentionPurgeEnabled: false,
          retentionPurgeEnabledAt: null,
          retentionPurgeEnabledByStaffId: null,
        };
      }
      return {
        dataRetentionYears: row.data_retention_years,
        retentionPurgeEnabled: row.retention_purge_enabled,
        retentionPurgeEnabledAt: row.retention_purge_enabled_at,
        retentionPurgeEnabledByStaffId: row.retention_purge_enabled_by_staff_id,
      };
    },
    async persistRetentionYears(clinicId: string, years: number): Promise<void> {
      await dbAdmin('clinics')
        .where({ id: clinicId })
        .update({ data_retention_years: years, updated_at: new Date() });
    },
    async persistPurgeEnabled(
      clinicId: string,
      enabled: boolean,
      staffId: string,
    ): Promise<void> {
      await dbAdmin('clinics')
        .where({ id: clinicId })
        .update({
          retention_purge_enabled: enabled,
          retention_purge_enabled_at: enabled ? new Date() : null,
          retention_purge_enabled_by_staff_id: enabled ? staffId : null,
          updated_at: new Date(),
        });
    },
    async writeAudit(entry: RetentionAuditEntry): Promise<void> {
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
