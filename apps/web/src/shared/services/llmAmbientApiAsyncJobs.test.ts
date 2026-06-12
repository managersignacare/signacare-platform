import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AMBIENT_NOTE_JOB_TIMEOUT_MS,
  extractAmbientResultFromJobStatus,
  llmAmbientApi,
  normalizeAmbientNoteOptions,
  type AmbientAiJobStatus,
} from './llmAmbientApi';
import { apiClient } from './apiClient';
import type { AmbientNoteResult } from '../types/llmTypes';

vi.mock('./apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    instance: {
      post: vi.fn(),
    },
  },
}));

function ambientResult(): AmbientNoteResult {
  return {
    transcript: 'Patient reports anxiety and sleep disruption.',
    diarizedTranscript: '',
    extractedFacts: {
      subjective: [],
      objective: [],
      assessment: [],
      plan: [],
      medications: [],
      risk: [],
      quotes: [],
    },
    structured: {
      subjective: 'Anxiety and sleep disruption.',
      objective: '',
      assessment: 'Anxiety symptoms.',
      plan: 'Review and safety plan.',
    },
    riskFlags: [],
    suggestedDiagnosis: [],
    medications: [],
    summary: 'Anxiety symptoms with sleep disruption.',
    durationSeconds: 60,
    model: 'llama3.2',
    requestedModel: 'llama3.2',
    modelUsed: 'llama3.2',
    format: 'soap',
    pipeline: 'medical-grade',
    pass1DurationMs: 1,
    pass2DurationMs: 1,
    pass3DurationMs: 1,
    transcriptionDurationMs: 1,
    verifiedMedications: [],
    riskAssessment: {
      overallLevel: 'low',
      flags: [],
      protectiveFactors: [],
    },
    safetyAlerts: [],
    quality: {
      overallConfidence: 80,
      transcriptWordCount: 6,
      sectionsWithEvidence: 2,
      sectionsTotal: 4,
      directQuotesCount: 0,
      notAssessedDomains: [],
    },
    citedFacts: [],
    icd10Suggestions: [],
    mbsSuggestions: [],
    outcomeMeasures: [],
    scribeActions: [],
    questScore: {
      overall: 80,
      dimensions: {
        completeness: 80,
        accuracy: 80,
        safety: 80,
        clarity: 80,
        actionability: 80,
      },
      grade: 'B',
      issues: [],
    },
    specialty: 'general',
    interpreterUsed: false,
  };
}

describe('llmAmbientApi async job recovery helpers', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
  });

  it('keeps the async polling window suitable for long psychiatric interviews', () => {
    expect(AMBIENT_NOTE_JOB_TIMEOUT_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('extracts the durable ambient payload from completed AI job status', () => {
    const result = ambientResult();
    const status: AmbientAiJobStatus = {
      jobId: 'job-1',
      action: 'ambient-audio',
      status: 'completed',
      resultJson: {
        payload: result,
      },
    };

    expect(extractAmbientResultFromJobStatus(status)).toEqual(result);
  });

  it('does not treat malformed or non-ambient job payloads as recoverable notes', () => {
    const status: AmbientAiJobStatus = {
      jobId: 'job-2',
      action: 'ambient-audio',
      status: 'completed',
      resultJson: {
        payload: { summary: 'missing transcript and structured sections' },
      },
    };

    expect(extractAmbientResultFromJobStatus(status)).toBeNull();
  });

  it('requests async scribe jobs with patient and action filters', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ jobs: [] });

    await llmAmbientApi.listAiJobs({
      patientId: '11111111-1111-4111-8111-111111111111',
      action: 'ambient-audio',
    });

    expect(apiClient.get).toHaveBeenCalledWith('ai/jobs', {
      patientId: '11111111-1111-4111-8111-111111111111',
      action: 'ambient-audio',
    });
  });

  it('normalizes stale ambient options before upload', () => {
    expect(normalizeAmbientNoteOptions({
      format: 'not-a-real-format' as never,
      patientId: '11111111-1111-4111-8111-111111111111',
      consentId: '22222222-2222-4222-8222-222222222222',
      interpreterUsed: false,
      interpreterLanguage: '  Vietnamese  ',
      model: '  llama3.2  ',
    })).toEqual({
      format: 'soap',
      patientId: '11111111-1111-4111-8111-111111111111',
      consentId: '22222222-2222-4222-8222-222222222222',
      interpreterUsed: false,
      interpreterLanguage: undefined,
      model: 'llama3.2',
    });
  });

  it('fails closed before upload when patient or consent identifiers are malformed', () => {
    expect(() => normalizeAmbientNoteOptions({
      patientId: 'not-a-uuid',
      consentId: '22222222-2222-4222-8222-222222222222',
    })).toThrow('valid patient context');

    expect(() => normalizeAmbientNoteOptions({
      patientId: '11111111-1111-4111-8111-111111111111',
      consentId: 'not-a-uuid',
    })).toThrow('consent was missing or expired');
  });

  it('keeps ambient scribe recovery behind the full async jobs dashboard', () => {
    const recorder = readFileSync(
      resolve(__dirname, '../../features/patients/components/notes/AmbientAiRecorder.tsx'),
      'utf8',
    );
    // Phase 8 UI refactor extracted the async-scribe pipeline + its
    // user-facing recovery copy into useAmbientScribeJobRunner.ts.
    // The composition shell (AmbientAiRecorder.tsx) still mounts the
    // <AmbientAiJobsDashboard /> surface; the recovery message that
    // points the clinician at the dashboard now lives in the runner.
    const jobRunner = readFileSync(
      resolve(__dirname, '../../features/patients/components/notes/useAmbientScribeJobRunner.ts'),
      'utf8',
    );
    const dashboard = readFileSync(
      resolve(__dirname, '../../features/patients/components/notes/AmbientAiJobsDashboard.tsx'),
      'utf8',
    );

    expect(recorder).toContain('AmbientAiJobsDashboard');
    expect(jobRunner).toContain('Async Scribe Jobs Dashboard below');
    expect(dashboard).toContain('Async Scribe Jobs Dashboard');
    expect(dashboard).toContain('Status filter');
    expect(dashboard).toContain('llmAmbientApi.getAiJobStatus');
    expect(dashboard).toContain('Output preview');
    expect(dashboard).toContain('Apply as AI draft');
    expect(dashboard).toContain('statusLabel');
    expect(dashboard).not.toContain('label={job.status}');
  });
});
