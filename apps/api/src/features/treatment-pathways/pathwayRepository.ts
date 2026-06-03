/*
 * apps/api/src/features/treatment-pathways/pathwayRepository.ts
 *
 * BUG-402 — Repository extracted from inline route handlers in
 * `pathwayRoutes.ts`. The pathway "hot data" (sessions completed,
 * end-date, status) lives inside the `milestones` JSONB column. Both
 * racy mutations (PATCH and POST /:id/session) are read-modify-write
 * merges — without optimistic locking, two concurrent calls can both
 * read state X, both write X+1, only one survives. The repository
 * encapsulates the JSONB shallow merge AND the opt-lock helper call so
 * route handlers cannot accidentally bypass either.
 *
 * R-FIX-BUG-402-REPO-USES-HELPER
 */

import { db } from '../../db/db';
import { AppError } from '../../shared/errors';
import { updateWithOptimisticLock } from '../../shared/db/optimisticLock';
// Phase 0b.2c-batch-1 migration (2026-05-04): drain hand-written
// TREATMENT_PATHWAY_COLUMNS to migration-driven TREATMENT_PATHWAYS_COLUMNS
// per Phase 0b.2 plan + CLAUDE.md §15. Re-exported below as alias.
//
// permanent: the alias re-export IS the end-state for Phase 0b.2's DoD
// ("0 remaining hand-written *_COLUMNS array literals"). The runtime
// constant resolves to the migration-driven SSoT, so when a future
// migration adds a column to `treatment_pathways`, the alias updates
// automatically. Migrating consumer call sites from the legacy local
// name to the canonical generated name (`TREATMENT_PATHWAYS_COLUMNS`)
// is a separate consumer-rename concern outside Phase 0b.2's drain
// scope; the alias is not a band-aid waiting for cleanup.
import { TREATMENT_PATHWAYS_COLUMNS } from '../../db/types/treatment_pathways';

/**
 * Treatment-pathway row as stored in the DB. CLAUDE.md §15 forward
 * direction: every declared field must exist in the DB. Reverse direction:
 * sub-projection is intentional but full — every column on
 * `treatment_pathways` per the schema snapshot is declared here so no
 * `@schema-drift-exempt partial-shape` exemption is needed.
 */
export interface TreatmentPathwayRow {
  id: string;
  patient_id: string;
  clinic_id: string;
  updated_by_staff_id: string | null;
  name: string;
  status: string;
  milestones: unknown;
  created_at: Date;
  updated_at: Date;
  /**
   * BUG-402 — optimistic-lock version. Migration
   * 20260701000038 added the column with default 1; helper increments
   * monotonically.
   */
  lock_version: number;
}

/**
 * Explicit RETURNING columns per CLAUDE.md §1.7. Includes lock_version
 * so callers can echo it back as `expectedLockVersion` on the next
 * mutation.
 *
 * Phase 0b.2c-batch-1 (2026-05-04): re-export of the auto-generated
 * TREATMENT_PATHWAYS_COLUMNS (from `apps/api/src/db/types/treatment_pathways.ts`)
 * under the legacy singular name. Migration-driven SSoT — when a future
 * migration adds a column to `treatment_pathways`, this constant updates
 * automatically (compile error surfaces consumers that need to opt in).
 */
export const TREATMENT_PATHWAY_COLUMNS = TREATMENT_PATHWAYS_COLUMNS;

function parseMilestones(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

export const pathwayRepository = {
  async findById(clinicId: string, id: string): Promise<TreatmentPathwayRow | null> {
    const row = await db<TreatmentPathwayRow>('treatment_pathways')
      .where({ id, clinic_id: clinicId })
      .first();
    return row ?? null;
  },

  async listForPatient(clinicId: string, patientId: string): Promise<TreatmentPathwayRow[]> {
    const rows = (await db<TreatmentPathwayRow>('treatment_pathways')
      .where({ patient_id: patientId, clinic_id: clinicId })
      .select(TREATMENT_PATHWAY_COLUMNS as unknown as string[])
      .orderBy('created_at', 'desc')) as unknown as TreatmentPathwayRow[];
    return rows;
  },

  async listForClinic(clinicId: string): Promise<TreatmentPathwayRow[]> {
    const rows = (await db<TreatmentPathwayRow>('treatment_pathways')
      .where({ clinic_id: clinicId })
      .select(TREATMENT_PATHWAY_COLUMNS as unknown as string[])
      .orderBy('created_at', 'desc')) as unknown as TreatmentPathwayRow[];
    return rows;
  },

  async create(row: {
    id?: string;
    clinic_id: string;
    patient_id: string;
    updated_by_staff_id?: string | null;
    name: string;
    status: string;
    milestones: Record<string, unknown>;
  }): Promise<TreatmentPathwayRow> {
    const [created] = (await db<TreatmentPathwayRow>('treatment_pathways')
      .insert({
        clinic_id: row.clinic_id,
        patient_id: row.patient_id,
        updated_by_staff_id: row.updated_by_staff_id ?? null,
        name: row.name,
        status: row.status,
        milestones: JSON.stringify(row.milestones),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(TREATMENT_PATHWAY_COLUMNS as unknown as string[])) as TreatmentPathwayRow[];
    return created;
  },

  /**
   * BUG-402 — opt-locked update. Caller passes the scalar columns it
   * wants to set (`name`, `status`) AND a partial milestones overlay
   * (`milestonesPatch`). The repository:
   *   1. Re-fetches existing milestones (single-row read inside the
   *      same opt-lock window — the `expectedLockVersion` predicate
   *      ensures the merge target is the row the caller observed).
   *   2. Shallow-merges milestonesPatch over the existing JSONB.
   *   3. Calls `updateWithOptimisticLock` with the merged patch.
   *
   * Returns the post-update row (lock_version bumped) or throws
   * `AppError(409, 'OPTIMISTIC_LOCK_CONFLICT')` if the row was
   * concurrently mutated.
   */
  async update(
    clinicId: string,
    id: string,
    expectedLockVersion: number,
    fields: {
      updated_by_staff_id?: string | null;
      name?: string;
      status?: string;
      milestonesPatch?: Record<string, unknown>;
    },
  ): Promise<TreatmentPathwayRow> {
    const existing = await pathwayRepository.findById(clinicId, id);
    if (!existing) {
      // Helper would also fail (zero rows) but with a 409, masking the
      // real cause. Surface 404 with the canonical AppError shape so
      // operators see "not-found" not "concurrent-edit" in observability.
      throw new AppError('Treatment pathway not found', 404, 'NOT_FOUND');
    }

    const patch: Record<string, unknown> = {};
    if (fields.updated_by_staff_id !== undefined) {
      // R-FIX-BUG-568-REPO-UPDATED-BY-PATCH
      patch.updated_by_staff_id = fields.updated_by_staff_id;
    }
    if (fields.name !== undefined) patch.name = fields.name;
    if (fields.status !== undefined) patch.status = fields.status;
    if (fields.milestonesPatch !== undefined) {
      const merged = {
        ...parseMilestones(existing.milestones),
        ...fields.milestonesPatch,
      };
      patch.milestones = JSON.stringify(merged);
    }

    if (Object.keys(patch).length === 0) {
      // Empty patch is a misuse signal (matches helper's own validation);
      // surface immediately instead of going through SQL.
      throw new Error('BUG-402 pathwayRepository.update: empty patch');
    }

    return updateWithOptimisticLock<TreatmentPathwayRow>({
      table: 'treatment_pathways',
      where: { id, clinic_id: clinicId },
      expectedLockVersion,
      patch,
      returning: TREATMENT_PATHWAY_COLUMNS,
    });
  },
};
