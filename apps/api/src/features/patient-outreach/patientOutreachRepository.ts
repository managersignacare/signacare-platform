// apps/api/src/features/patient-outreach/patientOutreachRepository.ts
//
// Phase 12A — repository for the patient outreach dispatcher.
//
// Three data needs:
//   1. Load the patient's delivery profile: sms_consent, phone_mobile,
//      and whether they have any live FCM tokens (Phase 11A adds the
//      patient_fcm_tokens table; until then this returns false and
//      the dispatcher falls through to the ACS SMS branch).
//   2. Insert + update rows in patient_outreach_log — the durable
//      audit trail for every delivery attempt.
//   3. List the last N log rows for a patient (clinician UI panel).
//
// Every query filters clinic_id first (CLAUDE.md §1.3). The dispatcher
// writes exactly one log row per call — success, failure and skip
// all follow the same "insert a row" shape so ops can count them
// uniformly.
import { db } from '../../db/db';

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Matches PatientOutreachLogRow + real patient_outreach_log schema (no
// updated_at — table is APPEND-ONLY).
const PATIENT_OUTREACH_LOG_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'kind', 'channel', 'skip_reason',
  'provider_message_id', 'title', 'body', 'deep_link',
  'override_channel', 'override_reason', 'override_by_staff_id',
  'attempted_at', 'delivered_at', 'failed_at', 'error_message',
] as const;

// ── Row shape ──────────────────────────────────────────────────────────────

export interface PatientOutreachLogRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  kind: string;
  channel: 'fcm' | 'acs_sms' | 'skipped';
  skip_reason: string | null;
  provider_message_id: string | null;
  title: string | null;
  body: string | null;
  deep_link: string | null;
  override_channel: 'fcm' | 'acs_sms' | null;
  override_reason: string | null;
  override_by_staff_id: string | null;
  attempted_at: Date;
  delivered_at: Date | null;
  failed_at: Date | null;
  error_message: string | null;
}

export interface PatientDeliveryProfile {
  patientId: string;
  smsConsent: boolean;
  mobilePhone: string | null;
  fcmTokenCount: number;
}

// ── Repository ─────────────────────────────────────────────────────────────

export class PatientOutreachRepository {
  async loadDeliveryProfile(
    clinicId: string,
    patientId: string,
  ): Promise<PatientDeliveryProfile | null> {
    const patient = await db('patients')
      .where({ id: patientId, clinic_id: clinicId })
      .select('id', 'sms_consent', 'phone_mobile')
      .first() as { id: string; sms_consent: boolean; phone_mobile: string | null } | undefined;
    if (!patient) return null;

    // patient_fcm_tokens is a first-class baseline table (R2b Section P).
    // The pre-R2 `hasTable` guard has been removed.
    const [row] = (await db('patient_fcm_tokens')
      .where({ clinic_id: clinicId, patient_id: patientId })
      .whereNull('deleted_at')
      .count<{ count: string }[]>('* as count')) as { count: string }[];
    const fcmTokenCount = Number(row?.count ?? '0');

    return {
      patientId,
      smsConsent: Boolean(patient.sms_consent),
      mobilePhone: patient.phone_mobile,
      fcmTokenCount,
    };
  }

  async insertLog(row: Omit<PatientOutreachLogRow, 'id' | 'attempted_at' | 'delivered_at' | 'failed_at' | 'error_message'> & {
    delivered_at?: Date | null;
    failed_at?: Date | null;
    error_message?: string | null;
  }): Promise<PatientOutreachLogRow> {
    const [created] = await db<PatientOutreachLogRow>('patient_outreach_log')
      .insert({
        clinic_id: row.clinic_id,
        patient_id: row.patient_id,
        kind: row.kind,
        channel: row.channel,
        skip_reason: row.skip_reason ?? null,
        provider_message_id: row.provider_message_id ?? null,
        title: row.title ?? null,
        body: row.body ?? null,
        deep_link: row.deep_link ?? null,
        override_channel: row.override_channel ?? null,
        override_reason: row.override_reason ?? null,
        override_by_staff_id: row.override_by_staff_id ?? null,
        attempted_at: new Date(),
        delivered_at: row.delivered_at ?? null,
        failed_at: row.failed_at ?? null,
        error_message: row.error_message ?? null,
      })
      .returning(PATIENT_OUTREACH_LOG_COLUMNS) as PatientOutreachLogRow[];
    return created;
  }

  async listForPatient(
    clinicId: string,
    patientId: string,
    limit = 30,
  ): Promise<PatientOutreachLogRow[]> {
    return db<PatientOutreachLogRow>('patient_outreach_log')
      .where({ clinic_id: clinicId, patient_id: patientId })
      .orderBy('attempted_at', 'desc')
      .limit(limit);
  }
}

export const patientOutreachRepository = new PatientOutreachRepository();
