#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';

const modulePath = fileURLToPath(import.meta.url);
const root = resolve(dirname(modulePath), '..', '..');
const outputPath = resolve(root, 'artifacts', 'release', 'release-manifest.json');
const checksumPath = resolve(root, 'artifacts', 'release', 'release-manifest.json.sha256');

function envFrom(source, name, fallback = '') {
  return source[name] ?? fallback;
}

function requiredEnv(source, name) {
  const value = envFrom(source, name).trim();
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function sha256Buffer(buffer) {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

function sha256File(relPath) {
  return sha256Buffer(readFileSync(resolve(root, relPath)));
}

function sha256Files(relPaths) {
  const hash = createHash('sha256');
  for (const relPath of relPaths) {
    const absPath = resolve(root, relPath);
    if (!existsSync(absPath)) throw new Error(`Missing release contract input ${relPath}`);
    hash.update(`${relPath}\n`);
    hash.update(readFileSync(absPath));
    hash.update('\n');
  }
  return `sha256:${hash.digest('hex')}`;
}

function imageArtifact(name, ref) {
  if (!ref) return null;
  if (ref.includes(':latest')) throw new Error(`${name} image must not use mutable :latest`);
  const match = ref.match(/^(.+)@(sha256:[a-f0-9]{64})$/);
  if (!match) throw new Error(`${name} image must be an immutable repo@sha256 digest ref: ${ref}`);
  return {
    ref,
    repository: match[1],
    digest: match[2],
  };
}

function migrationHead() {
  const migrationsDir = resolve(root, 'apps', 'api', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
  if (files.length === 0) throw new Error('No API migrations found');
  return basename(files[files.length - 1]);
}

export function workflowRunUrl(source = process.env) {
  const serverUrl = envFrom(source, 'GITHUB_SERVER_URL', 'https://github.com');
  const repository = envFrom(source, 'GITHUB_REPOSITORY');
  const runId = envFrom(source, 'GITHUB_RUN_ID');
  return repository && runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : '';
}

export function derivePipelineProvenance(source = process.env, releaseEnvironment) {
  const workflow = envFrom(source, 'GITHUB_WORKFLOW', 'Azure Deploy').trim() || 'Azure Deploy';
  const runId = envFrom(source, 'GITHUB_RUN_ID').trim();
  const runAttempt = envFrom(source, 'GITHUB_RUN_ATTEMPT').trim();
  const origin = envFrom(source, 'GITHUB_ACTIONS') === 'true' && /^[0-9]+$/.test(runId)
    ? 'github_actions'
    : 'manual_break_glass';
  const promotableToProd = origin === 'github_actions' && releaseEnvironment === 'staging';
  const nonPromotableReason = promotableToProd
    ? ''
    : origin !== 'github_actions'
      ? 'Only GitHub Actions-built staging releases can be promoted to prod.'
      : releaseEnvironment === 'prod'
        ? 'Production manifests are terminal deployments and cannot be promoted further.'
        : `Releases for environment ${releaseEnvironment} are not promotable to prod.`;

  return {
    workflow,
    runId,
    runAttempt,
    runUrl: workflowRunUrl(source),
    origin,
    promotableToProd,
    nonPromotableReason,
  };
}

export function buildReleaseManifest(source = process.env, builtAt = new Date().toISOString()) {
  const releaseEnvironment = requiredEnv(source, 'SIGNACARE_RELEASE_ENV');

  return {
    schemaVersion: 1,
    product: 'signacare',
    deployment: {
      activePath: 'linux-app-service',
      environment: releaseEnvironment,
      registry: {
        acrName: requiredEnv(source, 'SIGNACARE_ACR_NAME'),
      },
    },
    source: {
      commitSha: requiredEnv(source, 'GITHUB_SHA'),
      refName: envFrom(source, 'GITHUB_REF_NAME'),
    },
    pipeline: derivePipelineProvenance(source, releaseEnvironment),
    build: {
      imageTag: requiredEnv(source, 'SIGNACARE_IMAGE_TAG'),
      builtAt,
    },
    artifacts: {
      apiImage: imageArtifact('api', requiredEnv(source, 'SIGNACARE_API_IMAGE')),
      webImage: imageArtifact('web', requiredEnv(source, 'SIGNACARE_WEB_IMAGE')),
      ollamaImage: imageArtifact('ollama', envFrom(source, 'SIGNACARE_OLLAMA_IMAGE')),
      whisperImage: imageArtifact('whisper', envFrom(source, 'SIGNACARE_WHISPER_IMAGE')),
    },
    aiRuntime: {
      ollamaModel: envFrom(source, 'SIGNACARE_OLLAMA_MODEL'),
      ollamaModelManifestSha256: envFrom(source, 'SIGNACARE_OLLAMA_MODEL_MANIFEST_SHA256'),
      whisperModel: envFrom(source, 'SIGNACARE_WHISPER_MODEL'),
      whisperModelSha256: envFrom(source, 'SIGNACARE_WHISPER_MODEL_SHA256'),
    },
    contracts: {
      openapiSha256: sha256File('packages/shared/src/generated/openapi.json'),
      configContractSha256: sha256Files([
        '.env.example',
        'apps/api/.env.example',
        'apps/web/.env.example',
        'apps/emr-gateway/.env.example',
        'docs/operations/env-contract-catalog.md',
      ]),
      migrationHead: migrationHead(),
    },
  };
}

export function writeReleaseManifest(source = process.env) {
  const manifest = buildReleaseManifest(source);
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestSha256 = sha256Buffer(Buffer.from(manifestJson, 'utf8'));

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, manifestJson);
  writeFileSync(checksumPath, `${manifestSha256}  release-manifest.json\n`);

  const outputs = {
    release_manifest_path: 'artifacts/release/release-manifest.json',
    release_manifest_sha256: manifestSha256,
    openapi_sha256: manifest.contracts.openapiSha256,
    config_contract_sha256: manifest.contracts.configContractSha256,
    migration_head: manifest.contracts.migrationHead,
    commit_sha: manifest.source.commitSha,
    pipeline_workflow: manifest.pipeline.workflow,
    pipeline_run_id: manifest.pipeline.runId,
    pipeline_origin: manifest.pipeline.origin,
    release_promotable_to_prod: String(manifest.pipeline.promotableToProd),
    release_non_promotable_reason: manifest.pipeline.nonPromotableReason,
    built_at: manifest.build.builtAt,
  };

  if (source.GITHUB_OUTPUT) {
    const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
    writeFileSync(source.GITHUB_OUTPUT, `${lines.join('\n')}\n`, { flag: 'a' });
  }

  return { manifest, manifestSha256, outputs };
}

function isDirectInvocation() {
  return process.argv[1] && resolve(process.argv[1]) === modulePath;
}

if (isDirectInvocation()) {
  const { manifestSha256, outputs } = writeReleaseManifest(process.env);
  console.log(`Created ${outputs.release_manifest_path}`);
  console.log(`Release manifest ${manifestSha256}`);
}
