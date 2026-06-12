import type { AiLlmBackend, AiTextGenerationModelAlias, RoutedModelExecution } from '@signacare/shared';
import { RoutedModelExecutionSchema } from '@signacare/shared';
import { createHash } from 'node:crypto';
import { callLocalLlm } from '../../../mcp/localLlmAgent';
import { AppError } from '../../../shared/errors';
import { buildClinicalPromptForAction, type ClinicalPromptBuildOptions } from './clinicalPromptCatalog';
import {
  getClinicAiRuntimeSettings,
  DEFAULT_CLINIC_AI_RUNTIME_SETTINGS,
} from './clinicAiRuntimeSettings';
import { callAzureOpenAiChat } from './azureOpenAiAdapter';
import { getModelAliasPolicy } from './modelPolicyManifest';
import {
  scheduleShadowTextGeneration,
  type ShadowRuntimeOptions,
} from './modelShadowRuntime';

export interface RoutedTextGenerationRequest {
  clinicId?: string | null;
  runtimeSelection?: LockedAiRuntimeSelection | null;
  alias: AiTextGenerationModelAlias;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  requestedModel?: string;
  action?: string;
  allowLocalStyleAdapter?: boolean;
  shadowMode?: ShadowRuntimeOptions | null;
}

export interface RoutedTextGenerationResult {
  text: string;
  execution: RoutedModelExecution;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedPromptTokens: number | null;
  promptPrefixHash: string | null;
  fallbackFromModelName?: string | null;
}

export interface LockedAiRuntimeSelection {
  clinicId: string | null;
  backend: AiLlmBackend;
  localStyleAdapterModelName: string | null;
}

function shouldUseLocalStyleAdapter(alias: AiTextGenerationModelAlias): boolean {
  return getModelAliasPolicy(alias).localStyleAdapterAllowed;
}

function parseExecution(execution: RoutedModelExecution): RoutedModelExecution {
  return RoutedModelExecutionSchema.parse(execution);
}

function normalizeForPrefix(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .toLowerCase();
}

function extractStaticPromptPrefix(prompt: string): string {
  const normalizedForBoundary = prompt
    .replace(/\r\n/g, '\n')
    .trim();
  if (!normalizedForBoundary) return '';

  // In clinical workflows, prompt payloads are generally assembled as
  //   "<stable task framing>\n\n<data payload>"
  //
  // Azure prompt-caching only rewards a repeated prefix. We therefore
  // strip the final blank-line-delimited dynamic section so clinic
  // context changes do not invalidate cache unless the stable task
  // framing itself changed.
  const separator = '\n\n';
  const splitPoints: number[] = [];
  let cursor = 0;
  let idx = normalizedForBoundary.indexOf(separator, cursor);
  while (idx !== -1) {
    splitPoints.push(idx);
    cursor = idx + separator.length;
    idx = normalizedForBoundary.indexOf(separator, cursor);
  }
  if (!splitPoints.length) return normalizeForPrefix(normalizedForBoundary);

  const hasBoundaryHint = (prefix: string, suffix: string): boolean => {
    const prefixTail = prefix
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    if (!prefixTail) return false;
    const normalizedPrefixTail = prefixTail.toLowerCase();
    const normalizedPrefix = prefix.toLowerCase();
    const normalizedSuffix = suffix.toLowerCase();
    const suffixWords = normalizedSuffix.split(/\s+/).filter(Boolean).length;

    const hasPayloadStyleLine = prefix
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .some((line) => /^(patient|dob|mrn|diagnosis|diagnostic|medication|allergy|risk|appointment|pathology|clinical|episode|assessment|consent|score|transcript|note|lab|mha|bprs|gads|gad|k10|mshrs|clozapine|prescription)\s*:/i.test(line));

    const isInstructionPrefix =
      /\b(generate|analyse|analyze|convert|summar(i|ise)|build|create|draft|write|produce|document|derive|summarize)\b/.test(
        normalizedPrefixTail,
      ) ||
      /\b(generate|analyse|analyze|convert|summar(i|ise)|build|create|draft|write|produce|document|derive|summarize)\b/.test(
        normalizedPrefix,
      );

    if (hasPayloadStyleLine) {
      return false;
    }

    if (!isInstructionPrefix && !/[a-z]+:$/i.test(normalizedPrefixTail)) {
      return false;
    }

    return (
      suffixWords >= 4
      && (
        // Payloads frequently begin with patient/context/data blocks.
        /^\s*(patient|context|data|notes?|appt|medication|risk|lab|assessment|transcript)[:-\s]/i.test(suffix)
        || suffixWords >= 30
        || /\b(dob|mrn|id|date|score|clinical|medication|appointment|consent|episode)\b/.test(normalizedSuffix)
      )
    );
  };

  for (let i = splitPoints.length - 1; i >= 0; i -= 1) {
    const split = splitPoints[i];
    const trailingPayload = normalizedForBoundary.slice(split + separator.length).trim();
    const staticPrefix = normalizedForBoundary.slice(0, split).trim();

    if (staticPrefix && hasBoundaryHint(staticPrefix, trailingPayload)) {
      return normalizeForPrefix(staticPrefix);
    }
  }

  return normalizeForPrefix(normalizedForBoundary);
}

export function estimateStablePromptPrefixHash(
  request: Pick<RoutedTextGenerationRequest, 'alias' | 'system' | 'prompt' | 'action'>,
): string {
  const seed = [
    request.alias,
    request.action ?? 'clinical-action',
    request.system ? normalizeForPrefix(request.system) : '',
    request.prompt ? extractStaticPromptPrefix(request.prompt) : '',
  ]
    .join('\n---\n')
    .trim();

  const approxTokenSlice = seed
    .split(/\s+/)
    .slice(0, 1100)
    .join(' ')
    .slice(0, 8000);

  return createHash('sha256').update(approxTokenSlice).digest('hex');
}

export async function resolveLockedRuntimeSelection(
  clinicId?: string | null,
): Promise<LockedAiRuntimeSelection> {
  if (!clinicId) {
    return {
      clinicId: clinicId ?? null,
      backend: DEFAULT_CLINIC_AI_RUNTIME_SETTINGS.llmBackend,
      localStyleAdapterModelName: DEFAULT_CLINIC_AI_RUNTIME_SETTINGS.localStyleAdapterModelName,
    };
  }

  const runtime = await getClinicAiRuntimeSettings(clinicId);
  return {
    clinicId,
    backend: runtime.llmBackend,
    localStyleAdapterModelName: runtime.localStyleAdapterModelName,
  };
}

async function routeTextGenerationPrimary(
  request: RoutedTextGenerationRequest,
): Promise<RoutedTextGenerationResult> {
  const runtimeSelection = request.runtimeSelection
    ?? await resolveLockedRuntimeSelection(request.clinicId);
  const effectiveClinicId = request.clinicId ?? runtimeSelection.clinicId ?? null;
  const backend = runtimeSelection.backend;
  const localStyleAdapterModelName = runtimeSelection.localStyleAdapterModelName ?? null;

  if (backend === 'azure_openai') {
    if (request.requestedModel?.trim()) {
      throw new AppError(
        'Explicit model overrides are not allowed for governed Azure OpenAI aliases',
        422,
        'AI_MODEL_OVERRIDE_NOT_ALLOWED',
        { alias: request.alias, backend },
      );
    }

    const promptPrefixHash = estimateStablePromptPrefixHash(request);
    const azure = await callAzureOpenAiChat({
      alias: request.alias,
      prompt: request.prompt,
      system: request.system,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });

    return {
      text: azure.text,
      execution: parseExecution({
        alias: request.alias,
        backend,
        modelName: azure.modelName,
        modelVersion: azure.modelVersion,
        deployment: azure.deployment,
        localStyleAdapterModelName,
      }),
      promptTokens: azure.promptTokens,
      completionTokens: azure.completionTokens,
      cachedPromptTokens: azure.cachedPromptTokens ?? null,
      promptPrefixHash,
      fallbackFromModelName: null,
    };
  }

  const localModel =
    request.requestedModel
    ?? (
      request.allowLocalStyleAdapter !== false
      && localStyleAdapterModelName
      && shouldUseLocalStyleAdapter(request.alias)
        ? localStyleAdapterModelName
        : undefined
    );

  const local = await callLocalLlm({
    prompt: request.prompt,
    system: request.system,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    model: localModel,
    clinicId: effectiveClinicId ?? undefined,
    action: request.action,
  });

  return {
    text: local.text,
    execution: parseExecution({
      alias: request.alias,
      backend,
      modelName: local.model,
      modelVersion: local.modelVersion ?? local.model,
      deployment: null,
      localStyleAdapterModelName,
    }),
    cachedPromptTokens: null,
    promptPrefixHash: estimateStablePromptPrefixHash(request),
    promptTokens: local.tokensUsed > 0 ? local.tokensUsed : null,
    completionTokens: null,
    fallbackFromModelName: local.fallbackFromModel ?? null,
  };
}

export async function routeTextGeneration(
  request: RoutedTextGenerationRequest,
): Promise<RoutedTextGenerationResult> {
  const startedAt = Date.now();
  const primaryResult = await routeTextGenerationPrimary(request);

  scheduleShadowTextGeneration({
    request,
    primaryResult,
    primaryLatencyMs: Date.now() - startedAt,
    runChallenger: routeTextGenerationPrimary,
  });

  return primaryResult;
}

export async function generateClinicalAction(
  options: ClinicalPromptBuildOptions & {
    clinicId?: string | null;
    requestedModel?: string;
  },
): Promise<RoutedTextGenerationResult> {
  const spec = buildClinicalPromptForAction(options);
  return routeTextGeneration({
    clinicId: options.clinicId,
    alias: spec.alias,
    prompt: spec.prompt,
    system: spec.system,
    temperature: spec.temperature,
    maxTokens: spec.maxTokens,
    requestedModel: options.requestedModel,
    action: spec.localAction ?? options.action,
  });
}
