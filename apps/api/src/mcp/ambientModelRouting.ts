import type { AiTextGenerationModelAlias, RoutedModelExecution } from '@signacare/shared';
import { ambientOllamaNumPredict } from '../shared/ambientScribeConfig';
import {
  resolveLockedRuntimeSelection,
  routeTextGeneration,
  type LockedAiRuntimeSelection,
  type RoutedTextGenerationResult,
} from '../features/llm/modelRouter/modelRouter';

export interface AmbientRuntimeLock {
  readonly runtimeSelection: LockedAiRuntimeSelection;
  readonly requestedLocalModel: string | undefined;
}

export async function lockAmbientRuntime(
  clinicId: string,
  requestedModel?: string,
): Promise<AmbientRuntimeLock> {
  const runtimeSelection = await resolveLockedRuntimeSelection(clinicId);
  const trimmedRequestedModel = requestedModel?.trim();

  return {
    runtimeSelection,
    requestedLocalModel:
      runtimeSelection.backend === 'local_ollama' && trimmedRequestedModel
        ? trimmedRequestedModel
        : undefined,
  };
}

function ambientRequestedModel(lock: AmbientRuntimeLock): string | undefined {
  return lock.runtimeSelection.backend === 'local_ollama'
    ? lock.requestedLocalModel
    : undefined;
}

export function ambientModelProvider(
  backend: LockedAiRuntimeSelection['backend'],
): string {
  return backend === 'azure_openai' ? 'azure_openai' : 'ollama';
}

export function buildAmbientFallbackExecution(
  lock: AmbientRuntimeLock,
  alias: AiTextGenerationModelAlias,
): RoutedModelExecution {
  return {
    alias,
    backend: lock.runtimeSelection.backend,
    modelName: 'unknown',
    modelVersion: 'unknown',
    deployment: null,
    localStyleAdapterModelName: lock.runtimeSelection.localStyleAdapterModelName,
  };
}

export function summarizeAmbientExecutions(executions: readonly RoutedModelExecution[]): {
  modelName: string;
  modelVersion: string;
} {
  const uniqueModelNames = [...new Set(executions.map((execution) => execution.modelName).filter(Boolean))];
  const uniqueModelVersions = [...new Set(executions.map((execution) => execution.modelVersion).filter(Boolean))];

  return {
    modelName: uniqueModelNames.join('+') || 'unknown',
    modelVersion: uniqueModelVersions.join('+') || 'unknown',
  };
}

export async function generateAmbientPass1Text(args: {
  readonly lock: AmbientRuntimeLock;
  readonly prompt: string;
  readonly system: string;
}): Promise<RoutedTextGenerationResult> {
  return routeTextGeneration({
    clinicId: args.lock.runtimeSelection.clinicId,
    runtimeSelection: args.lock.runtimeSelection,
    alias: 'fast_clinical',
    prompt: args.prompt,
    system: args.system,
    temperature: 0.0,
    maxTokens: ambientOllamaNumPredict(),
    requestedModel: ambientRequestedModel(args.lock),
    action: 'ambient',
    allowLocalStyleAdapter: false,
  });
}

export async function generateAmbientPass3Text(args: {
  readonly lock: AmbientRuntimeLock;
  readonly prompt: string;
  readonly system: string;
}): Promise<RoutedTextGenerationResult> {
  return routeTextGeneration({
    clinicId: args.lock.runtimeSelection.clinicId,
    runtimeSelection: args.lock.runtimeSelection,
    alias: 'best_clinical',
    prompt: args.prompt,
    system: args.system,
    temperature: 0.1,
    maxTokens: ambientOllamaNumPredict(),
    requestedModel: ambientRequestedModel(args.lock),
    action: 'ambient',
    allowLocalStyleAdapter: true,
  });
}
