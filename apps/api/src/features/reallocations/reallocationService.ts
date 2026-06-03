/**
 * Patient care-team re-allocation approval workflow.
 *
 * Phase 0.7.5 c24 C5 — workflow state now lives in the
 * `patient_team_reallocations` table (new in migration 20260602000000),
 * separate from `patient_team_assignments` which holds only the current
 * active team per patient. Previously the service tried to encode the
 * workflow as extra fields (referral_status, referred_by_id, reviewed_*,
 * rejection_reason) on patient_team_assignments, but those columns never
 * existed — every request/approve/reject crashed at runtime (SD14).
 *
 * Three operations:
 *
 *   request  → insert a new `patient_team_reallocations` row with
 *              status='pending_approval' + referred_by_id = requester.
 *              The existing active `patient_team_assignments` row is
 *              left untouched so the patient is never in flux between
 *              the request and the decision. Partial unique index on
 *              (clinic_id, patient_id) WHERE status='pending_approval'
 *              enforces one-pending-at-a-time.
 *
 *   approve  → requires the approver to be either:
 *                (a) a global `manager` / admin / superadmin role, OR
 *                (b) a staff_role_assignments row with
 *                    role_type IN ('team_leader','manager') scoped
 *                    to the target org_unit_id, AND
 *              is_active = true on that assignment.
 *              In a single transaction:
 *                1. Flip existing active assignments to is_active=false.
 *                2. Upsert the new active assignment
 *                   (patient + target org_unit_id) via onConflict.merge.
 *                3. Mark the reallocation row status='active',
 *                   reviewed_by_id, reviewed_at.
 *              Emits a Viva outreach (kind=team_reassignment).
 *
 *   reject   → update the reallocation row: status='rejected',
 *              rejection_reason, reviewed_by_id, reviewed_at. Does
 *              NOT touch patient_team_assignments — the current active
 *              team stays as-is. No Viva notification — rejection is
 *              internal.
 *
 * Four-eyes principle: approve() refuses self-approval by comparing
 * the approver to referred_by_id on the reallocation row.
 */
import type { Knex } from 'knex';
import { db } from '../../db/db';
import { AppError } from '../../shared/errors';
import auditLogService from '../../utils/audit';
import logger from '../../utils/logger';
import { patientOutreachService } from '../patient-outreach/patientOutreachService';
import {
  executeAllocationInstructions,
  validateAllocationExecutionInstructions,
  type ReallocationAllocationInstruction,
} from '../patients/allocationExecutionCommand';

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// patient_team_reallocations has 14 columns.
const REALLOCATION_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'to_org_unit_id',
  'to_primary_clinician_id', 'from_org_unit_id', 'status',
  'referred_by_id', 'reviewed_by_id', 'reviewed_at',
  'reason', 'rejection_reason', 'created_at', 'updated_at',
] as const;

export interface RequestReallocationInput {
  clinicId: string;
  patientId: string;
  targetOrgUnitId: string;
  targetPrimaryClinicianId?: string | null;
  requestedByStaffId: string;
  reason?: string | null;
}

/**
 * Mirrors `patient_team_reallocations` (see migration 20260602000000).
 * Verified against the live schema via psql + the committed schema
 * snapshot (`npm run db:snapshot --workspace=apps/api`). The
 * row-iface-drift guard (CLAUDE.md §15) blocks any rename that doesn't
 * land a matching migration + snapshot regen.
 */
export interface ReallocationRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  to_org_unit_id: string;
  to_primary_clinician_id: string | null;
  from_org_unit_id: string | null;
  status: string;
  referred_by_id: string;
  reviewed_by_id: string | null;
  reviewed_at: Date | null;
  reason: string | null;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

async function loadPendingRow(
  clinicId: string,
  reallocationId: string,
  trx?: Knex.Transaction,
): Promise<ReallocationRow | null> {
  const row = await (trx ?? db)<ReallocationRow>('patient_team_reallocations')
    .where({ id: reallocationId, clinic_id: clinicId })
    .first();
  return row ?? null;
}

async function approverIsAuthorised(
  clinicId: string,
  approverStaffId: string,
  targetOrgUnitId: string,
): Promise<boolean> {
  // Shortcut 1 — global manager role bypasses the team-specific check.
  const staff = await db('staff')
    .where({ id: approverStaffId, clinic_id: clinicId })
    .select('role')
    .first() as { role?: string } | undefined;
  if (staff?.role === 'manager' || staff?.role === 'admin' || staff?.role === 'superadmin') {
    return true;
  }

  // Shortcut 2 — explicit team leader assignment scoped to this org unit.
  const assignment = await db('staff_role_assignments')
    .where({
      staff_id: approverStaffId,
      org_unit_id: targetOrgUnitId,
      is_active: true,
    })
    .whereIn('role_type', ['team_leader', 'manager'])
    .select('id')
    .first() as { id: string } | undefined;

  return !!assignment;
}

export const reallocationService = {
  /**
   * Create a pending re-allocation. The existing active assignment
   * stays live so there's no "unassigned" window — the switch only
   * happens on approve.
   */
  async request(input: RequestReallocationInput): Promise<ReallocationRow> {
    // Verify the patient exists in this clinic.
    const patient = await db('patients')
      .where({ id: input.patientId, clinic_id: input.clinicId })
      .whereNull('deleted_at')
      .select('id')
      .first() as { id: string } | undefined;
    if (!patient) {
      throw new AppError('Patient not found', 404, 'PATIENT_NOT_FOUND' as never);
    }

    // Verify the target org unit exists + belongs to this clinic.
    const org = await db('org_units')
      .where({ id: input.targetOrgUnitId, clinic_id: input.clinicId })
      .select('id', 'name')
      .first() as { id: string; name: string } | undefined;
    if (!org) {
      throw new AppError('Target team (org unit) not found', 404, 'ORG_UNIT_NOT_FOUND' as never);
    }

    if (input.targetPrimaryClinicianId) {
      const targetClinician = await db('staff')
        .where({
          id: input.targetPrimaryClinicianId,
          clinic_id: input.clinicId,
        })
        .whereNull('deleted_at')
        .first('id');
      if (!targetClinician) {
        throw new AppError(
          'Target clinician does not belong to this clinic',
          400,
          'CLINIC_SCOPE_VIOLATION' as never,
        );
      }
    }

    // Reject if there's already a pending request for the same patient.
    // The partial unique index will enforce this at the DB level too, but
    // the explicit pre-check produces a clearer error message.
    const existingPending = await db<ReallocationRow>('patient_team_reallocations')
      .where({
        patient_id: input.patientId,
        clinic_id: input.clinicId,
        status: 'pending_approval',
      })
      .select('id')
      .first();
    if (existingPending) {
      throw new AppError(
        'A re-allocation is already pending for this patient',
        409,
        'REALLOCATION_ALREADY_PENDING' as never,
      );
    }

    // Capture the current active org unit as the "from" side of the move
    // so audit trails can show `from → to` even if the assignment
    // changes again later.
    const currentAssignment = await db('patient_team_assignments')
      .where({
        patient_id: input.patientId,
        is_active: true,
      })
      .select('org_unit_id')
      .first() as { org_unit_id: string } | undefined;

    return db.transaction(async (trx) => {
      const rows = await trx<ReallocationRow>('patient_team_reallocations')
        .insert({
          clinic_id: input.clinicId,
          patient_id: input.patientId,
          to_org_unit_id: input.targetOrgUnitId,
          to_primary_clinician_id: input.targetPrimaryClinicianId ?? null,
          from_org_unit_id: currentAssignment?.org_unit_id ?? null,
          status: 'pending_approval',
          referred_by_id: input.requestedByStaffId,
          reason: input.reason ?? null,
        })
        .returning(REALLOCATION_COLUMNS) as ReallocationRow[];
      const row = rows[0];

      await auditLogService.logCreate({
        userId: input.requestedByStaffId,
        clinicId: input.clinicId,
        tableName: 'patient_team_reallocations',
        recordId: row.id,
        newData: {
          action: 'REALLOCATION_REQUESTED',
          targetOrgUnitId: input.targetOrgUnitId,
          reason: input.reason ?? null,
        },
      });

      return row;
    });
  },

  /**
   * Approve a pending re-allocation.
   */
  async approve(
    clinicId: string,
    reallocationId: string,
    approverStaffId: string,
  ): Promise<ReallocationRow> {
    const pending = await loadPendingRow(clinicId, reallocationId);
    if (!pending) {
      throw new AppError('Re-allocation not found', 404, 'REALLOCATION_NOT_FOUND' as never);
    }
    if (pending.status !== 'pending_approval') {
      throw new AppError(
        `Cannot approve a re-allocation in status '${pending.status}'`,
        422,
        'REALLOCATION_NOT_PENDING' as never,
      );
    }

    const canApprove = await approverIsAuthorised(clinicId, approverStaffId, pending.to_org_unit_id);
    if (!canApprove) {
      throw new AppError(
        'Only a team leader or clinic manager can approve a re-allocation',
        403,
        'REALLOCATION_APPROVER_FORBIDDEN' as never,
      );
    }

    // Four-eyes principle — the requester cannot also be the approver.
    if (pending.referred_by_id === approverStaffId) {
      throw new AppError(
        'A re-allocation cannot be approved by its requester — four-eyes principle applies',
        403,
        'REALLOCATION_SELF_APPROVAL' as never,
      );
    }

    const result = await db.transaction(async (trx) => {
      const now = new Date();
      const instruction: ReallocationAllocationInstruction = {
        mode: 'reallocation',
        patientId: pending.patient_id,
        toStaffId: pending.to_primary_clinician_id,
        toTeamId: pending.to_org_unit_id,
      };
      await validateAllocationExecutionInstructions({
        trx,
        clinicId,
        instructions: [instruction],
      });
      await executeAllocationInstructions({
        trx,
        clinicId,
        now,
        instructions: [instruction],
      });

      // 3. Stamp the reallocation row as approved.
      const updatedRows = await trx<ReallocationRow>('patient_team_reallocations')
        .where({ id: reallocationId, clinic_id: clinicId })
        .update({
          status: 'active',
          reviewed_by_id: approverStaffId,
          reviewed_at: now,
          updated_at: now,
        })
        .returning(REALLOCATION_COLUMNS) as ReallocationRow[];

      await auditLogService.logUpdate({
        userId: approverStaffId,
        clinicId,
        tableName: 'patient_team_reallocations',
        recordId: reallocationId,
        oldData: { status: 'pending_approval' },
        newData: {
          status: 'active',
          approver: approverStaffId,
          action: 'REALLOCATION_APPROVED',
        },
      });

      return updatedRows[0];
    });

    // Fire the Viva notification AFTER the transaction commits so a
    // push without a corresponding DB row is impossible. Wrapped in
    // try/catch because a delivery failure must not roll back the
    // approval — the approval is the source of truth, the outreach is
    // the courtesy message.
    try {
      // BUG-430: org_units is multi-tenant — add clinic_id Layer-1.
      const orgName = await db('org_units')
        .where({ id: pending.to_org_unit_id, clinic_id: clinicId })
        .select('name')
        .first() as { name?: string } | undefined;
      await patientOutreachService.send(
        {
          clinicId,
          patientId: pending.patient_id,
          kind: 'team_reassignment',
          title: 'Your care team has changed',
          body: orgName?.name
            ? `Your care has been transferred to the ${orgName.name} team.`
            : 'Your care team has been updated. Open Viva for details.',
          deepLink: '/my-care-team',
        },
        approverStaffId,
      );
    } catch (err) {
      logger.error(
        { err, reallocationId, patientId: pending.patient_id },
        'Re-allocation approved but Viva outreach failed — non-fatal',
      );
    }

    return result;
  },

  /**
   * Reject a pending re-allocation. Records the reason + marks the
   * row status, leaves the existing active assignment untouched.
   */
  async reject(
    clinicId: string,
    reallocationId: string,
    approverStaffId: string,
    rejectionReason: string,
  ): Promise<ReallocationRow> {
    if (!rejectionReason || rejectionReason.trim().length < 5) {
      throw new AppError(
        'Rejection reason is required (at least 5 characters)',
        400,
        'REALLOCATION_REJECTION_REASON_REQUIRED' as never,
      );
    }

    const pending = await loadPendingRow(clinicId, reallocationId);
    if (!pending) {
      throw new AppError('Re-allocation not found', 404, 'REALLOCATION_NOT_FOUND' as never);
    }
    if (pending.status !== 'pending_approval') {
      throw new AppError(
        `Cannot reject a re-allocation in status '${pending.status}'`,
        422,
        'REALLOCATION_NOT_PENDING' as never,
      );
    }

    const canApprove = await approverIsAuthorised(clinicId, approverStaffId, pending.to_org_unit_id);
    if (!canApprove) {
      throw new AppError(
        'Only a team leader or clinic manager can reject a re-allocation',
        403,
        'REALLOCATION_APPROVER_FORBIDDEN' as never,
      );
    }

    const updatedRows = await db<ReallocationRow>('patient_team_reallocations')
      .where({ id: reallocationId, clinic_id: clinicId })
      .update({
        status: 'rejected',
        reviewed_by_id: approverStaffId,
        reviewed_at: new Date(),
        rejection_reason: rejectionReason.trim(),
        updated_at: new Date(),
      })
      .returning(REALLOCATION_COLUMNS) as ReallocationRow[];

    await auditLogService.logUpdate({
      userId: approverStaffId,
      clinicId,
      tableName: 'patient_team_reallocations',
      recordId: reallocationId,
      oldData: { status: 'pending_approval' },
      newData: {
        status: 'rejected',
        rejection_reason: rejectionReason,
        action: 'REALLOCATION_REJECTED',
      },
    });

    return updatedRows[0];
  },

  /**
   * List pending re-allocations for a clinic — used by the approver's
   * inbox UI.
   */
  async listPending(clinicId: string): Promise<ReallocationRow[]> {
    return db<ReallocationRow>('patient_team_reallocations')
      .where({ clinic_id: clinicId, status: 'pending_approval' })
      .orderBy('created_at', 'asc');
  },
};
