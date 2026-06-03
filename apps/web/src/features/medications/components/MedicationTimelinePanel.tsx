import TimelineIcon from '@mui/icons-material/Timeline';
import {
  Alert,
  Box,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import { useMemo, useState } from 'react';
import type { MedicationRow } from '../types';

type TimelineGranularity = 'monthly' | 'annual';

interface MedicationTimelinePanelProps {
  allMeds: MedicationRow[];
}

interface TimelineTrial {
  id: string;
  key: string;
  medicationName: string;
  dose: string;
  frequency: string;
  route: string;
  status: string;
  start: Date;
  end: Date;
  rowIndex: number;
}

interface TimelineTick {
  label: string;
  position: number;
}

interface ExtendedMedicationRow extends MedicationRow {
  startDate?: string | null;
  endDate?: string | null;
  ceasedAt?: string | null;
  updatedAt?: string | null;
}

const ROW_HEIGHT = 28;
const ROW_GAP = 12;
const AXIS_TOP = 32;
const ROWS_TOP = 58;
const CHART_LEFT = 210;
const CHART_RIGHT_PADDING = 32;
const MIN_WIDTH = 940;

const STATUS_COLOR: Record<string, string> = {
  active: '#2E7D32',
  tapering: '#EF6C00',
  ceased: '#757575',
  suspended: '#8D6E63',
  on_hold: '#6D4C41',
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

function endOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 11, 31);
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function daysInYear(year: number): number {
  const isLeap = new Date(year, 1, 29).getMonth() === 1;
  return isLeap ? 366 : 365;
}

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

function monthUnits(start: Date, end: Date): number {
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
}

function yearUnits(start: Date, end: Date): number {
  return end.getFullYear() - start.getFullYear() + 1;
}

function xAtDate(date: Date, timelineStart: Date, granularity: TimelineGranularity, unitWidth: number): number {
  if (granularity === 'annual') {
    const years = date.getFullYear() - timelineStart.getFullYear();
    const fraction = dayOfYear(date) / daysInYear(date.getFullYear());
    return CHART_LEFT + (years + fraction) * unitWidth;
  }
  const months = (date.getFullYear() - timelineStart.getFullYear()) * 12 + (date.getMonth() - timelineStart.getMonth());
  const fraction = (date.getDate() - 1) / Math.max(daysInMonth(date), 1);
  return CHART_LEFT + (months + fraction) * unitWidth;
}

function buildTicks(start: Date, units: number, granularity: TimelineGranularity): TimelineTick[] {
  const ticks: TimelineTick[] = [];
  if (granularity === 'annual') {
    for (let i = 0; i < units; i += 1) {
      const d = new Date(start.getFullYear() + i, 0, 1);
      ticks.push({ label: String(d.getFullYear()), position: i });
    }
    return ticks;
  }

  for (let i = 0; i < units; i += 1) {
    const d = addMonths(start, i);
    const label = d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
    ticks.push({ label, position: i });
  }
  return ticks;
}

function timelineDateLabel(date: Date): string {
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function deriveTrialEnd(row: ExtendedMedicationRow, start: Date): Date {
  const endDate = parseDate(row.endDate ?? row.ceasedAt ?? undefined);
  if (endDate) return endDate;
  if (row.status === 'active' || row.status === 'tapering') return new Date();
  const updated = parseDate(row.updatedAt ?? undefined);
  if (updated) return updated;
  return start;
}

export function MedicationTimelinePanel({ allMeds }: MedicationTimelinePanelProps) {
  const [granularity, setGranularity] = useState<TimelineGranularity>('monthly');

  const rows = useMemo(() => {
    const named = allMeds.filter((m) => (m.medicationName ?? '').trim().length > 0);
    const byMed = new Map<string, string>();
    named.forEach((m) => {
      const key = (m.genericName || m.medicationName).toLowerCase();
      if (!byMed.has(key)) {
        byMed.set(key, m.genericName ? `${m.medicationName} (${m.genericName})` : m.medicationName);
      }
    });
    return Array.from(byMed.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allMeds]);

  const rowIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => map.set(row.key, index));
    return map;
  }, [rows]);

  const trials = useMemo<TimelineTrial[]>(() => {
    const out: TimelineTrial[] = [];
    (allMeds as ExtendedMedicationRow[]).forEach((m) => {
      const key = (m.genericName || m.medicationName).toLowerCase();
      const rowIndex = rowIndexByKey.get(key);
      if (rowIndex === undefined) return;
      const start = parseDate(m.startDate ?? m.prescribedAt ?? m.createdAt ?? undefined);
      if (!start) return;
      const derivedEnd = deriveTrialEnd(m, start);
      const end = derivedEnd.getTime() >= start.getTime() ? derivedEnd : start;
      out.push({
        id: m.id,
        key,
        medicationName: m.medicationName,
        dose: m.dose,
        frequency: m.frequency,
        route: m.route,
        status: m.status,
        start,
        end,
        rowIndex,
      });
    });
    return out.sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [allMeds, rowIndexByKey]);

  const timelineWindow = useMemo(() => {
    if (!trials.length) return null;
    const minStart = new Date(Math.min(...trials.map((t) => t.start.getTime())));
    const maxEnd = new Date(Math.max(...trials.map((t) => t.end.getTime())));
    const start = granularity === 'annual' ? startOfYear(minStart) : startOfMonth(minStart);
    const end = granularity === 'annual' ? endOfYear(maxEnd) : endOfMonth(maxEnd);
    const units = granularity === 'annual' ? yearUnits(start, end) : monthUnits(start, end);
    return { start, end, units };
  }, [trials, granularity]);

  const chartModel = useMemo(() => {
    if (!timelineWindow) return null;
    const rawUnitWidth = granularity === 'annual' ? 140 : 72;
    const contentWidth = timelineWindow.units * rawUnitWidth;
    const chartWidth = Math.max(MIN_WIDTH, CHART_LEFT + contentWidth + CHART_RIGHT_PADDING);
    const unitWidth = contentWidth > 0 ? (chartWidth - CHART_LEFT - CHART_RIGHT_PADDING) / timelineWindow.units : rawUnitWidth;
    const chartHeight = Math.max(220, ROWS_TOP + rows.length * (ROW_HEIGHT + ROW_GAP) + 24);
    const ticks = buildTicks(timelineWindow.start, timelineWindow.units, granularity);
    return {
      chartWidth,
      chartHeight,
      unitWidth,
      ticks,
    };
  }, [granularity, rows.length, timelineWindow]);

  const handleGranularity = (event: SelectChangeEvent<string>) => {
    const value = event.target.value === 'annual' ? 'annual' : 'monthly';
    setGranularity(value);
  };

  if (!allMeds.length) {
    return <Alert severity="info">No medications recorded for timeline visualization yet.</Alert>;
  }

  if (!trials.length || !timelineWindow || !chartModel) {
    return <Alert severity="warning">Medication records are present, but no valid medication dates were found to draw a timeline.</Alert>;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TimelineIcon sx={{ color: '#327C8D', fontSize: 18 }} />
          <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Medication Timeline
          </Typography>
          <Chip label={`${trials.length} trials`} size="small" sx={{ fontSize: 10, height: 18, bgcolor: '#E0F2F1', color: '#00695C' }} />
          <Chip label={`${rows.length} medications`} size="small" sx={{ fontSize: 10, height: 18, bgcolor: '#E3F2FD', color: '#1565C0' }} />
        </Box>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id="medication-timeline-granularity-label">Timeline Scale</InputLabel>
          <Select
            labelId="medication-timeline-granularity-label"
            value={granularity}
            label="Timeline Scale"
            onChange={handleGranularity}
          >
            <MenuItem value="monthly">Monthly</MenuItem>
            <MenuItem value="annual">Annual</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        {timelineDateLabel(timelineWindow.start)} to {timelineDateLabel(timelineWindow.end)}. Each bar represents one prescribed medication interval.
      </Typography>

      <Paper variant="outlined" sx={{ overflowX: 'auto', borderRadius: 2 }}>
        <svg width={chartModel.chartWidth} height={chartModel.chartHeight} style={{ fontFamily: 'Albert Sans, sans-serif' }}>
          {chartModel.ticks.map((tick) => {
            const x = CHART_LEFT + tick.position * chartModel.unitWidth;
            return (
              <g key={tick.label}>
                <line x1={x} y1={AXIS_TOP} x2={x} y2={chartModel.chartHeight - 18} stroke="#E6E6E6" strokeWidth={1} />
                <text x={x + 2} y={AXIS_TOP - 8} fontSize={10} fill="#616161">
                  {tick.label}
                </text>
              </g>
            );
          })}

          <line
            x1={CHART_LEFT}
            y1={AXIS_TOP}
            x2={chartModel.chartWidth - CHART_RIGHT_PADDING}
            y2={AXIS_TOP}
            stroke="#90A4AE"
            strokeWidth={1.2}
          />

          {rows.map((row, index) => {
            const y = ROWS_TOP + index * (ROW_HEIGHT + ROW_GAP);
            const isAlt = index % 2 === 1;
            return (
              <g key={row.key}>
                <rect
                  x={CHART_LEFT}
                  y={y - 6}
                  width={chartModel.chartWidth - CHART_LEFT - CHART_RIGHT_PADDING}
                  height={ROW_HEIGHT}
                  fill={isAlt ? '#FAFAFA' : 'transparent'}
                />
                <text x={12} y={y + 11} fontSize={11} fill="#37474F">
                  {row.label}
                </text>
              </g>
            );
          })}

          {trials.map((trial) => {
            const y = ROWS_TOP + trial.rowIndex * (ROW_HEIGHT + ROW_GAP);
            const x1 = xAtDate(trial.start, timelineWindow.start, granularity, chartModel.unitWidth);
            const x2 = xAtDate(trial.end, timelineWindow.start, granularity, chartModel.unitWidth);
            const width = Math.max(6, x2 - x1);
            const color = STATUS_COLOR[trial.status] ?? '#546E7A';
            return (
              <g key={trial.id}>
                <rect x={x1} y={y} width={width} height={16} rx={4} fill={color} opacity={0.85} />
                {width > 80 && (
                  <text x={x1 + 6} y={y + 11} fontSize={10} fill="#FFFFFF" fontWeight={700}>
                    {trial.dose}
                  </text>
                )}
                <title>
                  {`${trial.medicationName} ${trial.dose} ${trial.frequency} (${trial.route})\n${timelineDateLabel(trial.start)} — ${timelineDateLabel(trial.end)}\nStatus: ${trial.status}`}
                </title>
              </g>
            );
          })}
        </svg>
      </Paper>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
        {Object.entries(STATUS_COLOR).map(([status, color]) => (
          <Box key={status} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 12, height: 8, borderRadius: 0.5, bgcolor: color, opacity: 0.85 }} />
            <Typography variant="caption" sx={{ textTransform: 'capitalize' }}>
              {status.replace('_', ' ')}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
