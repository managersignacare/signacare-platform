// apps/web/src/features/reports/components/OutcomeMeasureDashboard.tsx
import { useState } from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  CircularProgress,
  Alert,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
} from '@mui/material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { useOutcomeDashboard } from '../hooks/useReports';
import type { ReportFilters } from '../types/reportTypes';
import { format, parseISO } from 'date-fns';

interface Props {
  filters: ReportFilters;
}

const INSTRUMENT_THRESHOLDS: Record<
  string,
  { mild: number; moderate: number; severe: number }
> = {
  PHQ9: { mild: 5, moderate: 10, severe: 20 },
  GAD7: { mild: 5, moderate: 10, severe: 15 },
  K10: { mild: 16, moderate: 22, severe: 30 },
};

const LINE_COLOURS = [
  '#1976d2',
  '#d32f2f',
  '#388e3c',
  '#f57c00',
  '#7b1fa2',
  '#0097a7',
  '#c62828',
  '#558b2f',
];

const TREND_COLOUR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  improving: 'success',
  stable: 'default',
  deteriorating: 'error',
  insufficientdata: 'default',
};

type Instrument = 'PHQ9' | 'GAD7' | 'K10' | 'HONOS' | 'BPRS' | 'DASS21';
const INSTRUMENT_OPTIONS: Instrument[] = ['PHQ9', 'GAD7', 'K10', 'HONOS', 'BPRS', 'DASS21'];

export function OutcomeMeasureDashboard({ filters }: Props) {
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument>('PHQ9');
  const { data, isLoading, isError } = useOutcomeDashboard(filters, true);

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" />;
  if (isError || !data)
    return <Alert role="alert" severity="error">Failed to load outcome data.</Alert>;

  const cohortSeries = data.cohortAverageByDate
    .filter((d) => d.instrument === selectedInstrument)
    .map((d) => ({
      date: format(parseISO(d.date), 'dd/MM'),
      avgScore: Number(d.avgScore.toFixed(1)),
      count: d.count,
    }));

  const patientTrends = data.trends.filter((t) => t.instrument === selectedInstrument);
  const thresholds = INSTRUMENT_THRESHOLDS[selectedInstrument];

  // Build a merged date-keyed dataset for individual lines
  const dateSet = new Set<string>();
  patientTrends.forEach((t) => t.dataPoints.forEach((p) => dateSet.add(p.date)));
  const sorted = Array.from(dateSet).sort();

  const patientChartData = sorted.map((date) => {
    const point: Record<string, string | number> = {
      date: format(parseISO(date), 'dd/MM'),
    };
    patientTrends.forEach((t, idx) => {
      const dp = t.dataPoints.find((p) => p.date === date);
      if (dp) point[`${t.patientName}_${idx}`] = dp.score;
    });
    return point;
  });

  return (
    <Box>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <Typography variant="h6">Outcome Measure Dashboard</Typography>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Instrument</InputLabel>
          <Select
            value={selectedInstrument}
            onChange={(e) => setSelectedInstrument(e.target.value as Instrument)}
            label="Instrument"
          >
            {INSTRUMENT_OPTIONS.map((i) => (
              <MenuItem key={i} value={i}>
                {i}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="body2" color="text.secondary">
          {filters.dateFrom} — {filters.dateTo}
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Cohort Average Trend */}
        <Grid>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Cohort Average — {selectedInstrument}
            </Typography>
            {cohortSeries.length === 0 ? (
              <Typography color="text.secondary" variant="body2">
                No cohort data for this period.
              </Typography>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={cohortSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  {thresholds && (
                    <>
                      <ReferenceLine
                        y={thresholds.mild}
                        stroke="#fbc02d"
                        strokeDasharray="4 4"
                        label={{ value: 'Mild', fontSize: 10, fill: '#fbc02d' }}
                      />
                      <ReferenceLine
                        y={thresholds.moderate}
                        stroke="#f57c00"
                        strokeDasharray="4 4"
                        label={{ value: 'Moderate', fontSize: 10, fill: '#f57c00' }}
                      />
                      <ReferenceLine
                        y={thresholds.severe}
                        stroke="#d32f2f"
                        strokeDasharray="4 4"
                        label={{ value: 'Severe', fontSize: 10, fill: '#d32f2f' }}
                      />
                    </>
                  )}
                  <Line
                    type="monotone"
                    dataKey="avgScore"
                    stroke="#1976d2"
                    strokeWidth={2}
                    dot={false}
                    name="Avg Score"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Paper>
        </Grid>

        {/* Individual Patient Trends */}
        <Grid>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Individual Patient Trends — {selectedInstrument}
            </Typography>
            {patientChartData.length === 0 ? (
              <Typography color="text.secondary" variant="body2">
                No individual data.
              </Typography>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={patientChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {patientTrends.map((t, idx) => (
                    <Line
                      key={`${t.patientId}_${idx}`}
                      type="monotone"
                      dataKey={`${t.patientName}_${idx}`}
                      stroke={LINE_COLOURS[idx % LINE_COLOURS.length]}
                      strokeWidth={1.5}
                      dot={{ r: 3 }}
                      name={t.patientName}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </Paper>
        </Grid>

        {/* Patient Trend Summary Table */}
        <Grid>
          <Paper variant="outlined">
            <Box sx={{ px: 2, pt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Patient Summary — {selectedInstrument}
              </Typography>
            </Box>
            <TableContainer role="region" aria-label="Data table">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Patient</TableCell>
                    <TableCell align="right">Baseline</TableCell>
                    <TableCell align="right">Latest</TableCell>
                    <TableCell align="right">Change</TableCell>
                    <TableCell>Trend</TableCell>
                    <TableCell align="right">Data Points</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {patientTrends.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Typography
                          color="text.secondary"
                          variant="body2"
                          sx={{ py: 1 }}
                        >
                          No patient data for this instrument and period.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    patientTrends.map((t, idx) => {
                      const change =
                        t.baselineScore !== null && t.latestScore !== null
                          ? Number(t.latestScore - t.baselineScore).toFixed(1)
                          : null;
                      return (
                        <TableRow key={`${t.patientId}_${idx}`} hover>
                          <TableCell>{t.patientName}</TableCell>
                          <TableCell align="right">
                            {t.baselineScore ?? '—'}
                          </TableCell>
                          <TableCell align="right">
                            {t.latestScore ?? '—'}
                          </TableCell>
                          <TableCell
                            align="right"
                            sx={{
                              color:
                                change === null
                                  ? 'text.secondary'
                                  : Number(change) < 0
                                  ? 'success.main'
                                  : Number(change) > 0
                                  ? 'error.main'
                                  : 'text.primary',
                              fontWeight: 600,
                            }}
                          >
                            {change === null
                              ? '—'
                              : Number(change) > 0
                              ? `+${change}`
                              : change}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={t.trend.replace(/_/g, ' ')}
                              size="small"
                              color={TREND_COLOUR[t.trend]}
                            />
                          </TableCell>
                          <TableCell align="right">
                            {t.dataPoints.length}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
