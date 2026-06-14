import { describe, expect, it } from 'vitest';
import { readReleaseMetadata } from '../../src/shared/releaseMetadata';

describe('readReleaseMetadata', () => {
  it('exposes pipeline provenance and promotability from runtime env vars', () => {
    const metadata = readReleaseMetadata({
      SIGNACARE_RELEASE_MANIFEST_SHA256: 'sha256:manifest',
      SIGNACARE_RELEASE_ENV: 'staging',
      SIGNACARE_COMMIT_SHA: '9708800c5fd5e12198ed588a85b09ad12b02ae2b',
      SIGNACARE_PIPELINE_WORKFLOW: 'Azure Deploy',
      SIGNACARE_PIPELINE_RUN_ID: '284',
      SIGNACARE_PIPELINE_RUN_ATTEMPT: '1',
      SIGNACARE_PIPELINE_ORIGIN: 'github_actions',
      SIGNACARE_RELEASE_PROMOTABLE_TO_PROD: 'true',
      SIGNACARE_RELEASE_NON_PROMOTABLE_REASON: '',
      SIGNACARE_IMAGE_TAG: '9708800c-20260607102809',
      SIGNACARE_BUILD_TIME: '2026-06-07T10:28:09.000Z',
      SIGNACARE_API_IMAGE_DIGEST: 'signacarecrstaging.azurecr.io/signacare-api@sha256:api',
      SIGNACARE_WEB_IMAGE_DIGEST: 'signacarecrstaging.azurecr.io/signacare-web@sha256:web',
      SIGNACARE_OLLAMA_IMAGE_DIGEST: 'signacarecrstaging.azurecr.io/signacare-ollama@sha256:ollama',
      SIGNACARE_WHISPER_IMAGE_DIGEST: 'signacarecrstaging.azurecr.io/signacare-whisper@sha256:whisper',
      SIGNACARE_OLLAMA_MODEL: 'llama3.2:signacare-35f39aa1',
      SIGNACARE_OLLAMA_MODEL_MANIFEST_SHA256: 'sha256:ollama-model',
      SIGNACARE_WHISPER_MODEL: 'small',
      SIGNACARE_WHISPER_MODEL_SHA256: 'sha256:whisper-model',
      SIGNACARE_OPENAPI_SHA256: 'sha256:openapi',
      SIGNACARE_CONFIG_CONTRACT_SHA256: 'sha256:config',
      SIGNACARE_MIGRATION_HEAD: '20260701000107_ai_provenance.ts',
      SIGNACARE_PROMOTION_SOURCE_ENV: '',
      SIGNACARE_PROMOTION_SOURCE_ACR_NAME: '',
      SIGNACARE_PROMOTION_SOURCE_RELEASE_MANIFEST_SHA256: '',
      SIGNACARE_PROMOTION_SOURCE_PIPELINE_RUN_ID: '',
      SIGNACARE_PROMOTED_AT: '',
    });

    expect(metadata.pipeline).toEqual({
      workflow: 'Azure Deploy',
      runId: '284',
      runAttempt: '1',
      origin: 'github_actions',
      promotableToProd: true,
      nonPromotableReason: '',
    });
    expect(metadata.promotion).toEqual({
      sourceEnvironment: 'unknown',
      sourceAcrName: 'unknown',
      sourceReleaseManifestSha256: 'unknown',
      sourcePipelineRunId: 'unknown',
      promotedAt: 'unknown',
    });
  });

  it('fails closed to unknown/non-promotable provenance when env vars are absent', () => {
    const metadata = readReleaseMetadata({
      SIGNACARE_RELEASE_MANIFEST_SHA256: 'sha256:manifest',
    });

    expect(metadata.pipeline.origin).toBe('unknown');
    expect(metadata.pipeline.promotableToProd).toBe(false);
    expect(metadata.pipeline.nonPromotableReason).toBe('');
    expect(metadata.promotion).toEqual({
      sourceEnvironment: 'unknown',
      sourceAcrName: 'unknown',
      sourceReleaseManifestSha256: 'unknown',
      sourcePipelineRunId: 'unknown',
      promotedAt: 'unknown',
    });
  });
});
