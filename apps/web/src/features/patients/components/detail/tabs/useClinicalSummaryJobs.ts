/**
 * Phase 8 UI refactor — async clinical-AI job orchestration extracted
 * from SummaryTab.
 *
 * Responsibility: own the parallel-arm orchestration for the
 * longitudinal summary (`action: 'maudsley'`) and clinical formulation
 * (`action: 'formulation'`) async-AI workflows. Each arm tracks its
 * own loading / persisting / error / job-status / active-job-id state,
 * persisted artifact note id, hydrated AI content, history list, and
 * generate / hard-reset / apply-completed actions.
 *
 * Behaviour preserved 1:1 with the original ClinicalSummaryPanel:
 *  - identical react-query keys (`['clinical-ai-jobs', patientId, ...]`)
 *  - identical refetchInterval cadence (5s while generating, 30s idle)
 *  - identical "create-new-version on signed-off" persistence semantics
 *  - identical ClinicalAiJobTimeoutError handling (keeps active-job-id
 *    so the dashboard apply path still works)
 *  - identical hydration-from-persisted-note logic (loaded ref snapshot
 *    pair to avoid stomping local edits)
 *  - identical hardReset locked behaviour (no-op when signed off)
 *  - identical refetch-on-error attempt with non-fatal console warn
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient, type QueryObserverResult } from '@tanstack/react-query';
import {
  ClinicalAiJobTimeoutError,
  llmAiJobsApi,
  type ClinicalAiJobAction,
  type ClinicalAiJobListItem,
  type ClinicalAiJobStatus,
} from '../../../../../shared/services/llmAiJobsApi';
import { patientsKeys } from '../../../queryKeys';
import { extractErrorMessage, type SummaryNoteRow } from './summaryTabDomain';
import {
  CLINICAL_FORMULATION_NOTE_TITLE,
  CLINICAL_FORMULATION_NOTE_TYPE,
  LONGITUDINAL_SUMMARY_NOTE_TITLE,
  LONGITUDINAL_SUMMARY_NOTE_TYPE,
  findLatestArtifactNote,
  listArtifactNotes,
  upsertSummaryArtifactNote,
} from './summaryArtifacts';
import { formatClinicalAiJobTime } from './ClinicalAiJobsDashboard';
import type { SummarySignoffRecord } from './summarySignoffTypes';

export type ClinicalSummaryArmKind = 'summary' | 'formulation';

type ArmConfig = {
  kind: ClinicalSummaryArmKind;
  action: ClinicalAiJobAction;
  label: string;
  noteType: typeof LONGITUDINAL_SUMMARY_NOTE_TYPE | typeof CLINICAL_FORMULATION_NOTE_TYPE;
  noteTitle: typeof LONGITUDINAL_SUMMARY_NOTE_TITLE | typeof CLINICAL_FORMULATION_NOTE_TITLE;
  signoffSection: 'longitudinal_summary' | 'clinical_formulation';
};

const SUMMARY_ARM: ArmConfig = {
  kind: 'summary',
  action: 'maudsley',
  label: 'summary',
  noteType: LONGITUDINAL_SUMMARY_NOTE_TYPE,
  noteTitle: LONGITUDINAL_SUMMARY_NOTE_TITLE,
  signoffSection: 'longitudinal_summary',
};

const FORMULATION_ARM: ArmConfig = {
  kind: 'formulation',
  action: 'formulation',
  label: 'formulation',
  noteType: CLINICAL_FORMULATION_NOTE_TYPE,
  noteTitle: CLINICAL_FORMULATION_NOTE_TITLE,
  signoffSection: 'clinical_formulation',
};

export interface ClinicalSummaryArmState {
  kind: ClinicalSummaryArmKind;
  action: ClinicalAiJobAction;
  /** Live AI-resolved content (null = nothing generated yet). */
  value: string | null;
  loading: boolean;
  persisting: boolean;
  error: string;
  jobStatus: string;
  activeJobId: string | null;
  lastGenerated: string | null;
  resetLocked: boolean;
  jobs: ClinicalAiJobListItem[];
  jobsLoading: boolean;
  refetchJobs: () => Promise<QueryObserverResult<ClinicalAiJobListItem[], Error>>;
  history: ReturnType<typeof listArtifactNotes>;
  setValue: (next: string | null) => void;
  setError: (next: string) => void;
  generate: () => Promise<void>;
  hardReset: () => Promise<void>;
  applyJob: (job: ClinicalAiJobListItem) => Promise<void>;
  persistArtifact: (content: string, options?: { createNewVersion?: boolean }) => Promise<void>;
}

export interface UseClinicalSummaryJobsOptions {
  patientId: string;
  notes: readonly SummaryNoteRow[];
  signoffRows: readonly SummarySignoffRecord[];
  /**
   * Builds the patient context payload passed as `data` to
   * llmAiJobsApi.queueClinicalAiJob. Matches the ClinicalAiJobSubmitInput
   * union `string | Record<string, unknown>` so callers can pass either a
   * pre-rendered narrative string or a structured payload.
   */
  buildContext: () => string | Record<string, unknown>;
}

export interface UseClinicalSummaryJobsReturn {
  summary: ClinicalSummaryArmState;
  formulation: ClinicalSummaryArmState;
}

function clinicalAiStillRunningMessage(label: string, jobId: string): string {
  return `${label} job ${jobId} is still running. You can leave this screen and use Settings → Async AI Jobs to inspect or apply the completed output.`;
}

interface ArmStateBuckets {
  value: string | null;
  setValue: (next: string | null) => void;
  loading: boolean;
  setLoading: (next: boolean) => void;
  persisting: boolean;
  setPersisting: (next: boolean) => void;
  error: string;
  setError: (next: string) => void;
  jobStatus: string;
  setJobStatus: (next: string) => void;
  activeJobId: string | null;
  setActiveJobId: (next: string | null) => void;
  lastGenerated: string | null;
  setLastGenerated: (next: string | null) => void;
  noteId: string | null;
  setNoteId: (next: string | null) => void;
}

function useArmStateBuckets(): ArmStateBuckets {
  const [value, setValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [persisting, setPersisting] = useState(false);
  const [error, setError] = useState('');
  const [jobStatus, setJobStatus] = useState('');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  return {
    value, setValue,
    loading, setLoading,
    persisting, setPersisting,
    error, setError,
    jobStatus, setJobStatus,
    activeJobId, setActiveJobId,
    lastGenerated, setLastGenerated,
    noteId, setNoteId,
  };
}

export function useClinicalSummaryJobs(options: UseClinicalSummaryJobsOptions): UseClinicalSummaryJobsReturn {
  const { patientId, notes, signoffRows, buildContext } = options;
  const queryClient = useQueryClient();

  const summaryBuckets = useArmStateBuckets();
  const formulationBuckets = useArmStateBuckets();
  const loadedSummaryNoteRef = useRef<string>('');
  const loadedFormulationNoteRef = useRef<string>('');

  const summarySignoff = signoffRows.find((row) => row.section === 'longitudinal_summary');
  const formulationSignoff = signoffRows.find((row) => row.section === 'clinical_formulation');
  const summaryResetLocked = Boolean(summarySignoff);
  const formulationResetLocked = Boolean(formulationSignoff);

  const summaryArtifacts = useMemo(
    () => listArtifactNotes(notes, LONGITUDINAL_SUMMARY_NOTE_TYPE),
    [notes],
  );
  const formulationArtifacts = useMemo(
    () => listArtifactNotes(notes, CLINICAL_FORMULATION_NOTE_TYPE),
    [notes],
  );
  const persistedSummary = useMemo(
    () => findLatestArtifactNote(notes, LONGITUDINAL_SUMMARY_NOTE_TYPE),
    [notes],
  );
  const persistedFormulation = useMemo(
    () => findLatestArtifactNote(notes, CLINICAL_FORMULATION_NOTE_TYPE),
    [notes],
  );
  const summaryHistory = useMemo(() => summaryArtifacts.slice(1), [summaryArtifacts]);
  const formulationHistory = useMemo(() => formulationArtifacts.slice(1), [formulationArtifacts]);

  useEffect(() => {
    const snapshot = `${persistedSummary.id ?? ''}::${persistedSummary.content}`;
    if (loadedSummaryNoteRef.current === snapshot) return;
    loadedSummaryNoteRef.current = snapshot;
    summaryBuckets.setNoteId(persistedSummary.id);
    summaryBuckets.setValue(persistedSummary.content ? persistedSummary.content : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedSummary.id, persistedSummary.content]);

  useEffect(() => {
    const snapshot = `${persistedFormulation.id ?? ''}::${persistedFormulation.content}`;
    if (loadedFormulationNoteRef.current === snapshot) return;
    loadedFormulationNoteRef.current = snapshot;
    formulationBuckets.setNoteId(persistedFormulation.id);
    formulationBuckets.setValue(persistedFormulation.content ? persistedFormulation.content : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedFormulation.id, persistedFormulation.content]);

  const summaryJobsQuery = useQuery({
    queryKey: ['clinical-ai-jobs', patientId, 'maudsley'],
    queryFn: () => llmAiJobsApi.listAiJobs({ patientId, action: 'maudsley' }).then((r) => r.jobs),
    enabled: !!patientId,
    staleTime: 10_000,
    refetchInterval: summaryBuckets.loading ? 5_000 : 30_000,
  });
  const formulationJobsQuery = useQuery({
    queryKey: ['clinical-ai-jobs', patientId, 'formulation'],
    queryFn: () => llmAiJobsApi.listAiJobs({ patientId, action: 'formulation' }).then((r) => r.jobs),
    enabled: !!patientId,
    staleTime: 10_000,
    refetchInterval: formulationBuckets.loading ? 5_000 : 30_000,
  });

  const persistArtifact = useCallback(
    async (
      arm: ArmConfig,
      buckets: ArmStateBuckets,
      content: string,
      persistOptions?: { createNewVersion?: boolean },
    ): Promise<void> => {
      buckets.setPersisting(true);
      try {
        const nextId = await upsertSummaryArtifactNote({
          patientId,
          noteId: buckets.noteId,
          noteType: arm.noteType,
          title: arm.noteTitle,
          content,
          createNewVersion: persistOptions?.createNewVersion === true,
        });
        buckets.setNoteId(nextId);
        await queryClient.invalidateQueries({ queryKey: patientsKeys.notes(patientId) });
      } finally {
        buckets.setPersisting(false);
      }
    },
    [patientId, queryClient],
  );

  const persistSummary = useCallback(
    (content: string, persistOptions?: { createNewVersion?: boolean }) =>
      persistArtifact(SUMMARY_ARM, summaryBuckets, content, persistOptions),
    [persistArtifact, summaryBuckets],
  );
  const persistFormulation = useCallback(
    (content: string, persistOptions?: { createNewVersion?: boolean }) =>
      persistArtifact(FORMULATION_ARM, formulationBuckets, content, persistOptions),
    [persistArtifact, formulationBuckets],
  );

  const applyCompletedJob = useCallback(
    async (
      arm: ArmConfig,
      buckets: ArmStateBuckets,
      signedOff: boolean,
      jobsQuery: typeof summaryJobsQuery,
      persistFn: typeof persistSummary,
      job: ClinicalAiJobListItem,
    ): Promise<void> => {
      buckets.setError('');
      buckets.setLoading(true);
      try {
        const status = await llmAiJobsApi.getAiJobStatus(job.jobId);
        if (status.patientId && status.patientId !== patientId) {
          throw new Error(`Completed ${arm.label} job belongs to a different patient and cannot be applied.`);
        }
        if (status.status !== 'completed' || !status.result?.trim()) {
          throw new Error(`Async ${arm.label} job is not completed yet.`);
        }
        const content = status.result.trim();
        buckets.setValue(content);
        if (arm.kind === 'summary') {
          buckets.setLastGenerated(formatClinicalAiJobTime(status.completedAt));
        }
        await persistFn(content, { createNewVersion: signedOff });
        buckets.setJobStatus(`Applied completed async ${arm.label} job ${job.jobId}.`);
        await jobsQuery.refetch();
      } catch (err) {
        buckets.setError(extractErrorMessage(err, `Failed to apply completed ${arm.label} job.`));
      } finally {
        buckets.setLoading(false);
      }
    },
    [patientId],
  );

  const generate = useCallback(
    async (
      arm: ArmConfig,
      buckets: ArmStateBuckets,
      signedOff: boolean,
      jobsQuery: typeof summaryJobsQuery,
      persistFn: typeof persistSummary,
    ): Promise<void> => {
      buckets.setLoading(true);
      buckets.setError('');
      buckets.setJobStatus('');
      buckets.setActiveJobId(null);
      try {
        const data = buildContext();
        const queued = await llmAiJobsApi.queueClinicalAiJob({
          action: arm.action,
          data,
          patientId,
        });
        buckets.setActiveJobId(queued.jobId);
        buckets.setJobStatus(`Queued async ${arm.label} job ${queued.jobId}.`);
        await jobsQuery.refetch();

        const completed = await llmAiJobsApi.waitForClinicalAiJob(queued.jobId, {
          onProgress: (status: ClinicalAiJobStatus) => {
            const statusText = status.statusMessage ?? status.stage ?? status.status;
            buckets.setJobStatus(`${statusText} · job ${queued.jobId}`);
          },
        });
        buckets.setError('');
        buckets.setJobStatus('');
        buckets.setActiveJobId(null);
        buckets.setValue(completed.result);
        if (arm.kind === 'summary') {
          buckets.setLastGenerated(new Date().toLocaleString('en-AU'));
        }
        await persistFn(completed.result, { createNewVersion: signedOff });
        await jobsQuery.refetch();
      } catch (err: unknown) {
        if (err instanceof ClinicalAiJobTimeoutError) {
          buckets.setActiveJobId(err.jobId);
          buckets.setError(clinicalAiStillRunningMessage(`Async ${arm.label}`, err.jobId));
        } else {
          buckets.setError(extractErrorMessage(err, `Failed to generate ${arm.label}.`));
        }
        try {
          await jobsQuery.refetch();
        } catch (refetchErr) {
          console.warn('SummaryTab: async AI jobs refetch failed after generation error', refetchErr);
        }
      } finally {
        buckets.setLoading(false);
      }
    },
    [buildContext, patientId],
  );

  const hardReset = useCallback(
    async (
      buckets: ArmStateBuckets,
      resetLocked: boolean,
      persistFn: typeof persistSummary,
      label: string,
    ): Promise<void> => {
      if (resetLocked) return;
      buckets.setError('');
      buckets.setJobStatus('');
      try {
        await persistFn('');
        buckets.setValue(null);
      } catch (err) {
        buckets.setError(extractErrorMessage(err, `Failed to reset ${label}.`));
      }
    },
    [],
  );

  const summaryArm: ClinicalSummaryArmState = {
    kind: 'summary',
    action: 'maudsley',
    value: summaryBuckets.value,
    loading: summaryBuckets.loading,
    persisting: summaryBuckets.persisting,
    error: summaryBuckets.error,
    jobStatus: summaryBuckets.jobStatus,
    activeJobId: summaryBuckets.activeJobId,
    lastGenerated: summaryBuckets.lastGenerated,
    resetLocked: summaryResetLocked,
    jobs: summaryJobsQuery.data ?? [],
    jobsLoading: summaryJobsQuery.isFetching,
    refetchJobs: summaryJobsQuery.refetch,
    history: summaryHistory,
    setValue: summaryBuckets.setValue,
    setError: summaryBuckets.setError,
    persistArtifact: persistSummary,
    generate: () => generate(SUMMARY_ARM, summaryBuckets, summaryResetLocked, summaryJobsQuery, persistSummary),
    hardReset: () => hardReset(summaryBuckets, summaryResetLocked, persistSummary, 'summary'),
    applyJob: (job) =>
      applyCompletedJob(SUMMARY_ARM, summaryBuckets, summaryResetLocked, summaryJobsQuery, persistSummary, job),
  };

  const formulationArm: ClinicalSummaryArmState = {
    kind: 'formulation',
    action: 'formulation',
    value: formulationBuckets.value,
    loading: formulationBuckets.loading,
    persisting: formulationBuckets.persisting,
    error: formulationBuckets.error,
    jobStatus: formulationBuckets.jobStatus,
    activeJobId: formulationBuckets.activeJobId,
    lastGenerated: formulationBuckets.lastGenerated,
    resetLocked: formulationResetLocked,
    jobs: formulationJobsQuery.data ?? [],
    jobsLoading: formulationJobsQuery.isFetching,
    refetchJobs: formulationJobsQuery.refetch,
    history: formulationHistory,
    setValue: formulationBuckets.setValue,
    setError: formulationBuckets.setError,
    persistArtifact: persistFormulation,
    generate: () =>
      generate(FORMULATION_ARM, formulationBuckets, formulationResetLocked, formulationJobsQuery, persistFormulation),
    hardReset: () =>
      hardReset(formulationBuckets, formulationResetLocked, persistFormulation, 'formulation'),
    applyJob: (job) =>
      applyCompletedJob(
        FORMULATION_ARM,
        formulationBuckets,
        formulationResetLocked,
        formulationJobsQuery,
        persistFormulation,
        job,
      ),
  };

  return { summary: summaryArm, formulation: formulationArm };
}
