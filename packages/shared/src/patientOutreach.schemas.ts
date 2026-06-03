// packages/shared/src/patientOutreach.schemas.ts
//
// Phase 12 — shared DTOs for the patient outreach dispatcher.
//
// Zod schemas used by the backend routes AND by the web app's
// consent panel in Phase 12E. Central location so frontend and
// backend can't drift on the override validation rule.
import { z } from 'zod';

export const OutreachKindEnum = z.enum([
  'appointment_reminder',
  'appointment_booked',
  'discharge_summary',
  'clinical_message',
  'referral_received',
  'test_results_available',
  'critical_alert',
]);
export type OutreachKind = z.infer<typeof OutreachKindEnum>;

export const OutreachChannelEnum = z.enum(['fcm', 'acs_sms', 'skipped']);
export type OutreachChannel = z.infer<typeof OutreachChannelEnum>;

export const ForceChannelEnum = z.enum(['fcm', 'acs_sms']);
export type ForceChannel = z.infer<typeof ForceChannelEnum>;

/**
 * Manual-send payload used by the clinician UI "Send Patient Message"
 * dialog. The route layer validates this then hands it to
 * patientOutreachService.send, which re-validates defensively.
 *
 * The refinement enforces "if you set forceChannel, you must supply
 * an overrideReason ≥ 10 characters" — the audit defensibility rule.
 */
export const SendOutreachSchema = z
  .object({
    patientId: z.string().uuid(),
    kind: OutreachKindEnum,
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(4000),
    deepLink: z.string().max(500).optional(),
    forceChannel: ForceChannelEnum.optional(),
    overrideReason: z.string().max(2000).optional(),
  })
  .refine(
    (v) => !v.forceChannel || (typeof v.overrideReason === 'string' && v.overrideReason.trim().length >= 10),
    {
      message: 'overrideReason is required (≥10 characters) when forceChannel is set',
      path: ['overrideReason'],
    },
  );
export type SendOutreachDTO = z.infer<typeof SendOutreachSchema>;

/**
 * Clinician sets or revokes the patient's SMS consent. The consent
 * audit trail (who / when / why) is captured by the backend from
 * the request context; only the new state + optional reason cross
 * the wire.
 */
export const SetSmsConsentSchema = z.object({
  consent: z.boolean(),
  mobilePhone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'mobile phone must be E.164 (e.g. +61400000000)').optional(),
  reason: z.string().max(500).optional(),
});
export type SetSmsConsentDTO = z.infer<typeof SetSmsConsentSchema>;

export const OutreachLogResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  kind: z.string(),
  channel: OutreachChannelEnum,
  skipReason: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  deepLink: z.string().nullable(),
  overrideChannel: ForceChannelEnum.nullable(),
  overrideReason: z.string().nullable(),
  overrideByStaffId: z.string().uuid().nullable(),
  overrideByStaffName: z.string().nullable().optional(),
  attemptedAt: z.string(),
  deliveredAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type OutreachLogResponse = z.infer<typeof OutreachLogResponseSchema>;

export const PatientDeliveryProfileResponseSchema = z.object({
  patientId: z.string().uuid(),
  smsConsent: z.boolean(),
  smsConsentUpdatedAt: z.string().nullable(),
  smsConsentUpdatedByStaffId: z.string().uuid().nullable(),
  mobilePhone: z.string().nullable(),
  hasVivaApp: z.boolean(),
  activeFcmDeviceCount: z.number().int().nonnegative(),
});
export type PatientDeliveryProfileResponse = z.infer<typeof PatientDeliveryProfileResponseSchema>;
