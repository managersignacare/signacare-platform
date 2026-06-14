import { Box, Tooltip, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { sharedBuildKeys } from '../../queryKeys';
import { resolveWebBuildInfo, shortenCommitSha } from './buildStampSupport';

interface ApiHealthPayload {
  release?: {
    status?: 'versioned' | 'unversioned';
    commitSha?: string;
  };
}

const webBuild = resolveWebBuildInfo(import.meta.env as Record<string, string | undefined>);

function resolveApiHealthUrl(): string {
  if (typeof window === 'undefined') return '/health';
  const origin = window.location.origin;
  if (origin.includes('-web-')) {
    return `${origin.replace('-web-', '-api-')}/health`;
  }
  if (origin.includes('-web.')) {
    return `${origin.replace('-web.', '-api.')}/health`;
  }
  return '/health';
}

async function fetchApiHealth() {
  const response = await fetch(resolveApiHealthUrl(), {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Health endpoint returned ${response.status}`);
  }

  const payload = await response.json() as ApiHealthPayload;
  return {
    release: {
      status: payload.release?.status,
      commitSha: payload.release?.commitSha,
    },
  };
}

export function BuildStamp(): React.ReactElement {
  const { data, isError } = useQuery({
    queryKey: sharedBuildKeys.apiHealth(),
    queryFn: fetchApiHealth,
    staleTime: 60_000,
    retry: 0,
  });

  const apiCommitSha = data?.release?.commitSha?.trim() || null;
  const apiDisplaySha = isError
    ? 'unreachable'
    : shortenCommitSha(apiCommitSha);
  const apiStatus = data?.release?.status ?? (isError ? 'unreachable' : 'unknown');

  return (
    <Box
      sx={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        zIndex: 1400,
        pointerEvents: 'none',
      }}
    >
      <Tooltip
        arrow
        placement="top-end"
        title={(
          <Box>
            <Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>
              Release Diagnostics
            </Typography>
            <Typography variant="caption" sx={{ display: 'block' }}>
              Web bundle: {webBuild.commitSha}
            </Typography>
            <Typography variant="caption" sx={{ display: 'block' }}>
              Asset version: {webBuild.assetVersion}
            </Typography>
            <Typography variant="caption" sx={{ display: 'block' }}>
              API release: {apiCommitSha ?? 'unknown'}
            </Typography>
            <Typography variant="caption" sx={{ display: 'block' }}>
              API status: {apiStatus}
            </Typography>
          </Box>
        )}
      >
        <Box
          sx={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1,
            py: 0.5,
            borderRadius: 999,
            border: '1px solid rgba(61, 72, 75, 0.16)',
            bgcolor: 'rgba(255, 255, 255, 0.94)',
            boxShadow: '0 6px 20px rgba(17, 24, 39, 0.10)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#3D484B' }}>
            Web {webBuild.displaySha}
          </Typography>
          <Typography sx={{ fontSize: 10, color: '#9CA3AF' }}>|</Typography>
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#3D484B' }}>
            API {apiDisplaySha}
          </Typography>
        </Box>
      </Tooltip>
    </Box>
  );
}
