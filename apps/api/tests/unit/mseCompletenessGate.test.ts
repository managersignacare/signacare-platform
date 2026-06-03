/**
 * BUG-377 — Mental State Examination completeness gate.
 *
 * Tests the boundary gate that blocks consultation sign with too few
 * MSE domains assessed. Threshold per catalogue: ≥ 8 of 11 domains
 * not_assessed → reject.
 *
 * Why this matters (clinical-safety):
 *   - Signed consultation = forensic record per AHPRA Standard 1.
 *   - "9/11 domains skipped" but signed = legal artefact says
 *     "consultation performed" when functionally no MSE happened.
 *   - Coronial review of an outcome would find the signed record but
 *     no actual mental state assessment to support the diagnosis.
 *
 * fix-registry anchors pinned by this file:
 *   - R-FIX-BUG-377-MSE-GATE-EXISTS
 *   - R-FIX-BUG-377-MSE-GATE-FIRES-ON-SIGNED
 *   - R-FIX-BUG-377-MSE-GATE-NOT-ASSESSED-PLACEHOLDERS
 *   - R-FIX-BUG-377-MSE-GATE-DRAFT-ALLOWED
 */
import { describe, expect, it } from 'vitest';
import {
  assertMseCompletenessOnSign,
  countMseDomains,
  isDomainAssessed,
  MSE_DOMAIN_COUNT,
  MSE_MAX_NOT_ASSESSED_FOR_SIGN,
} from '../../src/features/clinical-review/mseCompletenessGate';
import type { MentalStateExam } from '@signacare/shared';
import { AppError } from '../../src/shared/errors';

const FULL_MSE: MentalStateExam = {
  appearance:     'adequate self-care, eye contact maintained',
  behaviour:      'cooperative',
  speech:         'normal rate and volume',
  mood:           'low ("flat")',
  affect:         'restricted',
  thoughtForm:    'goal-directed',
  thoughtContent: 'no SI, denies HI; mild paranoid ideation',
  perception:     'denies AVH',
  cognition:      'orientated x3',
  insight:        'partial',
  judgement:      'fair',
};

function withDomainsAssessed(n: number): MentalStateExam {
  const domains: (keyof MentalStateExam)[] = [
    'appearance', 'behaviour', 'speech', 'mood', 'affect',
    'thoughtForm', 'thoughtContent', 'perception', 'cognition',
    'insight', 'judgement',
  ];
  const out: MentalStateExam = { ...FULL_MSE };
  for (let i = n; i < domains.length; i++) {
    out[domains[i]] = null;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('isDomainAssessed (BUG-377)', () => {
  it('TP-MSE-IDA-1: counts a non-empty clinical finding as assessed', () => {
    expect(isDomainAssessed('cooperative')).toBe(true);
    expect(isDomainAssessed('WNL')).toBe(true);
    expect(isDomainAssessed('intact')).toBe(true);
    expect(isDomainAssessed('a')).toBe(true);  // any non-placeholder string
  });

  it('TP-MSE-IDA-2: counts null / undefined as not assessed', () => {
    expect(isDomainAssessed(null)).toBe(false);
    expect(isDomainAssessed(undefined)).toBe(false);
  });

  it('TP-MSE-IDA-3: counts empty / whitespace-only strings as not assessed', () => {
    expect(isDomainAssessed('')).toBe(false);
    expect(isDomainAssessed('   ')).toBe(false);
    expect(isDomainAssessed('\t\n')).toBe(false);
  });

  it('TP-MSE-IDA-4: counts canonical placeholders as not assessed (case-insensitive)', () => {
    expect(isDomainAssessed('not assessed')).toBe(false);
    expect(isDomainAssessed('Not Assessed')).toBe(false);
    expect(isDomainAssessed('NOT_ASSESSED')).toBe(false);
    expect(isDomainAssessed('not-assessed')).toBe(false);
    expect(isDomainAssessed('N/A')).toBe(false);
    expect(isDomainAssessed('na')).toBe(false);
    expect(isDomainAssessed('none')).toBe(false);
    expect(isDomainAssessed('NIL')).toBe(false);
    expect(isDomainAssessed('—')).toBe(false);
    expect(isDomainAssessed('-')).toBe(false);
    expect(isDomainAssessed('?')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('countMseDomains (BUG-377)', () => {
  it('TP-MSE-CMD-1: full MSE → 11 assessed, 0 not_assessed', () => {
    const result = countMseDomains(FULL_MSE);
    expect(result.assessed).toBe(11);
    expect(result.notAssessed).toBe(0);
    expect(result.domains.every((d) => d.assessed)).toBe(true);
  });

  it('TP-MSE-CMD-2: null mse → 0 assessed, 11 not_assessed', () => {
    const result = countMseDomains(null);
    expect(result.assessed).toBe(0);
    expect(result.notAssessed).toBe(11);
    expect(result.domains.every((d) => !d.assessed)).toBe(true);
  });

  it('TP-MSE-CMD-3: 5/11 assessed', () => {
    const result = countMseDomains(withDomainsAssessed(5));
    expect(result.assessed).toBe(5);
    expect(result.notAssessed).toBe(6);
  });

  it('TP-MSE-CMD-4: returns per-domain breakdown', () => {
    const result = countMseDomains(withDomainsAssessed(3));
    expect(result.domains.find((d) => d.name === 'appearance')!.assessed).toBe(true);
    expect(result.domains.find((d) => d.name === 'speech')!.assessed).toBe(true);
    expect(result.domains.find((d) => d.name === 'judgement')!.assessed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assertMseCompletenessOnSign (BUG-377)', () => {
  describe('happy path (sign allowed)', () => {
    it('TP-MSE-AS-1: full MSE + status=signed → no throw', () => {
      expect(() => assertMseCompletenessOnSign(FULL_MSE, 'signed')).not.toThrow();
    });

    it('TP-MSE-AS-2: 4/11 assessed + status=signed → no throw (1 below threshold of 8 not_assessed)', () => {
      // 4 assessed → 7 not_assessed → < 8 → allowed
      expect(() => assertMseCompletenessOnSign(withDomainsAssessed(4), 'signed')).not.toThrow();
    });

    it('TP-MSE-AS-3: 3/11 assessed + status=signed → throws (8 not_assessed → at threshold)', () => {
      // 3 assessed → 8 not_assessed → ≥ 8 → reject
      expect(() => assertMseCompletenessOnSign(withDomainsAssessed(3), 'signed')).toThrow();
    });
  });

  describe('reject path', () => {
    it('TP-MSE-AS-4: 0/11 assessed + status=signed → throws AppError(422, MSE_INCOMPLETE_FOR_SIGN)', () => {
      expect.assertions(3);
      try {
        assertMseCompletenessOnSign(null, 'signed');
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).status).toBe(422);
        expect((e as AppError).code).toBe('MSE_INCOMPLETE_FOR_SIGN');
      }
    });

    it('TP-MSE-AS-5: 1/11 assessed + status=signed → throws (10 not_assessed)', () => {
      expect(() => assertMseCompletenessOnSign(withDomainsAssessed(1), 'signed')).toThrow();
    });

    it('TP-MSE-AS-6: error details include assessed/notAssessed counts and skipped domain names', () => {
      try {
        assertMseCompletenessOnSign(withDomainsAssessed(2), 'signed');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        const err = e as AppError;
        const details = err.details as { assessed: number; notAssessed: number; skippedDomains: string[] };
        expect(details.assessed).toBe(2);
        expect(details.notAssessed).toBe(9);
        expect(details.skippedDomains).toContain('judgement');
        expect(details.skippedDomains.length).toBe(9);
      }
    });
  });

  describe('draft path (gate is no-op)', () => {
    it('TP-MSE-AS-7: empty MSE + status=draft → no throw (drafts are allowed sparse)', () => {
      expect(() => assertMseCompletenessOnSign(null, 'draft')).not.toThrow();
    });

    it('TP-MSE-AS-8: empty MSE + status=in_progress → no throw', () => {
      expect(() => assertMseCompletenessOnSign(null, 'in_progress')).not.toThrow();
    });

    it('TP-MSE-AS-9: empty MSE + status=cancelled → no throw (gate only fires on `signed`)', () => {
      expect(() => assertMseCompletenessOnSign(null, 'cancelled')).not.toThrow();
    });
  });

  describe('placeholder substitution', () => {
    it('TP-MSE-AS-10: MSE with all placeholders → counts as 0 assessed → throws on signed', () => {
      const placeholderMse: MentalStateExam = {
        appearance: 'not assessed',
        behaviour: 'N/A',
        speech: '',
        mood: '   ',
        affect: 'nil',
        thoughtForm: 'none',
        thoughtContent: '—',
        perception: '?',
        cognition: '-',
        insight: null,
        judgement: 'NA',
      };
      expect(() => assertMseCompletenessOnSign(placeholderMse, 'signed')).toThrow(/Cannot sign/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('threshold constants (BUG-377)', () => {
  it('TP-MSE-CONST-1: MSE_DOMAIN_COUNT = 11', () => {
    expect(MSE_DOMAIN_COUNT).toBe(11);
  });

  it('TP-MSE-CONST-2: MSE_MAX_NOT_ASSESSED_FOR_SIGN = 8 (per BUG-377 catalogue)', () => {
    expect(MSE_MAX_NOT_ASSESSED_FOR_SIGN).toBe(8);
  });

  it('TP-MSE-CONST-3: MSE_DOMAIN_COUNT matches MentalStateExamSchema shape (BUG-377 L4 schema-drift detector)', async () => {
    // L4 cycle-2 absorb: pin schema-drift between mseCompletenessGate's
    // hardcoded `MSE_DOMAIN_COUNT` + `allDomains` array and the canonical
    // `MentalStateExamSchema` in @signacare/shared. If a future PR adds
    // a 12th domain to the schema (e.g. 'risk_assessment'), the gate's
    // hardcoded list would silently drop the new domain from the count.
    // This test fails-loud on that drift.
    const { MentalStateExamSchema } = await import('@signacare/shared');
    const schemaKeys = Object.keys(MentalStateExamSchema.shape);
    expect(schemaKeys.length).toBe(MSE_DOMAIN_COUNT);
    // Also verify each schema key appears in countMseDomains' breakdown
    const breakdown = countMseDomains(null);
    const breakdownNames = breakdown.domains.map((d) => d.name).sort();
    expect(breakdownNames).toEqual([...schemaKeys].sort());
  });
});
