// apps/web/src/features/reports/components/ReportBuilder.tsx
import { useState } from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Alert,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  Chip,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import FilterListIcon from '@mui/icons-material/FilterList';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ReportFiltersSchema,
  type ReportFilters,
  EpisodeTypeSchema,
} from '../types/reportTypes';
import { z } from 'zod';

type ReportFiltersInput = z.input<typeof ReportFiltersSchema>;
import {
  useEncounterReport,
  useClinicianFilter,
  useGenerateReport,
  useDownloadReport,
} from '../hooks/useReports';
import { format, parseISO, subMonths } from 'date-fns';

const EPISODE_TYPE_OPTIONS = EpisodeTypeSchema.options;
const REPORT_TYPES = [
  'encounters',
  'outcomes',
  'billing',
  'referrals',
  'missedappointments',
];

const defaultFilters: ReportFilters = {
  dateFrom: format(subMonths(new Date(), 3), 'yyyy-MM-dd'),
  dateTo: format(new Date(), 'yyyy-MM-dd'),
  format: 'json',
};

export function ReportBuilder() {
  const [activeFilters, setActiveFilters] = useState<ReportFilters>(defaultFilters);
  const [reportType, setReportType] = useState('encounters');
  const [runQuery, setRunQuery] = useState(false);

  const { data: clinicians } = useClinicianFilter();
  const {
    data: rows = [],
    isLoading,
    isError,
  } = useEncounterReport(activeFilters, runQuery && reportType === 'encounters');

  const generateReport = useGenerateReport();
  const downloadReport = useDownloadReport();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ReportFiltersInput>({
    resolver: zodResolver(ReportFiltersSchema),
    defaultValues: activeFilters,
  });

  const onApplyFilters = (values: ReportFiltersInput) => {
    setActiveFilters(values as ReportFilters);
    setRunQuery(true);
  };

  const onExport = (fmt: 'csv' | 'pdf') => {
    generateReport.mutate(
      { reportType, filters: { ...activeFilters, format: fmt } },
      {
        onSuccess: (result) => {
          if (result.reportId) {
            downloadReport.mutate({ reportId: result.reportId, format: fmt });
          }
        },
      },
    );
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Report Builder
      </Typography>

      {/* Filters */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Box
          component="form"
          onSubmit={handleSubmit(onApplyFilters)}
          sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}
        >
          <Typography variant="subtitle2" gutterBottom>
            <FilterListIcon fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
            Filters
          </Typography>

          <Grid container spacing={2} alignItems="flex-end">
            {/* Report Type */}
            <Grid>
              <FormControl fullWidth size="small">
                <InputLabel>Report Type</InputLabel>
                <Select
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value)}
                  label="Report Type"
                >
                  {REPORT_TYPES.map((r) => (
                    <MenuItem key={r} value={r} sx={{ textTransform: 'capitalize' }}>
                      {r.replace(/([a-z])([A-Z])/g, '$1 $2')}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Date From */}
            <Grid>
              <Controller
                name="dateFrom"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Date From"
                    type="date"
                    size="small"
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    error={Boolean(errors.dateFrom)}
                    helperText={errors.dateFrom?.message}
                  />
                )}
              />
            </Grid>

            {/* Date To */}
            <Grid>
              <Controller
                name="dateTo"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Date To"
                    type="date"
                    size="small"
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    error={Boolean(errors.dateTo)}
                    helperText={errors.dateTo?.message}
                  />
                )}
              />
            </Grid>

            {/* Clinician */}
            <Grid>
              <Controller
                name="clinicianStaffId"
                control={control}
                render={({ field }) => (
                  <FormControl fullWidth size="small">
                    <InputLabel>Clinician</InputLabel>
                    <Select {...field} label="Clinician" value={field.value ?? ''}>
                      <MenuItem value="">All clinicians</MenuItem>
                      {clinicians?.map((c) => (
                        <MenuItem key={c.id} value={c.id}>
                          {c.fullName}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              />
            </Grid>

            {/* Episode Type */}
            <Grid>
              <Controller
                name="episodeType"
                control={control}
                render={({ field }) => (
                  <FormControl fullWidth size="small">
                    <InputLabel>Episode Type</InputLabel>
                    <Select {...field} label="Episode Type" value={field.value ?? ''}>
                      <MenuItem value="">All types</MenuItem>
                      {EPISODE_TYPE_OPTIONS.map((t) => (
                        <MenuItem
                          key={t}
                          value={t}
                          sx={{ textTransform: 'capitalize' }}
                        >
                          {t.replace(/_/g, ' ')}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              />
            </Grid>

            {/* Run */}
            <Grid>
              <Button type="submit" variant="contained" fullWidth>
                Run
              </Button>
            </Grid>
          </Grid>
        </Box>
      </Paper>

      {/* Export Controls */}
      {runQuery && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 2 }}>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={() => onExport('csv')}
            disabled={generateReport.isPending}
            size="small"
          >
            Export CSV
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={() => onExport('pdf')}
            disabled={generateReport.isPending}
            size="small"
          >
            Export PDF
          </Button>
        </Box>
      )}

      {/* Results */}
      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" />}
      {isError && (
        <Alert role="alert" severity="error">Failed to load report data.</Alert>
      )}
      {!isLoading && runQuery && rows.length === 0 && (
        <Alert severity="info">No results for the selected filters.</Alert>
      )}
      {rows.length > 0 && (
        <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Patient</TableCell>
                <TableCell>Clinician</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Episode Type</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.encounterId} hover>
                  <TableCell>
                    {format(parseISO(row.encounterDate), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>{row.patientName}</TableCell>
                  <TableCell>{row.clinicianName}</TableCell>
                  <TableCell sx={{ textTransform: 'capitalize' }}>
                    {row.encounterType.replace(/_/g, ' ')}
                  </TableCell>
                  <TableCell>{row.episodeType ?? '—'}</TableCell>
                  <TableCell>
                    {row.durationMinutes ? `${row.durationMinutes}min` : '—'}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={row.status}
                      size="small"
                      color={row.status === 'signed' ? 'success' : 'default'}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
