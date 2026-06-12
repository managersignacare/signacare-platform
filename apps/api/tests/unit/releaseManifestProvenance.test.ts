import { describe, expect, it } from 'vitest';

const { derivePipelineProvenance } = await import('../../../../scripts/release/create-release-manifest.mjs');
const { assertPromotableStagingManifest } = await import('../../../../scripts/release/promote-release-manifest.mjs');

describe('release manifest provenance', () => {
  it('marks local break-glass manifests as non-promotable', () => {
    const provenance = derivePipelineProvenance({
      GITHUB_ACTIONS: 'false',
      GITHUB_WORKFLOW: '',
      GITHUB_RUN_ID: '',
      GITHUB_RUN_ATTEMPT: '',
    }, 'staging');

    expect(provenance.origin).toBe('manual_break_glass');
    expect(provenance.promotableToProd).toBe(false);
    expect(provenance.nonPromotableReason).toBe('Only GitHub Actions-built staging releases can be promoted to prod.');
  });

  it('rejects break-glass staging manifests from prod promotion', () => {
    expect(() => assertPromotableStagingManifest({
      deployment: {
        environment: 'staging',
        activePath: 'linux-app-service',
      },
      pipeline: {
        workflow: 'Azure Deploy',
        runId: 'manual-20260607-02',
        origin: 'manual_break_glass',
        promotableToProd: false,
      },
    })).toThrow('Only GitHub Actions-built staging manifests can be promoted to prod.');
  });

  it('accepts GitHub Actions-built staging manifests for prod promotion', () => {
    expect(() => assertPromotableStagingManifest({
      deployment: {
        environment: 'staging',
        activePath: 'linux-app-service',
      },
      pipeline: {
        workflow: 'Azure Deploy',
        runId: '284',
        origin: 'github_actions',
        promotableToProd: true,
      },
    })).not.toThrow();
  });
});
