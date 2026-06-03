// apps/api/src/features/llm/llmController.ts
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  LlmInteractionWriteDTOSchema,
  LlmSuggestionRequestSchema,
  LlmSuggestionResponseSchema,
} from '@signacare/shared';
import * as service from './llmService';
import { classifyForClinic } from '../../mcp/chatClassifier';
import { writeAuditLog } from '../../utils/audit';
import { CLINICAL_AI_DISCLAIMER } from '../../shared/llmDisclaimer';
// BUG-327 — /llm/suggest had NO requirePatientRelationship gate and
// NO bypass-role audit. Both missed from BUG-279's original 5-endpoint
// sweep (L4 flagged as a BUG-036-class extension). Added here.
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requirePatientRelationship } from '../../shared/authGuards';
import { writeLlmAccessBypassAudit } from '../../shared/writeLlmAccessBypassAudit';
import { guardAiTextEgress } from '../ai/egress/responseGuard';

const UsageQuerySchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const SuggestResponseEnvelopeSchema = LlmSuggestionResponseSchema.extend({
  disclaimer: z.string(),
});

export async function recordInteraction(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = LlmInteractionWriteDTOSchema.parse(req.body);
    const result = await service.writeLlmInteraction(
      req.clinicId,
      req.user!.id,
      dto,
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getClinicUsage(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { dateFrom, dateTo } = UsageQuerySchema.parse(req.query);
    const result = await service.getUsageSummary(
      req.clinicId,
      dateFrom,
      dateTo,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getUserUsage(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { dateFrom, dateTo } = UsageQuerySchema.parse(req.query);
    const result = await service.getUserUsageSummary(
      req.clinicId,
      req.params.userId,
      dateFrom,
      dateTo,
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function suggest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = LlmSuggestionRequestSchema.parse(req.body);

    // BUG-327 — patient-relationship gate. Conditional because
    // patientId is optional (some /suggest calls are patient-agnostic:
    // generic summarisation, coding_assist without a specific patient
    // record). When supplied, verify the clinician has a sanctioned
    // care relationship before the LLM call. Admin/superadmin bypass
    // is surfaced via writeLlmAccessBypassAudit at the success site.
    if (dto.patientId) {
      const auth = buildAuthContext(req, dto.patientId);
      await requirePatientRelationship(auth, dto.patientId);
    }

    // Audit Tier 5.3 — run the chat classifier BEFORE the LLM call.
    // A prescribing / dosage / controlled-drug match gets rejected
    // with a standardised error + audit-logged. Mode is per-clinic.
    const contextText =
      typeof (dto as { contextRef?: unknown }).contextRef === 'string'
        ? (dto as { contextRef: string }).contextRef
        : JSON.stringify(dto ?? {});
    const classification = await classifyForClinic(req.clinicId, contextText);
    if (classification.blocked) {
      await writeAuditLog({
        clinicId: req.clinicId,
        actorId: req.user!.id,
        action: 'AI_CHAT_CLASSIFIER_BLOCK',
        tableName: 'llm_interactions',
        // No row is written when the classifier blocks — use a
        // sentinel UUID so the audit row satisfies the required
        // string-valued recordId field.
        recordId: '00000000-0000-0000-0000-000000000000',
        newValues: {
          reason: classification.reason,
          mode: classification.mode,
          matched: classification.matched,
          feature: dto.feature,
        },
      }).catch(() => { /* audit failure is non-fatal — the block still happens */ });
      res.status(400).json({
        error: 'AI chat does not prescribe, dose, or advise on controlled drugs. ' +
          'Use the prescription workflow for dosing decisions.',
        code: 'AI_CHAT_PRESCRIBING_BLOCKED',
        reason: classification.reason,
      });
      return;
    }
    const result = await service.processSuggestion(
      req.clinicId,
      req.user!.id,
      dto,
    );
    const aiDecisionToken = (res.locals as {
      aiDecisionToken?: {
        tokenId: string;
        clinicId: string;
        staffId: string;
        role: string;
        permissions: string[];
        allowedTools?: string[];
        purposeOfUse: 'clinical' | 'operational' | 'analytics';
        scope?: {
          level: 'patient' | 'team' | 'staff' | 'clinic';
          patientIds?: string[];
          teamIds?: string[];
          staffIds?: string[];
          teamLabels?: string[];
          staffLabels?: string[];
          timeRangeFrom?: string;
          timeRangeTo?: string;
        };
        issuedAt: string;
        expiresAt: string;
        signature: string;
      };
    }).aiDecisionToken;
    const aiPolicyDecision = (res.locals as {
      aiPolicyDecision?: {
        purposeOfUse: 'clinical' | 'operational' | 'analytics';
        scope: {
          level: 'patient' | 'team' | 'staff' | 'clinic';
          patientIds?: string[];
          teamIds?: string[];
          staffIds?: string[];
          teamLabels?: string[];
          staffLabels?: string[];
          timeRangeFrom?: string;
          timeRangeTo?: string;
        };
      };
    }).aiPolicyDecision;
    const egressChecked = result.outputRef
      ? guardAiTextEgress({
        routeId: 'suggest',
        auth: {
          ...buildAuthContext(req, dto.patientId),
          aiPurposeOfUse: aiPolicyDecision?.purposeOfUse ?? 'clinical',
          aiScope: aiPolicyDecision?.scope,
          aiDecisionToken,
          aiAllowedTools: aiDecisionToken?.allowedTools,
        },
        text: result.outputRef,
      })
      : null;
    // BUG-327 — bypass-role audit. Fires on 200 when caller role is
    // in BYPASS_ROLES (admin/superadmin). No-op for regular clinicians
    // (who were already gated by requirePatientRelationship above).
    await writeLlmAccessBypassAudit({
      req,
      patientId: dto.patientId ?? null,
      endpoint: '/llm/suggest',
      feature: `suggest:${dto.feature}`,
    });
    // BUG-038 — disclaimer envelope on the /suggest response so UIs +
    // auditors can mark AI output as non-authoritative draft content.
    res.json(
      SuggestResponseEnvelopeSchema.parse({
        ...result,
        outputRef: egressChecked?.safeText ?? result.outputRef,
        disclaimer: CLINICAL_AI_DISCLAIMER,
      }),
    );
  } catch (err) {
    next(err);
  }
}
