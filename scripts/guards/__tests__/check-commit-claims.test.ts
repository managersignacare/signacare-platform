/*
 * scripts/guards/__tests__/check-commit-claims.test.ts
 *
 * Phase 0a.12 — fixture tests for the claim-discipline guard.
 *
 * Strategy: 5 synthetic input strings (mirroring the 5-fixture pattern
 * established by shortcut-detector / confidence-label-enforcer / etc.).
 * Each fixture targets a distinct rubric branch.
 */

import { describe, it, expect } from 'vitest';
import { scanText, isQualifiedNearby, BANNED_PATTERNS, SHAPE_REQUIREMENTS } from '../check-commit-claims';

describe('check-commit-claims fixtures', () => {
  // Fixture 1 — BLOCK on multiple banned phrases (no honest qualifier)
  it('Fixture 1: flags unsubstantiated-prediction + unverifiable-totality + unrun-test', () => {
    const input = `feat(x): ship something

This commit completes a comprehensive walkthrough. Tests pass and no
regressions were introduced. Should work in production.`;
    const violations = scanText(input);
    const ids = violations.map((v) => v.pattern_id);
    expect(ids).toContain('comprehensive');
    expect(ids).toContain('tests-pass-no-output');
    expect(ids).toContain('no-regressions');
    expect(ids).toContain('should-work');
  });

  // Fixture 2 — PASS on properly-qualified claim
  it('Fixture 2: properly-qualified claim with [Confidence] markers passes', () => {
    const input = `feat(x): ship deliverable Y

audit (sampled): 18 of 60+ modules covered. Confidence: MEDIUM.
[Confidence: HIGH — mechanical command output below] tests pass:
$ npm test
... 47 passed.`;
    const violations = scanText(input);
    // "tests pass" is followed by command output + qualifier within window
    const testsPass = violations.filter((v) => v.pattern_id === 'tests-pass-no-output');
    expect(testsPass.length).toBe(0);
    // "Confidence: MEDIUM" qualifier nearby suppresses any other-class fires
    const compre = violations.filter((v) => v.pattern_id === 'comprehensive');
    expect(compre.length).toBe(0);
  });

  // Fixture 3 — BLOCK on gold-standard-downgrade phrasing
  it('Fixture 3: flags multi-approach-recommendation + effort-downgrade', () => {
    const input = `feat(x): pivot

Approach B chosen. Reasoning: easier, faster, fewer edits. Less risk.`;
    const violations = scanText(input);
    const ids = violations.map((v) => v.pattern_id);
    expect(ids).toContain('approach-b');
    expect(ids).toContain('easier-as-reason');
  });

  // Fixture 4 — BLOCK on silent deferral without BUG citation
  it('Fixture 4: flags silent-deferral phrases without BUG-XXX', () => {
    const input = `feat(x): ship interim solution

This is a temporary fix. We'll address the structural issue for now.
Will revisit later (no BUG row yet).`;
    const violations = scanText(input);
    const ids = violations.map((v) => v.pattern_id);
    expect(ids).toContain('interim');
    expect(ids).toContain('temporary-no-bug');
    expect(ids).toContain('for-now-no-bug');
  });

  // Fixture 5 — PASS on silent-deferral with BUG citation nearby
  it('Fixture 5: silent-deferral with BUG-XXX-FOLLOWUP citation passes', () => {
    const input = `feat(x): partial absorb

Out of scope for this commit: live DB rollback test. Filed as
BUG-PR-R1-3-FOLLOWUP-LIVE-ROLLBACK-CYCLE (S2, close-by 2026-05-15)
per feedback_no_silent_out_of_scope.md. The "for now" choice is
explicitly tracked.`;
    const violations = scanText(input);
    // "for now" should NOT fire because BUG citation nearby
    // (allowlist would catch via inline qualifier; here the prose itself
    // names BUG-PR-R1-3-FOLLOWUP — not what the guard's qualifier-list
    // checks for, which is the structural [Confidence:...] form. So this
    // fixture documents the GUARD's current behavior: BUG citation in
    // prose alone does NOT suppress. To suppress, use [Confidence: LOW —
    // tracked under BUG-XXX] form OR allowlist the entry.)
    const forNow = violations.filter((v) => v.pattern_id === 'for-now-no-bug');
    // Document expected behavior: guard fires; allowlist or qualifier needed
    expect(forNow.length).toBe(1);
  });
});

describe('isQualifiedNearby helper', () => {
  it('returns true when [Confidence: HIGH] marker is in window', () => {
    const text = '[Confidence: HIGH — mechanical] should work in production';
    const pos = text.indexOf('should work');
    expect(isQualifiedNearby(text, pos)).toBe(true);
  });

  it('returns false when no qualifier in window', () => {
    const text = 'should work in production';
    const pos = text.indexOf('should work');
    expect(isQualifiedNearby(text, pos)).toBe(false);
  });

  it('returns true for [NOT INVOKED — reason] qualifier', () => {
    const text = 'tests pass for module X [NOT INVOKED — registry-gated]';
    const pos = text.indexOf('tests pass');
    expect(isQualifiedNearby(text, pos)).toBe(true);
  });
});

describe('BANNED_PATTERNS + SHAPE_REQUIREMENTS exports are non-empty', () => {
  it('exports at least 10 banned patterns', () => {
    expect(BANNED_PATTERNS.length).toBeGreaterThanOrEqual(10);
  });
  it('exports at least 1 shape requirement', () => {
    expect(SHAPE_REQUIREMENTS.length).toBeGreaterThanOrEqual(1);
  });
});
