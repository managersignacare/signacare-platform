/**
 * Auto-Create Contact Records
 *
 * Called after every clinical activity (note saved, letter sent, message sent, etc.)
 * to create a draft ABF contact record that the clinician can complete.
 *
 * This ensures every clinical contact has an associated ABF record for funding reporting.
 */

import type { Knex } from 'knex';
import { db } from '../../db/db';
import { logger } from '../../utils/logger';

interface AutoContactParams {
  dbConn?: Knex;
  clinicId: string;
  patientId: string;
  episodeId?: string;
  staffId: string;
  sourceType: 'clinical_note' | 'correspondence' | 'message' | 'appointment' | 'group_session' | 'phone_call' | 'lai_administration';
  sourceId: string;
  contactDate?: Date;
  contactType?: string;
  durationMinutes?: number;
  briefSummary?: string;
}

/**
 * Create a draft contact record for ABF reporting.
 * Non-blocking — errors are logged but don't fail the parent operation.
 */
export async function createAutoContactRecord(params: AutoContactParams): Promise<string | null> {
  try {
    const conn = params.dbConn ?? db;
    const result = await conn.transaction(async (trx) => {
      // Serialize same-source writes to prevent duplicate contact rows when
      // multiple async paths emit the same sourceId close together.
      await trx.raw(
        'SELECT pg_advisory_xact_lock(hashtext(?))',
        [`auto_contact:${params.clinicId}:${params.sourceId}`],
      );

      // Check if a contact record already exists for this source.
      // content is a TEXT column storing JSON — cast to jsonb and extract the
      // sourceId field with a parameterised placeholder to avoid SQL injection
      // (the old LIKE approach interpolated user input into the pattern).
      const existing = await trx('contact_records')
        .where({ clinic_id: params.clinicId, patient_id: params.patientId })
        .whereRaw("content IS NOT NULL AND content != '' AND content::jsonb->>'sourceId' = ?", [params.sourceId])
        .first();
      if (existing) {
        return { id: existing.id as string, created: false as const };
      }

      // Look up episode for diagnosis/legal status
      let diagnosis: string | null = null;
      let icd10: string | null = null;
      let episodeId = params.episodeId;

      if (!episodeId) {
        // Find the most recent open episode for this patient
        const ep = await trx('episodes')
          .where({ patient_id: params.patientId, clinic_id: params.clinicId, status: 'open' })
          .whereNull('deleted_at')
          .orderBy('start_date', 'desc').first();
        if (ep) {
          episodeId = ep.id;
          diagnosis = ep.primary_diagnosis;
          icd10 = ep.icd10_code;
        }
      } else {
        const ep = await trx('episodes')
          .where({ id: episodeId, clinic_id: params.clinicId })
          .whereNull('deleted_at')
          .first();
        if (ep) { diagnosis = ep.primary_diagnosis; icd10 = ep.icd10_code; }
      }

      // Look up staff role for practitioner category
      const staff = await trx('staff')
        .where({ id: params.staffId, clinic_id: params.clinicId })
        .whereNull('deleted_at')
        .first();
      const practitionerCategory = (staff?.role as string | null | undefined) ?? null;

      // Determine contact type based on source
      const contactType = params.contactType ?? inferContactType(params.sourceType);

      // Determine duration category
      const durationCategory = params.durationMinutes
        ? inferDurationCategory(params.durationMinutes)
        : null;

      // Extended fields stored in content JSONB (columns don't exist as top-level)
      const contentMeta = {
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        durationCategory,
        practitionerCategory,
        principalDiagnosis: diagnosis,
        icd10Code: icd10,
        patientPresent: params.sourceType !== 'correspondence' && params.sourceType !== 'message',
        briefSummary: params.briefSummary ?? null,
      };
      const [record] = await trx('contact_records').insert({
        clinic_id: params.clinicId,
        patient_id: params.patientId,
        episode_id: episodeId || null,
        staff_id: params.staffId,
        contact_date: (params.contactDate ?? new Date()).toISOString().slice(0, 10),
        contact_type: contactType,
        duration_min: params.durationMinutes ?? null,
        is_reportable: params.sourceType !== 'message',
        status: 'draft',
        content: JSON.stringify(contentMeta),
      }).returning('id');

      return { id: record.id as string, created: true as const };
    });

    if (result.created) {
      logger.info({
        contactRecordId: result.id,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        patientId: params.patientId,
      }, '[ContactRecord] Auto-created draft ABF contact record');
    } else {
      logger.debug({
        contactRecordId: result.id,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        patientId: params.patientId,
      }, '[ContactRecord] Reused existing ABF contact record');
    }

    return result.id;
  } catch (err) {
    // Non-blocking — don't fail the parent operation
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, message, sourceType: params.sourceType, sourceId: params.sourceId },
      '[ContactRecord] Failed to auto-create contact record');
    return null;
  }
}

function inferContactType(sourceType: string): string {
  switch (sourceType) {
    case 'clinical_note': return 'Face to face — Individual';
    case 'correspondence': return 'Non-face-to-face — Clinical documentation';
    case 'message': return 'Non-face-to-face — Clinical documentation';
    case 'appointment': return 'Face to face — Individual';
    case 'group_session': return 'Face to face — Group';
    case 'phone_call': return 'Telephone';
    case 'lai_administration': return 'Face to face — Individual';
    default: return 'Face to face — Individual';
  }
}

function inferDurationCategory(minutes: number): string {
  if (minutes < 15) return '< 15 minutes';
  if (minutes <= 30) return '15–30 minutes';
  if (minutes <= 45) return '30–45 minutes';
  if (minutes <= 60) return '45–60 minutes';
  if (minutes <= 90) return '60–90 minutes';
  return '> 90 minutes';
}
