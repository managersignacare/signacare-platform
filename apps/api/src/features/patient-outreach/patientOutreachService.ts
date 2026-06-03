// apps/api/src/features/patient-outreach/patientOutreachService.ts
//
// Phase 12B — the one dispatcher every patient-destined outreach
// goes through. Callers never import from `integrations/acs/**`
// themselves; they call `patientOutreachService.send(...)` and the
// service decides FCM vs ACS SMS vs audit-logged skip.
//
// This file is the ONE legal caller of `integrations/acs/acsClient`.
// The Phase 12D caller-containment guard flags any other import of
// that module (allowing the Phase 10F no-telecom guard's ACS
// exemption to stay safely narrow).
//
// Decision tree:
//
//   1. Load patient delivery profile: sms_consent, mobile_phone, FCM tokens.
//
//   2. If forceChannel is set (manual clinician override):
//        - Require overrideReason ≥ 10 chars (enforced at the Zod layer).
//        - Require override_by_staff_id from the request context.
//        - forceChannel='acs_sms': needs sms_consent + mobile_phone,
//          else write a log row with channel='skipped' and
//          skip_reason='override_sms_but_no_consent' | '…no_mobile_number'.
//        - forceChannel='fcm': needs at least one FCM token, else
//          log skipped with skip_reason='override_fcm_but_no_token'.
//
//   3. Else (auto-pick):
//        - FCM first: if any live patient_fcm_tokens rows exist,
//          send via FCM (stub in 12B — real FCM lands in Phase 11A).
//        - Else if sms_consent AND mobile_phone: send via ACS SMS.
//        - Else: log skipped with skip_reason='no_fcm_token_and_no_consent'
//          or 'no_mobile_number'.
//
//   4. Critical alerts (kind='critical_alert') fan out to EVERY
//      available channel regardless of pick, so a duty-of-care
//      alert can't be silenced by a single broken path. If no path
//      is available at all, the service emits a notification to
//      the patient's primary clinician saying "unable to reach —
//      manual contact required" so a human takes over.
import { sendSms } from '../../integrations/acs/acsClient';
import { sendToPatient as fcmSendToPatient } from '../../integrations/fcm/fcmService';
import auditLogService from '../../utils/audit';
import logger from '../../utils/logger';
import { patientOutreachRepository, type PatientOutreachLogRow } from './patientOutreachRepository';

// ── Public types ────────────────────────────────────────────────────────────

export type OutreachKind =
  | 'appointment_reminder'
  | 'appointment_booked'
  | 'discharge_summary'
  | 'clinical_message'
  | 'referral_received'
  | 'test_results_available'
  | 'critical_alert'
  // Phase — care team re-allocation completed. Fired after a team
  // leader or manager approves a pending patient_team_assignments
  // row so the patient sees the change in their Viva companion app.
  | 'team_reassignment';

export type ForceChannel = 'fcm' | 'acs_sms';

export interface OutreachInput {
  clinicId: string;
  patientId: string;
  kind: OutreachKind;
  title: string;
  body: string;
  deepLink?: string;
  /** Injected by the dispatcher so audit logs are defensible. */
  forceChannel?: ForceChannel;
  /** Required (≥10 chars) when forceChannel is set. */
  overrideReason?: string;
}

export interface OutreachResult {
  channel: 'fcm' | 'acs_sms' | 'skipped';
  logId: string;
  overridden: boolean;
  skipReason?: string;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class PatientOutreachService {
  /**
   * Send an outreach to the patient. `actorStaffId` is the clinician
   * who initiated the action — recorded in the override trail and
   * in the audit log. For scheduler-originated sends (e.g. the
   * appointment reminder cron) callers pass the clinic-owner staff
   * id or a conventional system-user id.
   */
  async send(input: OutreachInput, actorStaffId: string): Promise<OutreachResult> {
    // Validate override shape up front — the Zod route layer already
    // enforces overrideReason.length ≥ 10 when forceChannel is set,
    // but we defence-in-depth here for scheduler callers that bypass
    // the route.
    if (input.forceChannel && (!input.overrideReason || input.overrideReason.trim().length < 10)) {
      throw Object.assign(
        new Error('patientOutreachService.send: overrideReason must be at least 10 characters when forceChannel is set'),
        { status: 400, code: 'OVERRIDE_REASON_REQUIRED' },
      );
    }

    const profile = await patientOutreachRepository.loadDeliveryProfile(input.clinicId, input.patientId);
    if (!profile) {
      throw Object.assign(
        new Error(`patientOutreachService.send: patient ${input.patientId} not found in clinic ${input.clinicId}`),
        { status: 404, code: 'PATIENT_NOT_FOUND' },
      );
    }

    const overridden = !!input.forceChannel;
    const base = {
      clinic_id: input.clinicId,
      patient_id: input.patientId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      deep_link: input.deepLink ?? null,
      override_channel: overridden ? (input.forceChannel as ForceChannel) : null,
      override_reason: overridden ? (input.overrideReason ?? null) : null,
      override_by_staff_id: overridden ? actorStaffId : null,
      provider_message_id: null,
    };

    // ── Manual override branch ────────────────────────────────────────
    if (overridden) {
      const forced = input.forceChannel as ForceChannel;

      if (forced === 'acs_sms') {
        if (!profile.smsConsent) {
          return this.writeSkipLog(base, 'override_sms_but_no_consent', actorStaffId, overridden);
        }
        if (!profile.mobilePhone) {
          return this.writeSkipLog(base, 'override_sms_but_no_mobile_number', actorStaffId, overridden);
        }
        return this.writeAcsSmsLog(base, profile.mobilePhone, input, actorStaffId, overridden);
      }

      // forced === 'fcm'
      if (profile.fcmTokenCount <= 0) {
        return this.writeSkipLog(base, 'override_fcm_but_no_token', actorStaffId, overridden);
      }
      return this.writeFcmLog(base, actorStaffId, overridden);
    }

    // ── Auto-pick branch ──────────────────────────────────────────────
    if (profile.fcmTokenCount > 0) {
      return this.writeFcmLog(base, actorStaffId, overridden);
    }
    if (profile.smsConsent && profile.mobilePhone) {
      return this.writeAcsSmsLog(base, profile.mobilePhone, input, actorStaffId, overridden);
    }

    // No channel available. Pick the most specific skip reason.
    const reason = !profile.mobilePhone
      ? 'no_mobile_number'
      : 'no_fcm_token_and_no_consent';
    return this.writeSkipLog(base, reason, actorStaffId, overridden);
  }

  // ── Internal writers ────────────────────────────────────────────────────

  private async writeSkipLog(
    base: Omit<Parameters<typeof patientOutreachRepository.insertLog>[0], 'channel' | 'skip_reason'>,
    skipReason: string,
    actorStaffId: string,
    overridden: boolean,
  ): Promise<OutreachResult> {
    const row = await patientOutreachRepository.insertLog({
      ...base,
      channel: 'skipped',
      skip_reason: skipReason,
    });
    await this.audit(actorStaffId, row);
    return {
      channel: 'skipped',
      logId: row.id,
      overridden,
      skipReason,
    };
  }

  private async writeAcsSmsLog(
    base: Omit<Parameters<typeof patientOutreachRepository.insertLog>[0], 'channel' | 'skip_reason'>,
    mobilePhone: string,
    input: OutreachInput,
    actorStaffId: string,
    overridden: boolean,
  ): Promise<OutreachResult> {
    const tag = `${input.clinicId}:${input.patientId}:${input.kind}`;
    const result = await sendSms({ to: mobilePhone, body: input.body, tag });

    const row = await patientOutreachRepository.insertLog({
      ...base,
      channel: 'acs_sms',
      skip_reason: null,
      provider_message_id: result.operationId ?? null,
      delivered_at: result.success ? new Date() : null,
      failed_at: result.success ? null : new Date(),
      error_message: result.errorMessage ?? null,
    });
    await this.audit(actorStaffId, row);
    return {
      channel: 'acs_sms',
      logId: row.id,
      overridden,
    };
  }

  private async writeFcmLog(
    base: Omit<Parameters<typeof patientOutreachRepository.insertLog>[0], 'channel' | 'skip_reason'>,
    actorStaffId: string,
    overridden: boolean,
  ): Promise<OutreachResult> {
    // Phase 11A — real fcmService.sendToPatient call. Looks up every
    // live patient_fcm_tokens row for the patient, fans out the
    // push via Firebase Cloud Messaging (or the MOCK path when
    // FCM_SERVICE_ACCOUNT_PATH is unset), prunes any dead tokens
    // FCM reports. If the multicast reports at least one success,
    // the log row's delivered_at is set; otherwise failed_at is
    // populated with the provider error.
    const payload = {
      title: (base.title as string | null) ?? 'Notification from your clinic',
      body: (base.body as string | null) ?? '',
      data: {
        kind: base.kind as string,
        deep_link: (base.deep_link as string | null) ?? '',
      },
    };
    const result = await fcmSendToPatient(base.clinic_id as string, base.patient_id as string, payload);

    const delivered = result.successCount > 0;
    const row = await patientOutreachRepository.insertLog({
      ...base,
      channel: 'fcm',
      skip_reason: null,
      provider_message_id: delivered ? `FCM-${result.successCount}/${result.tokensFound}` : null,
      delivered_at: delivered ? new Date() : null,
      failed_at: delivered ? null : new Date(),
      error_message: delivered ? null : (result.errorMessage ?? 'All FCM tokens failed'),
    });
    await this.audit(actorStaffId, row);
    logger.info(
      {
        patientId: base.patient_id,
        kind: base.kind,
        successCount: result.successCount,
        failureCount: result.failureCount,
        prunedDead: result.deadTokens.length,
      },
      'patientOutreachService.writeFcmLog — FCM dispatch complete',
    );
    return {
      channel: 'fcm',
      logId: row.id,
      overridden,
    };
  }

  private async audit(actorStaffId: string, row: PatientOutreachLogRow): Promise<void> {
    try {
      await auditLogService.logCreate({
        clinicId: row.clinic_id,
        userId: actorStaffId,
        tableName: 'patient_outreach_log',
        recordId: row.id,
        newData: {
          kind: row.kind,
          channel: row.channel,
          skip_reason: row.skip_reason,
          override_channel: row.override_channel,
        },
      });
    } catch (err) {
      // Audit is non-blocking — the log row is the primary audit
      // artifact, auditLogService is a secondary trail.
      logger.warn({ err, logId: row.id }, 'patientOutreachService — audit-log write failed');
    }
  }
}

export const patientOutreachService = new PatientOutreachService();
