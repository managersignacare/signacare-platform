import { db } from '../../db/db';
import type { Knex } from 'knex';

export interface EscalationEventRow {
  id:           string;
  escalationId: string;
  actorId:      string;
  actorName:    string;
  eventType:    string;
  notes:        string | null;
  createdAt:    string;
}

export interface EscalationIsbar {
  situation:      string;
  background:     string;
  assessment:     string;
  recommendation: string;
}

export interface EscalationRow {
  id:               string;
  clinicId:         string;
  patientId:        string;
  episodeId:        string | null;
  raisedById:       string;
  raisedByName:     string;
  assignedTeam:     string;
  priority:         string;
  status:           string;
  isbar:            EscalationIsbar;
  acknowledgedAt:   string | null;
  acknowledgedById: string | null;
  resolvedAt:       string | null;
  resolvedById:     string | null;
  createdAt:        string;
  updatedAt:        string;
  // BUG-PR-R1-12-FIX-S1-escalations — opt-locking version (default 1;
  // monotonic). Multi-clinician ISBAR concurrency protection.
  lockVersion:      number;
  events:           EscalationEventRow[];
}

/**
 * Transforms flat ISBAR fields into a nested `isbar` object for the API response.
 * Works on both camelCase (from ESC_COLS aliasing) and snake_case (from raw DB rows).
 */
export function nestIsbar<T extends Record<string, unknown>>(row: T): T & { isbar: EscalationIsbar; assignedTeam: string } {
  // ISBAR may be stored as: (a) flat fields from old schema, or (b) JSON in description column
  let desc: Record<string, string> = {};
  if (row.description) {
    try { desc = typeof row.description === 'string' ? JSON.parse(row.description) : row.description as Record<string, string>; } catch { desc = {}; }
  }

  const situation      = (row.isbarSituation ?? row.situation ?? desc.situation ?? '') as string;
  const background     = (row.isbarBackground ?? row.background ?? desc.background ?? '') as string;
  const assessment     = (row.isbarAssessment ?? row.assessment ?? desc.assessment ?? '') as string;
  const recommendation = (row.isbarRecommendation ?? row.recommendation ?? desc.recommendation ?? '') as string;
  const assignedTeam   = (row.assignedTeam ?? row.assigned_team ?? desc.assignedTeam ?? '') as string;

  const {
    isbarSituation: _isbarSituation,
    isbarBackground: _isbarBackground,
    isbarAssessment: _isbarAssessment,
    isbarRecommendation: _isbarRecommendation,
    description: _description,
    ...rest
  } = row as Record<string, unknown>;
  return {
    ...rest,
    isbar: { situation, background, assessment, recommendation },
    assignedTeam,
  } as T & { isbar: EscalationIsbar; assignedTeam: string };
}

// DB schema: id, clinic_id, patient_id, episode_id, raised_by_id, assigned_to_id,
// type, severity, title, description (JSONB with ISBAR + assignedTeam), status,
// resolution, acknowledged_at, acknowledged_by_id, resolved_at, resolved_by_id
const ESC_COLS = [
  'e.id',
  'e.clinic_id              as clinicId',
  'e.patient_id             as patientId',
  'e.episode_id             as episodeId',
  'e.raised_by_id           as raisedById',
  db.raw(`concat(staff.given_name, ' ', staff.family_name) as "raisedByName"`),
  'e.description',
  'e.severity               as priority',
  'e.status',
  'e.title',
  'e.type',
  'e.acknowledged_at        as acknowledgedAt',
  'e.acknowledged_by_id     as acknowledgedById',
  'e.resolved_at            as resolvedAt',
  'e.resolved_by_id         as resolvedById',
  'e.created_at             as createdAt',
  'e.updated_at             as updatedAt',
  'e.lock_version           as lockVersion', // BUG-PR-R1-12-FIX-S1-escalations
];

async function hydrateEvents(escalations: Record<string, unknown>[]): Promise<EscalationRow[]> {
  if (escalations.length === 0) return [];
  const ids = escalations.map((e) => e.id as string);
  const rows = await db('escalation_events as ev')
    .join('staff', 'staff.id', 'ev.actor_id')
    .whereIn('ev.escalation_id', ids)
    .orderBy('ev.created_at', 'asc')
    .select([
      'ev.id',
      'ev.escalation_id    as escalationId',
      'ev.actor_id         as actorId',
      db.raw(`concat(staff.given_name, ' ', staff.family_name) as "actorName"`),
      'ev.event_type       as eventType',
      'ev.notes',
      'ev.created_at       as createdAt',
    ]);
  const byEsc = rows.reduce<Record<string, EscalationEventRow[]>>((acc, r) => {
    (acc[r.escalationId] ??= []).push(r as EscalationEventRow);
    return acc;
  }, {});
  return escalations.map((e) => ({
    ...nestIsbar(e as Record<string, unknown>),
    events: byEsc[e.id as string] ?? [],
  })) as EscalationRow[];
}

export const escalationRepository = {
  async listByPatient(
    clinicId: string,
    patientId: string,
    episodeId?: string,
  ): Promise<EscalationRow[]> {
    const q = db('escalations as e')
      .join('staff', 'staff.id', 'e.raised_by_id')
      .where({ 'e.clinic_id': clinicId, 'e.patient_id': patientId })
      .whereNull('e.deleted_at')
      .select(ESC_COLS)
      .orderBy('e.created_at', 'desc');
    if (episodeId) q.where('e.episode_id', episodeId);
    const rows = await q;
    return hydrateEvents(rows as Record<string, unknown>[]);
  },

  async findById(clinicId: string, id: string, trx?: Knex): Promise<EscalationRow | undefined> {
    const qb = trx ?? db;
    const row = await qb('escalations as e')
      .join('staff', 'staff.id', 'e.raised_by_id')
      .where({ 'e.id': id, 'e.clinic_id': clinicId })
      .whereNull('e.deleted_at')
      .select(ESC_COLS)
      .first();
    if (!row) return undefined;
    const [esc] = await hydrateEvents([row as Record<string, unknown>]);
    return esc;
  },

  async create(
    clinicId: string,
    raisedById: string,
    data: {
      patientId:           string;
      episodeId?:          string;
      assignedTeam:        string;
      priority:            string;
      isbarSituation:      string;
      isbarBackground:     string;
      isbarAssessment:     string;
      isbarRecommendation: string;
    },
  ): Promise<EscalationRow> {
    return db.transaction(async (trx) => {
      // DB schema: id, clinic_id, patient_id, episode_id, raised_by_id, assigned_to_id,
      // type, severity, title, description, status, resolution, acknowledged_at/by, resolved_at/by
      // ISBAR fields stored as JSON in description column
      const isbarJson = JSON.stringify({
        situation: data.isbarSituation,
        background: data.isbarBackground,
        assessment: data.isbarAssessment,
        recommendation: data.isbarRecommendation,
        assignedTeam: data.assignedTeam,
      });
      const [{ id }] = await trx('escalations')
        .insert({
          clinic_id:            clinicId,
          patient_id:           data.patientId,
          episode_id:           data.episodeId ?? null,
          raised_by_id:         raisedById,
          type:                 'clinical_escalation',
          severity:             data.priority ?? 'routine',
          title:                `ISBAR Escalation — ${data.assignedTeam}`,
          description:          isbarJson,
          status:               'open',
          updated_at:           trx.fn.now(),
        })
        .returning('id');
      await trx('escalation_events').insert({
        escalation_id: id,
        actor_id:      raisedById,
        event_type:    'created',
        notes:         null,
        created_at:    trx.fn.now(),
      });
      const esc = await escalationRepository.findById(clinicId, id, trx);
      if (!esc) throw new Error('Insert failed');
      return esc;
    });
  },

  async addEvent(
    clinicId: string,
    id: string,
    actorId: string,
    eventType: string,
    notes: string | null,
    statusPatch?: Record<string, unknown>,
    // BUG-PR-R1-12-FIX-S1-escalations — opt-locking expectedLockVersion.
    // When provided, the status UPDATE goes through updateWithOptimisticLock
    // and throws AppError(409, 'OPTIMISTIC_LOCK_CONFLICT') on mismatch.
    // Acknowledge path keeps legacy non-locked posture (acknowledged_at
    // idempotency guard prevents the race; BUG-371c asymmetric posture).
    expectedLockVersion?: number,
  ): Promise<EscalationRow> {
    const { updateWithOptimisticLock } = await import('../../shared/db/optimisticLock');
    return db.transaction(async (trx) => {
      if (statusPatch) {
        if (typeof expectedLockVersion === 'number') {
          await updateWithOptimisticLock<Record<string, unknown>>({
            table: 'escalations',
            where: { id, clinic_id: clinicId },
            expectedLockVersion,
            patch: statusPatch,
            returning: ['id'],
            trx,
          });
        } else {
          await trx('escalations')
            .where({ id, clinic_id: clinicId })
            .update({ ...statusPatch, updated_at: trx.fn.now() });
        }
      }
      await trx('escalation_events').insert({
        escalation_id: id,
        actor_id:      actorId,
        event_type:    eventType,
        notes:         notes ?? null,
        created_at:    trx.fn.now(),
      });
      const esc = await escalationRepository.findById(clinicId, id, trx);
      if (!esc) throw new Error('Event insert failed');
      return esc;
    });
  },

  async softDelete(clinicId: string, id: string): Promise<void> {
    await db('escalations')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update({ deleted_at: db.fn.now() });
  },
};
