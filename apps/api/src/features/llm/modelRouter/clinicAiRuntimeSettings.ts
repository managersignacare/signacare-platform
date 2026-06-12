import type {
  ClinicAiRuntimeSettings,
  ClinicAiRuntimeSettingsUpdateDTO,
} from '@signacare/shared';
import {
  ClinicAiRuntimeSettingsSchema,
  ClinicAiRuntimeSettingsUpdateSchema,
} from '@signacare/shared';
import { dbAdmin } from '../../../db/db';
import { AppError, ErrorCode } from '../../../shared/errors';
import { buildAzureOpenAiHealthEntry } from './azureOpenAiRuntimeHealth';

type ClinicAiRuntimeRow = {
  clinic_id: string;
  ai_llm_backend?: string | null;
  scribe_runtime_mode?: string | null;
  local_style_adapter_model_name?: string | null;
};

export const DEFAULT_CLINIC_AI_RUNTIME_SETTINGS = {
  llmBackend: 'local_ollama',
  scribeRuntimeMode: 'standard',
  localStyleAdapterModelName: null,
} as const;

export function assertClinicAiRuntimeSelectionSupported(
  llmBackend: 'local_ollama' | 'azure_openai',
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (llmBackend !== 'azure_openai') {
    return;
  }

  const azureHealth = buildAzureOpenAiHealthEntry(env);
  if (azureHealth.status === 'OK') {
    return;
  }

  throw new AppError(
    'OpenAI (Azure-hosted) cannot be selected until the hosted runtime is fully configured and healthy.',
    409,
    'AI_BACKEND_UNAVAILABLE',
    {
      provider: 'azure_openai',
      status: azureHealth.status,
      missingEnvVars: azureHealth.missingEnvVars ?? [],
      detail: azureHealth.error ?? null,
    },
  );
}

function normalizeLocalStyleAdapterModelName(value?: string | null): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapRowToRuntimeSettings(
  clinicId: string,
  row?: ClinicAiRuntimeRow | null,
): ClinicAiRuntimeSettings {
  return ClinicAiRuntimeSettingsSchema.parse({
    clinicId,
    llmBackend: row?.ai_llm_backend ?? DEFAULT_CLINIC_AI_RUNTIME_SETTINGS.llmBackend,
    scribeRuntimeMode: row?.scribe_runtime_mode ?? DEFAULT_CLINIC_AI_RUNTIME_SETTINGS.scribeRuntimeMode,
    localStyleAdapterModelName:
      normalizeLocalStyleAdapterModelName(row?.local_style_adapter_model_name ?? null) ?? null,
  });
}

async function assertClinicExists(clinicId: string): Promise<void> {
  const row = await dbAdmin('clinics').where({ id: clinicId }).first('id');
  if (!row) {
    throw new AppError(`Clinic ${clinicId} not found`, 404, ErrorCode.NOT_FOUND);
  }
}

export async function getClinicAiRuntimeSettings(clinicId: string): Promise<ClinicAiRuntimeSettings> {
  const row = (await dbAdmin('clinic_settings')
    .where({ clinic_id: clinicId })
    .first(
      'clinic_id',
      'ai_llm_backend',
      'scribe_runtime_mode',
      'local_style_adapter_model_name',
    )) as ClinicAiRuntimeRow | undefined;
  return mapRowToRuntimeSettings(clinicId, row);
}

export async function upsertClinicAiRuntimeSettings(
  clinicId: string,
  patch: ClinicAiRuntimeSettingsUpdateDTO,
): Promise<ClinicAiRuntimeSettings> {
  const parsedPatch = ClinicAiRuntimeSettingsUpdateSchema.parse(patch);
  await assertClinicExists(clinicId);

  const existing = (await dbAdmin('clinic_settings')
    .where({ clinic_id: clinicId })
    .first(
      'clinic_id',
      'ai_llm_backend',
      'scribe_runtime_mode',
      'local_style_adapter_model_name',
    )) as ClinicAiRuntimeRow | undefined;

  const hasExplicitLocalStyleAdapterPatch =
    Object.prototype.hasOwnProperty.call(parsedPatch, 'localStyleAdapterModelName');

  const merged = ClinicAiRuntimeSettingsSchema.parse({
    clinicId,
    llmBackend: parsedPatch.llmBackend ?? existing?.ai_llm_backend ?? DEFAULT_CLINIC_AI_RUNTIME_SETTINGS.llmBackend,
    scribeRuntimeMode:
      parsedPatch.scribeRuntimeMode
      ?? existing?.scribe_runtime_mode
      ?? DEFAULT_CLINIC_AI_RUNTIME_SETTINGS.scribeRuntimeMode,
    localStyleAdapterModelName:
      hasExplicitLocalStyleAdapterPatch
        ? (normalizeLocalStyleAdapterModelName(parsedPatch.localStyleAdapterModelName) ?? null)
        : (normalizeLocalStyleAdapterModelName(existing?.local_style_adapter_model_name ?? null) ?? null),
  });

  assertClinicAiRuntimeSelectionSupported(merged.llmBackend);

  const writePatch = {
    ai_llm_backend: merged.llmBackend,
    scribe_runtime_mode: merged.scribeRuntimeMode,
    local_style_adapter_model_name: merged.localStyleAdapterModelName,
    updated_at: new Date(),
  };

  if (existing) {
    await dbAdmin('clinic_settings')
      .where({ clinic_id: clinicId })
      .update(writePatch);
    return merged;
  }

  await dbAdmin('clinic_settings').insert({
    clinic_id: clinicId,
    ...writePatch,
    created_at: new Date(),
  });
  return merged;
}
