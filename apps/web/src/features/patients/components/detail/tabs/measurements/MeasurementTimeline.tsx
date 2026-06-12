/**
 * Cross-instrument chronological timeline.
 *
 * Operator brief:
 *   - "Cross-instrument timeline: show events by date with instrument
 *     badges. Do not plot raw scores on one shared y-axis unless same
 *     instrument."
 *
 * Renders a date-keyed list of events. Each event row carries:
 *   - the date,
 *   - the instrument display name,
 *   - the raw score + max (per-instrument, not shared axis),
 *   - the severity chip (if available),
 *   - the family badge.
 *
 * The component is intentionally NOT a chart — it is a list. A chart
 * here would mislead by implying cross-instrument comparison.
 */
import type React from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import type { CrossInstrumentEvent, MeasurementFamily } from '@signacare/shared';
import { describeMeasurementFamily } from './measurementVisualHelpers';

const FAMILY_BADGE_COLOR: Record<MeasurementFamily, string> = {
  outcome_measure: '#327C8D',
  clinician_rating_scale: '#b8621a',
  self_rated_scale: '#7B1FA2',
};

interface MeasurementTimelineProps {
  events: CrossInstrumentEvent[];
  /** Optional click handler — receives the event for navigation. */
  onEventClick?: (event: CrossInstrumentEvent) => void;
  /** Optional limit. Default 30 most recent. */
  limit?: number;
}

export function MeasurementTimeline({
  events,
  onEventClick,
  limit = 30,
}: MeasurementTimelineProps) {
  if (events.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', py: 1 }}>
        No measurements recorded yet.
      </Typography>
    );
  }
  // Most-recent first.
  const sorted = [...events].sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, limit);
  return (
    <Stack spacing={0.5} role="list" aria-label="Cross-instrument measurement timeline">
      {sorted.map((event) => {
        const familyColor = FAMILY_BADGE_COLOR[event.family];
        const interactiveProps = onEventClick
          ? {
              role: 'button' as const,
              tabIndex: 0,
              onClick: () => onEventClick(event),
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onEventClick(event);
                }
              },
            }
          : { role: 'listitem' as const };
        return (
          <Box
            key={event.pointId}
            {...interactiveProps}
            sx={{
              p: 1,
              border: '1px solid #E0E0E0',
              borderLeft: `4px solid ${familyColor}`,
              borderRadius: 1,
              bgcolor: '#FFFFFF',
              cursor: onEventClick ? 'pointer' : 'default',
              '&:hover': onEventClick ? { bgcolor: '#FAFAFA' } : {},
              '&:focus-visible': onEventClick ? { outline: `2px solid ${familyColor}`, outlineOffset: 2 } : {},
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                  <Typography variant="body2" fontWeight={700} sx={{ fontSize: 12 }}>
                    {event.instrumentDisplayName}
                  </Typography>
                  <Chip
                    label={describeMeasurementFamily(event.family)}
                    size="small"
                    sx={{ bgcolor: familyColor, color: '#FFF', fontSize: 9, height: 16 }}
                  />
                  {event.severityLabel && (
                    <Chip
                      label={event.severityLabel}
                      size="small"
                      variant="outlined"
                      sx={{
                        borderColor: event.severityColor ?? '#999',
                        color: event.severityColor ?? '#666',
                        fontSize: 9,
                        height: 16,
                      }}
                    />
                  )}
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                  {new Date(event.completedAt).toLocaleDateString('en-AU', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="body2" fontWeight={700} sx={{ color: event.severityColor ?? '#333' }}>
                  {event.rawScore}
                  {event.maxScore != null && (
                    <Typography component="span" variant="caption" sx={{ ml: 0.25, color: 'text.secondary', fontWeight: 400 }}>
                      /{event.maxScore}
                    </Typography>
                  )}
                </Typography>
              </Box>
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}
