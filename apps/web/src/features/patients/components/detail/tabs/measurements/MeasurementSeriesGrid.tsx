/**
 * Small-multiples grid of single-instrument cards.
 *
 * Operator brief:
 *   - "Multiple instruments same family: show small multiples, one chart
 *     per instrument."
 *   - "Allow sort by latest severity, recency, or diagnosis category."
 *
 * Each grid cell contains a LatestScoreCard above a MeasurementTrendChart.
 * The grid never plots cross-instrument data on a shared axis.
 */
import { Grid } from '@mui/material';
import type { MeasurementSeries } from '@signacare/shared';
import { LatestScoreCard } from './LatestScoreCard';
import { MeasurementTrendChart } from './MeasurementTrendChart';

interface MeasurementSeriesGridProps {
  series: MeasurementSeries[];
  /** Accent colour (per family). */
  accentColor?: string;
  /** Click handler — receives the series whose card was clicked. */
  onSeriesClick?: (series: MeasurementSeries) => void;
}

export function MeasurementSeriesGrid({
  series,
  accentColor,
  onSeriesClick,
}: MeasurementSeriesGridProps) {
  if (series.length === 0) return null;
  return (
    <Grid container spacing={1.5}>
      {series.map((s) => (
        <Grid key={`${s.family}:${s.instrumentSlug}`} size={{ xs: 12, md: 6 }}>
          <LatestScoreCard
            series={s}
            accentColor={accentColor}
            onClick={onSeriesClick ? () => onSeriesClick(s) : undefined}
          />
          <MeasurementTrendChart series={s} strokeColor={accentColor} />
        </Grid>
      ))}
    </Grid>
  );
}
