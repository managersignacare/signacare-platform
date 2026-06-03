import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DownloadIcon from '@mui/icons-material/Download';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Grid, Paper, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, TextField, Typography
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../../shared/services/apiClient';
import { cmiKeys } from '../queryKeys';

interface CmiStatusResponse {
  configured: boolean;
  mode: string;
  orgCode: string;
}

interface CmiValidationIssue {
  recordType: string;
  field: string;
  message: string;
}

interface CmiPrepareResponse {
  payload?: {
    episodes?: unknown[];
    contacts?: unknown[];
    outcomes?: unknown[];
  };
  validation?: {
    errors?: CmiValidationIssue[];
    warnings?: string[];
  };
}

interface CmiSubmitResponse {
  success: boolean;
  submissionId?: string;
  recordsAccepted?: number;
  recordsRejected?: number;
  validationErrors?: Array<{ message?: string }>;
}

function errorMessage(err: unknown, fallback: string): string {
  if (typeof err !== 'object' || err === null) return fallback;
  const maybeErr = err as {
    message?: unknown;
    response?: { data?: { error?: unknown; message?: unknown } };
  };
  if (typeof maybeErr.response?.data?.error === 'string' && maybeErr.response.data.error.trim()) return maybeErr.response.data.error;
  if (typeof maybeErr.response?.data?.message === 'string' && maybeErr.response.data.message.trim()) return maybeErr.response.data.message;
  if (typeof maybeErr.message === 'string' && maybeErr.message.trim()) return maybeErr.message;
  return fallback;
}

export function CmiPanel() {
  const [dateFrom, setDateFrom] = useState(new Date(Date.now() - 91 * 86400000).toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [prepResult, setPrepResult] = useState<CmiPrepareResponse | null>(null);
  const [submitResult, setSubmitResult] = useState<CmiSubmitResponse | null>(null);

  const { data: status } = useQuery({
    queryKey: cmiKeys.all,
    queryFn: () => apiClient.get<CmiStatusResponse>('cmi/status').catch(() => ({ configured: false, mode: 'test', orgCode: 'Not set' })),
  });

  const handlePrepare = async () => {
    setPreparing(true); setPrepResult(null); setSubmitResult(null);
    try {
      const result = await apiClient.post<CmiPrepareResponse>('cmi/prepare', { dateFrom, dateTo });
      setPrepResult(result);
    } catch (err: unknown) {
      setPrepResult({ validation: { errors: [{ recordType: 'system', field: 'api', message: errorMessage(err, 'Failed') }], warnings: [] } });
    } finally {
      setPreparing(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true); setSubmitResult(null);
    try {
      const result = await apiClient.post<CmiSubmitResponse>('cmi/submit', { dateFrom, dateTo });
      setSubmitResult(result);
    } catch (err: unknown) {
      setSubmitResult({ success: false, validationErrors: [{ message: errorMessage(err, 'Unknown error') }] });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadCsv = (type: string) => {
    window.open(`${import.meta.env.VITE_API_URL}/cmi/export?dateFrom=${dateFrom}&dateTo=${dateTo}&type=${type}`, '_blank');
  };

  const ep = prepResult?.payload?.episodes ?? [];
  const co = prepResult?.payload?.contacts ?? [];
  const ou = prepResult?.payload?.outcomes ?? [];
  const errors = prepResult?.validation?.errors ?? [];
  const warnings = prepResult?.validation?.warnings ?? [];

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={600}>Victorian CMI Data Submission</Typography>
            <Typography variant="body2" color="text.secondary">
              Department of Health Victoria — Mental Health Client Management Interface
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Chip label={status?.configured ? 'API Configured' : 'File Export Only'} size="small"
              color={status?.configured ? 'success' : 'warning'} sx={{ mb: 0.5 }} />
            <Typography variant="caption" display="block" color="text.secondary">
              Mode: {status?.mode ?? 'test'} | Org: {status?.orgCode}
            </Typography>
          </Box>
        </Box>

        {/* Period Selection */}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField label="Period From" type="date" fullWidth size="small" value={dateFrom}
              onChange={e => setDateFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField label="Period To" type="date" fullWidth size="small" value={dateTo}
              onChange={e => setDateTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Button variant="contained" fullWidth onClick={handlePrepare} disabled={preparing}
              startIcon={preparing ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : <CloudUploadIcon />}
              sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, height: 40 }}>
              {preparing ? 'Extracting...' : 'Prepare Submission'}
            </Button>
          </Grid>
        </Grid>

        {/* NOCC Requirements Info */}
        <Alert severity="info" sx={{ mb: 2, fontSize: 12 }}>
          <strong>NOCC Requirements:</strong> HoNOS + consumer-rated measure (K10+) at admission, 91-day review, and discharge.
          LSP-16 at admission and discharge. All service contacts must be recorded with duration, modality, and clinician category.
        </Alert>
      </Paper>

      {/* Results */}
      {prepResult && (
        <>
          {/* Summary Cards */}
          <Grid container spacing={2} sx={{ mb: 2 }}>
            {[
              { label: 'Episodes', count: ep.length, color: '#327C8D' },
              { label: 'Service Contacts', count: co.length, color: '#b8621a' },
              { label: 'Outcome Measures', count: ou.length, color: '#2E7D32' },
              { label: 'Validation Errors', count: errors.length, color: errors.length ? '#D32F2F' : '#999' },
            ].map(s => (
              <Grid key={s.label} size={{ xs: 6, sm: 3 }}>
                <Card variant="outlined">
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
                    <Typography variant="h4" fontWeight={800} sx={{ color: s.color }}>{s.count}</Typography>
                    <Typography variant="caption" color="text.secondary">{s.label}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          {/* Warnings */}
          {warnings.map((w: string, i: number) => (
            <Alert role="alert" key={i} severity="warning" sx={{ mb: 1, fontSize: 12 }}>{w}</Alert>
          ))}

          {/* Validation Errors */}
          {errors.length > 0 && (
            <Paper variant="outlined" sx={{ mb: 2 }}>
              <Box sx={{ p: 2, bgcolor: '#FFF3E0' }}>
                <Typography variant="subtitle2" fontWeight={600} color="error">Validation Errors ({errors.length})</Typography>
              </Box>
              <TableContainer role="region" aria-label="Data table">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Field</TableCell>
                      <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Message</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {errors.slice(0, 20).map((e, i: number) => (
                      <TableRow key={i}>
                        <TableCell sx={{ fontSize: 12 }}>{e.recordType}</TableCell>
                        <TableCell sx={{ fontSize: 12, fontFamily: 'monospace' }}>{e.field}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{e.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          {/* Actions */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => handleDownloadCsv('episodes')}
                  sx={{ textTransform: 'none', borderColor: '#327C8D', color: '#327C8D' }}>Episodes CSV</Button>
                <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => handleDownloadCsv('contacts')}
                  sx={{ textTransform: 'none', borderColor: '#b8621a', color: '#b8621a' }}>Contacts CSV</Button>
                <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => handleDownloadCsv('outcomes')}
                  sx={{ textTransform: 'none', borderColor: '#2E7D32', color: '#2E7D32' }}>Outcomes CSV</Button>
              </Box>
              <Button variant="contained" startIcon={submitting ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : <CloudUploadIcon />}
                onClick={handleSubmit} disabled={submitting || errors.length > 0}
                sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
                {submitting ? 'Submitting...' : status?.configured ? 'Submit to CMI' : 'Validate Only'}
              </Button>
            </Box>
          </Paper>

          {/* Submit Result */}
          {submitResult && (
            <Alert severity={submitResult.success ? 'success' : 'error'} sx={{ mt: 2 }}>
              {submitResult.success ? (
                <>
                  <strong>Submission successful!</strong> ID: {submitResult.submissionId} — {submitResult.recordsAccepted} records accepted, {submitResult.recordsRejected} rejected.
                </>
              ) : (
                <>Submission failed: {submitResult.validationErrors?.[0]?.message ?? 'Unknown error'}</>
              )}
            </Alert>
          )}
        </>
      )}
    </Box>
  );
}
