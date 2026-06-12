// @jsonb-extraction-exempt: draft-route helper reads staff identity fields only and returns Zod-validated route envelopes, not raw staff rows.

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { db } from '../../db/db';
import { CLINICAL_AI_DISCLAIMER } from '../../shared/llmDisclaimer';
import { writeLlmAccessBypassAudit } from '../../shared/writeLlmAccessBypassAudit';
import { recordScribeReadabilitySignal } from '../../shared/postDeployTelemetry';
import type { AiTextGenerationModelAlias, RoutedModelExecution } from '@signacare/shared';
import {
  PATIENT_SUMMARY_PROMPT,
  buildPatientSummaryPrompt,
  REFERRAL_LETTER_PROMPT,
  buildReferralLetterPrompt,
  wrapAsAiDraft,
  roleLabel,
} from '../../mcp/scribeEnhancements';
import { routeTextGeneration } from './modelRouter/modelRouter';
import { getClinicAiRuntimeSettings } from './modelRouter/clinicAiRuntimeSettings';
import { appendClinicalContextToPrompt, buildClinicalContext } from './context/buildClinicalContext';
import { recordClinicalContextLlmInteraction } from './context/contextAuditWriter';

const structuredNoteInput = z
  .union([
    z.string().min(1),
    z
      .record(z.string(), z.unknown())
      .refine((o) => Object.keys(o).length > 0, 'structuredNote required'),
  ])
  .transform((v) => (typeof v === 'string' ? v : JSON.stringify(v)));

const PatientSummarySchema = z.object({
  structuredNote: structuredNoteInput,
  patientId: z.string().uuid().optional(),
});

const ReferralLetterSchema = z.object({
  structuredNote: structuredNoteInput,
  recipientType: z.enum(['gp', 'specialist', 'service']).optional(),
  recipientName: z.string().max(200).optional(),
  patientId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
});

const PatientSummaryResponseSchema = z.object({
  summary: z.string(),
  patientName: z.string(),
  isAiDraft: z.literal(true),
  disclaimer: z.string(),
});

const ReferralLetterResponseSchema = z.object({
  letter: z.string(),
  patientName: z.string(),
  clinicianName: z.string(),
  clinicianRoleLabel: z.string(),
  isAiDraft: z.literal(true),
  disclaimer: z.string(),
});

function errorCodeOf(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return 'AI_GENERATION_FAILED';
}

function toAuDateOrEmpty(value: string | null): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('en-AU');
}

async function buildFailedExecution(
  clinicId: string,
  alias: AiTextGenerationModelAlias,
): Promise<RoutedModelExecution> {
  try {
    const runtime = await getClinicAiRuntimeSettings(clinicId);
    return {
      alias,
      backend: runtime.llmBackend,
      modelName: 'unknown',
      modelVersion: 'unknown',
      deployment: null,
      localStyleAdapterModelName: runtime.localStyleAdapterModelName,
    };
  } catch {
    return {
      alias,
      backend: 'local_ollama',
      modelName: 'unknown',
      modelVersion: 'unknown',
      deployment: null,
      localStyleAdapterModelName: null,
    };
  }
}

const router = Router();

router.post(
  '/patient-summary',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { structuredNote, patientId } = PatientSummarySchema.parse(req.body);
      let patientName = 'there';
      let prompt = '';
      let contextEnvelope = null;

      if (patientId) {
        const auth = buildAuthContext(req, patientId);
        const context = await buildClinicalContext({
          auth,
          documentType: 'avs',
          patientId,
        });
        patientName = context.anchorPatient.preferredName ?? context.anchorPatient.givenName ?? 'there';
        prompt = appendClinicalContextToPrompt(
          buildPatientSummaryPrompt(structuredNote, patientName),
          context.renderedPrompt,
        );
        contextEnvelope = context.envelope;
      } else {
        prompt = buildPatientSummaryPrompt(structuredNote, patientName);
      }

      let routed;
      try {
        routed = await routeTextGeneration({
          clinicId: req.clinicId,
          alias: 'best_clinical',
          prompt,
          system: PATIENT_SUMMARY_PROMPT,
          temperature: 0.2,
          maxTokens: 2048,
          action: 'letter',
        });
      } catch (err) {
        await recordClinicalContextLlmInteraction({
          clinicId: req.clinicId!,
          userId: req.user!.id,
        patientId: patientId ?? null,
        feature: 'scribe-patient-summary',
        execution: await buildFailedExecution(req.clinicId!, 'best_clinical'),
        promptText: prompt,
        outputText: '',
        success: false,
        errorCode: errorCodeOf(err),
        contextEnvelope,
        cachedPromptTokens: null,
        promptPrefixHash: null,
        metadata: { failurePath: 'routeTextGeneration' },
      });
        throw err;
      }

      const summary = wrapAsAiDraft(routed.text);
      await recordClinicalContextLlmInteraction({
        clinicId: req.clinicId!,
        userId: req.user!.id,
        patientId: patientId ?? null,
        feature: 'scribe-patient-summary',
        execution: routed.execution,
        promptText: prompt,
        outputText: routed.text,
        promptTokens: routed.promptTokens,
        completionTokens: routed.completionTokens,
        cachedPromptTokens: routed.cachedPromptTokens,
        promptPrefixHash: routed.promptPrefixHash,
        success: true,
        contextEnvelope,
      });
      await writeLlmAccessBypassAudit({
        req,
        patientId: patientId ?? null,
        endpoint: '/scribe/patient-summary',
        feature: 'scribe-patient-summary',
      });
      recordScribeReadabilitySignal({
        feature: 'scribe-patient-summary',
        text: summary,
      });
      res.json(PatientSummaryResponseSchema.parse({
        summary,
        patientName,
        isAiDraft: true,
        disclaimer: CLINICAL_AI_DISCLAIMER,
      }));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/referral-letter',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { structuredNote, recipientType, recipientName, patientId, reason } =
        ReferralLetterSchema.parse(req.body);
      let patientName = '';
      let patientDob = '';
      let patientMrn = '';
      let prompt = '';
      let contextEnvelope = null;

      const staff = await db('staff').where({ id: req.user!.id }).first();
      const clinicianName = staff ? `${staff.given_name} ${staff.family_name}` : '';
      const clinicianRole = staff?.role ?? req.user!.role ?? '';

      if (patientId) {
        const auth = buildAuthContext(req, patientId);
        const context = await buildClinicalContext({
          auth,
          documentType: 'referral-letter',
          patientId,
        });
        patientName = `${context.anchorPatient.givenName} ${context.anchorPatient.familyName}`.trim();
        patientDob = toAuDateOrEmpty(context.anchorPatient.dateOfBirth);
        patientMrn = context.anchorPatient.emrNumber ?? '';
        prompt = appendClinicalContextToPrompt(
          buildReferralLetterPrompt(
            structuredNote,
            recipientType ?? 'gp',
            recipientName ?? 'GP',
            patientName,
            patientDob,
            patientMrn,
            clinicianName,
            clinicianRole,
            reason,
          ),
          context.renderedPrompt,
        );
        contextEnvelope = context.envelope;
      } else {
        prompt = buildReferralLetterPrompt(
          structuredNote,
          recipientType ?? 'gp',
          recipientName ?? 'GP',
          patientName,
          patientDob,
          patientMrn,
          clinicianName,
          clinicianRole,
          reason,
        );
      }

      let routed;
      try {
        routed = await routeTextGeneration({
          clinicId: req.clinicId,
          alias: 'best_clinical',
          prompt,
          system: REFERRAL_LETTER_PROMPT,
          temperature: 0.2,
          maxTokens: 2048,
          action: 'letter',
        });
      } catch (err) {
        await recordClinicalContextLlmInteraction({
          clinicId: req.clinicId!,
          userId: req.user!.id,
        patientId: patientId ?? null,
        feature: 'scribe-referral-letter',
        execution: await buildFailedExecution(req.clinicId!, 'best_clinical'),
        promptText: prompt,
        outputText: '',
        success: false,
        errorCode: errorCodeOf(err),
        contextEnvelope,
        cachedPromptTokens: null,
        promptPrefixHash: null,
        metadata: { failurePath: 'routeTextGeneration' },
      });
        throw err;
      }

      const letter = wrapAsAiDraft(routed.text);
      await recordClinicalContextLlmInteraction({
        clinicId: req.clinicId!,
        userId: req.user!.id,
        patientId: patientId ?? null,
        feature: 'scribe-referral-letter',
        execution: routed.execution,
        promptText: prompt,
        outputText: routed.text,
        promptTokens: routed.promptTokens,
        completionTokens: routed.completionTokens,
        cachedPromptTokens: routed.cachedPromptTokens,
        promptPrefixHash: routed.promptPrefixHash,
        success: true,
        contextEnvelope,
      });
      await writeLlmAccessBypassAudit({
        req,
        patientId: patientId ?? null,
        endpoint: '/scribe/referral-letter',
        feature: 'scribe-referral-letter',
      });
      res.json(ReferralLetterResponseSchema.parse({
        letter,
        patientName,
        clinicianName,
        clinicianRoleLabel: roleLabel(clinicianRole),
        isAiDraft: true,
        disclaimer: CLINICAL_AI_DISCLAIMER,
      }));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
