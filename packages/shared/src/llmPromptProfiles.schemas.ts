import { z } from 'zod';

export const PromptProfileIdSchema = z.enum([
  'enterprise_dsm5_diagnostic_synthesis_v1',
  'enterprise_longitudinal_summary_v1',
  'enterprise_91_day_review_v1',
  'enterprise_psychiatric_scribe_v1',
]);
export type PromptProfileId = z.infer<typeof PromptProfileIdSchema>;

export const LlmPromptProfileSchema = z.object({
  // @zod-convention-exempt: prompt profile IDs are controlled enum keys, not DB row UUIDs.
  id: PromptProfileIdSchema,
  title: z.string().min(1).max(200),
  version: z.string().min(1).max(60),
  modelAgnostic: z.boolean(),
  targetActions: z.array(z.string().min(1).max(100)).min(1),
  purpose: z.string().min(1).max(2000),
  systemPrompt: z.string().min(1).max(50000),
  ragInstructions: z.string().max(50000).nullable(),
  fewShotExamples: z.string().max(100000).nullable(),
  governanceChecklist: z.array(z.string().min(1).max(400)).min(1),
});
export type LlmPromptProfile = z.infer<typeof LlmPromptProfileSchema>;

export const PromptProfileApplyRequestSchema = z.object({
  profileIds: z.array(PromptProfileIdSchema).min(1).optional(),
  replaceExisting: z.boolean().optional(),
  includeManifestInContext: z.boolean().optional(),
});
export type PromptProfileApplyRequest = z.infer<typeof PromptProfileApplyRequestSchema>;

export const PromptProfileLibraryResponseSchema = z.object({
  version: z.string().min(1).max(60),
  profiles: z.array(LlmPromptProfileSchema),
});
export type PromptProfileLibraryResponse = z.infer<typeof PromptProfileLibraryResponseSchema>;

export const PromptProfileApplyResponseSchema = z.object({
  appliedProfileIds: z.array(PromptProfileIdSchema),
  upsertedActions: z.number().int().nonnegative(),
  manifestRowsWritten: z.number().int().nonnegative(),
});
export type PromptProfileApplyResponse = z.infer<typeof PromptProfileApplyResponseSchema>;

export const LLM_PROMPT_PROFILE_LIBRARY_VERSION = '2026-05-22.v2';

const BASE_DIAGNOSTIC_PROMPT = `You are an enterprise diagnostic synthesis engine for psychiatric EMR data.

NON-NEGOTIABLE RULES:
1. Zero hallucination: never invent symptoms, timelines, diagnoses, doses, or risk events.
2. Preserve uncertainty explicitly using labels such as "provisional", "insufficient evidence", or "clinician review required".
3. Keep contradictions visible; do not silently reconcile conflicting sources.
4. Distinguish current, historical, and lifetime diagnostic evidence.
5. Mania/hypomania evidence must trigger bipolar-spectrum differential review; do not default to unipolar depression if lifetime polarity evidence conflicts.
6. Axis-style layout is an internal EMR format only. Do not claim DSM-5 uses official multiaxial diagnosis.
7. Include differential diagnoses and exclusion notes when evidence is incomplete.
8. Every output is a draft pending consultant clinician review.
9. Risk surfacing in this artifact is non-diagnostic: label as "clinical signal for clinician review", never as a confirmed diagnosis.
10. If evidence is insufficient, return "insufficient evidence for diagnostic conclusion" and preserve differential hypotheses only.

REQUIRED OUTPUT:
- Return strict JSON only.
- Include: axisI, axisII, axisIII, axisIV, axisV, diagnosticSynthesis, differentialDiagnoses, confidence, evidenceAnchors, disclaimer.
- Evidence anchors must include source type + date + key observed finding (not date-only anchors).`;

const BASE_LONGITUDINAL_PROMPT = `You are an enterprise longitudinal clinical summary engine.

NON-NEGOTIABLE RULES:
1. Zero hallucination.
2. Temporal coherence over recency bias: synthesise across full timeline.
3. Separate active problems from historical/resolved issues.
4. Medication history must be timeline-based (start/stop/dose changes, response, side effects, adherence signals).
5. Contradictions and data gaps must be explicit.
6. Risk history (self-harm/suicide/violence/psychosis/vulnerability) must be surfaced prominently.
7. Mark missing domains explicitly as "not evidenced in available records".
8. Draft status and clinician-review requirement must be explicit.
9. If surfacing risk signals, phrase them as review prompts (non-diagnostic) and attach evidence anchors.

OUTPUT STYLE:
- Structured and scannable.
- Evidence-bound sections with source/date anchors.
- No fabricated recommendations; "review focus" is navigation guidance only.`;

const BASE_91_DAY_PROMPT = `You are a 91-day clinical review synthesis engine for mental health services.

NON-NEGOTIABLE RULES:
1. Zero hallucination.
2. Scope is the review window only, with explicit comparison to prior window where evidence exists.
3. Summarise symptoms, MSE changes, medication changes, adherence, risk updates, functioning, and service engagement.
4. Include overdue or incomplete governance items (reviews, monitoring, legal obligations) only when present in evidence.
5. Mark uncertain or missing evidence explicitly.
6. Output is always a draft requiring consultant review and sign-off.
7. Risk signals must be expressed as clinician-review prompts, not diagnoses.

OUTPUT STRUCTURE:
- Review period metadata.
- Clinical course summary.
- Medication and safety changes.
- Risk and safeguarding update.
- Governance/compliance checks.
- 91-day forward review focus list (non-prescriptive).`;

const BASE_SCRIBE_PROMPT = `You are an enterprise psychiatric medical scribe for encounter documentation.

NON-NEGOTIABLE RULES:
1. Zero hallucination.
2. Preserve uncertainty and attribution.
3. Preserve negation and temporality.
4. Surface risk content in a dedicated section.
5. For missing but expected sections, use explicit marker:
   [ENCOUNTER-ABSENT: Not discussed in this encounter — clinician review required]
6. If transcript evidence conflicts, emit:
   [CLINICAL DISCREPANCY: ... requires clinician review]
7. Do not assign new diagnoses that were not clinician-stated or explicitly present in structured context.
8. Always include a draft disclaimer requiring clinician countersignature.
9. Any risk/safety-plan suggestion is preparatory only; activation requires explicit patient-collaboration attestation in workflow.

OUTPUT STYLE:
- Structured, parsable clinical note output.
- Domain coverage suitable for psychiatric reviews (MSE, risk, medications, plan, follow-up).`;

export const ENTERPRISE_LLM_PROMPT_PROFILES: readonly LlmPromptProfile[] = [
  {
    id: 'enterprise_dsm5_diagnostic_synthesis_v1',
    title: 'Enterprise DSM/ICD Diagnostic Synthesis',
    version: '1.1.0',
    modelAgnostic: true,
    targetActions: ['report-insight'],
    purpose:
      'Structured DSM/ICD-oriented diagnostic synthesis with evidence anchors, differentials, uncertainty handling, and safe draft boundaries.',
    systemPrompt: BASE_DIAGNOSTIC_PROMPT,
    ragInstructions:
      'Prioritise longitudinal episodes, MSE excerpts, risk assessments, medication-response chronology, and explicit clinician diagnostic statements.',
    fewShotExamples: null,
    governanceChecklist: [
      'No diagnosis without explicit evidence support.',
      'Contradictions preserved, not hidden.',
      'Differentials and exclusions surfaced when evidence incomplete.',
      'Risk surfacing is non-diagnostic and framed as clinician-review signals.',
      'Draft disclaimer always present.',
    ],
  },
  {
    id: 'enterprise_longitudinal_summary_v1',
    title: 'Enterprise Longitudinal Clinical Summary',
    version: '1.1.0',
    modelAgnostic: true,
    targetActions: ['maudsley', 'formulation'],
    purpose:
      'Longitudinal chart synthesis that preserves chronology, risk visibility, medication trajectory, and uncertainty discipline.',
    systemPrompt: BASE_LONGITUDINAL_PROMPT,
    ragInstructions:
      'Fuse structured + narrative sources; anchor every major section to timeline evidence; explicitly list omitted or unavailable domains.',
    fewShotExamples: null,
    governanceChecklist: [
      'Temporal coherence must be explicit.',
      'Current vs historical status must remain distinct.',
      'Medication trajectory represented as timeline, not static list.',
      'Risk history cannot be buried in narrative.',
      'Risk signal language remains non-diagnostic.',
    ],
  },
  {
    id: 'enterprise_91_day_review_v1',
    title: 'Enterprise 91-Day Review Synthesis',
    version: '1.1.0',
    modelAgnostic: true,
    targetActions: ['91day'],
    purpose:
      'Structured 91-day review summary with comparative interval framing and explicit governance/risk checks.',
    systemPrompt: BASE_91_DAY_PROMPT,
    ragInstructions:
      'Use interval-bound evidence first, then prior baseline for contrast; include compliance checkpoints only when evidenced.',
    fewShotExamples: null,
    governanceChecklist: [
      'Interval scope is explicit.',
      'Risk/MSE/medication changes are explicitly linked to evidence.',
      'Missing evidence is marked, not inferred.',
      'Risk outputs are framed as review prompts, not diagnoses.',
      'Draft + consultant review boundary preserved.',
    ],
  },
  {
    id: 'enterprise_psychiatric_scribe_v1',
    title: 'Enterprise Psychiatric Scribe',
    version: '1.1.0',
    modelAgnostic: true,
    targetActions: ['ambient'],
    purpose:
      'Safety-first encounter drafting with uncertainty markers, discrepancy surfacing, and explicit risk extraction.',
    systemPrompt: BASE_SCRIBE_PROMPT,
    ragInstructions:
      'Preserve speaker attribution and uncertainty markers; emphasise risk/safeguarding statements and medication changes with direct evidence anchors.',
    fewShotExamples: null,
    governanceChecklist: [
      'All absent sections are explicitly marked.',
      'Uncertain or conflicting transcript segments are preserved.',
      'No diagnostic up-coding.',
      'Safety-plan activation requires explicit patient-collaboration attestation.',
      'Draft disclaimer remains visible.',
    ],
  },
] as const;

export const ENTERPRISE_LLM_PROMPT_PROFILES_BY_ID: Readonly<Record<PromptProfileId, LlmPromptProfile>> = {
  enterprise_dsm5_diagnostic_synthesis_v1: ENTERPRISE_LLM_PROMPT_PROFILES[0],
  enterprise_longitudinal_summary_v1: ENTERPRISE_LLM_PROMPT_PROFILES[1],
  enterprise_91_day_review_v1: ENTERPRISE_LLM_PROMPT_PROFILES[2],
  enterprise_psychiatric_scribe_v1: ENTERPRISE_LLM_PROMPT_PROFILES[3],
};
