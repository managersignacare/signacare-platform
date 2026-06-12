#!/usr/bin/env tsx
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

const checks: Array<{ path: string; pass: (source: string) => boolean; reason: string }> = [
  {
    path: 'packages/shared/src/aiModelGovernance.schemas.ts',
    pass: (source) => /SovereignModelArtifactManifestSchema/.test(source)
      && /runtimePullAllowed:\s*z\.literal\(false\)/.test(source)
      && /inferenceTrainingSeparated:\s*z\.literal\(true\)/.test(source)
      && /trainingAdapterReview:\s*AiTrainingAdapterReviewSchema/.test(source)
      && /ACR_DIGEST_IMAGE_RE/.test(source),
    reason: 'Shared governance schema must require digest-pinned sovereign images, separated training/inference, no runtime model fetch, and adapter compatibility review.',
  },
  {
    path: 'scripts/ai/validate-sovereign-model-artifact.ts',
    pass: (source) => /SovereignModelArtifactManifestSchema\.parse/.test(source)
      && /compatibleAdapterCount !== review\.existingAdapterCount/.test(source)
      && /incompatibleAdapterNames\.length > 0/.test(source)
      && /adaptersRequiringRetrain\.length > 0/.test(source),
    reason: 'Sovereign artifact validator must fail closed unless every existing clinician adapter remains compatible.',
  },
  {
    path: 'package.json',
    pass: (source) => /"ai:sovereign-artifact:validate":\s*"tsx scripts\/ai\/validate-sovereign-model-artifact\.ts"/.test(source)
      && /"guard:sovereign-gpu-artifact-contract":\s*"tsx scripts\/guards\/check-sovereign-gpu-artifact-contract\.ts"/.test(source)
      && /guard:sovereign-gpu-artifact-contract/.test(source.match(/"guard:architecture-boundaries":\s*"([^"]+)"/)?.[1] ?? ''),
    reason: 'Package scripts must expose sovereign artifact validation and include the contract guard in architecture boundaries.',
  },
  {
    path: 'deploy/azure/deploy.sh',
    pass: (source) => /validate_sovereign_gpu_artifact_if_needed/.test(source)
      && /SOVEREIGN_MODEL_ARTIFACT_MANIFEST/.test(source)
      && /docs\/quality\/sovereign-model-artifacts\/\*\.json/.test(source)
      && /npm run ai:sovereign-artifact:validate/.test(source)
      && /sovereignInferenceImage="\$SOVEREIGN_INFERENCE_IMAGE"/.test(source)
      && /sovereignInferenceModelManifestSha256="\$SOVEREIGN_INFERENCE_MODEL_MANIFEST_SHA256"/.test(source),
    reason: 'Azure deploy helper must require a reviewed sovereign artifact manifest and pass its image/model digests into Bicep.',
  },
  {
    path: 'deploy/azure/main.bicep',
    pass: (source) => /module sovereignGpu 'modules\/sovereign-gpu-aks\.bicep' = if \(enableSovereignGpu\)/.test(source)
      && !/enableSovereignGpu && enablePrivateNetwork && !empty\(sovereignInferenceImage\)/.test(source),
    reason: 'Main Bicep must not silently skip sovereign GPU when enabled but misconfigured.',
  },
  {
    path: 'deploy/azure/modules/sovereign-gpu-aks.bicep',
    pass: (source) => /@minLength\(1\)\s*param aksSystemSubnetId string/.test(source)
      && /@minLength\(1\)\s*param aksInferenceSubnetId string/.test(source)
      && /@minLength\(1\)\s*param aksTrainingSubnetId string/.test(source)
      && /@minLength\(1\)\s*param inferenceImage string/.test(source)
      && /signacare\.io\/lane=inference:NoSchedule/.test(source)
      && /signacare\.io\/lane=training:NoSchedule/.test(source),
    reason: 'Sovereign AKS module must fail validation on missing private subnets/image and preserve inference/training taints.',
  },
  {
    path: 'docs/operations/runbooks/sovereign-gpu-lane.md',
    pass: (source) => /SOVEREIGN_MODEL_ARTIFACT_MANIFEST/.test(source)
      && /ai:sovereign-artifact:validate/.test(source)
      && /docs\/quality\/sovereign-model-artifacts/.test(source),
    reason: 'Sovereign GPU runbook must use the governed artifact manifest workflow.',
  },
];

const requiredFiles = [
  'docs/quality/sovereign-model-artifacts/README.md',
];

const violations: string[] = [];
for (const file of requiredFiles) {
  if (!existsSync(resolve(ROOT, file))) {
    violations.push(`${file}: required documentation file is missing`);
  }
}

for (const check of checks) {
  const source = read(check.path);
  if (!check.pass(source)) {
    violations.push(`${check.path}: ${check.reason}`);
  }
}

if (violations.length > 0) {
  console.error('Sovereign GPU artifact contract failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('Sovereign GPU artifact contract passed.');
