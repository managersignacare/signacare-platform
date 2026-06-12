// apps/api/src/features/llm/llmService.ts
import type {
  AiTextGenerationModelAlias,
  LlmInteractionWriteDTO,
  LlmInteractionResponse,
  LlmInteractionSummaryResponse,
  LlmSuggestionRequest,
  LlmSuggestionResponse,
  LlmUsageDaySummary,
} from '@signacare/shared';
import { LlmInteractionResponseSchema } from '@signacare/shared';
import * as repo from './llmRepository';
import type {
  LlmInteractionRow,
  LlmUsageDayRow,
} from './llmRepository';
import { logger } from '../../utils/logger';
import { AppError } from '../../shared/errors';
import { recordLlmInteraction } from '../../shared/recordLlmInteraction';
import {
  resolveLockedRuntimeSelection,
  routeTextGeneration,
  type LockedAiRuntimeSelection,
} from './modelRouter/modelRouter';

type SuggestionFeature = LlmSuggestionRequest['feature'];

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapInteraction(r: LlmInteractionRow): LlmInteractionResponse {
  // Phase 0.7.5 c24 C7 — reads real columns. API response shape
  // (camelCase: userId, feature, modelName, success, errorCode) is
  // unchanged so the frontend contract stays stable.
  const candidate = {
    id: r.id,
    clinicId: r.clinic_id,
    userId: r.user_id,
    patientId: r.patient_id ?? null,
    episodeId: r.episode_id ?? null,
    feature: r.feature,
    modelName: r.model_name,
    modelProvider: r.model_provider ?? null,
    promptTokens: r.prompt_tokens ?? null,
    completionTokens: r.completion_tokens ?? null,
    totalTokens: r.total_tokens ?? (((r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0)) || null),
    latencyMs: r.latency_ms ?? null,
    success: r.success,
    errorCode: r.error_code ?? null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  };
  // BUG-457 — fail-loud at the API boundary rather than ship drift to
  // the UI. BUG-456 absorb-1 precedent: emit-time Zod failures are
  // server-side data-integrity issues (500), not request-validation
  // failures (422 via the global ZodError handler). Carry interactionId
  // + zodIssues in `details` so RESPONSE_SHAPE_ERROR alerts in production
  // pinpoint the row + failing field path (matches BUG-456 mapper shape
  // at apps/api/src/features/medications/medicationService.ts:112-120).
  const parsed = LlmInteractionResponseSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AppError(
      'LLM interaction response shape failed schema validation',
      500,
      'RESPONSE_SHAPE_ERROR',
      { interactionId: r.id, zodIssues: parsed.error.issues },
    );
  }
  return parsed.data;
}

function mapDayRow(r: LlmUsageDayRow): LlmUsageDaySummary {
  return {
    usageDate: r.usage_date,
    feature: r.feature,
    modelName: r.model_name,
    callCount: parseInt(r.call_count, 10),
    totalTokensUsed: parseInt(r.total_tokens_used, 10),
    totalPromptTokens: parseInt(r.total_prompt_tokens, 10),
    totalCompletionTokens: parseInt(r.total_completion_tokens, 10),
    avgLatencyMs: r.avg_latency_ms
      ? parseInt(r.avg_latency_ms, 10)
      : null,
    errorCount: parseInt(r.error_count, 10),
  };
}

// ── Core write ────────────────────────────────────────────────────────────────

export async function writeLlmInteraction(
  clinicId: string,
  userId: string | null,
  dto: LlmInteractionWriteDTO,
): Promise<LlmInteractionResponse> {
  // Audit Tier 4.4 (CRIT-G3 part 1) — stamp `metadata.modelVersion`
  // with `<name>@<sha256>` so every AI-generated artefact has a
  // traceable weights identity. Ollama unreachable → `@unknown`
  // rather than failing the write-path. The full model-registry
  // enforcement (block unapproved digests, startup verify) is the
  // Tier 19.10 work item.
  const { ollamaModelRegistry } = await import('../../mcp/ollamaModelRegistry');
  const modelVersion = await ollamaModelRegistry.getModelVersion(dto.modelName);
  const mergedMetadata: Record<string, unknown> = {
    ...(dto.metadata ?? {}),
    modelVersion,
  };

  // Phase 0.7.5 c24 C7 — all fields match the real `llm_interactions`
  // columns. Dropped input_text/draft_content (the DB keeps only
  // pointers — input_ref/output_ref — to keep interaction rows small;
  // full prompt/completion text goes to object storage when retained).
  // status→success + error_message→error_code are the canonical names.
  const row = await repo.insertInteraction({
    clinic_id: clinicId,
    user_id: userId ?? '',
    patient_id: dto.patientId ?? null,
    episode_id: dto.episodeId ?? null,
    feature: dto.feature,
    model_name: dto.modelName,
    // BUG-424 — model_version surfaced through the row interface.
    // Same digest computation as the metadata.modelVersion above so
    // forensic queries can filter on the column directly without
    // JSONB extraction.
    model_version: modelVersion,
    model_provider: dto.modelProvider ?? null,
    prompt_tokens: dto.promptTokens ?? null,
    completion_tokens: dto.completionTokens ?? null,
    total_tokens: dto.totalTokens ?? null,
    latency_ms: dto.latencyMs ?? null,
    success: dto.success,
    error_code: dto.errorCode ?? null,
    input_ref: null,
    output_ref: null,
    metadata: mergedMetadata,
  });
  return mapInteraction(row);
}

// ── Usage summary ─────────────────────────────────────────────────────────────

export async function getUsageSummary(
  clinicId: string,
  dateFrom: string,
  dateTo: string,
): Promise<LlmInteractionSummaryResponse> {
  const dayRows = await repo.listClinicUsageByDay(clinicId, dateFrom, dateTo);
  const totalsRow = await repo.aggregateTotals(clinicId, dateFrom, dateTo);

  return {
    clinicId,
    dateFrom,
    dateTo,
    byDay: dayRows.map(mapDayRow),
    totals: {
      callCount: parseInt(totalsRow.call_count, 10),
      totalTokensUsed: parseInt(totalsRow.total_tokens_used, 10),
      errorCount: parseInt(totalsRow.error_count, 10),
      avgLatencyMs: totalsRow.avg_latency_ms
        ? parseInt(totalsRow.avg_latency_ms, 10)
        : null,
    },
  };
}

export async function getUserUsageSummary(
  clinicId: string,
  userId: string,
  dateFrom: string,
  dateTo: string,
): Promise<LlmUsageDaySummary[]> {
  const rows = await repo.listUsageByDay(clinicId, dateFrom, dateTo, userId);
  return rows.map(mapDayRow);
}

function resolveSuggestionAlias(feature: SuggestionFeature): AiTextGenerationModelAlias {
  switch (feature) {
    case 'summarisation':
      return 'best_clinical';
    case 'coding_assist':
      return 'best_clinical';
    case 'suggestion':
    default:
      return 'fast_clinical';
  }
}

function resolveSuggestionTemperature(feature: SuggestionFeature): number {
  switch (feature) {
    case 'coding_assist':
      return 0.1;
    case 'summarisation':
      return 0.15;
    case 'suggestion':
    default:
      return 0.2;
  }
}

function resolveSuggestionMaxTokens(feature: SuggestionFeature): number {
  switch (feature) {
    case 'summarisation':
      return 2048;
    case 'coding_assist':
      return 1536;
    case 'suggestion':
    default:
      return 1536;
  }
}

function toProvider(backend: LockedAiRuntimeSelection['backend']): string {
  return backend === 'azure_openai' ? 'azure_openai' : 'ollama';
}

function fallbackModelVersion(
  runtimeSelection: LockedAiRuntimeSelection,
  requestedModel: string | undefined,
): string {
  if (runtimeSelection.backend === 'azure_openai') {
    return requestedModel?.trim() || 'azure_openai@unknown';
  }
  return requestedModel?.trim() || 'local_ollama@unknown';
}

// ── Suggestion endpoint ───────────────────────────────────────────────────────

export async function processSuggestion(
  clinicId: string,
  userId: string,
  dto: LlmSuggestionRequest,
): Promise<LlmSuggestionResponse> {
  const alias = resolveSuggestionAlias(dto.feature);
  const temperature = resolveSuggestionTemperature(dto.feature);
  const maxTokens = resolveSuggestionMaxTokens(dto.feature);
  const runtimeSelection = await resolveLockedRuntimeSelection(clinicId);
  const requestedLocalModel =
    runtimeSelection.backend === 'local_ollama'
      ? dto.modelName?.trim() || undefined
      : undefined;
  const startMs = Date.now();
  let success = true;
  let errorCode: string | undefined;
  let outputRef: string | null = null;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let cachedPromptTokens: number | null | undefined;
  let promptPrefixHash: string | null | undefined;
  let modelName = (requestedLocalModel ?? dto.modelName?.trim()) || 'unknown';
  let modelVersion: string | undefined = fallbackModelVersion(runtimeSelection, dto.modelName);
  let modelProvider = toProvider(runtimeSelection.backend);
  let routedDeployment: string | null = null;
  let localStyleAdapterModelName = runtimeSelection.localStyleAdapterModelName;

  try {
    logger.info({
      action: 'llm_suggestion_requested',
      feature: dto.feature,
      routedAlias: alias,
      runtimeBackend: runtimeSelection.backend,
      requestedLocalModel: requestedLocalModel ?? null,
      ignoredRequestedModel:
        runtimeSelection.backend === 'azure_openai' ? dto.modelName?.trim() || null : null,
      clinicId,
      userId,
    });
    const result = await routeTextGeneration({
      clinicId,
      runtimeSelection,
      alias,
      prompt: dto.contextRef,
      temperature,
      maxTokens,
      requestedModel: requestedLocalModel,
      action: dto.feature,
      allowLocalStyleAdapter: false,
    });
    outputRef = result.text;
    promptTokens = result.promptTokens ?? undefined;
    completionTokens = result.completionTokens ?? undefined;
    cachedPromptTokens = result.cachedPromptTokens;
    promptPrefixHash = result.promptPrefixHash;
    modelName = result.execution.modelName;
    modelVersion = result.execution.modelVersion ?? modelVersion;
    modelProvider = toProvider(result.execution.backend);
    routedDeployment = result.execution.deployment ?? null;
    localStyleAdapterModelName = result.execution.localStyleAdapterModelName ?? null;
    // Audit Tier 5.5 (MED-G3) — server-appended verify disclaimer.
    // Appended here (server-side) rather than on the client so a
    // client cannot strip it before rendering. Idempotent: if the
    // model already appended the disclaimer somehow, we don't
    // double-stamp.
    const DISCLAIMER =
      '\n\n[⚠ Verify against current clinical guidelines before acting.]';
    if (outputRef && !outputRef.includes('Verify against current clinical guidelines')) {
      outputRef = `${outputRef}${DISCLAIMER}`;
    }
  } catch (err) {
    success = false;
    errorCode = 'LLM_PROVIDER_ERROR';
    logger.error({
      err,
      action: 'llm_suggestion_error',
      routedAlias: alias,
      runtimeBackend: runtimeSelection.backend,
      clinicId,
      userId,
    });
  }

  const latencyMs = Date.now() - startMs;

  const interactionId = await recordLlmInteraction({
    clinicId,
    userId,
    patientId: dto.patientId ?? null,
    feature: dto.feature,
    modelName,
    modelVersion,
    modelProvider,
    temperature,
    promptTokens,
    completionTokens,
    latencyMs,
    success,
    errorCode,
    metadata: {
      routedAlias: alias,
      routedBackend: runtimeSelection.backend,
      routedDeployment,
      localStyleAdapterModelName,
      requestedLocalModel: requestedLocalModel ?? null,
      ignoredRequestedModel:
        runtimeSelection.backend === 'azure_openai' ? dto.modelName?.trim() || null : null,
      versionSource: modelProvider === 'azure_openai' ? 'provider' : 'tag',
      cachedPromptTokens: cachedPromptTokens ?? null,
      promptPrefixHash: promptPrefixHash ?? null,
    },
    promptText: dto.contextRef,
    outputText: outputRef ?? '',
    consentId: null,
  });

  return {
    interactionId,
    outputRef,
    success,
    latencyMs,
  };
}
