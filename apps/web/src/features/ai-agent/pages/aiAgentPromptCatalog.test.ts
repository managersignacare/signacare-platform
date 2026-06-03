import { describe, expect, it } from 'vitest';
import { getPromptGroupsForRole, getQuickPromptsForRole } from './aiAgentPromptCatalog';

describe('aiAgentPromptCatalog role filtering', () => {
  it('keeps analytics groups for admin roles', () => {
    const groups = getPromptGroupsForRole('admin');
    const titles = groups.map((g) => g.title);
    expect(titles).toContain('Organisation');
    expect(titles).toContain('Team Caseload');
    expect(titles).toContain('Tasks');
    expect(groups.length).toBeGreaterThan(6);
  });

  it('hides clinic-wide analytics groups for clinician role', () => {
    const groups = getPromptGroupsForRole('clinician');
    const titles = groups.map((g) => g.title);
    expect(titles).toContain('Patient (select first)');
    expect(titles).toContain('Drug Interactions');
    expect(titles).not.toContain('Organisation');
    expect(titles).not.toContain('Team Caseload');
    expect(titles).not.toContain('Tasks');
  });

  it('returns patient-safe quick prompts for clinician role', () => {
    const prompts = getQuickPromptsForRole('clinician');
    expect(prompts).toContain('Patient clinical summary');
    expect(prompts).toContain('What medications?');
    expect(prompts).not.toContain('Organisation statistics');
  });
});
