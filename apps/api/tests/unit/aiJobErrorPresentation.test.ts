import { describe, expect, it } from 'vitest';
import { toClinicianFacingAiJobErrorMessage } from '../../src/features/llm/aiJobErrorPresentation';

describe('toClinicianFacingAiJobErrorMessage', () => {
  it('returns safe queue-unavailable guidance', () => {
    expect(toClinicianFacingAiJobErrorMessage({
      errorCode: 'AI_JOB_QUEUE_UNAVAILABLE',
      errorMessage: 'connect ECONNREFUSED redis',
    })).toContain('background AI queue');
  });

  it('preserves safe model-unavailable wording', () => {
    expect(toClinicianFacingAiJobErrorMessage({
      errorCode: 'AI_MODEL_UNAVAILABLE',
      errorMessage: 'AI generation is unavailable because the configured local model service is not reachable or the model is not loaded.',
    })).toContain('configured local model service');
  });

  it('hides raw SQL/database persistence failures', () => {
    expect(toClinicianFacingAiJobErrorMessage({
      errorCode: 'JOB_QUEUE_ERROR',
      errorMessage: 'update \"ai_job_runs\" set ... invalid input syntax for type json',
    })).toBe('AI output was generated but could not be saved durably. Retry shortly or contact your administrator if it persists.');
  });
});
