/*
 * scripts/guards/__tests__/l4-feature-list-ssot.test.ts
 *
 * BUG-PRECOMMIT-REVIEW-CHAIN-FOR-S1 (S2) — L5 cycle-1 absorb Drift A
 * (2026-05-06): mechanical SSoT-parity test for the L4 clinical-feature
 * inventory.
 *
 * L5 cycle-1 caught the inventory drifted: guard regex had 23 entries;
 * spec doc had 20. Drift A absorb extracted the list to a single source
 * (`scripts/guards/lib/l4ClinicalFeatures.ts`). This test asserts:
 *   1. The format doc no longer reproduces the list verbatim (preventing
 *      future copy-paste drift).
 *   2. The format doc references the SSoT module by path.
 *   3. The check-review-attestation guard imports from the SSoT (not its
 *      own inline regex).
 *
 * Future regression class prevented: a contributor adding a new clinical-
 * data feature must update ONLY the SSoT module; the format doc + guard
 * inherit automatically.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { L4_CLINICAL_FEATURES, L4_HEURISTIC_FEATURE_RE } from '../lib/l4ClinicalFeatures';
import { REPO_ROOT } from '../lib/repoRoot';

const FORMAT_DOC_PATH = path.join(REPO_ROOT, 'docs/quality/review-attestation-format.md');
const GUARD_PATH = path.join(REPO_ROOT, 'scripts/guards/check-review-attestation.ts');

describe('L4 clinical-feature inventory SSoT (L5 cycle-1 Drift A absorb)', () => {
  it('guard imports L4_HEURISTIC_FEATURE_RE from the SSoT module', () => {
    const guardSrc = readFileSync(GUARD_PATH, 'utf-8');
    expect(guardSrc).toContain("from './lib/l4ClinicalFeatures'");
    expect(guardSrc).toContain('L4_HEURISTIC_FEATURE_RE');
  });

  it('guard does NOT contain its own inline list of clinical features', () => {
    // The pre-fix inline regex had a long alternation chain like
    // `medications|clinical-notes|llm|scribe|...`. After Drift A absorb,
    // the alternation should ONLY appear in the SSoT module, not in the
    // guard. Detection: count occurrences of any 4+ feature alternation
    // pattern in the guard.
    const guardSrc = readFileSync(GUARD_PATH, 'utf-8');
    const inlineAlternation = /medications\|clinical-notes\|llm\|scribe/;
    expect(inlineAlternation.test(guardSrc)).toBe(false);
  });

  it('format doc references the SSoT module path', () => {
    const docSrc = readFileSync(FORMAT_DOC_PATH, 'utf-8');
    expect(docSrc).toContain('scripts/guards/lib/l4ClinicalFeatures.ts');
  });

  it('format doc does NOT reproduce the feature list verbatim', () => {
    // Reproducing the list verbatim is the drift-recurrence shape. After
    // Drift A absorb, the doc explains the rubric in prose + points at
    // the SSoT module; the doc does not contain the alternation chain.
    const docSrc = readFileSync(FORMAT_DOC_PATH, 'utf-8');
    const inlineAlternation = /medications\|clinical-notes\|llm\|scribe/;
    expect(inlineAlternation.test(docSrc)).toBe(false);
  });

  it('SSoT module exports a non-empty alphabetically-sorted feature list', () => {
    expect(L4_CLINICAL_FEATURES.length).toBeGreaterThan(0);
    const sorted = [...L4_CLINICAL_FEATURES].sort();
    expect([...L4_CLINICAL_FEATURES]).toEqual(sorted);
  });

  it('SSoT regex matches every feature in the list', () => {
    for (const feature of L4_CLINICAL_FEATURES) {
      const samplePath = `apps/api/src/features/${feature}/foo.ts`;
      expect(L4_HEURISTIC_FEATURE_RE.test(samplePath)).toBe(true);
    }
  });

  it('SSoT regex rejects non-clinical paths', () => {
    expect(L4_HEURISTIC_FEATURE_RE.test('apps/api/src/features/voice/voiceRepository.ts')).toBe(false);
    expect(L4_HEURISTIC_FEATURE_RE.test('apps/api/src/middleware/authMiddleware.ts')).toBe(false);
    expect(L4_HEURISTIC_FEATURE_RE.test('apps/api/src/features/staff-settings/staffSettingsRepository.ts')).toBe(false);
    expect(L4_HEURISTIC_FEATURE_RE.test('docs/quality/bugs-remaining.md')).toBe(false);
  });
});
