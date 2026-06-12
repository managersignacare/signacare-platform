import {
  AiModelAliasPolicySchema,
  AiTextGenerationModelAliasSchema,
  AiModelPolicyManifestSchema,
  type AiTextGenerationModelAlias,
  type AiModelAliasPolicy,
  type AiModelPromotionRecord,
  type AiModelPolicyManifest,
} from '@signacare/shared';
import { assertModelPromotionAllowed } from './modelGovernance';

export const AI_MODEL_POLICY_MANIFEST: AiModelPolicyManifest = AiModelPolicyManifestSchema.parse({
  schemaVersion: '1.0',
  policies: [
    {
      alias: 'fast_clinical',
      defaultLanePreference: ['azure_fast', 'sovereign_gpu', 'local_ollama'],
      localStyleAdapterAllowed: true,
      trainerAdapterDecoupled: true,
      modelSwapInvalidatesLocalStyleAdapters: false,
      promotionRequiresGovernanceRecord: true,
      promptCacheEligible: true,
    },
    {
      alias: 'best_clinical',
      defaultLanePreference: ['azure_fast', 'sovereign_gpu', 'local_ollama'],
      localStyleAdapterAllowed: true,
      trainerAdapterDecoupled: true,
      modelSwapInvalidatesLocalStyleAdapters: false,
      promotionRequiresGovernanceRecord: true,
      promptCacheEligible: true,
    },
    {
      alias: 'local_sovereign',
      defaultLanePreference: ['sovereign_gpu', 'local_ollama'],
      localStyleAdapterAllowed: true,
      trainerAdapterDecoupled: true,
      modelSwapInvalidatesLocalStyleAdapters: false,
      promotionRequiresGovernanceRecord: true,
      promptCacheEligible: false,
    },
    {
      alias: 'court_report_reasoning',
      defaultLanePreference: ['azure_fast', 'sovereign_gpu'],
      localStyleAdapterAllowed: true,
      trainerAdapterDecoupled: true,
      modelSwapInvalidatesLocalStyleAdapters: false,
      promotionRequiresGovernanceRecord: true,
      promptCacheEligible: true,
    },
  ],
});

const POLICY_BY_ALIAS = new Map<AiTextGenerationModelAlias, AiModelAliasPolicy>(
  AI_MODEL_POLICY_MANIFEST.policies.map((policy) => [policy.alias, AiModelAliasPolicySchema.parse(policy)]),
);

export function getModelAliasPolicy(alias: AiTextGenerationModelAlias): AiModelAliasPolicy {
  const policy = POLICY_BY_ALIAS.get(alias);
  if (!policy) {
    throw new Error(`Missing AI model alias policy for ${alias}`);
  }
  return policy;
}

export function assertAliasPromotionAllowedByManifest(args: {
  alias: AiTextGenerationModelAlias;
  promotionRecord: AiModelPromotionRecord;
}): AiModelAliasPolicy {
  const policy = getModelAliasPolicy(args.alias);
  if (!policy.promotionRequiresGovernanceRecord) return policy;

  const record = assertModelPromotionAllowed(args.promotionRecord);
  if (record.alias !== args.alias) {
    throw new Error(`AI model promotion alias mismatch: policy=${args.alias} record=${record.alias}`);
  }

  return policy;
}

export function assertModelPolicyManifestCoversAliases(): void {
  const aliases = new Set(AiTextGenerationModelAliasSchema.options);
  const manifestAliasList = AI_MODEL_POLICY_MANIFEST.policies.map((policy) => policy.alias);
  const manifestAliases = new Set(manifestAliasList);
  const duplicates = manifestAliasList.filter((alias, index) => manifestAliasList.indexOf(alias) !== index);
  const missing = [...aliases].filter((alias) => !manifestAliases.has(alias));
  const extra = [...manifestAliases].filter((alias) => !aliases.has(alias));

  if (duplicates.length || missing.length || extra.length || manifestAliasList.length !== aliases.size) {
    throw new Error(
      `AI model policy manifest drift: duplicates=${[...new Set(duplicates)].join(',')} missing=${missing.join(',')} extra=${extra.join(',')}`,
    );
  }

  for (const alias of aliases) {
    const policy = getModelAliasPolicy(alias);
    if (!policy.trainerAdapterDecoupled || policy.modelSwapInvalidatesLocalStyleAdapters) {
      throw new Error(`AI model policy manifest adapter decoupling invariant failed for ${alias}`);
    }
    if (!policy.promotionRequiresGovernanceRecord) {
      throw new Error(`AI model policy manifest promotion governance invariant failed for ${alias}`);
    }
  }
}

assertModelPolicyManifestCoversAliases();
