import type { Knex } from 'knex';
import { dbAdmin } from '../db/db';
import { writeAuditLog } from '../utils/audit';

export interface StaffActivenessResolution {
  candidateIds: string[];
  inactiveCandidateIds: string[];
  active: string[];
  reassignedToAdmin: string | null;
  adminSource: 'nominated' | 'delegated' | null;
  usedNoAdminFallbackCandidate: boolean;
}

interface AuditFallbackInput {
  clinicId: string;
  tableName: string;
  recordId: string;
  systemActor: string;
  reassignedAction: 'CRITICAL_RECIPIENT_REASSIGNED';
  noRecipientAction: 'CRITICAL_NO_RECIPIENT_AVAILABLE';
  metadata?: Record<string, unknown>;
}

interface ResolveStaffRecipientsInput {
  clinicId: string;
  candidateStaffIds: Array<string | null | undefined>;
  conn?: Knex;
  /**
   * `first_candidate` keeps compatibility for older pathways that must
   * still assign a task row even when all recipients are inactive and no
   * clinic admin is configured.
   */
  onNoAdmin?: 'none' | 'first_candidate';
  auditFallback?: AuditFallbackInput;
}

/**
 * Resolve recipient candidates to active staff. If no active candidates exist,
 * fall back to clinic nominated/delegated admin when configured.
 */
export async function resolveStaffRecipientsWithAdminFallback(
  input: ResolveStaffRecipientsInput,
): Promise<StaffActivenessResolution> {
  const conn = input.conn ?? dbAdmin;
  const candidateIds = Array.from(
    new Set(
      input.candidateStaffIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    ),
  );

  if (candidateIds.length === 0) {
    const noCandidates: StaffActivenessResolution = {
      candidateIds: [],
      inactiveCandidateIds: [],
      active: [],
      reassignedToAdmin: null,
      adminSource: null,
      usedNoAdminFallbackCandidate: false,
    };
    if (input.auditFallback) {
      await writeNoRecipientAudit(noCandidates, input.auditFallback);
    }
    return noCandidates;
  }

  const staffRows = await conn('staff')
    .where({ clinic_id: input.clinicId })
    .whereNull('deleted_at')
    .whereIn('id', candidateIds)
    .select('id', 'is_active');
  const activeSet = new Set(
    staffRows
      .filter((row) => row.is_active)
      .map((row) => String(row.id)),
  );
  const active = candidateIds.filter((id) => activeSet.has(id));
  const inactiveCandidateIds = candidateIds.filter((id) => !activeSet.has(id));

  if (active.length > 0) {
    return {
      candidateIds,
      inactiveCandidateIds,
      active,
      reassignedToAdmin: null,
      adminSource: null,
      usedNoAdminFallbackCandidate: false,
    };
  }

  const clinic = await conn('clinics')
    .where({ id: input.clinicId })
    .whereNull('deleted_at')
    .select('nominated_admin_staff_id', 'delegated_admin_staff_id')
    .first();
  const nominated = clinic?.nominated_admin_staff_id
    ? String(clinic.nominated_admin_staff_id)
    : null;
  const delegated = clinic?.delegated_admin_staff_id
    ? String(clinic.delegated_admin_staff_id)
    : null;
  const adminId = nominated ?? delegated;
  const adminSource = nominated ? 'nominated' : delegated ? 'delegated' : null;

  if (adminId) {
    const resolved: StaffActivenessResolution = {
      candidateIds,
      inactiveCandidateIds,
      active: [adminId],
      reassignedToAdmin: adminId,
      adminSource,
      usedNoAdminFallbackCandidate: false,
    };
    if (input.auditFallback) {
      await writeReassignedAudit(resolved, input.auditFallback);
    }
    return resolved;
  }

  const useFallbackCandidate = input.onNoAdmin === 'first_candidate';
  const resolved: StaffActivenessResolution = {
    candidateIds,
    inactiveCandidateIds,
    active: useFallbackCandidate ? [candidateIds[0]!] : [],
    reassignedToAdmin: null,
    adminSource: null,
    usedNoAdminFallbackCandidate: useFallbackCandidate,
  };
  if (input.auditFallback) {
    await writeNoRecipientAudit(resolved, input.auditFallback);
  }
  return resolved;
}

async function writeReassignedAudit(
  resolution: StaffActivenessResolution,
  audit: AuditFallbackInput,
): Promise<void> {
  await writeAuditLog({
    clinicId: audit.clinicId,
    actorId: `system:${audit.systemActor}`,
    action: audit.reassignedAction,
    tableName: audit.tableName,
    recordId: audit.recordId,
    newData: {
      system_actor: audit.systemActor,
      candidate_staff_ids: resolution.candidateIds,
      inactive_candidate_ids: resolution.inactiveCandidateIds,
      admin_staff_id: resolution.reassignedToAdmin,
      admin_source: resolution.adminSource,
      reason: 'all_candidates_inactive_admin_fallback',
      ...(audit.metadata ?? {}),
    },
  });
}

async function writeNoRecipientAudit(
  resolution: StaffActivenessResolution,
  audit: AuditFallbackInput,
): Promise<void> {
  await writeAuditLog({
    clinicId: audit.clinicId,
    actorId: `system:${audit.systemActor}`,
    action: audit.noRecipientAction,
    tableName: audit.tableName,
    recordId: audit.recordId,
    newData: {
      system_actor: audit.systemActor,
      candidate_staff_ids: resolution.candidateIds,
      inactive_candidate_ids: resolution.inactiveCandidateIds,
      fallback_assignee_id: resolution.usedNoAdminFallbackCandidate
        ? resolution.active[0] ?? null
        : null,
      reason: resolution.usedNoAdminFallbackCandidate
        ? 'no_admin_configured_assigned_inactive_candidate'
        : 'no_admin_configured_no_recipient',
      ...(audit.metadata ?? {}),
    },
  });
}
