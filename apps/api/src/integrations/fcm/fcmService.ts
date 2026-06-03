// apps/api/src/integrations/fcm/fcmService.ts
//
// Phase 11A — high-level FCM dispatcher. Takes a userId (staff or
// patient) and a payload, looks up every live token for that user,
// calls fcmClient.sendToTokens, prunes dead tokens, returns a
// summary.
//
// This is the module that notificationService.emit (Phase 10A) and
// patientOutreachService.writeFcmLog (Phase 12B) both call — keeping
// the decision of "which tokens to target" in one place so audience
// selection can't drift between the two call sites.
import { db } from '../../db/db';
import logger from '../../utils/logger';
import { sendToTokens, type FcmPayload, type FcmDeliveryResult } from './fcmClient';

export interface FcmDispatchSummary extends FcmDeliveryResult {
  /** Total live tokens that were targeted. */
  tokensFound: number;
}

async function pruneDeadStaffTokens(clinicId: string, deadTokens: string[]): Promise<void> {
  if (deadTokens.length === 0) return;
  await db('staff_fcm_tokens')
    .where({ clinic_id: clinicId })
    .whereIn('device_token', deadTokens)
    .update({ deleted_at: new Date() });
}

async function pruneDeadPatientTokens(clinicId: string, deadTokens: string[]): Promise<void> {
  if (deadTokens.length === 0) return;
  await db('patient_fcm_tokens')
    .where({ clinic_id: clinicId })
    .whereIn('device_token', deadTokens)
    .update({ deleted_at: new Date() });
}

/**
 * Send a notification to every live device token registered for a
 * staff member in a clinic. Dead tokens are pruned after the send.
 */
export async function sendToStaff(
  clinicId: string,
  staffId: string,
  payload: FcmPayload,
): Promise<FcmDispatchSummary> {
  const rows = await db('staff_fcm_tokens')
    .where({ clinic_id: clinicId, staff_id: staffId })
    .whereNull('deleted_at')
    .select('device_token') as { device_token: string }[];
  const tokens = rows.map((r) => r.device_token);

  const result = await sendToTokens(tokens, payload);
  if (result.errorMessage || result.failureCount > 0) {
    logger.warn(
      {
        clinicId,
        staffId,
        tokenCount: tokens.length,
        successCount: result.successCount,
        failureCount: result.failureCount,
        errorMessage: result.errorMessage ?? null,
      },
      'fcmService.sendToStaff — provider dispatch reported failure',
    );
  }
  await pruneDeadStaffTokens(clinicId, result.deadTokens);
  if (result.deadTokens.length > 0) {
    logger.info(
      { clinicId, staffId, pruned: result.deadTokens.length },
      'fcmService.sendToStaff — pruned dead device tokens',
    );
  }
  return { ...result, tokensFound: tokens.length };
}

/**
 * Send a notification to every live device token registered for a
 * patient in a clinic. Used by the patient outreach dispatcher
 * when auto-picking FCM.
 */
export async function sendToPatient(
  clinicId: string,
  patientId: string,
  payload: FcmPayload,
): Promise<FcmDispatchSummary> {
  const rows = await db('patient_fcm_tokens')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereNull('deleted_at')
    .select('device_token') as { device_token: string }[];
  const tokens = rows.map((r) => r.device_token);

  const result = await sendToTokens(tokens, payload);
  if (result.errorMessage || result.failureCount > 0) {
    logger.warn(
      {
        clinicId,
        patientId,
        tokenCount: tokens.length,
        successCount: result.successCount,
        failureCount: result.failureCount,
        errorMessage: result.errorMessage ?? null,
      },
      'fcmService.sendToPatient — provider dispatch reported failure',
    );
  }
  await pruneDeadPatientTokens(clinicId, result.deadTokens);
  if (result.deadTokens.length > 0) {
    logger.info(
      { clinicId, patientId, pruned: result.deadTokens.length },
      'fcmService.sendToPatient — pruned dead device tokens',
    );
  }
  return { ...result, tokensFound: tokens.length };
}
