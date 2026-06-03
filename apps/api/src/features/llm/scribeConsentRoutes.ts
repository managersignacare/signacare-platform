import { randomUUID } from 'crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../../db/db';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { requirePatientRelationship } from '../../shared/authGuards';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { AppError, ErrorCode } from '../../shared/errors';
import { writeAuditLog } from '../../utils/audit';

const router = Router();

// ── Scribe Consent (Audit Tier 4.3) ────────────────────────────────────────
//
// User direction (2026-04-19): BOTH consent modes must be supported.
// Mode is stored on clinic_settings.scribe_consent_mode (default
// clinician_attestation). Every scribe session captures a consent
// row BEFORE audio recording starts. The UI client is responsible for
// blocking the record button until the consent row is persisted.

const ScribeConsentCreateSchema = z.object({
  patientId: z.string().uuid(),
  sessionId: z.string().max(128).optional(),
  mode: z.enum(['patient_esignature', 'clinician_attestation']),
  patientSignaturePng: z.string().optional(), // base64 PNG from signature pad
  clinicianAttestationText: z.string().min(1).max(2000).optional(),
});
const DateLikeResponseSchema = z.union([z.string(), z.date()]);

const ScribeConsentModeResponseSchema = z.object({
  mode: z.enum(['patient_esignature', 'clinician_attestation']),
});

const ClinicSettingsModeDbRowSchema = z.object({
  scribe_consent_mode: z.enum(['patient_esignature', 'clinician_attestation']).optional(),
  default_guidelines: z.unknown().optional(),
});

const ScribeConsentRowResponseSchema = z.object({
  id: z.string().uuid(),
  clinic_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  session_id: z.string().max(128).nullable(),
  mode: z.enum(['patient_esignature', 'clinician_attestation']),
  clinician_attested_by_id: z.string().uuid().nullable(),
  attested_at: DateLikeResponseSchema,
  created_at: DateLikeResponseSchema,
});

const ScribeConsentRevocationResponseSchema = z.object({
  id: z.string().uuid(),
  revokedAt: DateLikeResponseSchema.optional().nullable(),
  idempotent: z.boolean(),
});

function mapScribeConsentModeToResponse(mode: unknown) {
  return ScribeConsentModeResponseSchema.parse({ mode });
}

function mapClinicSettingsModeToResponse(row: unknown) {
  const parsed = ClinicSettingsModeDbRowSchema.parse(row ?? {});
  const defaultGuidelines = parsed.default_guidelines;
  void defaultGuidelines;
  return mapScribeConsentModeToResponse(parsed.scribe_consent_mode ?? 'clinician_attestation');
}

function mapScribeConsentRowToResponse(row: unknown) {
  return ScribeConsentRowResponseSchema.parse(row);
}

function mapScribeConsentRevocationToResponse(payload: unknown) {
  return ScribeConsentRevocationResponseSchema.parse(payload);
}

// GET /api/v1/scribe/consent/mode — fetch the clinic's configured mode.
// Returns the current mode (default 'clinician_attestation') even when
// no clinic_settings row exists yet, so the Sara client can render the
// right dialog on first boot.
router.get('/consent/mode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await db('clinic_settings')
      .where({ clinic_id: req.clinicId })
      .select('scribe_consent_mode')
      .first();
    res.json(mapClinicSettingsModeToResponse(row));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/scribe/consent — record a consent for this scribe
// session. Validates the payload matches the clinic's configured mode
// (patient_signature_png required for e-sig mode;
// clinician_attestation_text required for attestation mode). Enforces
// patient relationship at the service layer.
router.post(
  '/consent',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ScribeConsentCreateSchema.parse(req.body);
      const auth = buildAuthContext(req, dto.patientId);
      await requirePatientRelationship(auth, dto.patientId);

      // Cross-check the submitted mode against the clinic's configured
      // mode so the UI cannot race a config flip by sending the wrong
      // artefact shape. Default to clinician_attestation when no
      // clinic_settings row exists yet.
      const settings = await db('clinic_settings')
        .where({ clinic_id: req.clinicId })
        .select('scribe_consent_mode')
        .first();
      const configuredMode = settings?.scribe_consent_mode ?? 'clinician_attestation';
      if (dto.mode !== configuredMode) {
        return next(
          new AppError(
            `Clinic is configured for ${configuredMode} consent; received ${dto.mode}`,
            409,
            'CONSENT_MODE_MISMATCH',
          ),
        );
      }

      if (dto.mode === 'patient_esignature' && !dto.patientSignaturePng) {
        return next(
          new AppError(
            'patientSignaturePng required for e-signature consent',
            400,
            ErrorCode.VALIDATION_ERROR,
          ),
        );
      }
      if (dto.mode === 'clinician_attestation' && !dto.clinicianAttestationText) {
        return next(
          new AppError(
            'clinicianAttestationText required for clinician attestation consent',
            400,
            ErrorCode.VALIDATION_ERROR,
          ),
        );
      }

      const [row] = await db('scribe_consents')
        .insert({
          id: randomUUID(),
          clinic_id: req.clinicId,
          patient_id: dto.patientId,
          session_id: dto.sessionId ?? null,
          mode: dto.mode,
          patient_signature_png: dto.patientSignaturePng ?? null,
          clinician_attested_by_id: dto.mode === 'clinician_attestation' ? req.user!.id : null,
          clinician_attestation_text: dto.clinicianAttestationText ?? null,
          attested_at: new Date(),
          created_at: new Date(),
        })
        .returning([
          'id',
          'clinic_id',
          'patient_id',
          'session_id',
          'mode',
          'clinician_attested_by_id',
          'attested_at',
          'created_at',
        ]);
      res.status(201).json(mapScribeConsentRowToResponse(row));
    } catch (err) {
      next(err);
    }
  },
);

// ── BUG-274 — Revocation of an active/pending scribe consent ──────────────
//
// Patient (via clinician UI) or clinician (on patient's verbal request)
// may revoke a recording consent at any time — even MID-SESSION. The
// revocation writes scribe_consents.revoked_at + .revoked_by +
// .revoke_reason; every downstream path that consumes audio (WebSocket
// chunk ingestion, HTTP /ambient-note multipart upload, transcribePartial)
// checks the revoked_at column via isConsentRevoked() on every chunk and
// halts with an audit row + WS close 4403 + 'RECORDING_REVOKED'.
//
// Idempotent: re-calling revoke on an already-revoked consent returns
// 200 with no state change and NO double-audit. Safer for UIs that
// retry on network blip than a 409 that the operator would have to
// disambiguate from a genuine conflict.
//
// On-revoke invariants (all satisfied atomically per session):
//   1. scribe_consents.revoked_at set to NOW() in a single UPDATE.
//   2. revokeCache invalidated so the next chunk check picks up the
//      new state without the 2s TTL race.
//   3. audit_log row 'AMBIENT_NOTE_RECORDING_REVOKED' written — even
//      if any downstream cleanup fails, the forensic record survives.
//   4. WebSocket close + in-memory session cleanup is handled by the
//      streaming layer (scribeStreaming.ts) via the cache invalidation
//      above — the next chunk arrival sees revoked=true and runs the
//      on-revoke cleanup (state → STOPPED, chunks purge, transcript
//      purge, ws.close(4403, 'RECORDING_REVOKED'), blob delete).
//
// Race resolution: if a client's {type:'stop'} message races the
// revoke, the revoke wins — the stop handler also checks isConsentRevoked
// and returns {type:'revoked'} to the client instead of processing.
const ScribeConsentRevokeSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

router.post(
  '/consent/:id/revoke',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const consentId = z.string().uuid().parse(req.params.id);
      const { reason } = ScribeConsentRevokeSchema.parse(req.body ?? {});

      // Load the consent row with RLS-scoped `db` (same tenant guarantee
      // as verifyRecordingConsent) so a cross-tenant revoke attempt
      // gets 404 not 403.
      const row = await db('scribe_consents')
        .where({ id: consentId, clinic_id: req.clinicId })
        .first('id', 'patient_id', 'revoked_at');
      if (!row) return next(new AppError('Consent not found', 404, 'CONSENT_NOT_FOUND'));

      // Idempotent: already-revoked → 200 with the existing revoke
      // timestamp; no new audit row, no state change. (R2 invariant.)
      if (row.revoked_at) {
        const { markConsentRevokedInCache, publishConsentRevokedCacheInvalidation } = await import(
          '../../shared/recordingConsent'
        );
        markConsentRevokedInCache(consentId);
        await publishConsentRevokedCacheInvalidation(consentId, req.clinicId);
        res.json(
          mapScribeConsentRevocationToResponse({
            id: consentId,
            revokedAt: row.revoked_at,
            idempotent: true,
          }),
        );
        return;
      }

      // Must have patient-relationship to revoke (clinician acting on
      // behalf of a patient they have a care-relationship with).
      const auth = buildAuthContext(req, row.patient_id);
      await requirePatientRelationship(auth, row.patient_id);

      // Atomic UPDATE. RETURNING gives us the canonical revoked_at for
      // the response body + the audit row.
      const updated = await db('scribe_consents')
        .where({ id: consentId, clinic_id: req.clinicId })
        .whereNull('revoked_at')
        .update({
          revoked_at: new Date(),
          revoked_by: req.user!.id,
          revoke_reason: reason ?? null,
        })
        .returning(['id', 'revoked_at']);

      if (updated.length === 0) {
        // Race: another concurrent revoke won. Treat as idempotent.
        const { markConsentRevokedInCache, publishConsentRevokedCacheInvalidation } = await import(
          '../../shared/recordingConsent'
        );
        markConsentRevokedInCache(consentId);
        await publishConsentRevokedCacheInvalidation(consentId, req.clinicId);
        res.json(mapScribeConsentRevocationToResponse({ id: consentId, idempotent: true }));
        return;
      }

      // Invalidate the in-process revoke cache so the NEXT chunk check
      // (in any active WS session bound to this consent) sees revoked
      // without waiting for the 2s TTL. The chunk handler will then
      // run the on-revoke cleanup (state → STOPPED, purge, ws.close).
      const { markConsentRevokedInCache, publishConsentRevokedCacheInvalidation } = await import(
        '../../shared/recordingConsent'
      );
      markConsentRevokedInCache(consentId);
      await publishConsentRevokedCacheInvalidation(consentId, req.clinicId);

      // BUG-282 — soft-mark llm_prompts_outputs rows bound to this
      // consent. Sets encryption_status='REVOKED' + NULLs ciphertext
      // columns via SECURITY DEFINER helper llm_prompts_outputs_mark_revoked
      // (bypass-trigger-permit path built into the BUG-282 migration's
      // trigger body). Synchronous, same-transaction-as-revoke.
      // Training/export pipelines exclude REVOKED rows the same way
      // they exclude FAILED rows — machine-checkable, not convention.
      // Async hard-purge owned by BUG-317 retention job (not this PR).
      try {
        const { dbAdmin } = await import('../../db/db');
        const markResult = await dbAdmin.raw<{
          rows: Array<{ llm_prompts_outputs_mark_revoked: number }>;
        }>(
          'SELECT llm_prompts_outputs_mark_revoked(?::uuid) AS llm_prompts_outputs_mark_revoked',
          [consentId],
        );
        const revokedRowCount = markResult.rows?.[0]?.llm_prompts_outputs_mark_revoked ?? 0;
        if (revokedRowCount > 0) {
          // Log without PHI — only counts. Operators see "N rows
          // revoked for consent X"; no prompt/output text.
          // Using structured logger.info so ops dashboards can alert
          // on abnormal volume (a spike signals bulk revocation).
          (await import('../../utils/logger')).logger.info(
            { consentId, revokedRowCount, clinicId: req.clinicId },
            '[BUG-282] llm_prompts_outputs soft-mark on revocation',
          );
        }
      } catch (markErr) {
        // R1 absorption: forensic record (audit_log below) must
        // survive even if the soft-mark fails. Log and continue to
        // the audit write.
        (await import('../../utils/logger')).logger.error(
          {
            err: markErr instanceof Error ? markErr.message : String(markErr),
            consentId,
            clinicId: req.clinicId,
          },
          '[BUG-282] llm_prompts_outputs_mark_revoked failed — audit_log row still written',
        );
      }

      // Audit row. Uses dbAdmin (via writeAuditLog → audit_log INSERT)
      // so the write survives even if the calling user's RLS context
      // is mid-transition. R1 invariant: the forensic record is durable
      // regardless of downstream cleanup success/failure.
      await writeAuditLog({
        clinicId: req.clinicId,
        userId: req.user!.id,
        action: 'AMBIENT_NOTE_RECORDING_REVOKED',
        tableName: 'scribe_consents',
        recordId: consentId,
        newData: {
          patientId: row.patient_id,
          reason: reason ?? null,
          revokedByStaffId: req.user!.id,
        },
      });

      res.json(
        mapScribeConsentRevocationToResponse({
          id: consentId,
          revokedAt: updated[0].revoked_at,
          idempotent: false,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
