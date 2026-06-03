import DownloadIcon from '@mui/icons-material/Download';
import InsightsIcon from '@mui/icons-material/Insights';
import TableViewIcon from '@mui/icons-material/TableView';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  type SelectChangeEvent,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminReportFilters,
  AdminReportMetricKey,
  AdminReportPeriod,
  AdminReportTrendGranularity,
} from '@signacare/shared';
import { ADMIN_REPORT_METRIC_META } from '@signacare/shared';
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuthStore } from '../../../shared/store/authStore';
import { adminReportKeys } from '../queryKeys';
import { reportsApi } from '../services/reportsApi';

type ViewTab = 'overview' | 'details' | 'trends';

const GROUP_COLORS: Record<string, string> = {
  consumer: '#1565C0',
  medication: '#2E7D32',
  legal: '#6A1B9A',
  overdue: '#C62828',
  incomplete: '#EF6C00',
};

const TREND_PALETTE = ['#1565C0', '#2E7D32', '#6A1B9A', '#C62828', '#00838F', '#8E24AA'];

function safeFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-');
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatShortDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

export function AdminReportWorkbench(): React.ReactElement {
  const user = useAuthStore((state) => state.user);
  const clinicId = user?.clinicId;
  const qc = useQueryClient();
  const [tab, setTab] = useState<ViewTab>('overview');
  const [period, setPeriod] = useState<AdminReportPeriod>('month');
  const [teamId, setTeamId] = useState<string>('');
  const [clinicianId, setClinicianId] = useState<string>('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [detailMetric, setDetailMetric] = useState<AdminReportMetricKey>('total_consumers');
  const [trendMetrics, setTrendMetrics] = useState<AdminReportMetricKey[]>([
    'total_consumers',
    'new_consumer',
    'overdue_91d_review',
  ]);
  const [granularity, setGranularity] = useState<AdminReportTrendGranularity>('month');

  const filters = useMemo<AdminReportFilters>(() => ({
    period,
    teamId: teamId || undefined,
    clinicianId: clinicianId || undefined,
    from: period === 'custom' && from ? from : undefined,
    to: period === 'custom' && to ? to : undefined,
  }), [period, teamId, clinicianId, from, to]);
  const customRangeReady = period !== 'custom' || (from.length > 0 && to.length > 0);

  const { data: metadata, isLoading: metadataLoading, error: metadataError } = useQuery({
    queryKey: adminReportKeys.metadata(clinicId),
    queryFn: () => reportsApi.getAdminReportMetadata(),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(clinicId),
  });

  const {
    data: overview,
    isLoading: overviewLoading,
    error: overviewError,
  } = useQuery({
    queryKey: adminReportKeys.overview(clinicId, filters),
    queryFn: () => reportsApi.getAdminReportOverview(filters),
    staleTime: 60 * 1000,
    enabled: Boolean(clinicId) && customRangeReady,
  });

  const {
    data: details,
    isLoading: detailsLoading,
    error: detailsError,
  } = useQuery({
    queryKey: adminReportKeys.details(clinicId, detailMetric, 200, filters),
    queryFn: () => reportsApi.getAdminReportDetails({ ...filters, metricKey: detailMetric, limit: 200 }),
    staleTime: 60 * 1000,
    enabled: Boolean(clinicId) && customRangeReady,
  });

  const metricsCsv = trendMetrics.join(',');
  const {
    data: trends,
    isLoading: trendsLoading,
    error: trendsError,
  } = useQuery({
    queryKey: adminReportKeys.trends(clinicId, metricsCsv, granularity, filters),
    queryFn: () => reportsApi.getAdminReportTrends({
      ...filters,
      metrics: metricsCsv,
      granularity,
    }),
    staleTime: 60 * 1000,
    enabled: Boolean(clinicId) && customRangeReady,
  });

  const exportMutation = useMutation({
    mutationFn: async (format: 'csv' | 'pdf') => {
      const blob = await reportsApi.exportAdminReport({
        filters,
        view: tab,
        format,
        metricKey: tab === 'details' ? detailMetric : undefined,
        metrics: tab === 'trends' ? metricsCsv : undefined,
        granularity: tab === 'trends' ? granularity : undefined,
        limit: tab === 'details' ? 200 : undefined,
      });
      const metricSuffix = tab === 'details' ? `-${safeFileName(detailMetric)}` : '';
      downloadBlob(blob, `admin-report-${tab}${metricSuffix}.${format}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminReportKeys.clinic(clinicId) });
    },
  });

  const groupedCards = useMemo(() => {
    const groups = new Map<string, Array<{ key: AdminReportMetricKey; label: string; group: string; count: number }>>();
    for (const card of overview?.cards ?? []) {
      const list = groups.get(card.group) ?? [];
      list.push(card);
      groups.set(card.group, list);
    }
    return [...groups.entries()];
  }, [overview]);

  const trendRows = useMemo(() => {
    const rows = new Map<string, Record<string, number | string>>();
    for (const series of trends?.series ?? []) {
      for (const point of series.points) {
        const key = point.bucketStart;
        const row = rows.get(key) ?? {
          bucketStart: point.bucketStart,
          bucketEnd: point.bucketEnd,
          label: `${point.bucketStart} - ${point.bucketEnd}`,
        };
        row[series.metricLabel] = point.count;
        rows.set(key, row);
      }
    }
    return [...rows.values()].sort((a, b) => String(a.bucketStart).localeCompare(String(b.bucketStart)));
  }, [trends]);

  const topError = metadataError ?? overviewError ?? detailsError ?? trendsError ?? null;

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2, alignItems: { md: 'center' } }}>
        <Typography variant="h6" fontWeight={700}>Admin Report</Typography>
        <Stack direction="row" spacing={1} sx={{ ml: { md: 'auto' } }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={() => exportMutation.mutate('csv')}
            disabled={exportMutation.isPending || !customRangeReady}
          >
            Export CSV
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={() => exportMutation.mutate('pdf')}
            disabled={exportMutation.isPending || !customRangeReady}
          >
            Export PDF
          </Button>
        </Stack>
      </Stack>

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 6, md: 2 }}>
          <FormControl fullWidth size="small">
            <InputLabel>Period</InputLabel>
            <Select
              value={period}
              label="Period"
              onChange={(event: SelectChangeEvent) => setPeriod(event.target.value as AdminReportPeriod)}
            >
              <MenuItem value="week">This Week</MenuItem>
              <MenuItem value="month">This Month</MenuItem>
              <MenuItem value="quarter">This Quarter</MenuItem>
              <MenuItem value="year">This Year</MenuItem>
              <MenuItem value="custom">Custom</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <FormControl fullWidth size="small" disabled={metadataLoading}>
            <InputLabel>Team</InputLabel>
            <Select value={teamId} label="Team" onChange={(event) => setTeamId(event.target.value)}>
              <MenuItem value="">All Teams</MenuItem>
              {(metadata?.teams ?? []).map((team) => (
                <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <FormControl fullWidth size="small" disabled={metadataLoading}>
            <InputLabel>Clinician</InputLabel>
            <Select value={clinicianId} label="Clinician" onChange={(event) => setClinicianId(event.target.value)}>
              <MenuItem value="">All Clinicians</MenuItem>
              {(metadata?.clinicians ?? []).map((clinician) => (
                <MenuItem key={clinician.id} value={clinician.id}>{clinician.fullName}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        {period === 'custom' && (
          <>
            <Grid size={{ xs: 12, sm: 6, md: 2 }}>
              <TextField
                fullWidth
                size="small"
                label="From"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 2 }}>
              <TextField
                fullWidth
                size="small"
                label="To"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </Grid>
          </>
        )}
      </Grid>

      {topError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {topError instanceof Error ? topError.message : 'Failed to load report data'}
        </Alert>
      )}

      {!customRangeReady && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Select both `from` and `to` dates for custom period reporting.
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mb: 2 }}>
        <Tab value="overview" icon={<InsightsIcon />} iconPosition="start" label="Overview" />
        <Tab value="details" icon={<TableViewIcon />} iconPosition="start" label="Details" />
        <Tab value="trends" icon={<InsightsIcon />} iconPosition="start" label="Trends" />
      </Tabs>

      {tab === 'overview' && (
        <>
          {overviewLoading && <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>}
          {!overviewLoading && groupedCards.map(([group, cards]) => (
            <Box key={group} sx={{ mb: 2.5 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, textTransform: 'capitalize' }}>
                {group}
              </Typography>
              <Grid container spacing={1.5}>
                {cards.map((card) => (
                  <Grid key={card.key} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                    <Card variant="outlined">
                      <CardActionArea
                        onClick={() => {
                          setDetailMetric(card.key);
                          setTab('details');
                        }}
                      >
                        <CardContent sx={{ py: 1.5 }}>
                          <Typography variant="caption" color="text.secondary">{card.label}</Typography>
                          <Typography
                            variant="h5"
                            fontWeight={800}
                            sx={{ color: GROUP_COLORS[card.group] ?? '#1565C0', lineHeight: 1.2 }}
                          >
                            {card.count}
                          </Typography>
                          <Chip
                            size="small"
                            label="View details"
                            variant="outlined"
                            sx={{ mt: 0.75, height: 20, fontSize: 11 }}
                          />
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Box>
          ))}
        </>
      )}

      {tab === 'details' && (
        <>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Metric</InputLabel>
              <Select
                value={detailMetric}
                label="Metric"
                onChange={(event: SelectChangeEvent) => setDetailMetric(event.target.value as AdminReportMetricKey)}
              >
                {ADMIN_REPORT_METRIC_META.map((metric) => (
                  <MenuItem key={metric.key} value={metric.key}>{metric.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Chip
              label={`Rows: ${details?.total ?? 0}`}
              color="primary"
              variant="outlined"
              sx={{ alignSelf: { md: 'center' } }}
            />
          </Stack>

          {detailsLoading && <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>}
          {!detailsLoading && (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>UR No</TableCell>
                    <TableCell>Patient</TableCell>
                    <TableCell>DOB</TableCell>
                    <TableCell>Team</TableCell>
                    <TableCell>Clinician</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Due</TableCell>
                    <TableCell>Notes</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(details?.rows ?? []).map((row) => (
                    <TableRow key={`${row.patientId}-${row.note ?? ''}-${row.dueDate ?? ''}`}>
                      <TableCell>{row.urNumber ?? '-'}</TableCell>
                      <TableCell>{row.patientName}</TableCell>
                      <TableCell>{formatShortDate(row.dateOfBirth)}</TableCell>
                      <TableCell>{row.team ?? '-'}</TableCell>
                      <TableCell>{row.clinician ?? '-'}</TableCell>
                      <TableCell>{row.status ?? '-'}</TableCell>
                      <TableCell>{formatShortDate(row.dueDate)}</TableCell>
                      <TableCell>{row.note ?? '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {(details?.rows.length ?? 0) === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No detail rows for current filters.
                </Typography>
              )}
            </Box>
          )}
        </>
      )}

      {tab === 'trends' && (
        <>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Trend Metrics</InputLabel>
              <Select
                multiple
                value={trendMetrics}
                label="Trend Metrics"
                onChange={(event) => {
                  const next = event.target.value as AdminReportMetricKey[];
                  setTrendMetrics(next.length > 0 ? next : ['total_consumers']);
                }}
                renderValue={(selected) =>
                  (selected as AdminReportMetricKey[])
                    .map((key) => ADMIN_REPORT_METRIC_META.find((entry) => entry.key === key)?.label ?? key)
                    .join(', ')
                }
              >
                {ADMIN_REPORT_METRIC_META.map((metric) => (
                  <MenuItem key={metric.key} value={metric.key}>
                    {metric.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Granularity</InputLabel>
              <Select
                value={granularity}
                label="Granularity"
                onChange={(event: SelectChangeEvent) => setGranularity(event.target.value as AdminReportTrendGranularity)}
              >
                <MenuItem value="day">Daily</MenuItem>
                <MenuItem value="week">Weekly</MenuItem>
                <MenuItem value="month">Monthly</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          {trendsLoading && <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>}
          {!trendsLoading && trendRows.length > 0 && (
            <Box sx={{ width: '100%', height: 420 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendRows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="bucketStart" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  {(trends?.series ?? []).map((series, index) => (
                    <Line
                      key={series.metricKey}
                      type="monotone"
                      dataKey={series.metricLabel}
                      stroke={TREND_PALETTE[index % TREND_PALETTE.length]}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Box>
          )}
          {!trendsLoading && trendRows.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              No trend data for current filters.
            </Typography>
          )}
        </>
      )}
    </Paper>
  );
}
