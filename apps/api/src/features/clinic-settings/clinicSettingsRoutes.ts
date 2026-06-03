// apps/api/src/features/clinic-settings/clinicSettingsRoutes.ts
//
// Audit Tier 4.3 — per-clinic settings router. Starts with the
// scribe_consent_mode toggle; future tiers (5.3 ai_chat_classifier_mode,
// 5.13 scribe_audio_retention, 16.9 letterhead config, etc.) will add
// GET/PATCH pairs to this file.
//
// Read is allowed for all authenticated roles (non-admin clinicians
// need to know the configured scribe consent mode to render the
// correct dialog). Write is admin/superadmin only.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import { writeAuditLog } from '../../utils/audit';
import { AppError } from '../../shared/errors';

const router = Router();
router.use(authMiddleware);

const EmailSenderModeSchema = z.enum(['staff_delegated', 'clinic_mailbox']);

const ClinicSettingsUpdateSchema = z.object({
  scribeConsentMode: z.enum(['patient_esignature', 'clinician_attestation']).optional(),
  aiChatClassifierMode: z.enum(['regex_keyword', 'local_llm']).optional(),
  scribeAudioRetention: z.enum(['immediate_delete', '24h', '7d', '30d', '90d']).optional(),
  emailSenderMode: EmailSenderModeSchema.optional(),
  clinicSenderEmail: z.union([z.string().trim().email().max(255), z.null()]).optional(),
  clinicSenderName: z.union([z.string().trim().min(1).max(120), z.null()]).optional(),
});

function normalizeNullableString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// GET /api/v1/clinic-settings
// Returns the current row for this clinic. If no row exists yet (the
// clinic hasn't hit the onboarding flow), returns the defaults so the
// UI can always render something meaningful.
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await db('clinic_settings')
      .where({ clinic_id: req.clinicId })
      .first();
    if (!row) {
      res.json({
        clinicId: req.clinicId,
        scribeConsentMode: 'clinician_attestation',
        aiChatClassifierMode: 'regex_keyword',
        scribeAudioRetention: 'immediate_delete',
        emailSenderMode: 'staff_delegated',
        clinicSenderEmail: null,
        clinicSenderName: null,
      });
      return;
    }
    res.json({
      clinicId: row.clinic_id,
      scribeConsentMode: row.scribe_consent_mode,
      aiChatClassifierMode: row.ai_chat_classifier_mode,
      scribeAudioRetention: row.scribe_audio_retention,
      emailSenderMode: row.email_sender_mode ?? 'staff_delegated',
      clinicSenderEmail: row.clinic_sender_email ?? null,
      clinicSenderName: row.clinic_sender_name ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (err) { next(err); }
});

// PATCH /api/v1/clinic-settings
// Upsert-style — creates the row on first write, updates in-place
// thereafter. Restricted to admin/superadmin.
router.patch(
  '/',
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ClinicSettingsUpdateSchema.parse(req.body);
      const existing = await db('clinic_settings')
        .where({ clinic_id: req.clinicId })
        .first();
      const clinicSenderEmail = normalizeNullableString(dto.clinicSenderEmail);
      const clinicSenderName = normalizeNullableString(dto.clinicSenderName);
      const effectiveMode =
        dto.emailSenderMode
        ?? existing?.email_sender_mode
        ?? 'staff_delegated';
      const effectiveSenderEmail =
        clinicSenderEmail !== undefined
          ? clinicSenderEmail
          : normalizeNullableString(existing?.clinic_sender_email);
      if (effectiveMode === 'clinic_mailbox' && !effectiveSenderEmail) {
        throw new AppError(
          'clinicSenderEmail is required when emailSenderMode is clinic_mailbox',
          422,
          'VALIDATION_ERROR',
        );
      }
      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (dto.scribeConsentMode !== undefined) patch.scribe_consent_mode = dto.scribeConsentMode;
      if (dto.aiChatClassifierMode !== undefined) patch.ai_chat_classifier_mode = dto.aiChatClassifierMode;
      if (dto.scribeAudioRetention !== undefined) patch.scribe_audio_retention = dto.scribeAudioRetention;
      if (dto.emailSenderMode !== undefined) patch.email_sender_mode = dto.emailSenderMode;
      if (dto.clinicSenderEmail !== undefined) patch.clinic_sender_email = clinicSenderEmail;
      if (dto.clinicSenderName !== undefined) patch.clinic_sender_name = clinicSenderName;
      if (existing) {
        await db('clinic_settings').where({ clinic_id: req.clinicId }).update(patch);
      } else {
        await db('clinic_settings').insert({
          clinic_id: req.clinicId,
          scribe_consent_mode: dto.scribeConsentMode ?? 'clinician_attestation',
          ai_chat_classifier_mode: dto.aiChatClassifierMode ?? 'regex_keyword',
          scribe_audio_retention: dto.scribeAudioRetention ?? 'immediate_delete',
          email_sender_mode: dto.emailSenderMode ?? 'staff_delegated',
          clinic_sender_email: clinicSenderEmail ?? null,
          clinic_sender_name: clinicSenderName ?? null,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
      const row = await db('clinic_settings').where({ clinic_id: req.clinicId }).first();
      // BUG-411 (2026-05-03) — forensic audit trail for clinic_settings
      // mutations. Pre-fix: two-rail "WHO" was logged (auth middleware)
      // but "WHAT was changed" was not — config drift across audit
      // reviews could not reconstruct the timeline. Now every UPDATE
      // (and first-write INSERT) writes an audit_log row with the
      // pre-image (existing) + post-image (row) so the diff is
      // machine-recoverable.
      await writeAuditLog({
        clinicId: req.clinicId as string,
        userId: req.user!.id,
        action: 'CLINIC_SETTINGS_UPDATE',
        tableName: 'clinic_settings',
        recordId: (row?.id as string) ?? (req.clinicId as string),
        oldData: existing
          ? {
              scribe_consent_mode: existing.scribe_consent_mode,
              ai_chat_classifier_mode: existing.ai_chat_classifier_mode,
              scribe_audio_retention: existing.scribe_audio_retention,
              email_sender_mode: existing.email_sender_mode ?? 'staff_delegated',
              clinic_sender_email: existing.clinic_sender_email ?? null,
              clinic_sender_name: existing.clinic_sender_name ?? null,
            }
          : null,
        newData: {
          scribe_consent_mode: row?.scribe_consent_mode,
          ai_chat_classifier_mode: row?.ai_chat_classifier_mode,
          scribe_audio_retention: row?.scribe_audio_retention,
          email_sender_mode: row?.email_sender_mode ?? 'staff_delegated',
          clinic_sender_email: row?.clinic_sender_email ?? null,
          clinic_sender_name: row?.clinic_sender_name ?? null,
        },
      });
      res.json({
        clinicId: row!.clinic_id,
        scribeConsentMode: row!.scribe_consent_mode,
        aiChatClassifierMode: row!.ai_chat_classifier_mode,
        scribeAudioRetention: row!.scribe_audio_retention,
        emailSenderMode: row!.email_sender_mode ?? 'staff_delegated',
        clinicSenderEmail: row!.clinic_sender_email ?? null,
        clinicSenderName: row!.clinic_sender_name ?? null,
        createdAt: row!.created_at,
        updatedAt: row!.updated_at,
      });
    } catch (err) { next(err); }
  },
);

export default router;
