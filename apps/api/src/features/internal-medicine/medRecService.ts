// apps/api/src/features/internal-medicine/medRecService.ts
import {
  CreateMedRecDTO,
  MedRecResponse,
  MedRecSnapshotItem,
} from '@signacare/shared';
import { medRecRepository, MedRecRowWithPerformer } from './medRecRepository';
import { HttpError } from '../../shared/errors';
import auditLogService from '../../utils/audit';

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function parseSnapshot(value: unknown): MedRecSnapshotItem[] {
  if (Array.isArray(value)) return value as MedRecSnapshotItem[];
  if (typeof value === 'string') {
    try { return JSON.parse(value) as MedRecSnapshotItem[]; } catch { return []; }
  }
  return [];
}

function mapRow(row: MedRecRowWithPerformer): MedRecResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    context: row.context as MedRecResponse['context'],
    performedAt: toIso(row.performed_at)!,
    performedBy: row.performed_by,
    performedByName:
      row.performed_by_given_name && row.performed_by_family_name
        ? `${row.performed_by_given_name} ${row.performed_by_family_name}`
        : null,
    snapshot: parseSnapshot(row.snapshot),
    continuedCount: row.continued_count,
    ceasedCount: row.ceased_count,
    modifiedCount: row.modified_count,
    newCount: row.new_count,
    onHoldCount: row.on_hold_count,
    summaryNotes: row.summary_notes,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

/**
 * Reduce a snapshot to per-disposition counts. Pre-computing on write
 * keeps every read cheap and means the chart can show "3 continued, 1
 * ceased, 1 new" without parsing the JSONB.
 */
function reduceCounts(snapshot: readonly MedRecSnapshotItem[]): {
  continued: number;
  ceased: number;
  modified: number;
  new: number;
  onHold: number;
} {
  const counts = { continued: 0, ceased: 0, modified: 0, new: 0, onHold: 0 };
  for (const item of snapshot) {
    switch (item.disposition) {
      case 'continued': counts.continued++; break;
      case 'ceased':    counts.ceased++;    break;
      case 'modified':  counts.modified++;  break;
      case 'new':       counts.new++;       break;
      case 'on-hold':   counts.onHold++;    break;
    }
  }
  return counts;
}

export class MedRecService {
  async listForPatient(clinicId: string, patientId: string): Promise<MedRecResponse[]> {
    const rows = await medRecRepository.listForPatient(clinicId, patientId);
    return rows.map(mapRow);
  }

  async create(
    clinicId: string,
    actorId: string,
    dto: CreateMedRecDTO,
  ): Promise<MedRecResponse> {
    const counts = reduceCounts(dto.snapshot);
    const created = await medRecRepository.create({
      clinic_id: clinicId,
      patient_id: dto.patientId,
      episode_id: dto.episodeId ?? null,
      context: dto.context,
      performed_at: new Date(),
      performed_by: actorId,
      snapshot: dto.snapshot as unknown,
      continued_count: counts.continued,
      ceased_count: counts.ceased,
      modified_count: counts.modified,
      new_count: counts.new,
      on_hold_count: counts.onHold,
      summary_notes: dto.summaryNotes ?? null,
    });
    await auditLogService.logCreate({
      clinicId,
      userId: actorId,
      tableName: 'medication_reconciliations',
      recordId: created.id,
      newData: { context: created.context, items: dto.snapshot.length },
    });
    const hydrated = await medRecRepository.findById(clinicId, created.id);
    if (!hydrated) throw new HttpError(500, 'INTERNAL_ERROR', 'Failed to hydrate created med rec');
    return mapRow(hydrated);
  }

  // Pure helper exposed for unit tests.
  static reduceCounts = reduceCounts;
}

export const medRecService = new MedRecService();
