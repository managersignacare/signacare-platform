import type { ClinicalContextEnvelope, RoutedModelExecution } from '@signacare/shared';
import { recordLlmInteraction } from '../../../shared/recordLlmInteraction';
import type { PipelineStage } from '../../../shared/pipelineTracker';

export interface ClinicalContextAuditMetadata {
  readonly routedAlias: RoutedModelExecution['alias'];
  readonly routedBackend: RoutedModelExecution['backend'];
  readonly routedDeployment: string | null;
  readonly localStyleAdapterModelName: string | null;
  readonly contextPresent: boolean;
  readonly contextDocumentType: ClinicalContextEnvelope['documentType'] | null;
  readonly contextSchemaVersion: ClinicalContextEnvelope['schemaVersion'] | null;
  readonly contextHash: string | null;
  readonly contextPhiClass: ClinicalContextEnvelope['phiClass'] | null;
  readonly contextEstimatedTokens: number | null;
  readonly contextTokenBudget: number | null;
  readonly contextSourceCount: number;
  readonly contextSourceTables: Record<string, number>;
  readonly contextExcluded: Array<{ domain: string; reason: string }>;
}

export interface RecordClinicalContextInteractionArgs {
  readonly clinicId: string;
  readonly userId?: string;
  readonly patientId?: string | null;
  readonly episodeId?: string | null;
  readonly feature: string;
  readonly execution: RoutedModelExecution;
  readonly promptText: string;
  readonly outputText?: string;
  readonly promptTokens?: number | null;
  readonly completionTokens?: number | null;
  readonly cachedPromptTokens?: number | null;
  readonly promptPrefixHash?: string | null;
  readonly pipeline?: PipelineStage[];
  readonly temperature?: number;
  readonly latencyMs?: number;
  readonly success?: boolean;
  readonly errorCode?: string;
  readonly consentId?: string | null;
  readonly contextEnvelope?: ClinicalContextEnvelope | null;
  readonly metadata?: Record<string, unknown>;
}

function countSourceTables(envelope: ClinicalContextEnvelope | null | undefined): Record<string, number> {
  if (!envelope) return {};

  return envelope.facts.reduce<Record<string, number>>((acc, fact) => {
    acc[fact.lineage.sourceTable] = (acc[fact.lineage.sourceTable] ?? 0) + 1;
    return acc;
  }, {});
}

export function buildClinicalContextAuditMetadata(
  execution: RoutedModelExecution,
  envelope?: ClinicalContextEnvelope | null,
): ClinicalContextAuditMetadata {
  return {
    routedAlias: execution.alias,
    routedBackend: execution.backend,
    routedDeployment: execution.deployment ?? null,
    localStyleAdapterModelName: execution.localStyleAdapterModelName ?? null,
    contextPresent: Boolean(envelope),
    contextDocumentType: envelope?.documentType ?? null,
    contextSchemaVersion: envelope?.schemaVersion ?? null,
    contextHash: envelope?.contextHash ?? null,
    contextPhiClass: envelope?.phiClass ?? null,
    contextEstimatedTokens: envelope?.estimatedTokens ?? null,
    contextTokenBudget: envelope?.tokenBudget ?? null,
    contextSourceCount: envelope?.facts.length ?? 0,
    contextSourceTables: countSourceTables(envelope),
    contextExcluded:
      envelope?.excluded.map((item) => ({ domain: item.domain, reason: item.reason })) ?? [],
  };
}

function toProvider(backend: RoutedModelExecution['backend']): string {
  return backend === 'azure_openai' ? 'azure_openai' : 'ollama';
}

export async function recordClinicalContextLlmInteraction(
  args: RecordClinicalContextInteractionArgs,
): Promise<string> {
  const baseMetadata = buildClinicalContextAuditMetadata(args.execution, args.contextEnvelope);

  return recordLlmInteraction({
    clinicId: args.clinicId,
    userId: args.userId,
    patientId: args.patientId ?? null,
    episodeId: args.episodeId ?? null,
    feature: args.feature,
    modelName: args.execution.modelName,
    modelVersion: args.execution.modelVersion ?? undefined,
    modelProvider: toProvider(args.execution.backend),
    promptTokens: args.promptTokens ?? undefined,
    completionTokens: args.completionTokens ?? undefined,
    totalTokens:
      args.promptTokens != null || args.completionTokens != null
        ? (args.promptTokens ?? 0) + (args.completionTokens ?? 0)
        : undefined,
    pipeline: args.pipeline,
    temperature: args.temperature,
    latencyMs: args.latencyMs,
    success: args.success ?? true,
    errorCode: args.errorCode,
    metadata: {
      ...baseMetadata,
      ...(args.metadata ?? {}),
      cachedPromptTokens: args.cachedPromptTokens ?? null,
      promptPrefixHash: args.promptPrefixHash ?? null,
    },
    promptText: args.promptText,
    outputText: args.outputText ?? '',
    consentId: args.consentId ?? null,
  });
}
