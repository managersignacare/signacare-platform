import { z } from 'zod';

export const ReleaseMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  product: z.literal('signacare'),
  service: z.literal('signacare-api'),
  status: z.enum(['versioned', 'unversioned']),
  deployment: z.object({
    activePath: z.literal('linux-app-service'),
    environment: z.string(),
  }),
  source: z.object({
    commitSha: z.string(),
  }),
  pipeline: z.object({
    workflow: z.string(),
    runId: z.string(),
    runAttempt: z.string(),
    origin: z.enum(['github_actions', 'manual_break_glass', 'unknown']),
    promotableToProd: z.boolean(),
    nonPromotableReason: z.string(),
  }),
  build: z.object({
    imageTag: z.string(),
    builtAt: z.string(),
  }),
  artifacts: z.object({
    apiImage: z.string(),
    webImage: z.string(),
    ollamaImage: z.string(),
    whisperImage: z.string(),
  }),
  aiRuntime: z.object({
    ollamaModel: z.string(),
    ollamaModelManifestSha256: z.string(),
    whisperModel: z.string(),
    whisperModelSha256: z.string(),
  }),
  contracts: z.object({
    releaseManifestSha256: z.string(),
    openapiSha256: z.string(),
    configContractSha256: z.string(),
    migrationHead: z.string(),
  }),
  promotion: z.object({
    sourceEnvironment: z.string(),
    sourceAcrName: z.string(),
    sourceReleaseManifestSha256: z.string(),
    sourcePipelineRunId: z.string(),
    promotedAt: z.string(),
  }),
});

export type ReleaseMetadata = z.infer<typeof ReleaseMetadataSchema>;

function readEnv(env: NodeJS.ProcessEnv, key: string): string {
  return env[key]?.trim() || 'unknown';
}

function readBooleanEnv(env: NodeJS.ProcessEnv, key: string): boolean {
  return env[key]?.trim().toLowerCase() === 'true';
}

function readPipelineOrigin(env: NodeJS.ProcessEnv): 'github_actions' | 'manual_break_glass' | 'unknown' {
  const origin = env['SIGNACARE_PIPELINE_ORIGIN']?.trim();
  if (origin === 'github_actions' || origin === 'manual_break_glass') return origin;
  return 'unknown';
}

export function readReleaseMetadata(env: NodeJS.ProcessEnv = process.env): ReleaseMetadata {
  const releaseManifestSha256 = readEnv(env, 'SIGNACARE_RELEASE_MANIFEST_SHA256');

  return {
    schemaVersion: 1,
    product: 'signacare',
    service: 'signacare-api',
    status: releaseManifestSha256 === 'unknown' ? 'unversioned' : 'versioned',
    deployment: {
      activePath: 'linux-app-service',
      environment: readEnv(env, 'SIGNACARE_RELEASE_ENV'),
    },
    source: {
      commitSha: readEnv(env, 'SIGNACARE_COMMIT_SHA'),
    },
    pipeline: {
      workflow: readEnv(env, 'SIGNACARE_PIPELINE_WORKFLOW'),
      runId: readEnv(env, 'SIGNACARE_PIPELINE_RUN_ID'),
      runAttempt: readEnv(env, 'SIGNACARE_PIPELINE_RUN_ATTEMPT'),
      origin: readPipelineOrigin(env),
      promotableToProd: readBooleanEnv(env, 'SIGNACARE_RELEASE_PROMOTABLE_TO_PROD'),
      nonPromotableReason: env['SIGNACARE_RELEASE_NON_PROMOTABLE_REASON']?.trim() || '',
    },
    build: {
      imageTag: readEnv(env, 'SIGNACARE_IMAGE_TAG'),
      builtAt: readEnv(env, 'SIGNACARE_BUILD_TIME'),
    },
    artifacts: {
      apiImage: readEnv(env, 'SIGNACARE_API_IMAGE_DIGEST'),
      webImage: readEnv(env, 'SIGNACARE_WEB_IMAGE_DIGEST'),
      ollamaImage: readEnv(env, 'SIGNACARE_OLLAMA_IMAGE_DIGEST'),
      whisperImage: readEnv(env, 'SIGNACARE_WHISPER_IMAGE_DIGEST'),
    },
    aiRuntime: {
      ollamaModel: readEnv(env, 'SIGNACARE_OLLAMA_MODEL'),
      ollamaModelManifestSha256: readEnv(env, 'SIGNACARE_OLLAMA_MODEL_MANIFEST_SHA256'),
      whisperModel: readEnv(env, 'SIGNACARE_WHISPER_MODEL'),
      whisperModelSha256: readEnv(env, 'SIGNACARE_WHISPER_MODEL_SHA256'),
    },
    contracts: {
      releaseManifestSha256,
      openapiSha256: readEnv(env, 'SIGNACARE_OPENAPI_SHA256'),
      configContractSha256: readEnv(env, 'SIGNACARE_CONFIG_CONTRACT_SHA256'),
      migrationHead: readEnv(env, 'SIGNACARE_MIGRATION_HEAD'),
    },
    promotion: {
      sourceEnvironment: readEnv(env, 'SIGNACARE_PROMOTION_SOURCE_ENV'),
      sourceAcrName: readEnv(env, 'SIGNACARE_PROMOTION_SOURCE_ACR_NAME'),
      sourceReleaseManifestSha256: readEnv(env, 'SIGNACARE_PROMOTION_SOURCE_RELEASE_MANIFEST_SHA256'),
      sourcePipelineRunId: readEnv(env, 'SIGNACARE_PROMOTION_SOURCE_PIPELINE_RUN_ID'),
      promotedAt: readEnv(env, 'SIGNACARE_PROMOTED_AT'),
    },
  };
}
