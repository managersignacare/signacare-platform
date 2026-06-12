#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const AUTH_SMOKE_SKIP_ENV = 'SMOKE_AUTH' + '_CHECK_SKIP_TOKEN';
const RATING_SMOKE_SKIP_TOKEN = 'reviewed-rating' + '-scale-smoke' + '-skip';
const AI_RUNTIME_SMOKE_SKIP_TOKEN = 'reviewed-ai' + '-runtime-smoke' + '-skip';
const STALE_OLLAMA_MANIFEST_LABEL = 'a80c' + '4f17';

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

const checks: Array<{ path: string; pass: (source: string) => boolean; reason: string }> = [
  {
    path: '.github/workflows/azure-deploy.yml',
    pass: (source) => /docker buildx imagetools inspect "\$IMAGE" --format '\{\{\.Manifest\.Digest\}\}'/.test(source)
      && !/signacare-(api|web):latest/.test(source)
      && /deploy\/whisper-server\/\*\*/.test(source)
      && /deploy-ai-runtime-services\.sh/.test(source)
      && /AI runtime service images \(staging only\)/.test(source)
      && source.includes("needs.build-and-push.outputs.env_name == 'staging'")
      && /OLLAMA_MODEL_NAME: llama3\.2:signacare-35f39aa1/.test(source)
      && /OLLAMA_MODEL_MANIFEST_SHA256: sha256:35f39aa10ab6344466b66afa2681446fc66e9631e013b047068177842d9afc58/.test(source)
      && !/enable-ai-runtime\.sh/.test(source)
      && !/ai-runtime-compose/.test(source)
      && !source.includes(STALE_OLLAMA_MANIFEST_LABEL),
    reason: 'Azure deploy must deploy immutable digest refs, avoid latest tags, rebuild on Whisper server changes, and use the dedicated AI runtime service path.',
  },
  {
    path: 'deploy/azure/deploy-ai-runtime-services.sh',
    pass: (source) => /Usage: \$0 staging\|prod/.test(source)
      && /require_digest_ref AI_OLLAMA_IMAGE/.test(source)
      && /require_digest_ref AI_WHISPER_IMAGE/.test(source)
      && /AI_RUNTIME_PROD_APPROVED/.test(source)
      && /config access-restriction add/.test(source)
      && /config access-restriction remove/.test(source)
      && /OLLAMA_URL="https:\/\/\$\{OLLAMA_HOST\}"/.test(source)
      && /WHISPER_API_URL="https:\/\/\$\{WHISPER_HOST\}"/.test(source)
      && /SIGNACARE_OLLAMA_MODEL/.test(source)
      && !/az acr build/.test(source)
      && !/deployment slot/.test(source)
      && !/docker-compose|compose\.template|COMPOSE_TEMPLATE/.test(source),
    reason: 'AI runtime helper must deploy dedicated services by digest, be idempotent, restrict ingress, and must not use the retired compose canary path.',
  },
  {
    path: 'deploy/ai/ollama/entrypoint.sh',
    pass: (source) => !/\bollama pull\b/.test(source)
      && /ollama show "\$model"/.test(source)
      && /Required baked Ollama model is missing/.test(source),
    reason: 'Ollama container must fail closed if the baked model is missing instead of pulling mutable tags at runtime.',
  },
  {
    path: 'deploy/ai/ollama/Dockerfile',
    pass: (source) => /FROM ollama\/ollama@sha256:[a-f0-9]{64}/.test(source)
      && !/OLLAMA_REGISTRY_TAG/.test(source)
      && /OLLAMA_MODEL_MANIFEST_SHA256=sha256:[a-f0-9]{64}/.test(source)
      && /COPY deploy\/ai\/ollama\/llama3\.2-35f39aa1\.manifest\.json/.test(source)
      && /test "\$actual" = "\$OLLAMA_MODEL_MANIFEST_SHA256"/.test(source)
      && /registry\.ollama\.ai\/v2\/\{registry_path\}\/blobs\/\{digest\}/.test(source)
      && /hashlib\.sha256\(target\.read_bytes\(\)\)\.hexdigest\(\)/.test(source)
      && !/\bollama pull\b/.test(source)
      && !/:latest/.test(source),
    reason: 'Ollama image must pin the base image by digest, validate a vendored model manifest, download exact blob digests, and avoid mutable tags/runtime pulls.',
  },
  {
    path: 'deploy/ai/whisper/Dockerfile',
    pass: (source) => /FROM python@sha256:[a-f0-9]{64}/.test(source)
      && /WHISPER_MODEL_SHA256=[a-f0-9]{64}/.test(source)
      && /sha256sum "\$target"/.test(source)
      && /pip==26\.1\.2/.test(source)
      && /torch==2\.12\.0/.test(source)
      && /flask==3\.1\.3/.test(source)
      && /flask-cors==6\.0\.2/.test(source)
      && /gunicorn==23\.0\.0/.test(source)
      && /openai-whisper==20250625/.test(source)
      && /whisper\.load_model/.test(source),
    reason: 'Whisper image must pin its base image/dependencies and verify the selected model checksum before baking it into the image cache.',
  },
  {
    path: 'deploy/azure/post-deploy-smoke.sh',
    pass: (source) => /SMOKE_LOGIN_EMAIL/.test(source)
      && /SMOKE_LOGIN_PASSWORD/.test(source)
      && !source.includes(AUTH_SMOKE_SKIP_ENV)
      && !source.includes(RATING_SMOKE_SKIP_TOKEN),
    reason: 'Staging/prod rating-scale smoke must require credentials and must not allow static skip tokens.',
  },
  {
    path: 'deploy/azure/post-deploy-smoke.sh',
    pass: (source) => /check_ai_runtime_smoke/.test(source)
      && /AZURE_AI_RUNTIME_ENABLED/.test(source)
      && !source.includes(AI_RUNTIME_SMOKE_SKIP_TOKEN)
      && /\/api\/v1\/llm\/whisper\/status/.test(source)
      && /\/api\/v1\/llm\/models/.test(source)
      && /\/api\/v1\/llm\/clinical-ai/.test(source)
      && /AI unavailable/.test(source),
    reason: 'AI runtime smoke must prove Whisper health, Ollama model availability, and a non-fallback clinical AI response when sidecars are enabled without static skip tokens.',
  },
  {
    path: 'apps/api/src/mcp/localLlmAgent.ts',
    pass: (source) => /AI_MODEL_UNAVAILABLE/.test(source)
      && /new AppError/.test(source)
      && !source.includes('[AI unavailable'),
    reason: 'LLM unavailability must use canonical structured AppError responses, not generated-looking fallback text.',
  },
];

const violations: string[] = [];

for (const check of checks) {
  const source = read(check.path);
  if (!check.pass(source)) {
    violations.push(`${check.path}: ${check.reason}`);
  }
}

if (violations.length > 0) {
  console.error('AI runtime immutable deployment contract failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('AI runtime immutable deployment contract passed.');
