import { randomUUID } from 'crypto';
import {
  CreateEpisodeSchema,
  UpdateEpisodeSchema,
  EpisodeSearchSchema,
  CloseEpisodeSchema,
  type AuthContext,
  type CreateEpisodeDTO,
  type UpdateEpisodeDTO,
  type EpisodeSearchDTO,
  type EpisodeResponse,
  type CloseEpisodeDTO,
} from '@signacare/shared';
import { episodeRepository, type EpisodeRow } from './episodeRepository';
import { writeAuditLog } from '../../utils/audit';
import { logger } from '../../utils/logger';
import { generateEpisodeNumber } from '../../shared/utils/numberGenerator';
import { flagService } from '../flags/flagService';
import { AppError } from '../../shared/errors';
import { resolveTeamName, resolveStaffName } from '../../utils/nameResolver';
import { ensureCanonicalSpecialties } from '../../shared/ensureCanonicalSpecialties';

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}

function normaliseEpisodeType(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

function isOpenEpisodeTypeConstraintViolation(err: unknown): boolean {
  const pg = err as { code?: string; constraint?: string; message?: string };
  return pg.code === '23505'
    && (
      pg.constraint === 'idx_episodes_one_open_per_type'
      || pg.message?.includes('idx_episodes_one_open_per_type') === true
    );
}

function mapRowToResponse(row: EpisodeRow & { team?: string }): EpisodeResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeNumber: row.episode_number ?? undefined,
    title: row.presenting_problem ?? row.episode_number ?? row.id,
    episodeType: row.episode_type ?? undefined,
    status: row.status as 'open' | 'closed' | 'onhold',
    primaryDiagnosis: row.primary_diagnosis ?? undefined,
    diagnoses: row.primary_diagnosis ?? undefined,
    startDate: typeof row.start_date === 'string' ? row.start_date : (row.start_date as unknown as Date).toISOString().split('T')[0],
    endDate: row.end_date ?? undefined,
    closureReason: row.closure_reason ?? undefined,
    dischargeSummary: row.closure_summary ?? undefined,
    summary: row.presenting_problem ?? undefined,
    team: row.team_id ?? undefined,
    createdById: row.primary_clinician_id ?? row.id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    // BUG-371c — propagate lock_version to client. OPTIONAL field on
    // the episode response per asymmetric posture (REQUIRED for
    // prescriptions/medications, OPTIONAL for episodes — tightening
    // tracked in BUG-371-FOLLOWUP-3).
    lockVersion: row.lock_version,
  };
}

/** Enrich episode responses with resolved team and clinician names */
async function enrichEpisodeNames(episodes: EpisodeResponse[]): Promise<EpisodeResponse[]> {
  for (const ep of episodes) {
    if (ep.team) ep.teamName = await resolveTeamName(ep.team);
    if (ep.createdById) ep.primaryClinicianName = await resolveStaffName(ep.createdById);
  }
  return episodes;
}

export const episodeService = {
  async create(
    auth: AuthContext,
    dto: CreateEpisodeDTO
  ): Promise<EpisodeResponse> {
    const { clinicId, staffId: actorId } = auth;
    await ensureCanonicalSpecialties({ caller: 'episodeService.create' });
    const parsed = CreateEpisodeSchema.parse(dto);
    const episodeType = normaliseEpisodeType(parsed.episodeType);
    const episodeNumber = await generateEpisodeNumber(clinicId);

    // Auto-generate title: EpisodeType YYYYMMDD
    const typeLabel = (episodeType ?? 'community').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const dateStr = parsed.startDate.replace(/-/g, '');
    const autoTitle = parsed.title || `${typeLabel} ${dateStr}`;

    if (episodeType) {
      const existing = await episodeRepository.findOpenByPatientAndType(clinicId, parsed.patientId, episodeType);
      if (existing) {
        throw new AppError(
          `An open ${typeLabel} episode already exists for this patient`,
          409,
          'OPEN_EPISODE_TYPE_CONFLICT',
          { patientId: parsed.patientId, episodeType, existingEpisodeId: existing.id },
        );
      }
    }

    let row: EpisodeRow;
    try {
      row = await episodeRepository.create({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: parsed.patientId,
        primary_clinician_id: actorId,
        team_id: null,
        presenting_problem: parsed.summary ?? parsed.title ?? null,
        primary_diagnosis: parsed.primaryDiagnosis ?? null,
        start_date: parsed.startDate,
        end_date: parsed.endDate ?? null,
        status: parsed.status ?? 'open',
        episode_number: episodeNumber,
        episode_type: episodeType,
        closure_reason: null,
        closure_summary: null,
        title: autoTitle,
      });
    } catch (err) {
      if (isOpenEpisodeTypeConstraintViolation(err)) {
        throw new AppError(
          `An open ${typeLabel} episode already exists for this patient`,
          409,
          'OPEN_EPISODE_TYPE_CONFLICT',
          { patientId: parsed.patientId, episodeType },
        );
      }
      throw err;
    }

    await writeAuditLog({
      actorId,
      clinicId,
      action: 'CREATE',
      tableName: 'episodes',
      recordId: row.id,
      newData: dto,
    });

    if (
      parsed.primaryDiagnosis &&
      parsed.primaryDiagnosis.toLowerCase().includes('suic')
    ) {
      await flagService
        .raise(clinicId, null, {
          patientId: parsed.patientId,
          category: 'safety',
          severity: 'high',
          title: 'High risk diagnosis in episode',
          description: parsed.primaryDiagnosis,
          relatedRecordType: 'episode',
          relatedRecordId: row.id,
          isHeaderFlag: false,
        })
        .catch((err) => { logger.warn({ err }, 'episodeService: op failed — returning undefined'); return undefined; });
    }

    return mapRowToResponse(row);
  },

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateEpisodeDTO
  ): Promise<EpisodeResponse> {
    const { clinicId, staffId: actorId } = auth;
    const parsed = UpdateEpisodeSchema.parse(dto);
    const existing = await episodeRepository.findById(clinicId, id);

    if (!existing) {
      throw new AppError('Episode not found', 404, 'NOT_FOUND');
    }

    // State-machine guard: reject invalid transitions. Without this
    // check, a discharged episode can be silently re-opened via a
    // PATCH with {status:'open'}, which breaks the audit trail and
    // confuses every downstream report.
    //
    // Valid transitions (status enum is open/closed/onhold):
    //   open    → closed | onhold
    //   onhold  → open | closed
    //   closed  → (none — closed episodes are terminal)
    //
    // ACHS Standard 1 (Clinical Governance — accurate clinical record).
    if (parsed.status !== undefined && parsed.status !== existing.status) {
      const current = existing.status as string;
      const requested = parsed.status;
      if (current === 'closed') {
        throw new AppError(
          `Closed episodes cannot transition to '${requested}'. Closed is terminal; create a new episode if follow-up care is needed.`,
          422,
          'INVALID_STATE_TRANSITION',
        );
      }
    }

    const patch: Partial<EpisodeRow> = {};

    if (parsed.title !== undefined) patch.presenting_problem = parsed.title ?? null;
    if (parsed.episodeType !== undefined) patch.episode_type = parsed.episodeType ?? null;
    if (parsed.status !== undefined) patch.status = parsed.status;
    if (parsed.primaryDiagnosis !== undefined) patch.primary_diagnosis = parsed.primaryDiagnosis ?? null;
    if (parsed.startDate !== undefined) patch.start_date = parsed.startDate;
    if (parsed.endDate !== undefined) patch.end_date = parsed.endDate ?? null;
    if (parsed.summary !== undefined) patch.presenting_problem = parsed.summary ?? null;

    // BUG-371c — opt-locked update. OPTIONAL `expectedLockVersion` per
    // transition strategy: legacy clients without the field hit the
    // warn-log path inside the repository; new clients send it and
    // get conflict-detect 409.
    const updated = await episodeRepository.update(clinicId, id, patch, parsed.expectedLockVersion);

    if (!updated) {
      throw new AppError('Episode not found', 404, 'NOT_FOUND');
    }

    await writeAuditLog({
      actorId,
      clinicId,
      action: 'UPDATE',
      tableName: 'episodes',
      recordId: id,
      oldData: existing,
      newData: patch,
    });

    return mapRowToResponse(updated);
  },

  async getById(
    auth: AuthContext,
    id: string,
  ): Promise<EpisodeResponse> {
    const { clinicId, staffId: actorId } = auth;
    const row = await episodeRepository.findById(clinicId, id);

    if (!row) {
      throw new AppError('Episode not found', 404, 'NOT_FOUND');
    }

    await writeAuditLog({
      actorId,
      clinicId,
      action: 'READ',
      tableName: 'episodes',
      recordId: id,
    });

    return mapRowToResponse(row);
  },

  async listForPatient(
    auth: AuthContext,
    patientId: string,
    filters: EpisodeSearchDTO
  ): Promise<{ data: EpisodeResponse[]; nextCursor: string | null }> {
    const { clinicId, staffId: actorId } = auth;
    const parsed = EpisodeSearchSchema.parse(filters);

    const { data, nextCursor } = await episodeRepository.listForPatient(
      clinicId,
      patientId,
      {
        status: parsed.status ?? undefined,
        cursor: parsed.cursor ?? null,
        limit: parsed.limit ?? 50,
      }
    );

    await writeAuditLog({
      actorId,
      clinicId,
      action: 'READ',
      tableName: 'episodes',
      recordId: '*',
      newData: { patientId, filters: parsed },
    });

    const mapped = data.map(mapRowToResponse);
    await enrichEpisodeNames(mapped);
    return {
      data: mapped,
      nextCursor,
    };
  },

  /**
   * BUG-602 — `conn` defaults to the request-scoped `db` proxy.
   * Schedulers running outside any request context MUST pass `dbAdmin`
   * so the SELECT + UPDATE + audit_log write do not RLS-zero / RLS-reject
   * under empty `app.clinic_id` GUC.
   */
  async close(
    auth: AuthContext,
    id: string,
    dto: CloseEpisodeDTO,
    conn?: import('knex').Knex,
  ): Promise<EpisodeResponse> {
    const { clinicId, staffId: actorId } = auth;
    const parsed = CloseEpisodeSchema.parse(dto);
    const existing = await episodeRepository.findById(clinicId, id, conn);

    if (!existing) {
      throw new AppError('Episode not found', 404, 'NOT_FOUND');
    }

    // State-machine guard: a closed episode cannot be re-closed.
    // Without this the close endpoint would silently overwrite
    // the closure_summary of an already-discharged episode, which
    // breaks the audit trail — the "real" discharge summary gets
    // replaced by whatever the re-close call passes in.
    if ((existing.status as string) === 'closed') {
      throw new AppError(
        'Episode is already closed. Closed episodes cannot be closed again — create a new episode if further care is needed.',
        422,
        'INVALID_STATE_TRANSITION',
      );
    }

    // ACHS Standard 1 (clinical record completeness): a discharge
    // must carry a structured discharge summary. The schema
    // currently allows null; we enforce the business rule here
    // so the day the Zod schema tightens, this guard becomes
    // redundant and can be removed.
    const summary = (parsed.dischargeSummary ?? '').trim();
    if (summary.length < 10) {
      throw new AppError(
        'A discharge summary of at least 10 characters is required to close an episode.',
        422,
        'DISCHARGE_SUMMARY_REQUIRED',
      );
    }

    const patch: Partial<EpisodeRow> = {
      status: 'closed',
      end_date: parsed.endDate,
      closure_reason: parsed.closureReason ?? null,
      closure_summary: summary,
    };

    // BUG-371c — opt-locked close. OPTIONAL `expectedLockVersion` per
    // transition strategy. The closure path is irreversible (closed →
    // terminal per state-machine guard) so concurrent-close race is
    // particularly worth flagging — when version provided, conflict
    // detection prevents two clinicians silently overwriting each
    // other's closure_summary.
    const updated = await episodeRepository.update(clinicId, id, patch, parsed.expectedLockVersion, conn);

    if (!updated) {
      throw new AppError('Episode not found', 404, 'NOT_FOUND');
    }

    await writeAuditLog({
      actorId,
      clinicId,
      action: 'UPDATE',
      tableName: 'episodes',
      recordId: id,
      oldData: existing,
      newData: patch,
    });

    await flagService.resolveByRecord(clinicId, 'safety', id).catch((err) => { logger.warn({ err }, 'episodeService: op failed — returning undefined'); return undefined; });

    return mapRowToResponse(updated);
  },

  async createFromReferral(
    auth: AuthContext,
    params: {
    patientId: string;
    referralId: string;
    episodeType: string;
  }): Promise<EpisodeResponse> {
    return episodeService.create(auth, {
      patientId: params.patientId,
      title: `Referral Episode`,
      episodeType: params.episodeType,
      startDate: new Date().toISOString().slice(0, 10),
    });
  },
};
