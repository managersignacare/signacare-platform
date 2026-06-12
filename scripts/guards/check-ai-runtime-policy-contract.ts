#!/usr/bin/env tsx
/**
 * Phase 1 model-router hardening guard.
 *
 * Keeps the runtime policy surfaces separated:
 *   - LLM backend selection (local Ollama vs Azure OpenAI),
 *   - scribe runtime mode (standard vs agentic),
 *   - local style/training adapter selection.
 *
 * The local adapter is a training artifact pointer. It must survive backend
 * swaps and must not be overwritten merely because a clinic temporarily routes
 * traffic to Azure.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

const checks: Array<{ path: string; patterns: Array<[RegExp | string, string]> }> = [
  {
    path: 'packages/shared/src/modelRouter.schemas.ts',
    patterns: [
      ["AiLlmBackendSchema = z.enum(['local_ollama', 'azure_openai'])", 'backend enum must expose local and Azure lanes'],
      ["AiScribeRuntimeModeSchema = z.enum(['standard', 'agentic'])", 'scribe mode enum must expose standard and agentic modes'],
      ['LocalStyleAdapterModelNameSchema', 'local style adapter must remain a distinct schema'],
      ['localStyleAdapterModelName: LocalStyleAdapterModelNameSchema', 'runtime settings must persist local adapter separately'],
      ['localStyleAdapterModelName: LocalStyleAdapterModelNameSchema.optional()', 'runtime patch must update adapter only when explicitly supplied'],
      ['Separate persisted local adapter selection', 'schema must document adapter/backend decoupling'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/modelRouter/clinicAiRuntimeSettings.ts',
    patterns: [
      ['hasExplicitLocalStyleAdapterPatch', 'settings writer must detect explicit adapter patches'],
      [/parsedPatch\.llmBackend\s*\?\?\s*existing\?\.ai_llm_backend/, 'backend updates must merge independently'],
      [/parsedPatch\.scribeRuntimeMode\s*\?\?[\s\S]*existing\?\.scribe_runtime_mode/, 'scribe mode updates must merge independently'],
      [/hasExplicitLocalStyleAdapterPatch[\s\S]*normalizeLocalStyleAdapterModelName\(parsedPatch\.localStyleAdapterModelName\)[\s\S]*normalizeLocalStyleAdapterModelName\(existing\?\.local_style_adapter_model_name/, 'adapter must be preserved when omitted from patch'],
      ['local_style_adapter_model_name: merged.localStyleAdapterModelName', 'settings writer must persist adapter pointer'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/modelRouter/modelRouter.ts',
    patterns: [
      ['getModelAliasPolicy', 'router must read adapter eligibility from the policy manifest'],
      ['allowLocalStyleAdapter !== false', 'caller must be able to suppress local adapter use explicitly'],
      ['AI_MODEL_OVERRIDE_NOT_ALLOWED', 'Azure routing must reject explicit model overrides'],
      [/request\.requestedModel[\s\S]+\?\?[\s\S]+\(\s*request\.allowLocalStyleAdapter !== false/, 'explicit requested model must override only local adapter selection'],
      ['backend === \'azure_openai\'', 'Azure branch must be explicit'],
      ['localStyleAdapterModelName', 'execution metadata must retain adapter pointer'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/modelRouter/modelPolicyManifest.ts',
    patterns: [
      ['AI_MODEL_POLICY_MANIFEST', 'strict alias policy manifest must exist'],
      ['AiModelPolicyManifestSchema.parse', 'manifest must validate through shared schema'],
      ['AiTextGenerationModelAliasSchema', 'manifest must be scoped to text-generation aliases, not ASR backends'],
      ['trainerAdapterDecoupled: true', 'manifest must declare trainer/adapter decoupling'],
      ['modelSwapInvalidatesLocalStyleAdapters: false', 'manifest must declare model-swap adapter preservation policy'],
      ['promotionRequiresGovernanceRecord: true', 'manifest must require governance record before alias promotion'],
      ['assertModelPolicyManifestCoversAliases', 'manifest must assert alias coverage'],
      ['assertAliasPromotionAllowedByManifest', 'manifest must expose a governance-record gate for alias promotion'],
      ['assertModelPromotionAllowed(args.promotionRecord)', 'alias promotion gate must validate concrete governance evidence'],
      ['record.alias !== args.alias', 'alias promotion gate must reject mismatched governance records'],
    ],
  },
  {
    path: 'apps/api/src/features/power-settings/powerSettingsRoutes.ts',
    patterns: [
      ['ClinicAiRuntimeSettingsUpdateSchema.parse', 'power-settings route must validate runtime patch with shared schema'],
      ['getClinicAiRuntimeSettings', 'power-settings route must read runtime settings through SSoT service'],
      ['upsertClinicAiRuntimeSettings', 'power-settings route must write runtime settings through SSoT service'],
      ['ai_llm_backend: before.llmBackend', 'audit must record previous backend'],
      ['scribe_runtime_mode: before.scribeRuntimeMode', 'audit must record previous scribe mode'],
      ['local_style_adapter_model_name: before.localStyleAdapterModelName', 'audit must record previous adapter'],
      ['local_style_adapter_model_name: updated.localStyleAdapterModelName', 'audit must record updated adapter'],
    ],
  },
  {
    path: 'apps/web/src/features/power-settings/components/PowerAiRuntimePanel.tsx',
    patterns: [
      ["useState<'local_ollama' | 'azure_openai'>", 'Power Settings UI must expose backend selection'],
      ["useState<'standard' | 'agentic'>", 'Power Settings UI must expose scribe mode selection'],
      ['localStyleAdapterModelName', 'Power Settings UI must expose local adapter pointer'],
      ["llmBackend === 'azure_openai' && localStyleAdapterModelName.trim().length > 0", 'UI must warn that Azure routing does not delete local adapter'],
      ['useUpdateClinicAiRuntimeSettings', 'UI must persist via power settings mutation hook'],
      ['updateRuntime({', 'UI must submit runtime patch through the mutation hook'],
    ],
  },
];

const violations: string[] = [];

for (const check of checks) {
  let source = '';
  try {
    source = read(check.path);
  } catch (err) {
    violations.push(`${check.path}: missing (${(err as Error).message})`);
    continue;
  }

  for (const [pattern, reason] of check.patterns) {
    const ok = typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
    if (!ok) violations.push(`${check.path}: ${reason}`);
  }
}

if (violations.length > 0) {
  console.error('AI runtime policy contract failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('AI runtime policy contract passed.');
