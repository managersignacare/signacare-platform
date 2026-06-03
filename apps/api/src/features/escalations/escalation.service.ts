// apps/api/src/features/escalations/escalation.service.ts
//
// Audit Tier 3.2 (HIGH-D2) — service-layer AuthContext migration per
// CLAUDE.md §13. Every public method accepts AuthContext as the first
// parameter and enforces requirePatientRelationship on the patient the
// escalation belongs to. Break-glass sessions short-circuit per the
// documented guard bypass — emergency access is audited via
// break_glass_sessions separately.
import type { AuthContext } from '@signacare/shared';
import { escalationRepository } from './escalation.repository';
import type { EscalationRow } from './escalation.repository';
import { AppError } from '../../shared/errors';
import { requirePatientRelationship } from '../../shared/authGuards';
import { writeAuditLog } from '../../utils/audit';
import type {
  CreateEscalationDTO,
  UpdateEscalationDTO,
} from '@signacare/shared';

async function loadAndAuthorise(
  auth: AuthContext,
  id: string,
): Promise<EscalationRow> {
  const esc = await escalationRepository.findById(auth.clinicId, id);
  if (!esc) throw new AppError('Escalation not found', 404, 'ESCALATION_NOT_FOUND');
  await requirePatientRelationship(auth, esc.patientId);
  return esc;
}

export const escalationService = {
  async listByPatient(
    auth: AuthContext,
    patientId: string,
    episodeId?: string,
  ): Promise<EscalationRow[]> {
    await requirePatientRelationship(auth, patientId);
    return escalationRepository.listByPatient(auth.clinicId, patientId, episodeId);
  },

  async getById(auth: AuthContext, id: string): Promise<EscalationRow> {
    return loadAndAuthorise(auth, id);
  },

  async create(auth: AuthContext, dto: CreateEscalationDTO): Promise<EscalationRow> {
    await requirePatientRelationship(auth, dto.patientId);
    return escalationRepository.create(auth.clinicId, auth.staffId, {
      patientId:           dto.patientId,
      episodeId:           dto.episodeId,
      assignedTeam:        dto.assignedTeam,
      priority:            dto.priority,
      isbarSituation:      dto.isbar.situation,
      isbarBackground:     dto.isbar.background,
      isbarAssessment:     dto.isbar.assessment,
      isbarRecommendation: dto.isbar.recommendation,
    });
  },

  // BUG-NEW-ESCALATION-AUDIT-FOLLOWUP-LIFECYCLE-PARITY (2026-05-03) — emit
  // ESCALATION_UPDATE audit_log row covering admin-metadata changes
  // (assignedTeam / priority). PHI redaction: dto.notes excluded from
  // oldData/newData per audit.ts:280+303 contract.
  async update(auth: AuthContext, id: string, dto: UpdateEscalationDTO): Promise<EscalationRow> {
    const existing = await loadAndAuthorise(auth, id);
    if (['resolved', 'closed'].includes(existing.status)) {
      throw new AppError('Closed escalations cannot be updated', 409, 'ESCALATION_CLOSED');
    }

    const nextAssignedTeam = dto.assignedTeam ?? existing.assignedTeam;
    const patch: Record<string, unknown> = {};

    // Escalations persist team + ISBAR in `description` JSON (baseline
    // schema), not an `assigned_team` column.
    if (dto.assignedTeam || dto.priority) {
      patch.description = JSON.stringify({
        situation: existing.isbar.situation,
        background: existing.isbar.background,
        assessment: existing.isbar.assessment,
        recommendation: existing.isbar.recommendation,
        assignedTeam: nextAssignedTeam,
      });
      patch.title = `ISBAR Escalation — ${nextAssignedTeam}`;
    }

    // Priority is stored in `severity` in the escalations table.
    if (dto.priority) patch.severity = dto.priority;

    // Keep expectedLockVersion meaningful even when only notes change:
    // force a lock-checked no-op status write so lock_version still
    // increments and stale writers still conflict.
    if (Object.keys(patch).length === 0) {
      patch.status = existing.status;
    }

    // BUG-PR-R1-12-FIX-S1-escalations — REQUIRED expectedLockVersion routed
    // through updateWithOptimisticLock helper. ISBAR concurrency protection.
    const result = await escalationRepository.addEvent(
      auth.clinicId, id, auth.staffId, 'updated', dto.notes ?? null, patch,
      dto.expectedLockVersion,
    );
    await writeAuditLog({
      clinicId: auth.clinicId, userId: auth.staffId, action: 'ESCALATION_UPDATE',
      tableName: 'escalations', recordId: id,
      oldData: { assignedTeam: existing.assignedTeam, priority: existing.priority, lockVersion: existing.lockVersion, patientId: existing.patientId, episodeId: existing.episodeId },
      newData: { assignedTeam: result.assignedTeam, priority: result.priority, lockVersion: result.lockVersion, patientId: result.patientId, episodeId: result.episodeId },
    });
    return result;
  },

  // BUG-NEW-ESCALATION-AUDIT-FOLLOWUP-LIFECYCLE-PARITY (2026-05-03) — emit
  // ESCALATION_ACKNOWLEDGE audit_log row capturing first-touch transition
  // (status open → in_progress + acknowledged_at + acknowledged_by_id).
  // No PHI involved (no notes parameter on this method).
  async acknowledge(auth: AuthContext, id: string): Promise<EscalationRow> {
    const existing = await loadAndAuthorise(auth, id);
    if (existing.acknowledgedAt) throw new AppError('Already acknowledged', 409, 'ESCALATION_ALREADY_ACKNOWLEDGED');
    const result = await escalationRepository.addEvent(
      auth.clinicId, id, auth.staffId, 'acknowledged', null,
      { status: 'in_progress', acknowledged_at: new Date().toISOString(), acknowledged_by_id: auth.staffId },
    );
    await writeAuditLog({
      clinicId: auth.clinicId, userId: auth.staffId, action: 'ESCALATION_ACKNOWLEDGE',
      tableName: 'escalations', recordId: id,
      oldData: { status: existing.status, acknowledgedAt: existing.acknowledgedAt, acknowledgedById: existing.acknowledgedById, patientId: existing.patientId, episodeId: existing.episodeId },
      newData: { status: result.status, acknowledgedAt: result.acknowledgedAt, acknowledgedById: result.acknowledgedById, patientId: result.patientId, episodeId: result.episodeId },
    });
    return result;
  },

  // BUG-PR-R1-12-FIX-S1-escalations — REQUIRED expectedLockVersion on resolve.
  // BUG-NEW-ESCALATION-AUDIT (2026-05-03) — emit ESCALATION_RESOLVE audit_log
  // row with structural pre-image + post-image. PHI redaction: `notes`
  // parameter (clinician free-text) is NOT included in audit oldData/newData
  // per audit.ts:280+303 contract — the note content is persisted to the
  // mutable escalation_events.notes column instead.
  async resolve(auth: AuthContext, id: string, notes: string, expectedLockVersion: number): Promise<EscalationRow> {
    const existing = await loadAndAuthorise(auth, id);
    if (existing.status === 'resolved' || existing.status === 'closed') {
      throw new AppError('Escalation already resolved', 409, 'ESCALATION_ALREADY_RESOLVED');
    }
    const result = await escalationRepository.addEvent(
      auth.clinicId, id, auth.staffId, 'resolved', notes,
      { status: 'resolved', resolved_at: new Date().toISOString(), resolved_by_id: auth.staffId },
      expectedLockVersion,
    );
    await writeAuditLog({
      clinicId: auth.clinicId, userId: auth.staffId, action: 'ESCALATION_RESOLVE',
      tableName: 'escalations', recordId: id,
      oldData: { status: existing.status, lockVersion: existing.lockVersion, patientId: existing.patientId, episodeId: existing.episodeId },
      newData: { status: result.status, lockVersion: result.lockVersion, resolvedAt: result.resolvedAt, resolvedById: result.resolvedById, patientId: result.patientId, episodeId: result.episodeId },
    });
    return result;
  },

  // BUG-PR-R1-12-FIX-S1-escalations — addNote triggers no statusPatch but
  // accepts expectedLockVersion for symmetry; only used by routes that
  // pass it through. The repository's addEvent treats statusPatch=undefined
  // as a no-op for the optimistic-lock predicate.
  // BUG-NEW-ESCALATION-AUDIT (2026-05-03) — emit ESCALATION_NOTE_ADDED
  // audit_log row. Status unchanged; oldData/newData carry eventCount
  // delta as structural marker. `notes` clinician free-text excluded
  // per audit.ts:280+303 contract; preserved in escalation_events.notes.
  async addNote(auth: AuthContext, id: string, notes: string, expectedLockVersion?: number): Promise<EscalationRow> {
    const existing = await loadAndAuthorise(auth, id);
    const result = await escalationRepository.addEvent(auth.clinicId, id, auth.staffId, 'note_added', notes, undefined, expectedLockVersion);
    await writeAuditLog({
      clinicId: auth.clinicId, userId: auth.staffId, action: 'ESCALATION_NOTE_ADDED',
      tableName: 'escalations', recordId: id,
      oldData: { status: existing.status, eventCount: existing.events.length, patientId: existing.patientId, episodeId: existing.episodeId },
      newData: { status: result.status, eventCount: result.events.length, eventType: 'note_added', patientId: result.patientId, episodeId: result.episodeId },
    });
    return result;
  },

  async softDelete(auth: AuthContext, id: string): Promise<void> {
    await loadAndAuthorise(auth, id);
    await escalationRepository.softDelete(auth.clinicId, id);
  },
};
