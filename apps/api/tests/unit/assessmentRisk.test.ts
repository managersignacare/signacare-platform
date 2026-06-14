import { describe, expect, it } from 'vitest';
import {
  detectSuicideRiskSignal,
  deriveAssessmentTotalScore,
  derivePhq9Q9Score,
} from '../../src/shared/assessmentRisk';

describe('assessmentRisk', () => {
  it('does not trigger suicide-risk escalation for non-PHQ measures', () => {
    const signal = detectSuicideRiskSignal({
      measureType: 'honos',
      responses: { q1: 2, q2: 1, q9: 3 },
      submittedTotalScore: 22,
    });
    expect(signal.isPhq9).toBe(false);
    expect(signal.triggered).toBe(false);
    expect(signal.reason).toBeNull();
  });

  it('triggers on PHQ-9 Q9 positive even when total score is below 20', () => {
    const signal = detectSuicideRiskSignal({
      measureType: 'PHQ-9',
      responses: { q1: 1, q2: 1, q3: 1, q9: 1 },
      submittedTotalScore: 8,
    });
    expect(signal.isPhq9).toBe(true);
    expect(signal.q9Score).toBe(1);
    expect(signal.totalScore).toBe(4);
    expect(signal.submittedTotalScore).toBe(8);
    expect(signal.hasScoreMismatch).toBe(true);
    expect(signal.triggered).toBe(true);
    expect(signal.reason).toBe('PHQ-9 self-harm/suicide item positive');
  });

  it('triggers on PHQ-9 total score >= 20 when Q9 is 0', () => {
    const signal = detectSuicideRiskSignal({
      measureType: 'phq9',
      responses: { q1: 3, q2: 3, q3: 3, q4: 3, q5: 3, q6: 3, q7: 2, q8: 0, q9: 0 },
      submittedTotalScore: 20,
    });
    expect(signal.q9Score).toBe(0);
    expect(signal.totalScore).toBe(20);
    expect(signal.hasScoreMismatch).toBe(false);
    expect(signal.triggered).toBe(true);
    expect(signal.reason).toBe('PHQ-9 total score >= 20');
  });

  it('triggers with combined reason when Q9 positive and total >= 20', () => {
    const signal = detectSuicideRiskSignal({
      templateName: 'PHQ-9 Self Report',
      responses: { q1: 3, q2: 3, q3: 3, q4: 3, q5: 3, q6: 2, q7: 2, q8: 0, q9: 2 },
      submittedTotalScore: 24,
    });
    expect(signal.triggered).toBe(true);
    expect(signal.reason).toBe('PHQ-9 Q9 positive and total score >= 20');
    expect(signal.totalScore).toBe(21);
    expect(signal.hasScoreMismatch).toBe(true);
  });

  it('derives total score from nested object responses when submitted total is absent', () => {
    const total = deriveAssessmentTotalScore({
      q1: { score: 2 },
      q2: { selectedValue: 3 },
      q3: 1,
      q4: { value: 4 },
    });
    expect(total).toBe(10);
  });

  it('derives Q9 score from array responses by item id', () => {
    const q9 = derivePhq9Q9Score([
      { itemId: '1', score: 0 },
      { itemId: '9', score: 3 },
    ]);
    expect(q9).toBe(3);
  });
});
