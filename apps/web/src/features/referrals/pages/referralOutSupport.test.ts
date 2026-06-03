import { describe, expect, it } from 'vitest'
import { buildReferralOutLetterDraft } from './referralOutSupport'

describe('buildReferralOutLetterDraft', () => {
  it('includes patient summary, reason, and destination sections', () => {
    const body = buildReferralOutLetterDraft({
      patientDisplayName: 'Noah Bennett',
      patientUrNumber: 'UR-1001',
      patientDateOfBirth: '1993-02-10',
      targetRecipient: 'Riverlands Community MH Team',
      targetType: 'internal_team',
      reason: 'Relapse prevention follow-up and shared care plan.',
      diagnosisSummary: ['Bipolar affective disorder'],
      medicationSummary: ['Lithium 900mg nocte', 'Olanzapine 5mg nocte'],
      additionalClinicalSummary: 'Recent mood instability with reduced sleep.',
      generatedAt: new Date('2026-05-20T00:00:00.000Z'),
    })

    expect(body).toContain('To: Riverlands Community MH Team')
    expect(body).toContain('Reason for Referral')
    expect(body).toContain('Relapse prevention follow-up and shared care plan.')
    expect(body).toContain('- Bipolar affective disorder')
    expect(body).toContain('- Lithium 900mg nocte')
    expect(body).toContain('Current Clinical Summary')
  })

  it('falls back safely when diagnoses and medications are missing', () => {
    const body = buildReferralOutLetterDraft({
      patientDisplayName: 'Alex Wong',
      targetRecipient: 'Northside Specialist Service',
      targetType: 'new_provider',
      reason: 'Complex care coordination requested.',
    })

    expect(body).toContain('- No diagnosis recorded yet')
    expect(body).toContain('- No active medications recorded')
    expect(body).toContain('Complex care coordination requested.')
  })
})
