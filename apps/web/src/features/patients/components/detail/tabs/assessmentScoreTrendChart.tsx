/**
 * Phase 8 — shared score-trend chart for the Outcome Measures + Rating
 * Scales tabs. Extracted verbatim from the original AssessmentsTab so
 * both tabs render trends identically.
 */
import { Box } from '@mui/material';

interface ScoreTrendChartProps {
  data: { date: string; score: number }[];
  maxScore: number;
}

export function ScoreTrendChart({ data, maxScore }: ScoreTrendChartProps) {
  if (data.length < 2) return null;
  const W = 400, H = 140, PAD = 30;
  const plotW = W - PAD * 2, plotH = H - PAD * 2;
  const points = data.map((d, i) => ({
    x: PAD + (i / (data.length - 1)) * plotW,
    y: PAD + plotH - (d.score / (maxScore || 1)) * plotH,
    ...d,
  }));
  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <Box sx={{ mb: 1 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 480, height: 'auto' }} role="img" aria-label="Score trend">
        <rect x={0} y={0} width={W} height={H} fill="#FAFAFA" stroke="#E0E0E0" />
        <polyline points={polyline} fill="none" stroke="#327C8D" strokeWidth={2} />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill="#327C8D" />
        ))}
      </svg>
    </Box>
  );
}
