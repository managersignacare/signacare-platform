// apps/web/src/features/risk-allergies/components/RiskScoreGauge.tsx
import { Box, Typography, LinearProgress, Stack } from '@mui/material';
import type { RiskLevel } from '../types/riskTypes';
import { RISK_LEVEL_CONFIG } from '../types/riskTypes';

interface Props {
  score:    number;
  maxScore: number;
  level:    RiskLevel;
  compact?: boolean;
}

const GAUGE_COLOURS: { threshold: number; colour: string }[] = [
  { threshold: 0.50, colour: '#4E9C82' },
  { threshold: 0.75, colour: '#F0852C' },
  { threshold: 1.00, colour: '#D32F2F' },
];

function gaugeColour(pct: number): string {
  for (const { threshold, colour } of GAUGE_COLOURS) {
    if (pct <= threshold) return colour;
  }
  return '#D32F2F';
}

export const RiskScoreGauge: React.FC<Props> = ({
  score,
  maxScore,
  level,
  compact = false,
}) => {
  const pct     = maxScore > 0 ? Math.min((score / maxScore) * 100, 100) : 0;
  const colour  = gaugeColour(pct / 100);
  const cfg     = RISK_LEVEL_CONFIG[level];

  return (
    <Box>
      {!compact && (
        <Stack direction="row" justifyContent="space-between" alignItems="baseline" mb={0.5}>
          <Typography variant="body2" fontWeight={600}>
            Risk Score
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {score} / {maxScore}
          </Typography>
        </Stack>
      )}

      <Box position="relative" height={compact ? 10 : 18} borderRadius={2} overflow="hidden" bgcolor="#E0E0E0">
        <Box
          position="absolute"
          top={0}
          left={0}
          height="100%"
          width={`${pct}%`}
          borderRadius={2}
          sx={{
            bgcolor:    colour,
            transition: 'width 0.6s ease, background-color 0.6s ease',
          }}
        />
      </Box>

      {!compact && (
        <Box position="relative" mt={0.25}>
          {[
            { pct: 0,   label: '0',            align: 'left'   as const },
            { pct: 50,  label: '50%',          align: 'center' as const },
            { pct: 75,  label: '75%',          align: 'center' as const },
            { pct: 100, label: String(maxScore), align: 'right' as const },
          ].map((m) => (
            <Typography
              key={m.pct}
              variant="caption"
              color="text.disabled"
              sx={{
                position:  'absolute',
                left:      m.pct === 100 ? undefined : `${m.pct}%`,
                right:     m.pct === 100 ? 0 : undefined,
                transform: m.align === 'center' ? 'translateX(-50%)' : undefined,
              }}
            >
              {m.label}
            </Typography>
          ))}
        </Box>
      )}

      {!compact && (
        <Stack direction="row" alignItems="center" spacing={1} mt={compact ? 0.5 : 1.5}>
          <Box
            width={14}
            height={14}
            borderRadius="50%"
            bgcolor={colour}
            flexShrink={0}
          />
          <Typography variant="body2" fontWeight={700} sx={{ color: colour }}>
            {cfg.label} Risk
          </Typography>
          <Typography variant="caption" color="text.secondary">
            ({Math.round(pct)}% of maximum)
          </Typography>
        </Stack>
      )}

      {!compact && (
        <Stack direction="row" spacing={2} mt={1}>
          {(
            [
              { colour: '#4E9C82', label: 'Low (0–49%)' },
              { colour: '#F0852C', label: 'Moderate (50–74%)' },
              { colour: '#D32F2F', label: 'High (75–100%)' },
            ] as const
          ).map((z) => (
            <Stack key={z.label} direction="row" spacing={0.5} alignItems="center">
              <Box width={10} height={10} borderRadius="50%" bgcolor={z.colour} />
              <Typography variant="caption" color="text.secondary">
                {z.label}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}

      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{ display: 'none' }}
        aria-label={`Risk score ${score} of ${maxScore} — ${cfg.label}`}
      />
    </Box>
  );
};
