import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@signacare/shared';
import { guardAiTextEgress } from '../../src/features/ai/egress/responseGuard';

function makeAuth(scopeLevel: NonNullable<AuthContext['aiScope']>['level'] = 'patient'): AuthContext {
  return {
    staffId: '22222222-2222-2222-2222-222222222222',
    clinicId: '11111111-1111-1111-1111-111111111111',
    role: 'clinician',
    permissions: ['clinical_notes:read'],
    aiScope: { level: scopeLevel },
    aiPurposeOfUse: 'clinical',
  };
}

describe('guardAiTextEgress', () => {
  it('injects non-diagnostic qualifier when risk-language appears without qualifier', () => {
    const out = guardAiTextEgress({
      routeId: 'clinical-ai',
      auth: makeAuth('patient'),
      text: 'Patient reports worsening suicidal thoughts and command hallucinations overnight.',
    });

    expect(out.safeText).toContain('Clinical signal for clinician review (non-diagnostic)');
    expect(out.safeText).toContain('suicidal thoughts');
    expect(out.riskLabels).toContain('non-diagnostic-risk-label-injected');
  });

  it('preserves text when non-diagnostic qualifier already exists', () => {
    const input =
      'Clinical signal for clinician review (non-diagnostic): possible relapse risk due to escalating agitation.';
    const out = guardAiTextEgress({
      routeId: 'clinical-ai',
      auth: makeAuth('patient'),
      text: input,
    });

    expect(out.safeText).toBe(input);
    expect(out.riskLabels).toContain('non-diagnostic-risk-qualified');
    expect(out.riskLabels).not.toContain('non-diagnostic-risk-label-injected');
  });

  it('does not inject qualifier for non-risk content', () => {
    const out = guardAiTextEgress({
      routeId: 'suggest',
      auth: makeAuth('team'),
      text: 'Follow-up appointment scheduled for next Tuesday at 10:00 AM.',
    });

    expect(out.safeText).toBe('Follow-up appointment scheduled for next Tuesday at 10:00 AM.');
    expect(out.riskLabels).not.toContain('non-diagnostic-risk-label-injected');
  });

  it('keeps patient-scope clinic-wide egress block intact', () => {
    expect(() =>
      guardAiTextEgress({
        routeId: 'agent',
        auth: makeAuth('patient'),
        text: 'Clinic-wide team breakdown shows no overdue tasks.',
      }),
    ).toThrowError(/AI egress blocked/);
  });
});
