import { describe, expect, it } from 'vitest';
import {
  ENTERPRISE_LLM_PROMPT_PROFILES,
  LlmPromptProfileSchema,
  PromptProfileLibraryResponseSchema,
  LLM_PROMPT_PROFILE_LIBRARY_VERSION,
} from './llmPromptProfiles.schemas';

describe('llmPromptProfiles.schemas', () => {
  it('validates every enterprise profile against schema', () => {
    for (const profile of ENTERPRISE_LLM_PROMPT_PROFILES) {
      const parsed = LlmPromptProfileSchema.parse(profile);
      expect(parsed.id).toBeTruthy();
      expect(parsed.modelAgnostic).toBe(true);
      expect(parsed.targetActions.length).toBeGreaterThan(0);
    }
  });

  it('covers core clinical-ai action surfaces for portability', () => {
    const covered = new Set<string>();
    for (const profile of ENTERPRISE_LLM_PROMPT_PROFILES) {
      for (const action of profile.targetActions) covered.add(action);
    }
    expect(covered.has('report-insight')).toBe(true);
    expect(covered.has('maudsley')).toBe(true);
    expect(covered.has('formulation')).toBe(true);
    expect(covered.has('91day')).toBe(true);
    expect(covered.has('ambient')).toBe(true);
  });

  it('builds a valid response envelope', () => {
    const parsed = PromptProfileLibraryResponseSchema.parse({
      version: LLM_PROMPT_PROFILE_LIBRARY_VERSION,
      profiles: ENTERPRISE_LLM_PROMPT_PROFILES,
    });
    expect(parsed.profiles.length).toBeGreaterThan(0);
    expect(parsed.version).toMatch(/^2026-05-22/);
  });

  it('pins non-diagnostic risk-surfacing and attestation governance language', () => {
    const corpus = ENTERPRISE_LLM_PROMPT_PROFILES
      .map((profile) => `${profile.systemPrompt}\n${profile.governanceChecklist.join('\n')}`)
      .join('\n')
      .toLowerCase();

    expect(corpus).toContain('non-diagnostic');
    expect(corpus).toContain('patient-collaboration attestation');
  });
});
