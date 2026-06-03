// apps/web/src/features/calendar/components/AvailabilityGridEditor.tsx
//
// Phase 13 PR3 — drag-paint weekly availability grid.
//
// Rows: 06:00 → 22:00 at preferences.slotMinutes granularity.
// Cols: Mon → Sun starting at preferences.weekStart.
// Tools: Red / Yellow / Green / Eraser radios at the top, click-drag
// paints, mouseup commits.
//
// The mouse-up commit is the only place we touch the network — every
// in-flight paint is local state. On commit:
//   * Eraser → DELETE every block whose (dayOfWeek, time-range)
//     overlaps the painted slots.
//   * Colour → coalesce contiguous painted slots in the same day into
//     one POST per run, so a 3-hour drag is one HTTP call, not 6.
//
// Errors are surfaced via a snackbar in the parent CalendarPage —
// hooks throw, the parent catches.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type {
  AvailabilityBlock,
  AvailabilityColour,
  CalendarPreferences,
} from '@signacare/shared';
import {
  useCreateBlock,
  useDeleteBlock,
} from '../hooks/useCalendarBlocks';

type Tool = AvailabilityColour | 'erase';

interface Props {
  blocks: AvailabilityBlock[];
  preferences: CalendarPreferences;
  // Override when an admin views another clinician (not v1).
  clinicianId?: string;
}

const DAY_LABELS_MON_FIRST = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
];
// Maps the visual column index (0 = first column shown) to the
// underlying Postgres day_of_week value (0 = Sunday).
function visualToDow(visualIndex: number, weekStart: number): number {
  // weekStart 1 = Monday. visualIndex 0 → Mon → dow 1.
  return (weekStart + visualIndex) % 7;
}

function formatTime(minutesFromMidnight: number): string {
  const h = Math.floor(minutesFromMidnight / 60);
  const m = minutesFromMidnight % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// "08:30:00" or "08:30" → 510
function parseClockToMinutes(clock: string): number {
  const [hh, mm] = clock.split(':');
  return Number(hh) * 60 + Number(mm);
}

const COLOUR_BG: Record<Tool, string> = {
  red: 'rgba(239, 68, 68, 0.55)',
  yellow: 'rgba(250, 204, 21, 0.55)',
  green: 'rgba(34, 197, 94, 0.55)',
  erase: 'transparent',
};

const DAY_START_MIN = 6 * 60; // 06:00
const DAY_END_MIN = 22 * 60; // 22:00

interface PendingCell {
  visualCol: number;
  rowIndex: number;
}

export const AvailabilityGridEditor: React.FC<Props> = ({
  blocks,
  preferences,
  clinicianId,
}) => {
  const slot = preferences.slotMinutes;
  const weekStart = preferences.weekStart;
  const create = useCreateBlock(clinicianId);
  const remove = useDeleteBlock(clinicianId);

  const rowMinutes = useMemo(() => {
    const r: number[] = [];
    for (let m = DAY_START_MIN; m < DAY_END_MIN; m += slot) r.push(m);
    return r;
  }, [slot]);

  const [tool, setTool] = useState<Tool>('green');
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<Map<string, PendingCell>>(new Map());

  // Released-button safety: if the mouse leaves the grid mid-drag we
  // still need to commit on the next mouseup anywhere in the document.
  useEffect(() => {
    if (!dragging) return;
    const onUp = () => commit();
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, pending]);

  const cellKey = (col: number, row: number) => `${col}:${row}`;

  // Paints handled by tracking cells in `pending`. The grid is purely
  // visual until commit().
  const startPaint = (visualCol: number, rowIndex: number) => {
    setDragging(true);
    setPending(
      new Map([[cellKey(visualCol, rowIndex), { visualCol, rowIndex }]]),
    );
  };

  const extendPaint = (visualCol: number, rowIndex: number) => {
    if (!dragging) return;
    setPending((prev) => {
      const next = new Map(prev);
      next.set(cellKey(visualCol, rowIndex), { visualCol, rowIndex });
      return next;
    });
  };

  const commit = useCallback(async () => {
    if (!dragging) return;
    setDragging(false);
    const cells = Array.from(pending.values());
    setPending(new Map());
    if (cells.length === 0) return;

    // Group painted cells by visual column → contiguous run in that column.
    const byCol = new Map<number, number[]>();
    for (const c of cells) {
      if (!byCol.has(c.visualCol)) byCol.set(c.visualCol, []);
      byCol.get(c.visualCol)!.push(c.rowIndex);
    }

    for (const [visualCol, rowIndices] of byCol) {
      rowIndices.sort((a, b) => a - b);
      const runs: { startRow: number; endRow: number }[] = [];
      let start = rowIndices[0]!;
      let last = start;
      for (let i = 1; i < rowIndices.length; i++) {
        const r = rowIndices[i]!;
        if (r === last + 1) {
          last = r;
        } else {
          runs.push({ startRow: start, endRow: last });
          start = r;
          last = r;
        }
      }
      runs.push({ startRow: start, endRow: last });

      const dow = visualToDow(visualCol, weekStart);

      for (const run of runs) {
        const startMin = rowMinutes[run.startRow]!;
        const endMin = rowMinutes[run.endRow]! + slot;
        const startTime = formatTime(startMin);
        const endTime = formatTime(endMin);

        if (tool === 'erase') {
          // Delete every weekly block on this day that overlaps the
          // painted range. Server enforces clinic_id; we just need to
          // pick the right ids.
          const toDelete = blocks.filter((b) => {
            if (b.recurrence !== 'weekly') return false;
            if (b.dayOfWeek !== dow) return false;
            const bs = parseClockToMinutes(b.startTime);
            const be = parseClockToMinutes(b.endTime);
            return bs < endMin && be > startMin;
          });
          for (const b of toDelete) {
            try {
              await remove.mutateAsync(b.id);
            } catch {
              /* surfaced by the parent */
            }
          }
        } else {
          try {
            await create.mutateAsync({
              colour: tool,
              recurrence: 'weekly',
              dayOfWeek: dow,
              specificDate: null,
              startTime,
              endTime,
              effectiveFrom: new Date().toISOString().slice(0, 10),
              effectiveUntil: null,
              label: null,
              notes: null,
            });
          } catch {
            /* surfaced by the parent */
          }
        }
      }
    }
  }, [blocks, create, dragging, pending, remove, rowMinutes, slot, tool, weekStart]);

  // Lookup table: which colour (if any) is currently committed on
  // (visualCol, rowIndex). Pending overrides committed.
  const cellColour = (visualCol: number, rowIndex: number): Tool | null => {
    const k = cellKey(visualCol, rowIndex);
    if (pending.has(k)) return tool;
    const dow = visualToDow(visualCol, weekStart);
    const minute = rowMinutes[rowIndex]!;
    const match = blocks.find((b) => {
      if (b.recurrence !== 'weekly') return false;
      if (b.dayOfWeek !== dow) return false;
      const bs = parseClockToMinutes(b.startTime);
      const be = parseClockToMinutes(b.endTime);
      return bs <= minute && be > minute;
    });
    return match ? (match.colour as Tool) : null;
  };

  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
        <Typography variant="h6">My Working Week</Typography>
        <ToggleButtonGroup
          size="small"
          value={tool}
          exclusive
          onChange={(_, v) => v && setTool(v as Tool)}
        >
          <ToggleButton value="green" sx={{ color: '#16a34a' }}>
            🟢 Available
          </ToggleButton>
          <ToggleButton value="yellow" sx={{ color: '#ca8a04' }}>
            🟡 Tentative
          </ToggleButton>
          <ToggleButton value="red" sx={{ color: '#dc2626' }}>
            🔴 Unavailable
          </ToggleButton>
          <ToggleButton value="erase">⌫ Erase</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `64px repeat(7, 1fr)`,
          userSelect: 'none',
          border: '1px solid',
          borderColor: 'divider',
        }}
        onMouseLeave={() => dragging && commit()}
      >
        {/* Header row */}
        <Box />
        {Array.from({ length: 7 }).map((_, visualCol) => {
          const dow = visualToDow(visualCol, weekStart);
          const label = DAY_LABELS_MON_FIRST[(dow + 6) % 7];
          return (
            <Box
              key={`h-${visualCol}`}
              sx={{
                p: 0.5,
                textAlign: 'center',
                fontSize: 12,
                fontWeight: 600,
                borderBottom: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.default',
              }}
            >
              {label}
            </Box>
          );
        })}

        {rowMinutes.map((min, rowIndex) => (
          <React.Fragment key={`row-${rowIndex}`}>
            <Box
              sx={{
                fontSize: 11,
                color: 'text.secondary',
                p: 0.25,
                textAlign: 'right',
                borderRight: '1px solid',
                borderColor: 'divider',
              }}
            >
              {min % 60 === 0 ? formatTime(min) : ''}
            </Box>
            {Array.from({ length: 7 }).map((_, visualCol) => {
              const colour = cellColour(visualCol, rowIndex);
              return (
                <Box
                  key={`c-${visualCol}-${rowIndex}`}
                  data-testid={`slot-${visualCol}-${rowIndex}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    startPaint(visualCol, rowIndex);
                  }}
                  onMouseEnter={() => extendPaint(visualCol, rowIndex)}
                  sx={{
                    height: 18,
                    borderTop: min % 60 === 0 ? '1px solid' : '1px dashed',
                    borderRight: '1px solid',
                    borderColor: 'divider',
                    bgcolor: colour ? COLOUR_BG[colour] : 'transparent',
                    cursor: 'pointer',
                    '&:hover': { outline: '1px solid rgba(0,0,0,0.2)' },
                  }}
                />
              );
            })}
          </React.Fragment>
        ))}
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        Click and drag to paint. Yellow blocks ask reception to confirm before
        booking. Red blocks block all booking attempts.
      </Typography>
    </Paper>
  );
};
