import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { MeasurementDashboardSummary } from '@signacare/shared'
import {
  detectTrigger,
  expandMacro,
  MACRO_IDS,
  MACRO_TRIGGER,
} from './noteMacros'
import { apiClient } from '../../../../shared/services/apiClient'

vi.mock('../../../../shared/services/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

describe('noteMacros', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset()
  })

  it('keeps the insert toolbar macro list inclusive of the rating-scale shortcut', () => {
    expect(MACRO_IDS).toContain('ratingScale')
    expect(MACRO_TRIGGER.ratingScale).toBe('/rating scale')
  })

  it('detects the multi-word /rating scale trigger after the commit space', () => {
    const text = 'Review completed /rating scale '
    const hit = detectTrigger(text, text.length)

    expect(hit).toEqual({
      id: 'ratingScale',
      start: text.indexOf('/rating scale'),
      end: text.length,
    })
  })

  it('still detects the original single-word triggers', () => {
    const text = 'Review completed /labs '
    expect(detectTrigger(text, text.length)).toEqual({
      id: 'labs',
      start: text.indexOf('/labs'),
      end: text.length,
    })
  })

  it('expands rating scale from the most recent clinician-rated assessment', async () => {
    const summary: MeasurementDashboardSummary = {
      patientId: 'patient-1',
      episodeId: null,
      generatedAt: '2026-06-05T01:00:00.000Z',
      series: [
        {
          instrumentSlug: 'bprs',
          displayName: 'BPRS',
          family: 'clinician_rating_scale',
          raterType: 'clinician',
          source: 'clinical_note_rating_scale',
          points: [],
          latestPoint: {
            id: 'older',
            patientId: 'patient-1',
            episodeId: null,
            instrumentSlug: 'bprs',
            instrumentDisplayName: 'BPRS',
            family: 'clinician_rating_scale',
            raterType: 'clinician',
            source: 'clinical_note_rating_scale',
            rawScore: 22,
            maxScore: 126,
            minScore: 0,
            severityLabel: 'Moderate',
            severityColor: null,
            completedAt: '2026-06-01T00:00:00.000Z',
            collectionOccasion: null,
            completedByStaffId: null,
            completedByStaffName: null,
            submittedByPatient: false,
          },
          trendSummary: {
            direction: 'stable',
            rawDelta: 0,
            spanDays: 7,
            administrations: 2,
            polarity: 'higher_is_worse',
          },
          clinicalInterpretationHint: null,
        },
        {
          instrumentSlug: 'cgis',
          displayName: 'CGI-S',
          family: 'clinician_rating_scale',
          raterType: 'clinician',
          source: 'clinical_note_rating_scale',
          points: [],
          latestPoint: {
            id: 'newer',
            patientId: 'patient-1',
            episodeId: null,
            instrumentSlug: 'cgis',
            instrumentDisplayName: 'CGI-S',
            family: 'clinician_rating_scale',
            raterType: 'clinician',
            source: 'clinical_note_rating_scale',
            rawScore: 4,
            maxScore: 7,
            minScore: 1,
            severityLabel: 'Moderately ill',
            severityColor: null,
            completedAt: '2026-06-05T00:00:00.000Z',
            collectionOccasion: null,
            completedByStaffId: null,
            completedByStaffName: null,
            submittedByPatient: false,
          },
          trendSummary: {
            direction: 'stable',
            rawDelta: 0,
            spanDays: 7,
            administrations: 2,
            polarity: 'higher_is_worse',
          },
          clinicalInterpretationHint: null,
        },
      ],
      latestByFamily: {
        outcome_measure: [],
        clinician_rating_scale: [],
        self_rated_scale: [],
      },
      crossInstrumentTimeline: [],
      warnings: [],
    }

    vi.mocked(apiClient.get).mockResolvedValueOnce(summary)

    await expect(expandMacro('ratingScale', 'patient-1')).resolves.toBe(
      [
        '=== RATING SCALE ===',
        '  Instrument: CGI-S',
        '  Latest score: 4/7 — Moderately ill',
        '  Completed: 05/06/2026',
        '',
      ].join('\n'),
    )
    expect(apiClient.get).toHaveBeenCalledWith(
      'assessments/patient/patient-1/measurement-summary',
      { family: 'clinician_rating_scale' },
    )
  })
})
