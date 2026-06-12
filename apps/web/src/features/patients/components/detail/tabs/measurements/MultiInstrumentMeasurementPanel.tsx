/**
 * Top-level panel for measurement visualisation.
 *
 * Operator brief:
 *   - "Single instrument: show latest raw score/max score, severity, date,
 *     rater/source, trend line."
 *   - "Multiple instruments same family: small multiples, one chart per
 *     instrument."
 *   - "Multiple families: grouped sections."
 *
 * The panel inspects the `series` array, partitions by family, then
 * delegates to MeasurementSeriesGrid per family. A single MeasurementLegend
 * + MeasurementTimeline is rendered ABOVE the per-family sections so the
 * clinician sees provenance and chronology before drilling into any one
 * instrument.
 */
import { Box, Stack, Typography } from '@mui/material';
import type {
  CrossInstrumentEvent,
  MeasurementFamily,
  MeasurementSeries,
  MeasurementWarning,
} from '@signacare/shared';
import { MeasurementLegend } from './MeasurementLegend';
import { MeasurementSeriesGrid } from './MeasurementSeriesGrid';
import { MeasurementTimeline } from './MeasurementTimeline';
import {
  describeMeasurementFamily,
  sortSeriesByRecency,
} from './measurementVisualHelpers';

const FAMILY_ACCENT: Record<MeasurementFamily, string> = {
  outcome_measure: '#327C8D',
  clinician_rating_scale: '#b8621a',
  self_rated_scale: '#7B1FA2',
};

interface MultiInstrumentMeasurementPanelProps {
  series: MeasurementSeries[];
  timeline: CrossInstrumentEvent[];
  warnings?: MeasurementWarning[];
  /** Restrict the panel to a single family. Hides other-family series. */
  restrictToFamily?: MeasurementFamily;
  /** Hide the family legend (used on single-family tabs where it adds noise). */
  hideLegend?: boolean;
  /** Hide the cross-instrument timeline (used on single-family tabs). */
  hideTimeline?: boolean;
  /** Click handler — receives the series whose card was clicked. */
  onSeriesClick?: (series: MeasurementSeries) => void;
}

export function MultiInstrumentMeasurementPanel({
  series,
  timeline,
  warnings = [],
  restrictToFamily,
  hideLegend,
  hideTimeline,
  onSeriesClick,
}: MultiInstrumentMeasurementPanelProps) {
  // Operator brief: never merge raw scores across instruments. Partition by
  // family + emit one MeasurementSeriesGrid section per family.
  const filteredSeries = restrictToFamily
    ? series.filter((s) => s.family === restrictToFamily)
    : series;
  const filteredTimeline = restrictToFamily
    ? timeline.filter((e) => e.family === restrictToFamily)
    : timeline;

  const byFamily = new Map<MeasurementFamily, MeasurementSeries[]>();
  for (const s of filteredSeries) {
    const arr = byFamily.get(s.family) ?? [];
    arr.push(s);
    byFamily.set(s.family, arr);
  }
  const presentFamilies: MeasurementFamily[] = (
    ['outcome_measure', 'clinician_rating_scale', 'self_rated_scale'] as const
  ).filter((f) => byFamily.has(f));

  if (filteredSeries.length === 0 && filteredTimeline.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
        <Typography variant="body2">No measurements to display.</Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      {!hideLegend && (
        <MeasurementLegend visibleFamilies={new Set(presentFamilies)} />
      )}
      {warnings.length > 0 && (
        <Box
          role="status"
          aria-live="polite"
          sx={{ p: 1, bgcolor: '#FFF8E1', border: '1px solid #FFE082', borderRadius: 1 }}
        >
          <Typography variant="caption" fontWeight={700} sx={{ display: 'block', color: '#E65100' }}>
            Data quality notes ({warnings.length}):
          </Typography>
          {warnings.slice(0, 5).map((w, i) => (
            <Typography key={i} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              • {w.detail}{w.count > 1 ? ` (${w.count} occurrences)` : ''}
            </Typography>
          ))}
          {warnings.length > 5 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontStyle: 'italic' }}>
              … and {warnings.length - 5} more
            </Typography>
          )}
        </Box>
      )}
      {!hideTimeline && filteredTimeline.length > 0 && (
        <Box>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: '#3D484B' }}>
            Cross-Instrument Timeline
          </Typography>
          <MeasurementTimeline events={filteredTimeline} />
        </Box>
      )}
      {presentFamilies.map((family) => {
        const sorted = (byFamily.get(family) ?? []).slice().sort(sortSeriesByRecency);
        return (
          <Box key={family}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: FAMILY_ACCENT[family] }}>
              {describeMeasurementFamily(family)} ({sorted.length})
            </Typography>
            <MeasurementSeriesGrid
              series={sorted}
              accentColor={FAMILY_ACCENT[family]}
              onSeriesClick={onSeriesClick}
            />
          </Box>
        );
      })}
    </Stack>
  );
}
