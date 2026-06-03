/**
 * Unit tests for the HAZARD-010 scribe hallucination detector.
 *
 * The detector is the last line of defence before an LLM-generated
 * structured note reaches a clinician for review. Every test below
 * maps to a real failure mode from the ISO 14971 hazard analysis:
 *
 *   - Invented medication: LLM adds a drug the clinician never said
 *   - Invented dose: correct drug, wrong strength
 *   - Invented diagnosis: LLM pattern-matches and adds a condition
 *   - Paraphrase false-positive: we must NOT flag legitimate
 *     rephrasing
 *
 * Tests are pure — no DB, no network, no clock. The detector is
 * wired into the scribe pipeline by the aiJobRoutes handler and
 * runs post-extraction, pre-persistence.
 */

import { describe, it, expect } from 'vitest';
import {
  detectScribeHallucinations,
  extractMedicationRoot,
} from '../../src/shared/detectScribeHallucinations';

describe('extractMedicationRoot', () => {
  it('strips a trailing " NNN mg" dose suffix', () => {
    expect(extractMedicationRoot('Olanzapine 20 mg')).toBe('olanzapine');
  });

  it('strips a trailing "NNNmg" (glued) dose suffix', () => {
    expect(extractMedicationRoot('Sodium Valproate 500mg')).toBe('sodium valproate');
  });

  it('strips multi-word frequency + dose suffix', () => {
    expect(extractMedicationRoot('Paracetamol 500 mg bd')).toBe('paracetamol');
  });

  it('handles mcg / micrograms', () => {
    expect(extractMedicationRoot('Levothyroxine 100 mcg')).toBe('levothyroxine');
    expect(extractMedicationRoot('Fentanyl 25 micrograms')).toBe('fentanyl');
  });

  it('leaves a bare name untouched', () => {
    expect(extractMedicationRoot('Clozapine')).toBe('clozapine');
  });

  it('preserves two-word names when the dose is absent', () => {
    expect(extractMedicationRoot('Sodium Valproate')).toBe('sodium valproate');
  });

  it('lowercases', () => {
    expect(extractMedicationRoot('OLANZAPINE')).toBe('olanzapine');
  });
});

describe('detectScribeHallucinations', () => {
  it('reports ok when every medication appears in the transcript', () => {
    const transcript =
      'Patient tolerating olanzapine 20 mg at night with good effect.';
    const report = detectScribeHallucinations(transcript, {
      medications: [{ name: 'Olanzapine', dose: '20 mg' }],
    });
    expect(report.ok).toBe(true);
    expect(report.findings).toHaveLength(0);
  });

  it('flags a medication entirely absent from the transcript', () => {
    const transcript = 'Patient reports low mood and poor sleep. No medication changes discussed.';
    const report = detectScribeHallucinations(transcript, {
      medications: [{ name: 'Sertraline', dose: '100 mg' }],
    });
    expect(report.ok).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].kind).toBe('medication');
    expect(report.findings[0].rootTerm).toBe('sertraline');
  });

  it('flags a hallucinated dose even when the drug name is present', () => {
    const transcript =
      'I have increased her olanzapine to the maximum tolerated dose of 10 mg.';
    const report = detectScribeHallucinations(transcript, {
      medications: [{ name: 'Olanzapine', dose: '20 mg' }],
    });
    expect(report.ok).toBe(false);
    // The drug name is substantiated but the dose is not — exactly
    // one finding should emerge, and it should be about the dose.
    const doseFindings = report.findings.filter((f) => /dose/i.test(f.reason));
    expect(doseFindings).toHaveLength(1);
  });

  it('does NOT flag paraphrased diagnoses', () => {
    const transcript =
      'The patient continues to experience auditory hallucinations and disorganised speech. ' +
      'Consistent with schizophrenia.';
    const report = detectScribeHallucinations(transcript, {
      diagnoses: [{ display: 'Schizophrenia, paranoid type' }],
    });
    // The note adds "paranoid type" which is not in the transcript,
    // but the root token "schizophrenia" is substantiated. The
    // detector must NOT report this as a hallucination.
    expect(report.ok).toBe(true);
  });

  it('flags a completely invented diagnosis', () => {
    const transcript = 'Patient doing well. No acute concerns today.';
    const report = detectScribeHallucinations(transcript, {
      diagnoses: [{ display: 'Post-traumatic stress disorder' }],
    });
    expect(report.ok).toBe(false);
    expect(report.findings[0].kind).toBe('diagnosis');
  });

  it('flags an invented allergy', () => {
    const transcript = 'No new allergies reported.';
    const report = detectScribeHallucinations(transcript, {
      allergies: [{ substance: 'Penicillin' }],
    });
    expect(report.ok).toBe(false);
    expect(report.findings[0].kind).toBe('allergy');
  });

  it('returns ok for an empty note', () => {
    const report = detectScribeHallucinations('some transcript', {});
    expect(report.ok).toBe(true);
  });

  it('returns ok for empty-string medication entries', () => {
    const report = detectScribeHallucinations('transcript', {
      medications: [{ name: '' }],
    });
    expect(report.ok).toBe(true);
  });

  it('case-insensitive substantiation works', () => {
    const transcript = 'Started OLANZAPINE 20 mg at bedtime.';
    const report = detectScribeHallucinations(transcript, {
      medications: [{ name: 'olanzapine', dose: '20 mg' }],
    });
    expect(report.ok).toBe(true);
  });

  it('word boundary prevents substring false-positives', () => {
    // "ola" should NOT match "olanzapine". Flags the hallucination.
    const transcript = 'Continuing olanzapine with good effect.';
    const report = detectScribeHallucinations(transcript, {
      medications: [{ name: 'Ola' }],
    });
    // 'ola' is not a word-boundary match inside 'olanzapine', so
    // this is correctly flagged. Protects against silent accept.
    expect(report.ok).toBe(false);
  });

  it('accepts matching dose even when expressed differently in transcript', () => {
    // Note: "20mg" — Transcript: "20 milligrams" (number alone matches)
    const transcript = 'Olanzapine is at 20 now, wants to trial 30.';
    const report = detectScribeHallucinations(transcript, {
      medications: [{ name: 'Olanzapine', dose: '20 mg' }],
    });
    // Drug name found, dose "20" substring found in transcript.
    expect(report.ok).toBe(true);
  });

  it('reports multiple findings from a single note', () => {
    const transcript = 'Patient complains of insomnia.';
    const report = detectScribeHallucinations(transcript, {
      medications: [
        { name: 'Sertraline', dose: '50 mg' },
        { name: 'Quetiapine', dose: '25 mg' },
      ],
      diagnoses: [{ display: 'Generalised anxiety disorder' }],
    });
    expect(report.ok).toBe(false);
    expect(report.findings.length).toBeGreaterThanOrEqual(3);
  });

  it('the finding reason strings are UI-renderable', () => {
    const report = detectScribeHallucinations('empty', {
      medications: [{ name: 'Fictoxin' }],
    });
    expect(report.findings[0].reason).toContain('Fictoxin');
    expect(report.findings[0].reason).toContain('not substantiated');
  });
});
