import { describe, expect, it } from 'vitest';
import type {
  SummaryEpisodeRow,
  SummaryMedicationRow,
  SummaryNoteRow,
  SummaryPatientProfile,
} from './summaryTabDomain';
import {
  buildHeuristicSchemaDoc,
  normalizeSchemaDoc,
  parseSchemaDocFromLlm,
} from './lifeChartSchemaDomain';

const patient: SummaryPatientProfile = {
  givenName: 'Noah',
  familyName: 'Bennett',
  dateOfBirth: '1989-02-15',
  gender: 'male',
};

const notes: SummaryNoteRow[] = [];
const meds: SummaryMedicationRow[] = [];

describe('lifeChartSchemaDomain', () => {
  it('maps common AI synonym keys into canonical schema row fields', () => {
    const llmRaw = `\`\`\`json
{
  "version": "1.0",
  "disorderLabel": "Psychotic disorder",
  "primaryDomain": "psychotic_symptoms",
  "symptomMode": "severity",
  "baselineLabel": "Baseline symptom burden",
  "generatedBy": "ai",
  "updatedAt": "2026-05-18T00:00:00.000Z",
  "rows": [
    {
      "timeInterval": "Jan 2026",
      "intervalStart": "2026-01-01",
      "intervalEnd": "2026-01-31",
      "symptomState": "Paranoid ideation",
      "severityScore": 3,
      "activeMedications": "Olanzapine 10mg",
      "documentedLifeEvents": "Housing instability",
      "precipitants": "Sleep deprivation",
      "treatmentInterventions": "ACIS review",
      "interepisodeFunctioning": "Reduced occupational functioning",
      "substanceUsePattern": "Cannabis daily",
      "hospitalisations": "Acute ward admission",
      "comments": "Improving by end of month"
    }
  ]
}
\`\`\``;

    const parsed = parseSchemaDocFromLlm(llmRaw, { generatedBy: 'heuristic' });
    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe('2.0');
    expect(parsed?.rows).toHaveLength(1);
    const row = parsed!.rows[0];
    expect(row.intervalLabel).toBe('Jan 2026');
    expect(row.startDate).toBe('2026-01-01');
    expect(row.endDate).toBe('2026-01-31');
    expect(row.primaryState).toBe('Paranoid ideation');
    expect(row.primaryScore).toBe(3);
    expect(row.substanceUse).toBe('Cannabis daily');
    expect(row.hospitalization).toBe('Acute ward admission');
    expect(row.symptomChannel).toBe('general');
    expect(row.startDatePrecision).toBe('day');
    expect(row.endDatePrecision).toBe('day');
    expect(parsed?.clinicTimeZone).toBe('Australia/Melbourne');
  });

  it('builds bidirectional heuristic schema for bipolar trajectories', () => {
    const episodes: SummaryEpisodeRow[] = [
      {
        id: 'e1',
        episodeType: 'Mania',
        primaryDiagnosis: 'Bipolar I disorder',
        severity: 'severe',
        startDate: '2024-01-01',
        endDate: '2024-02-15',
      },
      {
        id: 'e2',
        episodeType: 'Major depression',
        primaryDiagnosis: 'Bipolar I disorder',
        severity: 'moderate',
        startDate: '2024-06-01',
        endDate: '2024-09-01',
      },
    ];

    const schema = buildHeuristicSchemaDoc(patient, episodes, notes, meds);
    expect(schema.symptomMode).toBe('bidirectional');
    expect(schema.primaryDomain).toBe('mood');
    expect(schema.rows).toHaveLength(2);
    expect(schema.rows[0].primaryScore).toBeGreaterThan(0);
    expect(schema.rows[1].primaryScore).toBeLessThan(0);
    expect(schema.rows[0].provenance.sourceTypes).toContain('episode');
  });

  it('builds severity-mode heuristic schema for psychotic trajectories', () => {
    const episodes: SummaryEpisodeRow[] = [
      {
        id: 'e1',
        episodeType: 'Psychotic relapse',
        primaryDiagnosis: 'Schizophrenia',
        severity: 'moderate',
        startDate: '2025-03-01',
        endDate: '2025-05-01',
      },
    ];

    const schema = buildHeuristicSchemaDoc(patient, episodes, notes, meds);
    expect(schema.symptomMode).toBe('severity');
    expect(schema.primaryDomain).toBe('psychotic_symptoms');
    expect(schema.rows[0].primaryScore).toBeGreaterThan(0);
    expect(schema.rows[0].symptomChannel).toBe('psychosis');
  });

  it('collapses overlapping rows inside the same symptom channel', () => {
    const normalized = normalizeSchemaDoc({
      version: '2.0',
      disorderLabel: 'Bipolar disorder',
      primaryDomain: 'mood',
      symptomMode: 'bidirectional',
      baselineLabel: 'Euthymia',
      generatedBy: 'ai',
      updatedAt: '2026-05-20T00:00:00.000Z',
      rows: [
        {
          id: 'a',
          intervalLabel: 'Wave A',
          symptomChannel: 'depression',
          startDate: '2026-01-01',
          endDate: '2026-02-10',
          primaryState: 'Depression',
          primaryScore: -3,
        },
        {
          id: 'b',
          intervalLabel: 'Wave B',
          symptomChannel: 'depression',
          startDate: '2026-02-01',
          endDate: '2026-03-01',
          primaryState: 'Depression',
          primaryScore: -2.5,
        },
      ],
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.rows).toHaveLength(1);
    expect(normalized?.rows[0].startDate).toBe('2026-01-01');
    expect(normalized?.rows[0].endDate).toBe('2026-03-01');
  });

  it('preserves cross-channel overlap while normalizing partial date precision', () => {
    const normalized = normalizeSchemaDoc({
      version: '2.0',
      disorderLabel: 'Psychiatric disorder',
      primaryDomain: 'symptom_trajectory',
      symptomMode: 'severity',
      baselineLabel: 'Baseline',
      generatedBy: 'ai',
      updatedAt: '2026-05-20T00:00:00.000Z',
      rows: [
        {
          id: 'a',
          intervalLabel: 'Psychosis period',
          symptomChannel: 'psychosis',
          startDate: '2025-03',
          endDate: '2025-06',
          primaryState: 'Psychosis',
          primaryScore: 3.5,
        },
        {
          id: 'b',
          intervalLabel: 'Substance period',
          symptomChannel: 'substance',
          startDate: '2025',
          endDate: '',
          primaryState: 'Cannabis use',
          primaryScore: 2.1,
        },
      ],
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.rows).toHaveLength(2);
    const psychosis = normalized!.rows.find((r) => r.symptomChannel === 'psychosis');
    const substance = normalized!.rows.find((r) => r.symptomChannel === 'substance');
    expect(psychosis?.startDate).toBe('2025-03-01');
    expect(psychosis?.startDatePrecision).toBe('month');
    expect(substance?.startDate).toBe('2025-01-01');
    expect(substance?.startDatePrecision).toBe('year');
  });
});
