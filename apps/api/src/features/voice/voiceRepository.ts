// apps/api/src/features/voice/voiceRepository.ts
import { randomUUID } from 'crypto';
import { db } from '../../db/db';
// Phase 0b.2c-batch-7a (2026-05-06): drain 2 standard singular→plural
// hand-written column constants to migration-driven SSoT per Phase 0b.2
// plan + CLAUDE.md §15.
//
// permanent: alias re-exports IS the end-state per Phase 0b.2 DoD.
// Migration-driven SSoT auto-propagates forward when migrations land.
// Zero external consumers per grep — module-private `const`.
//
// Batch-7a scope: 2 standard singular→plural aliases ONLY:
//   VOICE_CALL_COLUMNS   = VOICE_CALLS_COLUMNS
//   VOICE_SCRIPT_COLUMNS = VOICE_SCRIPTS_COLUMNS
//
// Held for batch-7b (operator-authorized split 2026-05-06):
// VOICE_PREFERENCE_COLUMNS remains hand-written. Generated equivalent
// is VOICE_PATIENT_PREFERENCES_COLUMNS — would be a NAME-SHORTENING
// alias (drops `_PATIENT_` from middle of full table name). Adding it
// pre-guard would expand the very surface BUG-PHASE-0B-COLUMN-CONSTANT-
// NAMING-GUARD is meant to contain. Ships when the naming guard +
// `@column-alias-exempt` annotation mechanism is in place, OR with
// fresh explicit operator authorization. Memory:
// `feedback_no_authorization_token_expansion.md`.
import { VOICE_CALLS_COLUMNS } from '../../db/types/voice_calls';
import { VOICE_SCRIPTS_COLUMNS } from '../../db/types/voice_scripts';

// ── Row types (DB snake_case) ─────────────────────────────────────────────────

export interface VoiceCallRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  script_id: string | null;
  initiated_by_id: string | null;
  direction: string;
  status: string;
  phone_number_masked: string | null;
  duration_seconds: number | null;
  started_at: string | null;
  ended_at: string | null;
  call_sid: string | null;
  transcript_available: boolean;
  transcript_s3_key: string | null;
  outcome: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// Mirrors `voice_scripts` exactly. Phase 0.7.5 c24 C11 (SD28) — the
// interface previously declared `deleted_at` but the table has no such
// column. Queries that filtered `.whereNull('deleted_at')` crashed at
// runtime. Voice scripts are admin-only config and don't need soft-
// delete; the filter is removed from the repo below.
export interface VoiceScriptRow {
  id: string;
  clinic_id: string;
  name: string;
  description: string | null;
  script_type: string;
  version: number;
  content: string;
  is_active: boolean;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoicePreferenceRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  opted_out: boolean;
  opted_out_at: string | null;
  opt_out_channel: string | null;
  preferred_call_start: string | null;
  preferred_call_end: string | null;
  preferred_call_time: string | null;
  preferred_days: string[] | null;
  preferred_call_days: string[] | null;
  created_at: string;
  updated_at: string;
}

// Phase 0.7.5 c24 D2 — explicit column lists matching the Row interfaces
// above. Knex types .returning(array) as Partial<T>[] even when the array
// is complete, so each call casts to T[] to preserve the declared return
// type.
const VOICE_CALL_COLUMNS = VOICE_CALLS_COLUMNS;

const VOICE_SCRIPT_COLUMNS = VOICE_SCRIPTS_COLUMNS;

// VOICE_PREFERENCE_COLUMNS held for batch-7b (name-shortening alias —
// VOICE_PATIENT_PREFERENCES_COLUMNS drops `_PATIENT_`); see file-level
// header for split-batch rationale.
const VOICE_PREFERENCE_COLUMNS = [
  'id',
  'clinic_id',
  'patient_id',
  'opted_out',
  'opted_out_at',
  'opt_out_channel',
  'preferred_call_start',
  'preferred_call_end',
  'preferred_call_time',
  'preferred_days',
  'preferred_call_days',
  'created_at',
  'updated_at',
] as const;

// ── Voice Calls ───────────────────────────────────────────────────────────────

export async function insertCall(
  data: Omit<VoiceCallRow, 'created_at' | 'updated_at' | 'deleted_at'>,
): Promise<VoiceCallRow> {
  const rows = await db('voice_calls')
    .insert({ ...data, created_at: new Date(), updated_at: new Date() })
    .returning(VOICE_CALL_COLUMNS) as VoiceCallRow[];
  return rows[0];
}

export async function findCallById(
  clinicId: string,
  id: string,
): Promise<VoiceCallRow | undefined> {
  return db('voice_calls')
    .where({ id, clinic_id: clinicId })
    .whereNull('deleted_at')
    .first();
}

export async function listCallsForPatient(
  clinicId: string,
  patientId: string,
  limit = 50,
  offset = 0,
): Promise<VoiceCallRow[]> {
  return db('voice_calls')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);
}

export async function updateCall(
  clinicId: string,
  id: string,
  patch: Partial<VoiceCallRow>,
): Promise<VoiceCallRow | undefined> {
  const rows = await db('voice_calls')
    .where({ id, clinic_id: clinicId })
    .whereNull('deleted_at')
    .update({ ...patch, updated_at: new Date() })
    .returning(VOICE_CALL_COLUMNS) as VoiceCallRow[];
  return rows[0];
}

export async function softDeleteCall(clinicId: string, id: string): Promise<void> {
  await db('voice_calls')
    .where({ id, clinic_id: clinicId })
    .whereNull('deleted_at')
    .update({ deleted_at: new Date(), updated_at: new Date() });
}

// ── Voice Scripts ─────────────────────────────────────────────────────────────

export async function insertScript(
  data: Omit<VoiceScriptRow, 'id' | 'created_at' | 'updated_at'>,
): Promise<VoiceScriptRow> {
  const rows = await db('voice_scripts')
    .insert({ id: randomUUID(), ...data, created_at: new Date(), updated_at: new Date() })
    .returning(VOICE_SCRIPT_COLUMNS) as VoiceScriptRow[];
  return rows[0];
}

export async function listScripts(
  clinicId: string,
  activeOnly = true,
): Promise<VoiceScriptRow[]> {
  // Phase 0.7.5 c24 C11 (SD28) — no `deleted_at` on voice_scripts.
  // Scripts are removed by setting is_active=false, not by soft-delete.
  const q = db('voice_scripts')
    .where({ clinic_id: clinicId })
    .orderBy('name', 'asc');
  if (activeOnly) q.where('is_active', true);
  return q;
}

export async function findScriptById(
  clinicId: string,
  id: string,
): Promise<VoiceScriptRow | undefined> {
  return db('voice_scripts')
    .where({ id, clinic_id: clinicId })
    .first();
}

export async function bumpScriptVersion(
  clinicId: string,
  id: string,
  content: string,
): Promise<VoiceScriptRow | undefined> {
  const rows = await db('voice_scripts')
    .where({ id, clinic_id: clinicId })
    .update({
      content,
      version: db.raw('version + 1'),
      updated_at: new Date(),
    })
    .returning(VOICE_SCRIPT_COLUMNS) as VoiceScriptRow[];
  return rows[0];
}

// ── Patient Preferences ───────────────────────────────────────────────────────

export async function upsertPreferences(
  clinicId: string,
  patientId: string,
  patch: Partial<Omit<VoicePreferenceRow, 'id' | 'clinic_id' | 'patient_id' | 'created_at'>>,
): Promise<VoicePreferenceRow> {
  const existing = await db('voice_patient_preferences')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .first<VoicePreferenceRow>();

  if (existing) {
    const rows = await db('voice_patient_preferences')
      .where({ clinic_id: clinicId, patient_id: patientId })
      .update({ ...patch, updated_at: new Date() })
      .returning(VOICE_PREFERENCE_COLUMNS) as VoicePreferenceRow[];
    return rows[0];
  }

  const rows = await db('voice_patient_preferences')
    .insert({
      id: randomUUID(),
      clinic_id: clinicId,
      patient_id: patientId,
      opted_out: false,
      ...patch,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returning(VOICE_PREFERENCE_COLUMNS) as VoicePreferenceRow[];
  return rows[0];
}

export async function findPreferences(
  clinicId: string,
  patientId: string,
): Promise<VoicePreferenceRow | undefined> {
  return db('voice_patient_preferences')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .first();
}
