import { routeTextGeneration, type LockedAiRuntimeSelection } from '../llm/modelRouter/modelRouter';
import { recordLlmInteraction } from '../../shared/recordLlmInteraction';

export interface AuditScoringNoteInput {
  readonly clinicId: string;
  readonly createdById: string;
  readonly runId: string;
  readonly templateId: string;
  readonly runtimeSelection: LockedAiRuntimeSelection;
  readonly noteId: string;
  readonly patientId: string | null;
  readonly noteType: string | null;
  readonly authorName: string;
  readonly content: string;
  readonly questions: string[];
}

export interface AuditScoringNoteResult extends Record<string, unknown> {
  readonly noteId: string;
}

const AUDIT_SCORING_SYSTEM_PROMPT = [
  'You are a clinical quality auditor for an Australian mental health service.',
  'Score the clinical note against each audit question.',
  'Return ONLY valid JSON in this exact shape:',
  '{',
  '  "scores": [{ "question": string, "score": number, "comment": string }],',
  '  "overallScore": number,',
  '  "summary": string',
  '}',
  'Do not add markdown fences, prose, or extra keys.',
].join('\n');

function toProvider(backend: LockedAiRuntimeSelection['backend']): string {
  return backend === 'azure_openai' ? 'azure_openai' : 'ollama';
}

function buildPrompt(input: AuditScoringNoteInput): string {
  const numberedQuestions = input.questions.map((question, index) => `${index + 1}. ${question}`).join('\n');
  return [
    `Audit run ID: ${input.runId}`,
    `Audit template ID: ${input.templateId}`,
    `Note type: ${input.noteType ?? 'unknown'}`,
    `Author: ${input.authorName}`,
    '',
    'Clinical note content:',
    input.content,
    '',
    'Audit questions:',
    numberedQuestions,
  ].join('\n');
}

function parseAuditScoringResult(text: string, noteId: string): AuditScoringNoteResult {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return { noteId, ...parsed };
}

export async function scoreClinicalNoteAudit(
  input: AuditScoringNoteInput,
): Promise<AuditScoringNoteResult> {
  const prompt = buildPrompt(input);
  const startedAt = Date.now();

  try {
    const routed = await routeTextGeneration({
      clinicId: input.clinicId,
      runtimeSelection: input.runtimeSelection,
      alias: 'best_clinical',
      prompt,
      system: AUDIT_SCORING_SYSTEM_PROMPT,
      temperature: 0.1,
      maxTokens: 1500,
      action: 'admin-report',
      allowLocalStyleAdapter: false,
    });

    const latencyMs = Date.now() - startedAt;
    await recordLlmInteraction({
      clinicId: input.clinicId,
      userId: input.createdById,
      patientId: input.patientId,
      feature: 'clinical-note-audit',
      modelName: routed.execution.modelName,
      modelVersion: routed.execution.modelVersion ?? undefined,
      modelProvider: toProvider(input.runtimeSelection.backend),
      promptTokens: routed.promptTokens ?? undefined,
      completionTokens: routed.completionTokens ?? undefined,
      totalTokens:
        routed.promptTokens != null || routed.completionTokens != null
          ? (routed.promptTokens ?? 0) + (routed.completionTokens ?? 0)
          : undefined,
      latencyMs,
      success: true,
      promptText: `${AUDIT_SCORING_SYSTEM_PROMPT}\n\n${prompt}`,
      outputText: routed.text,
      consentId: null,
      metadata: {
        cachedPromptTokens: routed.cachedPromptTokens ?? null,
        promptPrefixHash: routed.promptPrefixHash ?? null,
        routedAlias: routed.execution.alias,
        routedBackend: routed.execution.backend,
        routedDeployment: routed.execution.deployment ?? null,
        localStyleAdapterModelName: routed.execution.localStyleAdapterModelName ?? null,
        versionSource: routed.execution.backend === 'azure_openai' ? 'provider' : 'tag',
        auditRunId: input.runId,
        auditTemplateId: input.templateId,
        noteId: input.noteId,
        noteType: input.noteType,
        auditQuestionCount: input.questions.length,
      },
    });

    return parseAuditScoringResult(routed.text, input.noteId);
  } catch {
    return { noteId: input.noteId, error: 'LLM scoring failed' };
  }
}
