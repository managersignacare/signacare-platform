/*
 * scripts/guards/__tests__/check-pr-template-compliance.test.ts
 *
 * Phase 0a.13 — fixture tests for the PR template compliance guard.
 *
 * 5 fixtures + helper tests covering: all-sections-present PASS;
 * one-section-missing FAIL; multiple-sections-missing FAIL; placeholder-
 * only-content FAIL; inline-exempt PASS.
 */

import { describe, it, expect } from 'vitest';
import { checkCompliance, checkSection, REQUIRED_SECTIONS } from '../check-pr-template-compliance';

const FULL_BODY_TEMPLATE = `## DoD Status

- [x] Guard exists at scripts/guards/foo.ts (200 LOC)
- [x] Tests pass: vitest 12/12 PASS [HIGH]
- [ ] Push auth — NOT REQUESTED yet

## Confidence Labels

- All guard PASS results: HIGH (mechanical command output)
- Code correctness: HIGH (umbrella guard PASS = runtime observed)
- Reviewer agent verdicts: HIGH (directly observed)

## Gold-Standard Compliance

This PR implements the gold-standard structural fix. No band-aid framing.

## L3 / L4 / L5 References

- L3 (code-reviewer-general): PASS [HIGH] verdict: "PASS - APPROVED FOR COMMIT. ..."
- L4: N/A (rationale: discipline scaffold, no clinical-surface touch)
- L5 (architecture-reviewer): PASS [HIGH] verdict: "PASS — ARCHITECTURAL INTEGRITY PRESERVED. ..."

## Atomic Commit List

- abc1234 — feat(phase-x): scope deliverable
`;

describe('check-pr-template-compliance fixtures', () => {
  // Fixture 1 — PASS on full body with all 5 sections + substantive content
  it('Fixture 1: full body with all 5 sections passes', () => {
    const result = checkCompliance(FULL_BODY_TEMPLATE);
    expect(result.ok).toBe(true);
    expect(result.missing.length).toBe(0);
    expect(result.exempt).toBe(false);
  });

  // Fixture 2 — BLOCK on missing single section
  it('Fixture 2: missing "## Atomic Commit List" section fails', () => {
    const partial = FULL_BODY_TEMPLATE.replace(/## Atomic Commit List[\s\S]+$/, '').trim();
    const result = checkCompliance(partial);
    expect(result.ok).toBe(false);
    expect(result.missing.length).toBe(1);
    expect(result.missing[0].heading).toBe('## Atomic Commit List');
    expect(result.missing[0].reason).toBe('absent');
  });

  // Fixture 3 — BLOCK on multiple missing sections
  it('Fixture 3: empty body fails on all 5 sections', () => {
    const result = checkCompliance('');
    expect(result.ok).toBe(false);
    expect(result.missing.length).toBe(5);
    expect(result.missing.every((m) => m.reason === 'absent')).toBe(true);
  });

  // Fixture 4 — BLOCK on placeholder-only content
  it('Fixture 4: section with only placeholder text fails', () => {
    const placeholder = `## DoD Status

(per-DoD-line status here)

## Confidence Labels

- HIGH per claim

## Gold-Standard Compliance

Gold standard chosen.

## L3 / L4 / L5 References

L3: PASS

## Atomic Commit List

- abc1234 — feat(x)
`;
    const result = checkCompliance(placeholder);
    expect(result.ok).toBe(false);
    expect(result.missing.length).toBe(1);
    expect(result.missing[0].heading).toBe('## DoD Status');
    expect(result.missing[0].reason).toBe('placeholder-only');
  });

  // Fixture 5 — PASS on inline @pr-template-exempt annotation
  it('Fixture 5: inline @pr-template-exempt annotation passes (sections check skipped)', () => {
    const exemptBody = `<!-- @pr-template-exempt: typo fix in README.md L42 -->\n\nFix typo in README.`;
    const result = checkCompliance(exemptBody);
    expect(result.ok).toBe(true);
    expect(result.exempt).toBe(true);
    expect(result.exemptReason).toContain('typo fix');
  });

  // Phase 0a.13 cycle-2 absorb of L3 finding #2: regression test pinning that
  // hyphenated exempt reasons (the documented examples in the allowlist
  // header: `dependabot-bump-pr` / `typo-only-pr`) actually match the
  // INLINE_EXEMPT_REGEX. The cycle-1 regex used `[^->]*` which silently
  // excluded hyphens, breaking the documented escape hatch.
  it('Fixture 6 (cycle-2 regression): hyphenated exempt reasons match', () => {
    for (const reason of ['dependabot-bump-pr', 'typo-only-pr', 'auto-generated dependency bump v2.0', 'single-line doc fix']) {
      const body = `<!-- @pr-template-exempt: ${reason} -->\n\n(no other content)`;
      const result = checkCompliance(body);
      expect(result.ok, `reason "${reason}" should match`).toBe(true);
      expect(result.exempt).toBe(true);
      expect(result.exemptReason).toContain(reason);
    }
  });
});

describe('checkSection helper', () => {
  it('returns null when section present with substantive content', () => {
    const text = '## DoD Status\n\n- [x] Real artifact reference here\n\n## Next';
    expect(checkSection(text, '## DoD Status', '(per-DoD-line status here)')).toBeNull();
  });

  it('returns absent reason when heading missing entirely', () => {
    const text = '## Other Section\n\nContent';
    const result = checkSection(text, '## DoD Status', '(per-DoD-line status here)');
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('absent');
  });

  it('returns placeholder-only reason when only placeholder text', () => {
    const text = '## DoD Status\n\n(per-DoD-line status here)\n\n## Next';
    const result = checkSection(text, '## DoD Status', '(per-DoD-line status here)');
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('placeholder-only');
  });

  it('strips HTML comments before checking content', () => {
    const text = '## DoD Status\n\n<!-- big instruction block -->\n\n- [x] Real content\n\n## Next';
    expect(checkSection(text, '## DoD Status', '(per-DoD-line status here)')).toBeNull();
  });
});

describe('REQUIRED_SECTIONS export', () => {
  it('exports exactly 5 required sections', () => {
    expect(REQUIRED_SECTIONS.length).toBe(5);
  });
  it('each required section has heading + placeholder fields', () => {
    for (const s of REQUIRED_SECTIONS) {
      expect(s.heading.startsWith('## ')).toBe(true);
      expect(s.placeholder.length).toBeGreaterThan(0);
    }
  });
});
