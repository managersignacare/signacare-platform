import {
  Box,
  Typography,
  Chip,
  Stack,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorIcon from '@mui/icons-material/Error';
import type { PatientFlagResponse } from '@signacare/shared';

interface Props {
  flags: PatientFlagResponse[];
}

const HIGH_SEVERITY = new Set(['high', 'critical']);

const SEVERITY_COLOR = (severity: string): string => {
  if (severity === 'critical') return '#D32F2F';
  return '#F0852C';
};

const SEVERITY_BG = (severity: string): string => {
  if (severity === 'critical') return 'rgba(211,47,47,0.08)';
  return 'rgba(240,133,44,0.09)';
};

export function PatientBanner({
  flags,
}: Props): React.ReactElement | null {
  const visibleFlags = flags.filter(
    (f) =>
      f.status === 'active' &&
      f.isHeaderFlag &&
      HIGH_SEVERITY.has(f.severity),
  );

  if (visibleFlags.length === 0) return null;

  const sorted = [...visibleFlags].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, high: 1 };
    return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
  });

  const topSeverity = sorted[0]?.severity ?? 'high';
  const borderColor = SEVERITY_COLOR(topSeverity);
  const bgColor = SEVERITY_BG(topSeverity);
  const isCritical = topSeverity === 'critical';

  return (
    <Box
      role="alert"
      aria-live="polite"
      sx={{
        borderLeft: `5px solid ${borderColor}`,
        bgcolor: bgColor,
        px: 2,
        py: 1,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        flexWrap: 'wrap',
      }}
    >
      {isCritical ? (
        <ErrorIcon sx={{ color: borderColor, mt: 0.15, flexShrink: 0, fontSize: 'small' }} />
      ) : (
        <WarningAmberIcon sx={{ color: borderColor, mt: 0.15, flexShrink: 0, fontSize: 'small' }} />
      )}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center" sx={{ flex: 1 }}>
        {sorted.map((flag) => {
          const color = SEVERITY_COLOR(flag.severity);
          return (
            <Chip
              key={flag.id}
              icon={
                flag.severity === 'critical' ? (
                  <ErrorIcon style={{ color }} />
                ) : (
                  <WarningAmberIcon style={{ color }} />
                )
              }
              label={
                <Typography variant="caption" fontWeight={600} sx={{ color: flag.category.toUpperCase() }}>
                  {flag.title ?? flag.category}
                </Typography>
              }
              size="small"
              variant="outlined"
              sx={{ borderColor: color, bgcolor: 'transparent', '& .MuiChip-icon': { ml: 0.5 } }}
            />
          );
        })}
      </Stack>
    </Box>
  );
}
