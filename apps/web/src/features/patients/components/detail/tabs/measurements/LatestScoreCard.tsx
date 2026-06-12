/**
 * "Latest cross-sectional score" card.
 *
 * Operator brief:
 *   - "Latest cross-sectional score must be visually shown."
 *   - "Every visual point must carry provenance: instrument, rater type,
 *     source, date, episode if available, completedBy/submittedBy where
 *     available."
 *   - "Pair status colour with icon + label, never colour alone."
 *
 * Shows: instrument display name, raw score / max, severity chip,
 * completion date, provenance ("Clinician — NOCC outcome" or similar),
 * trend descriptor (improved/worsened/stable) with arrow.
 */
import type React from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import type { MeasurementSeries } from '@signacare/shared';
import {
  describeMeasurementProvenance,
  describeRelativeAge,
  describeTrendDirection,
  isMeasurementStale,
} from './measurementVisualHelpers';

interface LatestScoreCardProps {
  series: MeasurementSeries;
  /** Border colour. Optional — surfaces override per family palette. */
  accentColor?: string;
  /** Click handler — surface uses this to open the source row. */
  onClick?: () => void;
}

function trendIcon(tone: ReturnType<typeof describeTrendDirection>['tone']) {
  switch (tone) {
    case 'positive': return <TrendingDownIcon fontSize="small" aria-hidden="true" />;
    case 'negative': return <TrendingUpIcon fontSize="small" aria-hidden="true" />;
    case 'neutral': return <TrendingFlatIcon fontSize="small" aria-hidden="true" />;
    default: return <HelpOutlineIcon fontSize="small" aria-hidden="true" />;
  }
}

export function LatestScoreCard({ series, accentColor = '#327C8D', onClick }: LatestScoreCardProps) {
  const latest = series.latestPoint;
  const trendDescriptor = describeTrendDirection(series.trendSummary.direction);
  const stale = latest ? isMeasurementStale(latest.completedAt) : false;
  const provenance = describeMeasurementProvenance(series.source);
  const tone = trendDescriptor.tone;
  const toneColor: Record<typeof tone, string> = {
    positive: '#2E7D32',
    negative: '#C62828',
    neutral: '#666',
    unknown: '#999',
  };

  // Operator brief: keyboard-only clinicians depend on Enter/Space.
  // When `onClick` is provided, expose role+tabIndex+onKeyDown UNCONDITIONALLY
  // so the lint rule + screen reader picks them up; when not provided, the
  // card is purely informational and renders as a passive Box.
  const interactiveProps = onClick
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        },
      }
    : {};

  return (
    <Box
      {...interactiveProps}
      aria-label={`${series.displayName}, latest score ${latest?.rawScore ?? 'none'}${latest?.maxScore != null ? ` of ${latest.maxScore}` : ''}${latest?.severityLabel ? `, severity ${latest.severityLabel}` : ''}, ${trendDescriptor.label}, ${provenance}`}
      sx={{
        p: 1.5,
        border: `1px solid ${accentColor}`,
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: 2,
        bgcolor: '#FFFFFF',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.15s',
        '&:hover': onClick ? { boxShadow: 2 } : {},
        '&:focus-visible': onClick ? { outline: `2px solid ${accentColor}`, outlineOffset: 2 } : {},
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="body2" fontWeight={700} sx={{ fontSize: 13, color: '#333' }}>
            {series.displayName}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {provenance}
          </Typography>
        </Box>
        <Stack alignItems="flex-end" spacing={0.25}>
          <Typography variant="h6" fontWeight={800} sx={{ color: latest?.severityColor ?? accentColor }}>
            {latest?.rawScore ?? '—'}
            {latest?.maxScore != null && (
              <Typography component="span" variant="caption" sx={{ ml: 0.5, color: 'text.secondary', fontWeight: 400 }}>
                / {latest.maxScore}
              </Typography>
            )}
          </Typography>
          {latest?.severityLabel && (
            <Chip
              label={latest.severityLabel}
              size="small"
              sx={{
                bgcolor: latest.severityColor ?? '#666',
                color: '#FFF',
                fontSize: 9,
                height: 18,
              }}
            />
          )}
        </Stack>
      </Stack>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 1, color: toneColor[tone] }}>
        {trendIcon(tone)}
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          {trendDescriptor.label}
        </Typography>
        {series.trendSummary.rawDelta !== null && (
          <Typography variant="caption" color="text.secondary">
            ({series.trendSummary.rawDelta > 0 ? '+' : ''}{series.trendSummary.rawDelta} over {series.trendSummary.administrations} administrations)
          </Typography>
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        Last completed {describeRelativeAge(latest?.completedAt ?? '')}
        {stale && (
          <Chip
            label="Stale"
            size="small"
            color="warning"
            sx={{ ml: 1, fontSize: 9, height: 16 }}
          />
        )}
      </Typography>
      {series.clinicalInterpretationHint && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic', color: '#555' }}>
          {series.clinicalInterpretationHint}
        </Typography>
      )}
    </Box>
  );
}
