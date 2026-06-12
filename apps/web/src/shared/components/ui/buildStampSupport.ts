export interface WebBuildInfo {
  assetVersion: string;
  commitSha: string;
  displaySha: string;
}

type BuildEnv = Record<string, string | undefined>;

function normalizeEnvValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function shortenCommitSha(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return 'unknown';
  if (/^[a-f0-9]{7,40}$/i.test(normalized)) {
    return normalized.slice(0, 7).toLowerCase();
  }
  return normalized.slice(0, 12);
}

export function resolveWebBuildInfo(env: BuildEnv): WebBuildInfo {
  const assetVersion = normalizeEnvValue(env['VITE_ASSET_VERSION']) ?? 'dev';
  const commitSha = normalizeEnvValue(env['VITE_BUILD_SHA'])
    ?? assetVersion.split('-')[0]
    ?? 'dev';

  return {
    assetVersion,
    commitSha,
    displaySha: shortenCommitSha(commitSha),
  };
}
