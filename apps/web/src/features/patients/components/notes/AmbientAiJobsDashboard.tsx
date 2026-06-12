import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  extractAmbientResultFromJobStatus,
  llmAmbientApi,
  type AmbientAiJobStatus,
  type AmbientAiJobSummary,
} from '../../../../shared/services/llmAmbientApi';
import type { AmbientNoteResult } from '../../../../shared/types/llmTypes';
import {
  classifyAmbientAiJobsLoadError,
  type AmbientAiJobsFeedback,
} from './ambientAiJobsDashboardSupport';

type StatusFilter = 'all' | 'active' | 'completed' | 'failed';
type StatusPhase = 'active' | 'completed' | 'failed';

interface AmbientAiJobsDashboardProps {
  patientId?: string;
  disabled?: boolean;
  onApplyResult: (result: AmbientNoteResult, elapsedSeconds?: string) => boolean;
  onInspectStatus?: (status: AmbientAiJobStatus) => void;
  onLog?: (message: string) => void;
}

const ACTIVE_STATUSES = new Set([
  'queued',
  'waiting',
  'active',
  'processing',
  'transcribing',
  'generating',
  'validating',
  'retrying',
  'delayed',
]);

function formatAmbientJobTime(value?: string | Date | null): string {
  if (!value) return 'time unavailable';
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'time unavailable';
  return parsed.toLocaleString('en-AU');
}

function statusPhase(status: string): StatusPhase {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'active';
}

function statusLabel(status: string): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'retrying':
      return 'Retrying';
    case 'queued':
    case 'waiting':
    case 'delayed':
      return 'Queued';
    case 'transcribing':
      return 'Transcribing audio';
    case 'generating':
      return 'Generating note';
    case 'validating':
      return 'Validating safety';
    case 'active':
    case 'processing':
      return 'Processing';
    default:
      return ACTIVE_STATUSES.has(status) ? 'Processing' : 'Queued';
  }
}

function statusColor(status: string): 'info' | 'success' | 'warning' | 'error' {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'retrying') return 'warning';
  return 'info';
}

function progressValue(job: AmbientAiJobSummary | AmbientAiJobStatus): number | null {
  return typeof job.progress === 'number'
    ? Math.max(0, Math.min(100, job.progress))
    : null;
}

function compactJobId(jobId: string): string {
  return jobId.length > 12 ? `${jobId.slice(0, 8)}...${jobId.slice(-4)}` : jobId;
}

function sortTime(job: AmbientAiJobSummary): number {
  const value = job.completedAt ?? job.failedAt ?? job.submittedAt;
  if (!value) return 0;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function matchesFilter(job: AmbientAiJobSummary, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return statusPhase(job.status) === 'active';
  return job.status === filter;
}

function resultPreview(status: AmbientAiJobStatus | null): string {
  if (!status) return '';
  const result = extractAmbientResultFromJobStatus(status);
  if (!result) return '';
  const preview = [
    result.summary ? `Summary:\n${result.summary}` : '',
    result.structured?.assessment ? `\nAssessment:\n${result.structured.assessment}` : '',
    result.transcript ? `\nTranscript excerpt:\n${result.transcript}` : '',
  ].filter(Boolean).join('\n');
  return preview.length > 1800 ? `${preview.slice(0, 1800)}\n\n... output truncated in dashboard preview` : preview;
}

export function AmbientAiJobsDashboard({
  patientId,
  disabled,
  onApplyResult,
  onInspectStatus,
  onLog,
}: AmbientAiJobsDashboardProps) {
  const [jobs, setJobs] = useState<AmbientAiJobSummary[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [applyingJobId, setApplyingJobId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<AmbientAiJobStatus | null>(null);
  const [panelError, setPanelError] = useState('');
  const [panelNotice, setPanelNotice] = useState<AmbientAiJobsFeedback | null>(null);

  const raiseError = useCallback((message: string) => {
    setPanelError(message);
  }, []);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setPanelError('');
    setPanelNotice(null);
    try {
      if (!patientId) {
        raiseError('Cannot load async scribe jobs without a selected patient.');
        return;
      }
      const loaded = await llmAmbientApi.listAiJobs({ patientId, action: 'ambient-audio' });
      const ambientJobs = loaded
        .filter((job) => job.action === 'ambient-audio')
        .filter((job) => !job.patientId || job.patientId === patientId)
        .sort((a, b) => sortTime(b) - sortTime(a));
      setJobs(ambientJobs);
      onLog?.(`Loaded ${ambientJobs.length} async scribe job${ambientJobs.length === 1 ? '' : 's'}`);
    } catch (err) {
      const feedback = classifyAmbientAiJobsLoadError(err);
      if (feedback.severity === 'error') {
        raiseError(feedback.message);
        onLog?.(`ERROR: async scribe jobs load failed - ${feedback.message}`);
      } else {
        setPanelNotice(feedback);
        setJobs([]);
        onLog?.(`INFO: async scribe jobs unavailable - ${feedback.message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [onLog, patientId, raiseError]);

  useEffect(() => {
    if (!patientId) return;
    void loadJobs();
  }, [loadJobs, patientId]);

  const inspectJob = useCallback(async (jobId: string) => {
    setSelectedJobId(jobId);
    setSelectedStatus(null);
    setPanelError('');
    setDetailLoading(true);
    try {
      const status = await llmAmbientApi.getAiJobStatus(jobId);
      if (patientId && status.patientId && status.patientId !== patientId) {
        throw new Error('This async scribe job belongs to a different patient and cannot be inspected here.');
      }
      setSelectedStatus(status);
      onInspectStatus?.(status);
      onLog?.(`Inspected async scribe job - ${jobId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to inspect async scribe job.';
      raiseError(message);
      onLog?.(`ERROR: async scribe inspection failed - ${message}`);
    } finally {
      setDetailLoading(false);
    }
  }, [onInspectStatus, onLog, patientId, raiseError]);

  const applyJob = useCallback(async (jobId: string) => {
    setApplyingJobId(jobId);
    setPanelError('');
    try {
      const status = selectedStatus?.jobId === jobId
        ? selectedStatus
        : await llmAmbientApi.getAiJobStatus(jobId);
      if (patientId && status.patientId && status.patientId !== patientId) {
        throw new Error('This async scribe job belongs to a different patient and was not applied.');
      }
      if (status.status !== 'completed') {
        throw new Error(`Async scribe job is not complete yet: ${statusLabel(status.status)}.`);
      }
      const recovered = extractAmbientResultFromJobStatus(status);
      if (!recovered) {
        throw new Error('Async scribe job completed without a recoverable clinical note payload.');
      }
      const applied = onApplyResult(recovered);
      if (applied) {
        setSelectedStatus(status);
        onInspectStatus?.(status);
        onLog?.(`Recovered async scribe output from job - ${jobId}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to recover async scribe job.';
      raiseError(message);
      onLog?.(`ERROR: async scribe recovery failed - ${message}`);
    } finally {
      setApplyingJobId(null);
    }
  }, [onApplyResult, onInspectStatus, onLog, patientId, raiseError, selectedStatus]);

  const visibleJobs = useMemo(() => jobs.filter((job) => matchesFilter(job, filter)), [filter, jobs]);
  const activeCount = jobs.filter((job) => statusPhase(job.status) === 'active').length;
  const completedCount = jobs.filter((job) => job.status === 'completed').length;
  const failedCount = jobs.filter((job) => job.status === 'failed').length;
  const preview = resultPreview(selectedStatus);

  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 1, bgcolor: '#F6FAFB', borderColor: '#D7E7EC' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }}>
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 800, color: '#327C8D', display: 'block' }}>
            Async Scribe Jobs Dashboard
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
            Recover long-interview output after browser reloads, Azure 499 disconnects, or slow AI processing.
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
          <Chip label={`${jobs.length} total`} size="small" variant="outlined" sx={{ fontSize: 10 }} />
          <Chip label={`${activeCount} active`} size="small" color={activeCount > 0 ? 'info' : 'default'} variant="outlined" sx={{ fontSize: 10 }} />
          <Chip label={`${completedCount} completed`} size="small" color="success" variant="outlined" sx={{ fontSize: 10 }} />
          <Chip label={`${failedCount} failed`} size="small" color={failedCount > 0 ? 'error' : 'default'} variant="outlined" sx={{ fontSize: 10 }} />
          <Button
            size="small"
            startIcon={loading ? <CircularProgress size={12} /> : <RefreshIcon />}
            onClick={() => { void loadJobs(); }}
            disabled={disabled || loading}
            sx={{ fontSize: 10, textTransform: 'none', minWidth: 0, py: 0.25 }}
          >
            Refresh
          </Button>
        </Stack>
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1 }}>
        <TextField
          select
          size="small"
          label="Status filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value as StatusFilter)}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="all">All jobs</MenuItem>
          <MenuItem value="active">Queued / processing</MenuItem>
          <MenuItem value="completed">Completed</MenuItem>
          <MenuItem value="failed">Failed</MenuItem>
        </TextField>
        <Alert severity="info" sx={{ py: 0.25, flex: 1, fontSize: 11 }}>
          Completed outputs remain recoverable even if the original recording request timed out or the tab closed.
        </Alert>
      </Stack>

      {panelNotice && <Alert severity={panelNotice.severity} sx={{ mt: 1, fontSize: 12 }}>{panelNotice.message}</Alert>}
      {panelError && <Alert severity="error" sx={{ mt: 1, fontSize: 12 }}>{panelError}</Alert>}

      {visibleJobs.length === 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, fontSize: 10 }}>
          No async scribe jobs match this filter. Use Refresh after a long interview or browser disconnect.
        </Typography>
      ) : (
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          {visibleJobs.map((job) => {
            const progress = progressValue(job);
            const canApply = job.status === 'completed';
            return (
              <Box key={job.jobId} sx={{ p: 0.85, borderRadius: 1, bgcolor: '#fff', border: '1px solid #E3EEF2' }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                      <Chip label={statusLabel(job.status)} size="small" color={statusColor(job.status)} sx={{ height: 20, fontSize: 10 }} />
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 10, color: 'text.secondary' }}>
                        job {compactJobId(job.jobId)}
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.4, fontSize: 10 }}>
                      Submitted {formatAmbientJobTime(job.submittedAt)} · {statusLabel(job.status)}
                    </Typography>
                    {progress != null && (
                      <Box sx={{ mt: 0.65, maxWidth: 380 }}>
                        <LinearProgress variant="determinate" value={progress} sx={{ height: 5, borderRadius: 99 }} />
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{progress}% complete</Typography>
                      </Box>
                    )}
                    {canApply && (
                      <Alert severity="info" sx={{ mt: 0.75, py: 0.2, fontSize: 11 }}>
                        AI scribe draft ready. Review and edit before inserting into the clinical note.
                      </Alert>
                    )}
                  </Box>
                  <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="flex-end">
                    <Tooltip title="Inspect durable job state">
                      <Button
                        size="small"
                        startIcon={<VisibilityIcon />}
                        onClick={() => { void inspectJob(job.jobId); }}
                        disabled={disabled || detailLoading}
                        sx={{ fontSize: 10, textTransform: 'none', minWidth: 0, py: 0.25 }}
                      >
                        Inspect
                      </Button>
                    </Tooltip>
                    <Button
                      size="small"
                      variant={canApply ? 'contained' : 'outlined'}
                      disabled={disabled || !canApply || applyingJobId === job.jobId}
                      onClick={() => { void applyJob(job.jobId); }}
                      sx={{ fontSize: 10, textTransform: 'none', minWidth: 0, py: 0.25 }}
                    >
                      {applyingJobId === job.jobId ? 'Applying...' : canApply ? 'Apply as AI draft' : 'Not ready'}
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}

      <Collapse in={Boolean(selectedJobId)} unmountOnExit>
        <Divider sx={{ my: 1 }} />
        <Box sx={{ p: 1, borderRadius: 1, bgcolor: '#ECEFF1' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Typography variant="caption" fontWeight={800}>Scribe Job Detail</Typography>
            <Button size="small" onClick={() => { setSelectedJobId(null); setSelectedStatus(null); }} sx={{ fontSize: 10, textTransform: 'none' }}>
              Close
            </Button>
          </Stack>
          {detailLoading && <LinearProgress sx={{ my: 1 }} />}
          {selectedStatus && (
            <Box sx={{ mt: 0.75 }}>
              <Stack direction="row" spacing={0.75} flexWrap="wrap">
                <Chip label={statusLabel(selectedStatus.status)} size="small" color={statusColor(selectedStatus.status)} />
                {selectedStatus.validated != null && (
                  <Chip label={`Clinical validation: ${selectedStatus.validated ? 'passed' : 'review required'}`} size="small" variant="outlined" />
                )}
                {selectedStatus.durationMs != null && (
                  <Chip label={`Duration: ${Math.round(selectedStatus.durationMs / 1000)}s`} size="small" variant="outlined" />
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, fontSize: 10 }}>
                Full job id: {selectedStatus.jobId}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: 10 }}>
                Queued {formatAmbientJobTime(selectedStatus.queuedAt)} · Started {formatAmbientJobTime(selectedStatus.startedAt)} · Completed {formatAmbientJobTime(selectedStatus.completedAt)}
              </Typography>
              {selectedStatus.failedReason && <Alert severity="error" sx={{ mt: 1, fontSize: 12 }}>{selectedStatus.failedReason}</Alert>}
              {preview && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" fontWeight={800}>Output preview</Typography>
                  <Box sx={{ mt: 0.5, p: 1, borderRadius: 1, bgcolor: '#fff', maxHeight: 220, overflowY: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11 }}>
                    {preview}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}
