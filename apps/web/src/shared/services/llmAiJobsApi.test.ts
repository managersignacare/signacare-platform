import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CLINICAL_AI_JOB_QUEUED_EVENT,
  CLINICAL_AI_JOB_RECOVERY_STORAGE_KEY,
  CLINICAL_AI_JOB_TIMEOUT_MS,
  llmAiJobsApi,
} from './llmAiJobsApi';
import { apiClient, SignacareApiError } from './apiClient';

vi.mock('./apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./apiClient')>();
  return {
    ...actual,
    apiClient: {
      get: vi.fn(),
      post: vi.fn(),
    },
  };
});

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
}

describe('llmAiJobsApi durable clinical AI jobs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.post).mockReset();
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.stubGlobal('dispatchEvent', vi.fn());
    vi.stubGlobal('CustomEvent', class {
      readonly type: string;
      readonly detail: unknown;

      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps the polling window suitable for slow clinical summary generation', () => {
    expect(CLINICAL_AI_JOB_TIMEOUT_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('submits clinical summaries through the async job endpoint', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      jobId: 'job-1',
      action: 'maudsley',
      status: 'queued',
      message: 'queued',
    });

    await llmAiJobsApi.queueClinicalAiJob({
      action: 'maudsley',
      data: 'patient context',
      patientId: '11111111-1111-4111-8111-111111111111',
    });

    expect(apiClient.post).toHaveBeenCalledWith('ai/jobs', {
      action: 'maudsley',
      data: 'patient context',
      patientId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('records a PHI-safe queued-job recovery stub and event for durable recovery UI', async () => {
    vi.setSystemTime(new Date('2026-06-06T02:00:00.000Z'));
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      jobId: 'job-recovery-1',
      action: 'mhrt-report',
      status: 'queued',
      message: 'queued',
    });

    await llmAiJobsApi.queueClinicalAiJob({
      action: 'mhrt-report',
      data: { legalOrders: 2 },
      patientId: '11111111-1111-4111-8111-111111111111',
      enhance: true,
    });

    const stored = JSON.parse(
      globalThis.localStorage.getItem(CLINICAL_AI_JOB_RECOVERY_STORAGE_KEY) ?? '[]',
    ) as Array<Record<string, unknown>>;

    expect(stored).toEqual([
      {
        jobId: 'job-recovery-1',
        action: 'mhrt-report',
        patientId: '11111111-1111-4111-8111-111111111111',
        queuedAt: '2026-06-06T02:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(stored)).not.toContain('legalOrders');
    expect(globalThis.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: CLINICAL_AI_JOB_QUEUED_EVENT,
        detail: stored[0],
      }),
    );
  });

  it('normalizes queue-submit failures into actionable summary-generation guidance', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(
      new SignacareApiError('Failed to queue AI job', 'AI_JOB_QUEUE_UNAVAILABLE', 503),
    );

    await expect(
      llmAiJobsApi.queueClinicalAiJob({
        action: 'maudsley',
        data: 'patient context',
        patientId: '11111111-1111-4111-8111-111111111111',
      }),
    ).rejects.toMatchObject({
      code: 'AI_JOB_QUEUE_UNAVAILABLE',
      message:
        'AI summary generation is temporarily unavailable because the background AI queue cannot be reached. Retry shortly or contact your administrator if it persists.',
    });
  });

  it('returns completed text from durable job status', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      jobId: 'job-1',
      action: 'formulation',
      status: 'completed',
      result: '4P formulation text',
    });

    await expect(llmAiJobsApi.waitForClinicalAiJob('job-1')).resolves.toMatchObject({
      jobId: 'job-1',
      result: '4P formulation text',
    });
    expect(apiClient.get).toHaveBeenCalledWith('ai/jobs/job-1');
  });

  it('returns the full completed status for callers that need async payload metadata', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      jobId: 'job-9',
      action: 'letter',
      status: 'queued',
      message: 'queued',
    });
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      jobId: 'job-9',
      action: 'letter',
      status: 'completed',
      result: 'Generated letter body',
      resultJson: {
        model: 'azure-fast-clinical',
        payload: {
          enriched: true,
          sections: { valid: true, missing: [] },
        },
      },
    });

    await expect(
      llmAiJobsApi.runClinicalAiJobDetailed({
        action: 'letter',
        data: 'patient context',
        patientId: '11111111-1111-4111-8111-111111111111',
        enhance: true,
      }),
    ).resolves.toMatchObject({
      jobId: 'job-9',
      status: 'completed',
      result: 'Generated letter body',
      resultJson: {
        model: 'azure-fast-clinical',
      },
    });
  });

  it('lists recent patient-scoped clinical AI jobs for recovery', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      jobs: [{ jobId: 'job-3', action: 'maudsley', status: 'completed' }],
    });

    await llmAiJobsApi.listAiJobs({
      action: 'maudsley',
      patientId: '11111111-1111-4111-8111-111111111111',
    });

    expect(apiClient.get).toHaveBeenCalledWith('ai/jobs', {
      action: 'maudsley',
      patientId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('surfaces failed durable job status instead of spinning forever', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      jobId: 'job-2',
      action: 'formulation',
      status: 'failed',
      failedReason: 'Ollama unavailable',
    });

    await expect(llmAiJobsApi.waitForClinicalAiJob('job-2')).rejects.toThrow('Ollama unavailable');
  });

  it('keeps patient summary and formulation generation off browser-held clinical-ai requests', () => {
    const summaryJobs = readFileSync(
      resolve(__dirname, '../../features/patients/components/detail/tabs/useClinicalSummaryJobs.ts'),
      'utf8',
    );
    const generateSummaryBlock = summaryJobs.slice(
      summaryJobs.indexOf('const generate = useCallback'),
      summaryJobs.indexOf('const generateSummary = useCallback'),
    );

    expect(generateSummaryBlock).toContain('llmAiJobsApi.queueClinicalAiJob');
    expect(generateSummaryBlock).toContain('llmAiJobsApi.waitForClinicalAiJob');
    expect(generateSummaryBlock).not.toContain('llm/clinical-ai');
  });

  it('keeps the patient summary tab recoverable through the full async jobs dashboard', () => {
    const summaryTab = readFileSync(
      resolve(__dirname, '../../features/patients/components/detail/tabs/SummaryTab.tsx'),
      'utf8',
    );
    const settingsPage = readFileSync(
      resolve(__dirname, '../../features/settings/pages/SettingsPage.tsx'),
      'utf8',
    );
    const settingsPanel = readFileSync(
      resolve(__dirname, '../../features/settings/components/AsyncAiJobsSettingsPanel.tsx'),
      'utf8',
    );
    const summaryJobs = readFileSync(
      resolve(__dirname, '../../features/patients/components/detail/tabs/useClinicalSummaryJobs.ts'),
      'utf8',
    );
    const dashboard = readFileSync(
      resolve(__dirname, '../../features/patients/components/detail/tabs/ClinicalAiJobsDashboard.tsx'),
      'utf8',
    );

    expect(summaryTab).not.toContain('ClinicalAiJobsDashboard');
    expect(summaryTab).toContain('buildSettingsAsyncAiJobsPath');
    expect(summaryTab).toContain('Open in Settings');
    expect(settingsPage).toContain("value=\"async-ai-jobs\"");
    expect(settingsPage).toContain('<AsyncAiJobsSettingsPanel patientId={searchParams.get(\'patientId\')} />');
    expect(settingsPanel).toContain('ClinicalAiJobsDashboard');
    expect(settingsPanel).toContain('patientId: string | null;');
    expect(settingsPanel).toContain('Applied completed async');
    expect(summaryJobs).toContain('llmAiJobsApi.queueClinicalAiJob');
    expect(summaryJobs).toContain("llmAiJobsApi.listAiJobs({ patientId, action: 'maudsley' })");
    expect(summaryJobs).toContain("llmAiJobsApi.listAiJobs({ patientId, action: 'formulation' })");
    expect(summaryJobs).toContain('const applyCompletedJob = useCallback');
    expect(dashboard).toContain('Async AI Jobs Dashboard');
    expect(dashboard).toContain('Status filter');
    expect(dashboard).toContain('Inspect');
    expect(dashboard).toContain('Output preview');
    expect(dashboard).toContain('Apply as AI draft');
    expect(dashboard).toContain('statusLabel');
    expect(dashboard).not.toContain('label={job.status}');
  });

  it('keeps letter, admin-report, and medication-summary surfaces off browser-held clinical-ai requests', () => {
    const letterDialog = readFileSync(
      resolve(__dirname, '../../features/patients/components/notes/LetterGeneratorDialog.tsx'),
      'utf8',
    );
    const correspondenceLetters = readFileSync(
      resolve(__dirname, '../../features/patients/components/detail/tabs/CorrespondenceLettersPanel.tsx'),
      'utf8',
    );
    const notesList = readFileSync(
      resolve(__dirname, '../../features/patients/components/notes/NotesList.tsx'),
      'utf8',
    );
    const reportsPage = readFileSync(
      resolve(__dirname, '../../features/reports/pages/ReportsPage.tsx'),
      'utf8',
    );
    const medHistoryPanel = readFileSync(
      resolve(__dirname, '../../features/medications/components/MedHistoryPanel.tsx'),
      'utf8',
    );

    expect(letterDialog).toContain("llmAiJobsApi.runClinicalAiJob({");
    expect(correspondenceLetters).toContain("llmAiJobsApi.runClinicalAiJob({");
    expect(notesList).toContain("llmAiJobsApi.runClinicalAiJob({");
    expect(reportsPage).toContain("action: 'admin-report'");
    expect(reportsPage).toContain("llmAiJobsApi.runClinicalAiJob({");
    expect(medHistoryPanel).toContain("action: 'med-summary'");
    expect(medHistoryPanel).toContain("llmAiJobsApi.runClinicalAiJob({");

    const generateLetterBlock = letterDialog.slice(
      letterDialog.indexOf('const generateLetter'),
      letterDialog.indexOf('React.useEffect'),
    );
    const handleAiGenerateBlock = correspondenceLetters.slice(
      correspondenceLetters.indexOf('const handleAiGenerate'),
      correspondenceLetters.indexOf('const selectedDetails'),
    );
    const noteLetterBlock = notesList.slice(
      notesList.indexOf('const handleGenerate'),
      notesList.indexOf('const handleSave'),
    );
    const adminReportBlock = reportsPage.slice(
      reportsPage.indexOf('const generateAiReport'),
      reportsPage.indexOf('return ('),
    );
    const medSummaryBlock = medHistoryPanel.slice(
      medHistoryPanel.indexOf('const generateSummary'),
      medHistoryPanel.indexOf('return ('),
    );

    expect(generateLetterBlock).not.toContain('llm/clinical-ai');
    expect(handleAiGenerateBlock).not.toContain('llm/clinical-ai');
    expect(noteLetterBlock).not.toContain('llm/clinical-ai');
    expect(adminReportBlock).not.toContain('llm/clinical-ai');
    expect(medSummaryBlock).not.toContain('llm/clinical-ai');
  });

  it('keeps patient-scoped AI agent long actions on the durable jobs lane', () => {
    const aiAgentPage = readFileSync(
      resolve(__dirname, '../../features/ai-agent/pages/AiAgentPage.tsx'),
      'utf8',
    );
    const handleGenerateBlock = aiAgentPage.slice(
      aiAgentPage.indexOf('const handleGenerate'),
      aiAgentPage.indexOf('const handleSendEmail'),
    );

    expect(handleGenerateBlock).toContain('requiresAsyncClinicalAiJob');
    expect(handleGenerateBlock).toContain('llmAiJobsApi.runClinicalAiJobDetailed');
  });

  it('keeps psychiatrist 5P formulation assist off the legacy sync generate route', () => {
    const psychiatristPage = readFileSync(
      resolve(__dirname, '../../features/psychiatrist/pages/PsychiatristPage.tsx'),
      'utf8',
    );
    const assistBlock = psychiatristPage.slice(
      psychiatristPage.indexOf('const handleAiAssist'),
      psychiatristPage.indexOf('const P_LABELS'),
    );

    expect(assistBlock).toContain("action: '5p-formulation'");
    expect(assistBlock).toContain('llmAiJobsApi.queueClinicalAiJob');
    expect(assistBlock).toContain('llmAiJobsApi.waitForClinicalAiJob');
    expect(psychiatristPage).toContain('Job ID: {aiJobId}');
    expect(psychiatristPage).toContain('Check the async AI jobs dashboard');
    expect(assistBlock).not.toContain('llm/generate');
    expect(assistBlock).not.toContain('llm/clinical-ai');
  });

  it('keeps episode discharge summary generation on the durable jobs lane', () => {
    const episodePanels = readFileSync(
      resolve(__dirname, '../../features/patients/components/detail/tabs/EpisodesAuxPanels.tsx'),
      'utf8',
    );
    const dischargeDialogBlock = episodePanels.slice(
      episodePanels.indexOf('function DischargeSummaryDialog'),
      episodePanels.indexOf('export function CloseEpisodeDialog'),
    );

    expect(dischargeDialogBlock).toContain("action: 'discharge'");
    expect(dischargeDialogBlock).toContain('llmAiJobsApi.queueClinicalAiJob');
    expect(dischargeDialogBlock).toContain('llmAiJobsApi.waitForClinicalAiJob');
    expect(dischargeDialogBlock).toContain('episodeId,');
    expect(dischargeDialogBlock).toContain('Job ID: {activeJobId}');
    expect(dischargeDialogBlock).toContain('Check the async AI jobs dashboard');
    expect(dischargeDialogBlock).not.toContain('[AI unavailable');
    expect(dischargeDialogBlock).not.toContain('discharge-summary/generate');
    expect(dischargeDialogBlock).not.toContain('llm/clinical-ai');
  });
});
