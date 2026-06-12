import { describe, expect, it } from 'vitest';
import { resolveWebBuildInfo, shortenCommitSha } from './buildStampSupport';

describe('shortenCommitSha', () => {
  it('shortens canonical git hashes to 7 characters', () => {
    expect(shortenCommitSha('5E0B86F6F8A3D4C2B1A0E9D8C7B6A5F4E3D2C1B0')).toBe('5e0b86f');
  });

  it('returns a stable fallback for non-hash labels', () => {
    expect(shortenCommitSha('dev-build-local')).toBe('dev-build-lo');
  });
});

describe('resolveWebBuildInfo', () => {
  it('prefers VITE_BUILD_SHA when present', () => {
    expect(resolveWebBuildInfo({
      VITE_BUILD_SHA: '5e0b86f6f8a3d4c2b1a0e9d8c7b6a5f4e3d2c1b0',
      VITE_ASSET_VERSION: '5e0b86f6-20260606220000',
    })).toMatchObject({
      assetVersion: '5e0b86f6-20260606220000',
      commitSha: '5e0b86f6f8a3d4c2b1a0e9d8c7b6a5f4e3d2c1b0',
      displaySha: '5e0b86f',
    });
  });

  it('falls back to the asset version prefix when commit SHA is absent', () => {
    expect(resolveWebBuildInfo({
      VITE_ASSET_VERSION: '2be4b380-20260601120000',
    })).toMatchObject({
      assetVersion: '2be4b380-20260601120000',
      commitSha: '2be4b380',
      displaySha: '2be4b38',
    });
  });
});
