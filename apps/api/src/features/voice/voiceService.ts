// apps/api/src/features/voice/voiceService.ts
import { randomUUID } from 'crypto';
import { AppError } from '../../shared/errors';
import type {
  VoiceCallCreateDTO,
  VoiceCallUpdateDTO,
  VoiceCallResponse,
  VoiceScriptCreateDTO,
  VoiceScriptResponse,
  VoicePatientPreferencesDTO,
  VoicePatientPreferencesResponse,
} from '@signacare/shared';
import * as repo from './voiceRepository';
import type {
  VoiceCallRow,
  VoiceScriptRow,
  VoicePreferenceRow,
} from './voiceRepository';

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapCall(r: VoiceCallRow): VoiceCallResponse {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    patientId: r.patient_id,
    episodeId: r.episode_id,
    scriptId: r.script_id,
    initiatedById: r.initiated_by_id,
    direction: r.direction as 'inbound' | 'outbound',
    status: r.status,
    phoneNumberMasked: r.phone_number_masked,
    durationSeconds: r.duration_seconds,
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
    callSid: r.call_sid,
    transcriptAvailable: r.transcript_available,
    outcome: r.outcome,
    notes: r.notes,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function mapScript(r: VoiceScriptRow): VoiceScriptResponse {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    name: r.name,
    description: r.description,
    scriptType: r.script_type,
    version: r.version,
    content: r.content,
    isActive: r.is_active,
    createdById: r.created_by_id,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function mapPrefs(r: VoicePreferenceRow): VoicePatientPreferencesResponse {
  const days = r.preferred_days ?? r.preferred_call_days;
  return {
    id: r.id,
    clinicId: r.clinic_id,
    patientId: r.patient_id,
    optedOut: r.opted_out,
    optedOutAt: r.opted_out_at,
    preferredCallStart: r.preferred_call_start ?? r.preferred_call_time ?? undefined,
    preferredCallEnd: r.preferred_call_end ?? undefined,
    preferredDays: days ? days.map(Number) : undefined,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

// ── Call operations ───────────────────────────────────────────────────────────

export async function logCall(
  clinicId: string,
  initiatedById: string,
  dto: VoiceCallCreateDTO,
): Promise<VoiceCallResponse> {
  const prefs = await repo.findPreferences(clinicId, dto.patientId);
  if (prefs?.opted_out && dto.direction === 'outbound') {
    throw Object.assign(
      new Error('Patient has opted out of outbound voice calls.'),
      { status: 422, code: 'PATIENT_OPTED_OUT' },
    );
  }

  const row = await repo.insertCall({
    id: randomUUID(),
    clinic_id: clinicId,
    patient_id: dto.patientId,
    episode_id: dto.episodeId ?? null,
    script_id: dto.scriptId ?? null,
    initiated_by_id: initiatedById,
    direction: dto.direction,
    status: 'initiated',
    phone_number_masked: null,
    duration_seconds: null,
    started_at: null,
    ended_at: null,
    call_sid: null,
    transcript_available: false,
    transcript_s3_key: null,
    outcome: null,
    notes: dto.notes ?? null,
  });
  return mapCall(row);
}

export async function updateCall(
  clinicId: string,
  callId: string,
  dto: VoiceCallUpdateDTO,
): Promise<VoiceCallResponse> {
  const patch: Partial<VoiceCallRow> = {};
  if (dto.status !== undefined) patch.status = dto.status;
  if (dto.durationSeconds !== undefined)
    patch.duration_seconds = dto.durationSeconds;
  if (dto.startedAt !== undefined) patch.started_at = dto.startedAt;
  if (dto.endedAt !== undefined) patch.ended_at = dto.endedAt;
  if (dto.callSid !== undefined) patch.call_sid = dto.callSid;
  if (dto.transcriptAvailable !== undefined)
    patch.transcript_available = dto.transcriptAvailable;
  if (dto.transcriptS3Key !== undefined)
    patch.transcript_s3_key = dto.transcriptS3Key;
  if (dto.outcome !== undefined) patch.outcome = dto.outcome;
  if (dto.notes !== undefined) patch.notes = dto.notes;

  const updated = await repo.updateCall(clinicId, callId, patch);
  if (!updated) {
    throw new AppError('Voice call not found', 404, 'NOT_FOUND');
  }
  return mapCall(updated);
}

export async function listCallsForPatient(
  clinicId: string,
  patientId: string,
  limit = 50,
  offset = 0,
): Promise<VoiceCallResponse[]> {
  const rows = await repo.listCallsForPatient(
    clinicId,
    patientId,
    limit,
    offset,
  );
  return rows.map(mapCall);
}

export async function getCallDetails(
  clinicId: string,
  callId: string,
): Promise<VoiceCallResponse> {
  const row = await repo.findCallById(clinicId, callId);
  if (!row) {
    throw new AppError('Voice call not found', 404, 'NOT_FOUND');
  }
  return mapCall(row);
}

// ── Script operations ─────────────────────────────────────────────────────────

export async function createScript(
  clinicId: string,
  createdById: string,
  dto: VoiceScriptCreateDTO,
): Promise<VoiceScriptResponse> {
  const row = await repo.insertScript({
    clinic_id: clinicId,
    name: dto.name,
    description: dto.description ?? null,
    script_type: dto.scriptType,
    version: 1,
    content: dto.content,
    is_active: dto.isActive,
    created_by_id: createdById,
  });
  return mapScript(row);
}

export async function listScripts(
  clinicId: string,
): Promise<VoiceScriptResponse[]> {
  const rows = await repo.listScripts(clinicId);
  return rows.map(mapScript);
}

export async function updateScriptContent(
  clinicId: string,
  scriptId: string,
  content: string,
): Promise<VoiceScriptResponse> {
  const updated = await repo.bumpScriptVersion(clinicId, scriptId, content);
  if (!updated) {
    throw new AppError('Script not found', 404, 'NOT_FOUND');
  }
  return mapScript(updated);
}

// ── Patient preferences ───────────────────────────────────────────────────────

export async function setPatientPreferences(
  clinicId: string,
  patientId: string,
  dto: VoicePatientPreferencesDTO,
): Promise<VoicePatientPreferencesResponse> {
  const patch: Parameters<typeof repo.upsertPreferences>[2] = {
    opted_out: dto.optedOut,
    preferred_call_time: dto.preferredCallStart ?? null,
    preferred_call_days: dto.preferredDays?.map(String) ?? null,
  };
  const row = await repo.upsertPreferences(clinicId, patientId, patch);
  return mapPrefs(row);
}

export async function getPatientPreferences(
  clinicId: string,
  patientId: string,
): Promise<VoicePatientPreferencesResponse | null> {
  const row = await repo.findPreferences(clinicId, patientId);
  return row ? mapPrefs(row) : null;
}
