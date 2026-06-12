import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useNavigate } from 'react-router-dom';
import { usePatient } from '../../patients/hooks/usePatient';
import { patientsKeys } from '../../patients/queryKeys';
import { ClinicalAiJobsDashboard } from '../../patients/components/detail/tabs/ClinicalAiJobsDashboard';
import { isActiveClinicalAiJobStatus } from '../../patients/components/detail/tabs/clinicalAiJobsDashboardSupport';
import type { SummaryNoteRow } from '../../patients/components/detail/tabs/summaryTabDomain';
import { extractErrorMessage } from '../../patients/components/detail/tabs/summaryTabDomain';
import {
  CLINICAL_FORMULATION_NOTE_TITLE,
  CLINICAL_FORMULATION_NOTE_TYPE,
  LONGITUDINAL_SUMMARY_NOTE_TITLE,
  LONGITUDINAL_SUMMARY_NOTE_TYPE,
  findLatestArtifactNote,
  upsertSummaryArtifactNote,
} from '../../patients/components/detail/tabs/summaryArtifacts';
import type { SummarySignoffRecord } from '../../patients/components/detail/tabs/summarySignoffTypes';
import type { ClinicalAiJobListItem } from '../../../shared/services/llmAiJobsApi';
import { llmAiJobsApi } from '../../../shared/services/llmAiJobsApi';
import { apiClient } from '../../../shared/services/apiClient';

interface AsyncAiJobsSettingsPanelProps {
  patientId: string | null;
}

type SettingsAiSection = 'longitudinal_summary' | 'clinical_formulation';

type ApplyFeedback =
  | { severity: 'success'; message: string }
  | { severity: 'error'; message: string };

const JOB_ARTIFACT_CONFIG = {
  maudsley: {
    label: 'longitudinal summary',
    noteType: LONGITUDINAL_SUMMARY_NOTE_TYPE,
    noteTitle: LONGITUDINAL_SUMMARY_NOTE_TITLE,
    signoffSection: 'longitudinal_summary' as const satisfies SettingsAiSection,
  },
  formulation: {
    label: 'clinical formulation',
    noteType: CLINICAL_FORMULATION_NOTE_TYPE,
    noteTitle: CLINICAL_FORMULATION_NOTE_TITLE,
    signoffSection: 'clinical_formulation' as const satisfies SettingsAiSection,
  },
} as const;

function readPatientDisplayName(
  patient:
    | {
        givenName?: string | null;
        familyName?: string | null;
      }
    | null
    | undefined,
): string {
  const fullName = [patient?.givenName, patient?.familyName]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' ')
    .trim();

  return fullName || 'selected patient';
}

function resolveActiveJobId(jobs: ClinicalAiJobListItem[]): string | null {
  return jobs.find((job) => isActiveClinicalAiJobStatus(job.status))?.jobId ?? null;
}

export function AsyncAiJobsSettingsPanel({ patientId }: AsyncAiJobsSettingsPanelProps) {
  const normalizedPatientId = patientId?.trim() || '';
  const hasPatientId = normalizedPatientId.length > 0;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [applyFeedback, setApplyFeedback] = React.useState<ApplyFeedback | null>(null);

  const { data: patient, isLoading: patientLoading } = usePatient(normalizedPatientId);
  const patientDisplayName = readPatientDisplayName(patient);

  const notesQuery = useQuery({
    queryKey: patientsKeys.notes(normalizedPatientId),
    queryFn: () =>
      apiClient
        .get<{ notes: SummaryNoteRow[] }>(`patients/${normalizedPatientId}/notes`)
        .then((response) => response.notes ?? []),
    enabled: hasPatientId,
  });

  const signoffsQuery = useQuery({
    queryKey: patientsKeys.summarySignoffs(normalizedPatientId),
    queryFn: () =>
      apiClient
        .get<{ signoffs?: SummarySignoffRecord[] }>(`patients/${normalizedPatientId}/summary-signoffs`)
        .then((response) => response.signoffs ?? []),
    enabled: hasPatientId,
    staleTime: 60_000,
  });

  const summaryJobsQuery = useQuery({
    queryKey: ['clinical-ai-jobs', normalizedPatientId, 'maudsley'],
    queryFn: () =>
      llmAiJobsApi.listAiJobs({ patientId: normalizedPatientId, action: 'maudsley' }).then((response) => response.jobs),
    enabled: hasPatientId,
    staleTime: 10_000,
  });

  const formulationJobsQuery = useQuery({
    queryKey: ['clinical-ai-jobs', normalizedPatientId, 'formulation'],
    queryFn: () =>
      llmAiJobsApi.listAiJobs({ patientId: normalizedPatientId, action: 'formulation' }).then((response) => response.jobs),
    enabled: hasPatientId,
    staleTime: 10_000,
  });

  const handleApplyJob = React.useCallback(
    async (job: ClinicalAiJobListItem) => {
      setApplyFeedback(null);
      try {
        const config =
          job.action === 'maudsley' || job.action === 'formulation'
            ? JOB_ARTIFACT_CONFIG[job.action]
            : null;

        if (!config) {
          throw new Error('Only longitudinal summary and clinical formulation jobs can be applied from this dashboard.');
        }

        const status = await llmAiJobsApi.getAiJobStatus(job.jobId);
        if (status.patientId && status.patientId !== normalizedPatientId) {
          throw new Error('This AI job belongs to a different patient and cannot be applied here.');
        }

        const content = status.result?.trim();
        if (status.status !== 'completed' || !content) {
          throw new Error(`Async ${config.label} job is not completed yet.`);
        }

        const latestArtifact = findLatestArtifactNote(notesQuery.data ?? [], config.noteType);
        const signedOff = (signoffsQuery.data ?? []).some(
          (row) => row.section === config.signoffSection,
        );

        await upsertSummaryArtifactNote({
          patientId: normalizedPatientId,
          noteId: latestArtifact.id,
          noteType: config.noteType,
          title: config.noteTitle,
          content,
          createNewVersion: signedOff,
        });

        await queryClient.invalidateQueries({ queryKey: patientsKeys.notes(normalizedPatientId) });
        await Promise.all([summaryJobsQuery.refetch(), formulationJobsQuery.refetch()]);

        setApplyFeedback({
          severity: 'success',
          message: `Applied completed async ${config.label} job as an AI draft note for ${patientDisplayName}.`,
        });
      } catch (error) {
        setApplyFeedback({
          severity: 'error',
          message: extractErrorMessage(error, 'Failed to apply completed async AI job.'),
        });
      }
    },
    [
      formulationJobsQuery,
      normalizedPatientId,
      notesQuery.data,
      patientDisplayName,
      queryClient,
      signoffsQuery.data,
      summaryJobsQuery,
    ],
  );

  const dependencyError = notesQuery.error ?? signoffsQuery.error;

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'flex-start', md: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h6" fontWeight={600}>Async AI Jobs</Typography>
          <Typography variant="body2" color="text.secondary">
            Review durable patient-scoped summary and formulation jobs from Settings, then apply completed output back into the patient record.
          </Typography>
        </Box>
        {hasPatientId && (
          <Button
            variant="outlined"
            startIcon={<OpenInNewIcon />}
            onClick={() => navigate(`/patients/${normalizedPatientId}`)}
            sx={{ textTransform: 'none' }}
          >
            Return to Patient Summary
          </Button>
        )}
      </Stack>

      {!hasPatientId ? (
        <Alert severity="info">
          Open this tab from a patient Summary page to inspect that patient&apos;s durable AI jobs. The patient-aware Settings link will populate the correct `patientId` automatically.
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Alert severity="info">
            {patientLoading ? 'Loading patient context…' : `Patient-scoped async AI recovery for ${patientDisplayName}.`}
          </Alert>

          {applyFeedback && (
            <Alert severity={applyFeedback.severity}>
              {applyFeedback.message}
            </Alert>
          )}

          {dependencyError && (
            <Alert severity="warning">
              {extractErrorMessage(
                dependencyError,
                'Patient notes or sign-off records could not be loaded. Inspect is still available, but applying completed jobs may be incomplete until those dependencies load cleanly.',
              )}
            </Alert>
          )}

          {(notesQuery.isLoading || signoffsQuery.isLoading) && (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                Loading patient note and sign-off context for apply actions…
              </Typography>
            </Stack>
          )}

          <ClinicalAiJobsDashboard
            patientId={normalizedPatientId}
            sections={[
              {
                label: 'Longitudinal summary',
                action: 'maudsley',
                kind: 'summary',
                jobs: summaryJobsQuery.data ?? [],
                activeJobId: resolveActiveJobId(summaryJobsQuery.data ?? []),
                loading: summaryJobsQuery.isFetching,
                onRefresh: summaryJobsQuery.refetch,
                onApply: handleApplyJob,
              },
              {
                label: 'Clinical formulation',
                action: 'formulation',
                kind: 'formulation',
                jobs: formulationJobsQuery.data ?? [],
                activeJobId: resolveActiveJobId(formulationJobsQuery.data ?? []),
                loading: formulationJobsQuery.isFetching,
                onRefresh: formulationJobsQuery.refetch,
                onApply: handleApplyJob,
              },
            ]}
          />
        </Stack>
      )}
    </Box>
  );
}
