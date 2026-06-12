/**
 * Single-instrument trend chart.
 *
 * Operator brief:
 *   - Raw scores may be shown PER INSTRUMENT — this chart only ever plots
 *     points from a single instrument. The caller passes one series at a
 *     time. There is intentionally no `data: Point[][]` API.
 *   - Charts must have aria-labels. Provide table fallback or textual
 *     trend summary. Do not rely on colour alone.
 *
 * Renders a small SVG line + dots + dotted max-score reference line. If
 * `points.length < 2` the chart renders the latest score textually with
 * "trend unavailable: only one administration" — the operator brief calls
 * this fallback out explicitly.
 */
import { Box, Stack, Typography } from '@mui/material';
import type { MeasurementSeries } from '@signacare/shared';
import { describeTrendDirection } from './measurementVisualHelpers';

interface MeasurementTrendChartProps {
  series: MeasurementSeries;
  /** Width in CSS pixels; chart scales to fit. Defaults to 480. */
  maxWidth?: number;
  /** Hex stroke colour. Defaults vary per family in the calling tab. */
  strokeColor?: string;
}

export function MeasurementTrendChart({
  series,
  maxWidth = 480,
  strokeColor = '#327C8D',
}: MeasurementTrendChartProps) {
  const points = series.points;
  const trendDescriptor = describeTrendDirection(series.trendSummary.direction);

  // Single-administration fallback — operator brief: "If fewer than 2
  // points: show latest score and 'trend unavailable: only one
  // administration'."
  if (points.length < 2) {
    const latest = series.latestPoint;
    return (
      <Box
        role="img"
        aria-label={`${series.displayName} score. Trend unavailable — only one administration.`}
        sx={{ p: 1.5, border: '1px dashed #E0E0E0', borderRadius: 1, bgcolor: '#FAFAFA' }}
      >
        <Stack direction="row" spacing={1} alignItems="baseline">
          <Typography variant="body2" fontWeight={700} sx={{ color: strokeColor }}>
            {latest?.rawScore ?? '—'}
            {latest?.maxScore != null && (
              <Typography component="span" variant="caption" sx={{ ml: 0.5, color: 'text.secondary' }}>
                / {latest.maxScore}
              </Typography>
            )}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {trendDescriptor.label}: only one administration recorded.
          </Typography>
        </Stack>
      </Box>
    );
  }

  // 2+ administrations — render an SVG line chart on the raw-score axis
  // for THIS instrument only. The y-axis is bounded by [0, maxScore] when
  // maxScore is known; otherwise by [min(points), max(points)] expanded
  // 10% so the line never clips against the frame.
  const observedMin = Math.min(...points.map((p) => p.rawScore));
  const observedMax = Math.max(...points.map((p) => p.rawScore));
  const declaredMin = points[0].minScore;
  const declaredMax = points[0].maxScore;
  const yMin = declaredMin ?? Math.max(0, Math.floor(observedMin * 0.9));
  const yMax = declaredMax ?? (Math.ceil(observedMax * 1.1) || 1);
  const W = 400;
  const H = 140;
  const PAD = 32;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;
  const xy = points.map((p, i) => ({
    x: PAD + (i / (points.length - 1)) * plotW,
    y: PAD + plotH - ((p.rawScore - yMin) / Math.max(yMax - yMin, 1)) * plotH,
    point: p,
  }));
  const polyline = xy.map((p) => `${p.x},${p.y}`).join(' ');

  // Build a textual fallback description so screen readers can summarise.
  const start = points[0];
  const end = points[points.length - 1];
  const tableSummary = (
    `${series.displayName} score over ${points.length} administrations: `
    + `${start.rawScore} on ${new Date(start.completedAt).toLocaleDateString('en-AU')}`
    + ` to ${end.rawScore} on ${new Date(end.completedAt).toLocaleDateString('en-AU')}. `
    + `${trendDescriptor.label}.`
  );

  return (
    <Box sx={{ mb: 1 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', maxWidth, height: 'auto' }}
        role="img"
        aria-label={tableSummary}
      >
        <rect x={0} y={0} width={W} height={H} fill="#FAFAFA" stroke="#E0E0E0" />
        {/* Max-score reference line (dashed, very subtle). */}
        {declaredMax != null && (
          <line
            x1={PAD}
            x2={W - PAD}
            y1={PAD}
            y2={PAD}
            stroke="#CCC"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
        )}
        <polyline points={polyline} fill="none" stroke={strokeColor} strokeWidth={2} />
        {xy.map((p) => (
          <circle
            key={p.point.id}
            cx={p.x}
            cy={p.y}
            r={3.5}
            fill={p.point.severityColor ?? strokeColor}
            stroke="#FFF"
            strokeWidth={1.5}
          >
            <title>{`${p.point.rawScore} on ${new Date(p.point.completedAt).toLocaleDateString('en-AU')}${p.point.severityLabel ? ` — ${p.point.severityLabel}` : ''}`}</title>
          </circle>
        ))}
        {/* Y-axis labels (declared bounds only). */}
        <text x={PAD - 4} y={PAD} textAnchor="end" fontSize="10" fill="#666">{yMax}</text>
        <text x={PAD - 4} y={PAD + plotH} textAnchor="end" fontSize="10" fill="#666">{yMin}</text>
      </svg>
      {/* Visually-hidden textual summary for non-sighted assistive tech. */}
      <Box sx={{ position: 'absolute', overflow: 'hidden', clipPath: 'inset(50%)', width: 1, height: 1 }} aria-live="polite">
        {tableSummary}
      </Box>
    </Box>
  );
}
