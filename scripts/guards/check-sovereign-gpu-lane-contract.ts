#!/usr/bin/env tsx
/**
 * Phase 5 sovereign-GPU lane contract.
 *
 * The sovereign lane is only enterprise-grade if three boundaries hold:
 *   1. The inference image is immutable and runtime-verifies the baked
 *      Ollama model manifest.
 *   2. The AKS workload is repo-owned, digest-only, and scheduled only on
 *      the inference GPU node pool.
 *   3. Training remains structurally separated from inference.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

const checks: Array<{ path: string; patterns: Array<[RegExp | string, string]> }> = [
  {
    path: 'deploy/ai/ollama/Dockerfile',
    patterns: [
      [/FROM ollama\/ollama@sha256:[a-f0-9]{64}/, 'base image must be digest-pinned'],
      ['OLLAMA_MODEL_MANIFEST_PATH=/tmp/ollama-model-manifest.json', 'image must publish baked manifest path'],
      ['OLLAMA_MODEL_MANIFEST_SHA256=${OLLAMA_MODEL_MANIFEST_SHA256}', 'image must publish baked manifest digest'],
      ['test "$actual" = "$OLLAMA_MODEL_MANIFEST_SHA256"', 'build must fail when vendored manifest hash drifts'],
      ['hashlib.sha256(target.read_bytes()).hexdigest()', 'build must verify every downloaded model blob digest'],
    ],
  },
  {
    path: 'deploy/ai/ollama/entrypoint.sh',
    patterns: [
      ['OLLAMA_MODEL_MANIFEST_PATH:=/tmp/ollama-model-manifest.json', 'runtime must know the baked manifest path'],
      ['Required baked Ollama model manifest is missing', 'runtime must fail closed when manifest is missing'],
      ['sha256sum "$OLLAMA_MODEL_MANIFEST_PATH"', 'runtime must recompute manifest digest'],
      ['Baked Ollama model manifest digest mismatch', 'runtime must fail closed on manifest mismatch'],
      ['ollama show "$model"', 'runtime may only check baked model availability'],
    ],
  },
  {
    path: 'deploy/azure/helm/sovereign-gpu-inference/values.schema.json',
    patterns: [
      ['"pattern": "^sha256:[a-f0-9]{64}$"', 'schema must require digest-shaped image/model references'],
      ['"const": "inference"', 'schema must require inference node-pool selector'],
      ['"enum": ["ollama"]', 'runtime engine choices must be explicit and reviewed'],
    ],
  },
  {
    path: 'deploy/azure/helm/sovereign-gpu-inference/templates/deployment.yaml',
    patterns: [
      ['image: "{{ .Values.image.repository }}@{{ .Values.image.digest }}"', 'deployment must use digest-only image references'],
      ['signacare.io/image-digest', 'deployment must annotate image digest provenance'],
      ['signacare.io/model-manifest-sha256', 'deployment must annotate model manifest provenance'],
      ['OLLAMA_MODEL_MANIFEST_SHA256', 'deployment must pass manifest digest to runtime'],
      ['OLLAMA_MODEL_MANIFEST_PATH', 'deployment must pass manifest path to runtime'],
      ['nodeSelector:', 'deployment must declare node selector'],
      ['tolerations:', 'deployment must declare taint toleration'],
      ['readinessProbe:', 'deployment must expose readiness proof'],
      ['startupProbe:', 'deployment must expose startup proof'],
    ],
  },
  {
    path: 'deploy/azure/helm/sovereign-gpu-inference/templates/networkpolicy.yaml',
    patterns: [
      ['kind: NetworkPolicy', 'sovereign inference service must have ingress policy'],
      ['policyTypes:', 'network policy must declare enforced policy type'],
      ['allowedIngress', 'ingress must be explicitly scoped via values'],
    ],
  },
  {
    path: 'deploy/azure/helm/sovereign-gpu-inference/templates/poddisruptionbudget.yaml',
    patterns: [
      ['kind: PodDisruptionBudget', 'inference workload must have disruption protection'],
      ['minAvailable:', 'PDB must keep at least one inference pod available'],
    ],
  },
  {
    path: 'deploy/azure/helm/sovereign-gpu-inference/templates/serviceaccount.yaml',
    patterns: [
      ['automountServiceAccountToken: false', 'inference pod must not receive a Kubernetes API token by default'],
    ],
  },
  {
    path: 'deploy/azure/modules/sovereign-gpu-aks.bicep',
    patterns: [
      ['enablePrivateCluster: true', 'AKS API server must be private'],
      ['signacare.io/lane=inference:NoSchedule', 'inference node pool must be tainted'],
      ['signacare.io/lane=training:NoSchedule', 'training node pool must be tainted separately'],
      ['minCount: 0', 'training pool must scale to zero'],
      ['signacare.io/model-manifest-sha256', 'inference pool must publish model manifest provenance'],
    ],
  },
  {
    path: 'docs/operations/runbooks/sovereign-gpu-lane.md',
    patterns: [
      ['deploy/ai/ollama/Dockerfile', 'runbook must reference the repo-owned Ollama Dockerfile path'],
      ['deploy/azure/helm/sovereign-gpu-inference', 'runbook must deploy the repo-owned Helm chart'],
      ['repository@sha256:<image-digest>', 'runbook must show digest-only Helm image shape'],
      ['SOVEREIGN_INFERENCE_MODEL_MANIFEST_SHA256', 'runbook must wire runtime provenance env'],
    ],
  },
  {
    path: 'package.json',
    patterns: [
      ['guard:sovereign-gpu-lane-contract', 'package scripts must expose the sovereign GPU contract guard'],
    ],
  },
];

const forbidden: Array<{ path: string; patterns: Array<[RegExp | string, string]> }> = [
  {
    path: 'deploy/azure/helm/sovereign-gpu-inference/templates/deployment.yaml',
    patterns: [
      [/\.Values\.image\.tag/, 'Helm chart must not support mutable image tags'],
      [/:latest\b/, 'Helm chart must not use latest tags'],
    ],
  },
  {
    path: 'docs/operations/runbooks/sovereign-gpu-lane.md',
    patterns: [
      ['ai-runtime/Dockerfile.ollama', 'stale Dockerfile path must not remain in sovereign runbook'],
      ['NOT shipped in this repo', 'workload chart must be repo-owned, not outsourced to a runbook gap'],
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

for (const check of forbidden) {
  const source = read(check.path);
  for (const [pattern, reason] of check.patterns) {
    const bad = typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
    if (bad) violations.push(`${check.path}: ${reason}`);
  }
}

if (violations.length > 0) {
  console.error('Sovereign GPU lane contract failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('Sovereign GPU lane contract passed.');
