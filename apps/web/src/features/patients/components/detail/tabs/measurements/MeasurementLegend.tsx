/**
 * Family + rater + source legend used at the top of multi-family panels.
 *
 * Operator brief:
 *   - "Pair status colour with icon + text label, never colour alone."
 *   - "Cross-instrument timeline: show events by date with instrument
 *     badges."
 *
 * The legend explains how to read the family-colour bars on the timeline
 * + cards so colour-blind / low-vision clinicians can map colour to
 * meaning via text + icons.
 */
import { Box, Chip, Stack, Typography } from '@mui/material';
import OutcomeIcon from '@mui/icons-material/Assessment';
import RatingIcon from '@mui/icons-material/Scale';
import SelfRatedIcon from '@mui/icons-material/PhoneIphone';
import type { MeasurementFamily } from '@signacare/shared';

const ENTRIES: Array<{ family: MeasurementFamily; color: string; label: string; rater: string; icon: React.ReactElement }> = [
  { family: 'outcome_measure', color: '#327C8D', label: 'Outcome Measures', rater: 'Clinician — NOCC', icon: <OutcomeIcon fontSize="small" /> },
  { family: 'clinician_rating_scale', color: '#b8621a', label: 'Clinician Rating Scales', rater: 'Clinician-administered', icon: <RatingIcon fontSize="small" /> },
  { family: 'self_rated_scale', color: '#7B1FA2', label: 'Viva Self-Rated', rater: 'Patient via Viva app', icon: <SelfRatedIcon fontSize="small" /> },
];

interface MeasurementLegendProps {
  /** Filter to a subset of families when only some are present. */
  visibleFamilies?: ReadonlySet<MeasurementFamily>;
}

export function MeasurementLegend({ visibleFamilies }: MeasurementLegendProps) {
  const entries = visibleFamilies
    ? ENTRIES.filter((e) => visibleFamilies.has(e.family))
    : ENTRIES;
  if (entries.length === 0) return null;
  return (
    <Stack
      direction="row"
      spacing={1}
      flexWrap="wrap"
      sx={{ p: 1, bgcolor: '#FAFAFA', border: '1px solid #E0E0E0', borderRadius: 1 }}
      role="group"
      aria-label="Measurement family legend"
    >
      <Typography variant="caption" fontWeight={700} sx={{ alignSelf: 'center', mr: 1 }}>
        Legend:
      </Typography>
      {entries.map((entry) => (
        <Stack key={entry.family} direction="row" spacing={0.5} alignItems="center">
          <Box sx={{ display: 'inline-flex', alignItems: 'center', color: entry.color }}>
            {entry.icon}
          </Box>
          <Chip
            label={entry.label}
            size="small"
            sx={{ bgcolor: entry.color, color: '#FFF', fontSize: 10, height: 18 }}
          />
          <Typography variant="caption" color="text.secondary">
            ({entry.rater})
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}
