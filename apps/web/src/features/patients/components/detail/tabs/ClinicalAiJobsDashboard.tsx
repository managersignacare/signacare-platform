import { useMemo, useState } from 'react';
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
import type {
  ClinicalAiJobAction,
  ClinicalAiJobListItem,
  ClinicalAiJobStatus,
} from '../../../../../shared/services/llmAiJobsApi';
import { llmAiJobsApi } from '../../../../../shared/services/llmAiJobsApi';
import { extractErrorMessage } from './summaryTabDomain';
import {
  collapseSupersededDashboardJobs,
  isActiveClinicalAiJobStatus,
  sortClinicalAiJobTime,
} from './clinicalAiJobsDashboardSupport';

export function formatClinicalAiJobTime(value?: string | Date | null): string {
  if (!value) return 'time unavailable';
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'time unavailable';
  return parsed.toLocaleString('en-AU');
}

type ClinicalAiDashboardKind = 'summary' | 'formulation';
type StatusFilter = 'all' | 'active' | 'completed' | 'failed';

export interface ClinicalAiJobsDashboardSection {
  label: string;
  action: ClinicalAiJobAction;
  kind: ClinicalAiDashboardKind;
  jobs: ClinicalAiJobListItem[];
  activeJobId: string | null;
  loading?: boolean;
  onRefresh: () => Promise<unknown> | void;
  onApply: (job: ClinicalAiJobListItem) => Promise<void>;
}

interface DashboardJob extends ClinicalAiJobListItem {
  groupKey: string;
  sectionLabel: string;
  kind: ClinicalAiDashboardKind;
  active: boolean;
  onApply: (job: ClinicalAiJobListItem) => Promise<void>;
}

interface ClinicalAiJobsDashboardProps {
  patientId: string;
  sections: ClinicalAiJobsDashboardSection[];
}

function matchesStatusFilter(job: DashboardJob, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return isActiveClinicalAiJobStatus(job.status);
  return job.status === filter;
}

function statusColor(status: string): 'default' | 'info' | 'success' | 'warning' | 'error' {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'retrying') return 'warning';
  if (isActiveClinicalAiJobStatus(status)) return 'info';
  return 'default';
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
      return 'Queued';
    case 'generating':
      return 'Generating';
    case 'transcribing':
      return 'Transcribing';
    case 'validating':
      return 'Validating';
    case 'processing':
      return 'Processing';
    default:
      return isActiveClinicalAiJobStatus(status) ? 'Processing' : 'Queued';
  }
}

function progressValue(job: ClinicalAiJobListItem | ClinicalAiJobStatus): number | null {
  return typeof job.progress === 'number'
    ? Math.max(0, Math.min(100, job.progress))
    : null;
}

function jobSummary(job: ClinicalAiJobListItem | ClinicalAiJobStatus): string {
  return job.statusMessage ?? job.stage ?? statusLabel(job.status);
}

function compactJobId(jobId: string): string {
  return jobId.length > 12 ? `${jobId.slice(0, 8)}...${jobId.slice(-4)}` : jobId;
}

function outputPreview(status: ClinicalAiJobStatus | null): string {
  const raw = status?.result?.trim();
  if (!raw) return '';
  return raw.length > 1600 ? `${raw.slice(0, 1600)}\n\n... output truncated in dashboard preview` : raw;
}

export function ClinicalAiJobsDashboard({ patientId, sections }: ClinicalAiJobsDashboardProps) {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<ClinicalAiJobStatus | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  const jobs = useMemo(() => sections
    .flatMap((section) => section.jobs.map((job) => ({
      ...job,
      groupKey: section.kind,
      sectionLabel: section.label,
      kind: section.kind,
      active: section.activeJobId === job.jobId,
      onApply: section.onApply,
    } satisfies DashboardJob)))
    .sort((a, b) => sortClinicalAiJobTime(b) - sortClinicalAiJobTime(a)), [sections]);

  const collapsedJobs = useMemo(
    () => collapseSupersededDashboardJobs(jobs),
    [jobs],
  );

  const visibleJobs = collapsedJobs.filter((job) => matchesStatusFilter(job, filter));
  const activeCount = collapsedJobs.filter((job) => isActiveClinicalAiJobStatus(job.status)).length;
  const completedCount = collapsedJobs.filter((job) => job.status === 'completed').length;
  const failedCount = collapsedJobs.filter((job) => job.status === 'failed').length;
  const refreshLoading = sections.some((section) => section.loading);

  const inspectJob = async (job: DashboardJob) => {
    setSelectedJobId(job.jobId);
    setSelectedStatus(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const status = await llmAiJobsApi.getAiJobStatus(job.jobId);
      if (status.patientId && status.patientId !== patientId) {
        throw new Error('This AI job belongs to a different patient and cannot be inspected here.');
      }
      setSelectedStatus(status);
    } catch (err) {
      setDetailError(extractErrorMessage(err, 'Failed to load AI job detail.'));
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshAll = async () => {
    await Promise.all(sections.map((section) => Promise.resolve(section.onRefresh())));
  };

  return (
    <Paper variant="outlined" sx={{ p: 2.25, mb: 2, borderLeft: '4px solid #263238', bgcolor: '#FBFCFD' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={800} fontFamily="Albert Sans, sans-serif">
            Async AI Jobs Dashboard
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Durable patient-scoped AI jobs. Results can be recovered after browser reloads, Azure 499 disconnects, or long model runtimes.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Chip label={`${collapsedJobs.length} total`} size="small" variant="outlined" />
          <Chip label={`${activeCount} active`} size="small" color={activeCount > 0 ? 'info' : 'default'} variant="outlined" />
          <Chip label={`${completedCount} completed`} size="small" color="success" variant="outlined" />
          <Chip label={`${failedCount} failed`} size="small" color={failedCount > 0 ? 'error' : 'default'} variant="outlined" />
          <Button
            size="small"
            startIcon={refreshLoading ? <CircularProgress size={12} /> : <RefreshIcon />}
            onClick={() => { void refreshAll(); }}
            disabled={refreshLoading}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            Refresh
          </Button>
        </Stack>
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 1.5, mb: 1 }}>
        <TextField
          select
          size="small"
          label="Status filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value as StatusFilter)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="all">All jobs</MenuItem>
          <MenuItem value="active">Queued / processing</MenuItem>
          <MenuItem value="completed">Completed</MenuItem>
          <MenuItem value="failed">Failed</MenuItem>
        </TextField>
        <Alert severity="info" sx={{ py: 0.25, alignItems: 'center', flex: 1 }}>
          Summary and formulation generation now use this durable dashboard path instead of a browser-held `llm/clinical-ai` request.
        </Alert>
      </Stack>

      {visibleJobs.length === 0 ? (
        <Box sx={{ p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 1, bgcolor: '#fff' }}>
          <Typography variant="body2" color="text.secondary">
            No async AI jobs match this filter for this patient.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1}>
          {visibleJobs.map((job) => {
            const progress = progressValue(job);
            const canApply = job.status === 'completed';
            return (
              <Box key={`${job.action}-${job.jobId}`} sx={{ p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: '#fff' }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} justifyContent="space-between">
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2" fontWeight={800}>{job.sectionLabel}</Typography>
                      <Chip label={statusLabel(job.status)} size="small" color={statusColor(job.status)} />
                      {job.active && <Chip label="active in this tab" size="small" color="info" variant="outlined" />}
                      <Typography variant="caption" color="text.secondary">job {compactJobId(job.jobId)}</Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Submitted {formatClinicalAiJobTime(job.submittedAt)} · {jobSummary(job)}
                    </Typography>
                    {progress != null && (
                      <Box sx={{ mt: 0.75, maxWidth: 420 }}>
                        <LinearProgress variant="determinate" value={progress} sx={{ height: 6, borderRadius: 99 }} />
                        <Typography variant="caption" color="text.secondary">{progress}% complete</Typography>
                      </Box>
                    )}
                    {canApply && (
                      <Alert severity="info" sx={{ mt: 1, py: 0.25 }}>
                        AI draft ready. Review, edit, and sign clinically before relying on it.
                      </Alert>
                    )}
                  </Box>
                  <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="flex-end">
                    <Tooltip title="Inspect full durable job state">
                      <Button
                        size="small"
                        startIcon={<VisibilityIcon />}
                        onClick={() => { void inspectJob(job); }}
                        sx={{ textTransform: 'none' }}
                      >
                        Inspect
                      </Button>
                    </Tooltip>
                    <Button
                      size="small"
                      variant={canApply ? 'contained' : 'outlined'}
                      disabled={!canApply}
                      onClick={() => { void job.onApply(job); }}
                      sx={{ textTransform: 'none', bgcolor: canApply ? '#263238' : undefined }}
                    >
                      {canApply ? 'Apply as AI draft' : 'Not ready'}
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}

      <Collapse in={Boolean(selectedJobId)} unmountOnExit>
        <Divider sx={{ my: 1.5 }} />
        <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: '#ECEFF1' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Typography variant="subtitle2" fontWeight={800}>Job Detail</Typography>
            <Button size="small" onClick={() => { setSelectedJobId(null); setSelectedStatus(null); }} sx={{ textTransform: 'none' }}>
              Close
            </Button>
          </Stack>
          {detailLoading && <LinearProgress sx={{ my: 1 }} />}
          {detailError && <Alert severity="error" sx={{ mt: 1 }}>{detailError}</Alert>}
          {selectedStatus && (
            <Box sx={{ mt: 1 }}>
              <Stack direction="row" spacing={0.75} flexWrap="wrap">
                <Chip label={statusLabel(selectedStatus.status)} size="small" color={statusColor(selectedStatus.status)} />
                <Chip label={`Job type: ${selectedStatus.action === 'maudsley' ? 'Longitudinal summary' : 'Clinical formulation'}`} size="small" variant="outlined" />
                {selectedStatus.validated != null && <Chip label={`validated: ${selectedStatus.validated ? 'yes' : 'no'}`} size="small" variant="outlined" />}
                {selectedStatus.durationMs != null && <Chip label={`duration: ${Math.round(selectedStatus.durationMs / 1000)}s`} size="small" variant="outlined" />}
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Full job id: {selectedStatus.jobId}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Queued {formatClinicalAiJobTime(selectedStatus.queuedAt)} · Started {formatClinicalAiJobTime(selectedStatus.startedAt)} · Completed {formatClinicalAiJobTime(selectedStatus.completedAt)}
              </Typography>
              {selectedStatus.failedReason && <Alert severity="error" sx={{ mt: 1 }}>{selectedStatus.failedReason}</Alert>}
              {outputPreview(selectedStatus) && (
                <Box sx={{ mt: 1.25 }}>
                  <Typography variant="caption" fontWeight={800}>Output preview</Typography>
                  <Box sx={{ mt: 0.5, p: 1.25, borderRadius: 1, bgcolor: '#fff', maxHeight: 260, overflowY: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}>
                    {outputPreview(selectedStatus)}
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
