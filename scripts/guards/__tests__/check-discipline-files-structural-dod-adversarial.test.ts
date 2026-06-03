/*
 * scripts/guards/__tests__/check-discipline-files-structural-dod-adversarial.test.ts
 *
 * Phase 0a.10 — adversarial-input fixture for `checkDodTemplate()` in
 * `scripts/guards/check-discipline-files-structural.ts`. Closes the
 * MEDIUM-confidence carve-out from Phase 0a.9b commit message:
 *
 *   "Code correctness of checkDodTemplate() LOGIC under ADVERSARIAL inputs
 *    (missing sections / wrong section text): MEDIUM — static-traced only;
 *    umbrella-script PASS verifies the function exits 0 on the current
 *    CANONICAL template but does NOT integration-test behavioral
 *    correctness under intentionally-malformed input."
 *
 * Strategy: write a synthetic DoD template content string (in-memory; no
 * real file write) for each adversarial shape; assert the per-snippet
 * required-content list correctly identifies the missing snippet.
 *
 * The check itself is keyed on 8 canonical sections. Each adversarial
 * fixture removes ONE canonical section and asserts the test catches it.
 *
 * Phase 0a.11 absorb of L5 0a.10 advisory #3: `checkSnippetsPresent` and
 * `CANONICAL_REQUIRED_SNIPPETS` are now exported from the guard module +
 * imported here. The deliberate two-rail duplication that was acceptable
 * at landing time is closed; the test exercises the actual production
 * helper instead of replicating its contract.
 */

import { describe, it, expect } from 'vitest';
import { checkSnippetsPresent, CANONICAL_REQUIRED_SNIPPETS } from '../check-discipline-files-structural';

const CANONICAL_TEMPLATE = `
# Per-Deliverable Definition-of-Done Template

## Template (paste + adapt per deliverable)

#### Artifact existence
- File exists

#### Local verification (commands + outputs)
- Run command

#### Reviewer agents (L1-L5)
- L3 PASS

#### Discipline agents (Layer 0a — when available)
- shortcut-detector PASS

#### Confidence label
HIGH

When ANY line is unchecked, deliverable is NOT complete.
`;

describe('checkDodTemplate adversarial — gold-standard input PASSES', () => {
  it('canonical template with all 8 sections passes', () => {
    const result = checkSnippetsPresent(CANONICAL_TEMPLATE, CANONICAL_REQUIRED_SNIPPETS);
    expect(result.pass).toBe(true);
    expect(result.missing).toEqual([]);
  });
});

describe('checkDodTemplate adversarial — missing-section inputs FAIL', () => {
  it('missing top-level title fails', () => {
    const adversarial = CANONICAL_TEMPLATE.replace('# Per-Deliverable Definition-of-Done Template', '# Some Other Title');
    const result = checkSnippetsPresent(adversarial, CANONICAL_REQUIRED_SNIPPETS);
    expect(result.pass).toBe(false);
    expect(result.missing).toContain('# Per-Deliverable Definition-of-Done Template');
  });

  it('missing template paste-and-adapt section fails', () => {
    const adversarial = CANONICAL_TEMPLATE.replace('## Template (paste + adapt per deliverable)', '## Template');
    const result = checkSnippetsPresent(adversarial, CANONICAL_REQUIRED_SNIPPETS);
    expect(result.pass).toBe(false);
    expect(result.missing).toContain('## Template (paste + adapt per deliverable)');
  });

  it('missing artifact-existence section fails', () => {
    const adversarial = CANONICAL_TEMPLATE.replace('#### Artifact existence', '#### Files');
    const result = checkSnippetsPresent(adversarial, CANONICAL_REQUIRED_SNIPPETS);
    expect(result.pass).toBe(false);
    expect(result.missing).toContain('#### Artifact existence');
  });

  it('missing local-verification section fails', () => {
    const adversarial = CANONICAL_TEMPLATE.replace('#### Local verification (commands + outputs)', '#### Verification');
    const result = checkSnippetsPresent(adversarial, CANONICAL_REQUIRED_SNIPPETS);
    expect(result.pass).toBe(false);
    expect(result.missing).toContain('#### Local verification (commands + outputs)');
  });

  it('missing reviewer-agents-L1-L5 section fails', () => {
    const adversarial = CANONICAL_TEMPLATE.replace('#### Reviewer agents (L1-L5)', '#### Reviewers');
    const result = checkSnippetsPresent(adversarial, CANONICAL_REQUIRED_SNIPPETS);
    expect(result.pass).toBe(false);
    expect(result.missing).toContain('#### Reviewer agents (L1-L5)');
  });

  it('missing discipline-agents Layer 0a section fails', () => {
    const adversarial = CANONICAL_TEMPLATE.replace('#### Discipline agents (Layer 0a — when available)', '#### Discipline agents');
    const result = checkSnippetsPresent(adversarial, CANONICAL_REQUIRED_SNIPPETS);
    expect(result.pass).toBe(false);
    expect(result.missing).toContain('#### Discipline agents (Layer 0a — when available)');
  });

  it('missing confidence-label section fails', () => {
    const adversarial = CANONICAL_TEMPLATE.replace('#### Confidence label', '#### Notes');
    const result = checkSnippetsPresent(adversarial, CANONICAL_REQUIRED_SNIPPETS);
    expect(result.pass).toBe(false);
    expect(result.missing).toContain('#### Confidence label');
  });

  it('missing ANY-line-unchecked rule fails', () => {
    const adversarial = CANONICAL_TEMPLATE.replace('When ANY line is unchecked, deliverable is NOT complete.', 'Best effort applies.');
    const result = checkSnippetsPresent(adversarial, CANONICAL_REQUIRED_SNIPPETS);
    expect(result.pass).toBe(false);
    expect(result.missing).toContain('ANY line is unchecked');
  });

  it('multiple missing sections all surface in missing list', () => {
    const adversarial = '# Wrong Title\n## Wrong Subhead\n#### Wrong Body\n';
    const result = checkSnippetsPresent(adversarial, CANONICAL_REQUIRED_SNIPPETS);
    expect(result.pass).toBe(false);
    // Should detect all 8 missing
    expect(result.missing.length).toBe(8);
  });

  it('empty input fails on all 8 snippets', () => {
    const result = checkSnippetsPresent('', CANONICAL_REQUIRED_SNIPPETS);
    expect(result.pass).toBe(false);
    expect(result.missing.length).toBe(8);
  });
});

describe('checkDodTemplate adversarial — false-positive avoidance', () => {
  it('snippets in code blocks still count (no special parsing)', () => {
    const inCodeBlock = '```\n# Per-Deliverable Definition-of-Done Template\n## Template (paste + adapt per deliverable)\n#### Artifact existence\n#### Local verification (commands + outputs)\n#### Reviewer agents (L1-L5)\n#### Discipline agents (Layer 0a — when available)\n#### Confidence label\nANY line is unchecked\n```\n';
    const result = checkSnippetsPresent(inCodeBlock, CANONICAL_REQUIRED_SNIPPETS);
    expect(result.pass).toBe(true);
  });

  it('prose containing snippet text still satisfies (substring match)', () => {
    const prose = 'The template title is exactly "# Per-Deliverable Definition-of-Done Template" by convention. The "## Template (paste + adapt per deliverable)" section follows. Sections include "#### Artifact existence", "#### Local verification (commands + outputs)", "#### Reviewer agents (L1-L5)", "#### Discipline agents (Layer 0a — when available)", "#### Confidence label", and the rule that "ANY line is unchecked" means incomplete.';
    const result = checkSnippetsPresent(prose, CANONICAL_REQUIRED_SNIPPETS);
    expect(result.pass).toBe(true);
  });
});
