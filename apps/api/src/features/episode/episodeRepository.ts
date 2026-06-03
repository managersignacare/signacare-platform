import type { Knex } from 'knex';
import { db } from '../../db/db';
import { EPISODES_COLUMNS } from '../../db/types/episodes';
import { logger } from '../../utils/logger';
import { updateWithOptimisticLock } from '../../shared/db/optimisticLock';

/**
 * @schema-drift-exempt partial-shape
 * BUG-538 — Discharge / closure workflow columns (discharge_signature,
 * discharge_signed_by_id, discharge_signed_at, discharge_summary_content,
 * discharge_vetting_status, discharge_vetted_by_id, discharge_vetted_at,
 * closure_vetting_status, closure_vetted_by_id, closure_vetted_at,
 * closure_signature, key_worker_id, specialty_code) are managed via
 * dedicated routes and intentionally not surfaced through the generic
 * create/update path here, so they're omitted from this row shape.
 * BUG-538 tracks the eventual decision to either flatten the subset
 * or formalise it as a typed view.
 */
export interface EpisodeRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  primary_clinician_id: string | null;
  team_id: string | null;
  episode_number: string | null;
  episode_type: string | null;
  status: string;
  presenting_problem: string | null;
  primary_diagnosis: string | null;
  title: string | null;
  start_date: string;
  end_date: string | null;
  closure_reason: string | null;
  closure_summary: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  /**
   * BUG-371c — opt-lock version. Migration 20260701000037 added the
   * column with default 1. EpisodeRow is partial-shape per BUG-538
   * (omits 14 discharge/closure-workflow columns), so this `lock_version`
   * declaration satisfies forward-direction guard. Reverse-direction
   * partial-shape exemption stays.
   */
  lock_version: number;
}

const EPISODE_COLUMNS = EPISODES_COLUMNS;

export interface EpisodeListFilters {
  status?: string;
  cursor?: string | null;
  limit: number;
}

/**
 * BUG-602 — `conn` defaults to the request-scoped `db` proxy. Schedulers
 * running outside any request context MUST pass `dbAdmin` so SELECTs
 * + UPDATEs do not RLS-zero under empty `app.clinic_id` GUC.
 */
function baseQuery(clinicId: string, conn: Knex = db): Knex.QueryBuilder<EpisodeRow> {
  return conn<EpisodeRow>('episodes')
    .where({ clinic_id: clinicId })
    .whereNull('deleted_at');
}

export const episodeRepository = {
  async create(
    row: Omit<EpisodeRow, 'created_at' | 'updated_at' | 'deleted_at' | 'lock_version'>
  ): Promise<EpisodeRow> {
    // BUG-371c — lock_version omitted from insert: DB default 1 fills.
    const [created] = await db<EpisodeRow>('episodes')
      .insert({
        ...row,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      })
      .returning(EPISODE_COLUMNS) as EpisodeRow[];
    return created;
  },

  /**
   * BUG-371c — opt-lock with OPTIONAL `expectedLockVersion` per plan §2.5.3
   * + asymmetric Zod posture (REQUIRED for prescriptions/medications,
   * OPTIONAL+warn for episodes — transition strategy; tightening
   * tracked in BUG-371-FOLLOWUP-3).
   *
   * If `expectedLockVersion` provided → routes through helper with
   * conflict-detect 409.
   * If `expectedLockVersion` is undefined → legacy non-locking path
   * with structured pino warn so observability captures the missing
   * version. Transition signal: when warn-count → 0, tighten Zod.
   */
  async update(
    clinicId: string,
    id: string,
    patch: Partial<EpisodeRow>,
    expectedLockVersion?: number,
    conn?: Knex,
  ): Promise<EpisodeRow | null> {
    if (typeof expectedLockVersion === 'number') {
      // Helper throws AppError(409) on conflict; unknown errors bubble.
      // No try/catch wrapper — propagation is the desired behaviour.
      // BUG-602 — pass conn through as `trx` (helper's optional connection).
      return updateWithOptimisticLock<EpisodeRow>({
        table: 'episodes',
        where: { id, clinic_id: clinicId, deleted_at: null },
        expectedLockVersion,
        patch: patch as Record<string, unknown>,
        returning: EPISODE_COLUMNS,
        trx: conn as Knex.Transaction | undefined,
      });
    }
    logger.warn(
      { kind: 'OPTIMISTIC_LOCK_VERSION_MISSING', table: 'episodes', episodeId: id, clinicId },
      'BUG-371c: episode update without expectedLockVersion (legacy client; tracked in BUG-371-FOLLOWUP-3 to flip REQUIRED)',
    );
    const [updated] = await baseQuery(clinicId, conn)
      .andWhere({ id })
      .update({ ...patch, updated_at: new Date() }, EPISODE_COLUMNS as unknown as string[]) as EpisodeRow[];
    return updated ?? null;
  },

  async findById(clinicId: string, id: string, conn?: Knex): Promise<EpisodeRow | null> {
    const row = await baseQuery(clinicId, conn).andWhere({ id }).first();
    return row ?? null;
  },

  async findOpenByPatientAndType(
    clinicId: string,
    patientId: string,
    episodeType: string,
    conn?: Knex,
  ): Promise<EpisodeRow | null> {
    const row = await baseQuery(clinicId, conn)
      .andWhere({
        patient_id: patientId,
        status: 'open',
        episode_type: episodeType,
      })
      .first();
    return row ?? null;
  },

  async listForPatient(
    clinicId: string,
    patientId: string,
    filters: EpisodeListFilters
  ): Promise<{ data: EpisodeRow[]; nextCursor: string | null }> {
    const { status, cursor, limit } = filters;

    let q = baseQuery(clinicId)
      .andWhere({ patient_id: patientId })
      .orderBy([{ column: 'start_date', order: 'desc' }, { column: 'id' }]);

    if (status) q = q.andWhere({ status });
    if (cursor) q = q.andWhere('id', '<', cursor);

    const rows = await q.limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    return { data: items, nextCursor };
  },

  async softDelete(clinicId: string, id: string): Promise<void> {
    await baseQuery(clinicId)
      .andWhere({ id })
      .update({ deleted_at: new Date(), updated_at: new Date() });
  },
};
