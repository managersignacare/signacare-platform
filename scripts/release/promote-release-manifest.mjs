#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const root = resolve(dirname(modulePath), '..', '..');
const manifestPath = resolve(root, 'artifacts', 'release', 'release-manifest.json');
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

function imageArtifact(name, sourceArtifact, targetAcrName) {
  if (!sourceArtifact) return null;
  if (!sourceArtifact.digest?.match(/^sha256:[a-f0-9]{64}$/)) {
    throw new Error(`${name} source artifact has invalid digest: ${sourceArtifact.digest ?? 'missing'}`);
  }
  const sourceRepository = sourceArtifact.repository ?? '';
  const repoPath = sourceRepository.split('.azurecr.io/')[1];
  if (!repoPath) throw new Error(`${name} source repository is not an ACR repository: ${sourceRepository}`);
  const repository = `${targetAcrName}.azurecr.io/${repoPath}`;
  return {
    ref: `${repository}@${sourceArtifact.digest}`,
    repository,
    digest: sourceArtifact.digest,
    promotedFromRef: sourceArtifact.ref,
  };
}

export function workflowRunUrl(source = process.env) {
  const serverUrl = envFrom(source, 'GITHUB_SERVER_URL', 'https://github.com');
  const repository = envFrom(source, 'GITHUB_REPOSITORY');
  const runId = envFrom(source, 'GITHUB_RUN_ID');
  return repository && runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : '';
}

export function assertPromotableStagingManifest(source) {
  if (source?.deployment?.environment !== 'staging') {
    throw new Error(`Production promotion requires a staging source manifest, received ${source?.deployment?.environment ?? 'missing'}`);
  }
  if (source?.deployment?.activePath !== 'linux-app-service') {
    throw new Error(`Source manifest active path must be linux-app-service, received ${source?.deployment?.activePath ?? 'missing'}`);
  }
  if (source?.pipeline?.origin !== 'github_actions') {
    throw new Error('Only GitHub Actions-built staging manifests can be promoted to prod.');
  }
  if (source?.pipeline?.promotableToProd !== true) {
    throw new Error('Staging source manifest is not marked promotable to prod.');
  }
  if (source?.pipeline?.workflow !== 'Azure Deploy') {
    throw new Error(`Staging source manifest must come from the Azure Deploy workflow, received ${source?.pipeline?.workflow ?? 'missing'}`);
  }
  if (!String(source?.pipeline?.runId ?? '').match(/^[0-9]+$/)) {
    throw new Error('Staging source manifest must record a numeric GitHub Actions run ID.');
  }
}

export function buildPromotionPipeline(source = process.env) {
  const runId = envFrom(source, 'GITHUB_RUN_ID').trim();
  const origin = envFrom(source, 'GITHUB_ACTIONS') === 'true' && /^[0-9]+$/.test(runId)
    ? 'github_actions'
    : 'manual_break_glass';
  return {
    workflow: envFrom(source, 'GITHUB_WORKFLOW', 'Azure Deploy').trim() || 'Azure Deploy',
    runId,
    runAttempt: envFrom(source, 'GITHUB_RUN_ATTEMPT').trim(),
    runUrl: workflowRunUrl(source),
    origin,
    promotableToProd: false,
    nonPromotableReason: 'Production manifests are terminal deployments and cannot be promoted further.',
  };
}

export function buildPromotionManifest(sourceManifest, sourceManifestSha256, source = process.env, promotedAt = new Date().toISOString()) {
  const targetEnvironment = requiredEnv(source, 'SIGNACARE_RELEASE_ENV');
  const targetAcrName = requiredEnv(source, 'SIGNACARE_TARGET_ACR_NAME');
  if (targetEnvironment !== 'prod') {
    throw new Error(`Promotion manifest is only valid for prod, received ${targetEnvironment}`);
  }

  assertPromotableStagingManifest(sourceManifest);

  const expectedCommitSha = envFrom(source, 'SIGNACARE_EXPECTED_COMMIT_SHA').trim();
  if (expectedCommitSha && sourceManifest?.source?.commitSha !== expectedCommitSha) {
    throw new Error('Source manifest commit SHA does not match SIGNACARE_EXPECTED_COMMIT_SHA');
  }
  if (sourceManifest?.build?.imageTag !== requiredEnv(source, 'SIGNACARE_EXPECTED_IMAGE_TAG')) {
    throw new Error('Source manifest image tag does not match the requested staging image tag');
  }

  const promoted = {
    ...sourceManifest,
    deployment: {
      ...sourceManifest.deployment,
      environment: targetEnvironment,
      registry: {
        acrName: targetAcrName,
      },
    },
    pipeline: buildPromotionPipeline(source),
    artifacts: {
      apiImage: imageArtifact('api', sourceManifest.artifacts?.apiImage, targetAcrName),
      webImage: imageArtifact('web', sourceManifest.artifacts?.webImage, targetAcrName),
      ollamaImage: imageArtifact('ollama', sourceManifest.artifacts?.ollamaImage, targetAcrName),
      whisperImage: imageArtifact('whisper', sourceManifest.artifacts?.whisperImage, targetAcrName),
    },
    promotion: {
      strategy: 'staging-digest-import',
      sourceEnvironment: sourceManifest.deployment.environment,
      sourceAcrName: sourceManifest.deployment.registry?.acrName ?? '',
      sourceReleaseManifestSha256: sourceManifestSha256,
      sourcePipelineRunId: sourceManifest.pipeline?.runId ?? '',
      sourcePipelineRunUrl: sourceManifest.pipeline?.runUrl ?? '',
      promotedAt,
      promotedByWorkflowRunId: envFrom(source, 'GITHUB_RUN_ID'),
      digestPolicy: 'preserve-source-manifest-digests',
    },
  };

  if (!promoted.artifacts.apiImage || !promoted.artifacts.webImage) {
    throw new Error('Promotion manifest requires API and web image artifacts');
  }

  return promoted;
}

export function writePromotionManifest(source = process.env) {
  if (!existsSync(manifestPath)) {
    throw new Error('Missing staging release manifest at artifacts/release/release-manifest.json');
  }

  const sourceManifestJson = readFileSync(manifestPath);
  const sourceManifestSha256 = sha256Buffer(sourceManifestJson);
  const sourceManifest = JSON.parse(sourceManifestJson.toString('utf8'));
  const promoted = buildPromotionManifest(sourceManifest, sourceManifestSha256, source);
  const promotedJson = `${JSON.stringify(promoted, null, 2)}\n`;
  const promotedSha256 = sha256Buffer(Buffer.from(promotedJson, 'utf8'));
  writeFileSync(manifestPath, promotedJson);
  writeFileSync(checksumPath, `${promotedSha256}  release-manifest.json\n`);

  const outputs = {
    image_tag: promoted.build.imageTag,
    api_image: promoted.artifacts.apiImage.ref,
    web_image: promoted.artifacts.webImage.ref,
    ollama_image: promoted.artifacts.ollamaImage?.ref ?? '',
    whisper_image: promoted.artifacts.whisperImage?.ref ?? '',
    release_manifest_sha256: promotedSha256,
    openapi_sha256: promoted.contracts.openapiSha256,
    config_contract_sha256: promoted.contracts.configContractSha256,
    migration_head: promoted.contracts.migrationHead,
    commit_sha: promoted.source.commitSha,
    pipeline_workflow: promoted.pipeline.workflow,
    pipeline_run_id: promoted.pipeline.runId,
    pipeline_origin: promoted.pipeline.origin,
    release_promotable_to_prod: String(promoted.pipeline.promotableToProd),
    release_non_promotable_reason: promoted.pipeline.nonPromotableReason,
    built_at: promoted.build.builtAt,
    promotion_source_env: promoted.promotion.sourceEnvironment,
    promotion_source_acr_name: promoted.promotion.sourceAcrName,
    promotion_source_release_manifest_sha256: promoted.promotion.sourceReleaseManifestSha256,
    promotion_source_pipeline_run_id: promoted.promotion.sourcePipelineRunId,
    promoted_at: promoted.promotion.promotedAt,
  };

  if (source.GITHUB_OUTPUT) {
    const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
    writeFileSync(source.GITHUB_OUTPUT, `${lines.join('\n')}\n`, { flag: 'a' });
  }

  return { promoted, promotedSha256, sourceManifestSha256, outputs };
}

function isDirectInvocation() {
  return process.argv[1] && resolve(process.argv[1]) === modulePath;
}

if (isDirectInvocation()) {
  const { promotedSha256, sourceManifestSha256 } = writePromotionManifest(process.env);
  console.log(`Promoted staging release manifest ${sourceManifestSha256} to prod manifest ${promotedSha256}`);
}
