/*
 * scripts/guards/__tests__/check-review-attestation.test.ts
 *
 * BUG-PRECOMMIT-REVIEW-CHAIN-FOR-S1 (S2) — D4 commit-msg attestation
 * guard unit tests. Cycle-1 symmetric tests covering each verification
 * rule + the required-reviewers set + L4 conditional + L4 N/A rationale.
 */
import { describe, it, expect } from 'vitest';
import { verifyAttestation } from '../check-review-attestation';

const VALID_TREE_HASH = 'abc1234567890abcdef1234567890abcdef12345';
const OTHER_TREE_HASH = 'fed1234567890abcdef1234567890abcdef67890';

const FULL_REVIEWERS = {
  'confidence-label-enforcer': { verdict: 'PASS', cycle: 1 },
  'shortcut-detector':         { verdict: 'PASS', cycle: 1 },
  'gold-standard-enforcer':    { verdict: 'PASS', cycle: 1 },
  'dod-completion-checker':    { verdict: 'PASS', cycle: 1 },
  'L3':                        { verdict: 'PASS', cycle: 1 },
  'L5':                        { verdict: 'PASS', cycle: 1 },
};

function buildArtifact(opts: {
  treeHash?: string;
  reviewers?: Record<string, unknown>;
  version?: number;
  omit?: string[];
} = {}): string {
  const obj: Record<string, unknown> = {
    version: opts.version ?? 1,
    treeHash: opts.treeHash ?? VALID_TREE_HASH,
    createdAt: '2026-05-06T11:42:00.000Z',
    triggerKind: ['migrations'],
    reviewers: opts.reviewers ?? { ...FULL_REVIEWERS },
  };
  for (const k of opts.omit ?? []) delete obj[k];
  return JSON.stringify(obj);
}

describe('verifyAttestation — non-trigger commit', () => {
  it('PASSes when not a trigger commit, regardless of artifact', () => {
    const result = verifyAttestation({
      stagedFiles: ['README.md'],
      commitMessage: 'docs: small typo',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: null,
    });
    expect(result.pass).toBe(true);
    expect(result.triggerKinds).toEqual([]);
  });
});

describe('verifyAttestation — trigger commit + artifact present', () => {
  it('PASSes when trigger fires + artifact valid + tree-hash matches + all reviewers PASS', () => {
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/20260601000000_x.ts'],
      commitMessage: 'chore: schema tidy',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: buildArtifact(),
    });
    expect(result.pass).toBe(true);
    expect(result.triggerKinds).toContain('migrations');
  });
});

describe('verifyAttestation — trigger commit + artifact absent', () => {
  it('REJECTs when trigger fires but no artifact', () => {
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/20260601000000_x.ts'],
      commitMessage: 'fix(bug-x): close S1 thing\n\nBUG-X (S1) closure',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: null,
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('no review-attestation artifact present');
    expect(result.triggerKinds.length).toBeGreaterThan(0);
  });
});

describe('verifyAttestation — tree-hash mismatch', () => {
  it('REJECTs when artifact tree-hash does not match current `git write-tree`', () => {
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/20260601000000_x.ts'],
      commitMessage: 'chore: tidy',
      currentTreeHash: OTHER_TREE_HASH,
      artifactRaw: buildArtifact({ treeHash: VALID_TREE_HASH }),
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('different staged snapshot');
  });
});

describe('verifyAttestation — schema validity', () => {
  it('REJECTs malformed JSON', () => {
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/x.ts'],
      commitMessage: 'chore',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: '{ not valid json',
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('malformed');
  });

  it('REJECTs unsupported schema version', () => {
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/x.ts'],
      commitMessage: 'chore',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: buildArtifact({ version: 99 }),
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('version=99 not supported');
  });

  it('REJECTs missing top-level field (treeHash)', () => {
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/x.ts'],
      commitMessage: 'chore',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: buildArtifact({ omit: ['treeHash'] }),
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('missing required field: treeHash');
  });
});

describe('verifyAttestation — required reviewers', () => {
  it('REJECTs when L3 reviewer is missing', () => {
    const reviewersWithoutL3 = { ...FULL_REVIEWERS };
    delete (reviewersWithoutL3 as Record<string, unknown>)['L3'];
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/x.ts'],
      commitMessage: 'chore',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: buildArtifact({ reviewers: reviewersWithoutL3 }),
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('missing required reviewer: L3');
  });

  it('REJECTs when shortcut-detector reviewer is missing', () => {
    const reviewersWithoutShortcut = { ...FULL_REVIEWERS };
    delete (reviewersWithoutShortcut as Record<string, unknown>)['shortcut-detector'];
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/x.ts'],
      commitMessage: 'chore',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: buildArtifact({ reviewers: reviewersWithoutShortcut }),
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('missing required reviewer: shortcut-detector');
  });
});

describe('verifyAttestation — L4 conditional', () => {
  it('REJECTs when staged diff touches medications feature + L4 absent', () => {
    const result = verifyAttestation({
      stagedFiles: ['apps/api/src/features/medications/medicationService.ts', 'apps/api/src/features/medications/medicationRoutes.ts', 'apps/api/src/features/medications/medicationRepository.ts'],
      commitMessage: 'refactor: tidy medications',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: buildArtifact(), // FULL_REVIEWERS doesn't include L4
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('L4 verdict required');
  });

  it('PASSes when L4 is present with valid PASS verdict', () => {
    const reviewersWithL4 = {
      ...FULL_REVIEWERS,
      L4: { verdict: 'PASS', cycle: 1 },
    };
    const result = verifyAttestation({
      stagedFiles: ['apps/api/src/features/medications/medicationService.ts', 'apps/api/src/features/medications/medicationRoutes.ts', 'apps/api/src/features/medications/medicationRepository.ts'],
      commitMessage: 'refactor: tidy medications',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: buildArtifact({ reviewers: reviewersWithL4 }),
    });
    expect(result.pass).toBe(true);
  });

  it('REJECTs when L4 verdict=N/A but rationale is empty', () => {
    const reviewersWithL4NaEmpty = {
      ...FULL_REVIEWERS,
      L4: { verdict: 'N/A', rationale: '' },
    };
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/x.ts'],
      commitMessage: 'chore',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: buildArtifact({ reviewers: reviewersWithL4NaEmpty }),
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('non-empty rationale');
  });

  it('PASSes when L4 verdict=N/A with non-empty rationale (free-text)', () => {
    const reviewersWithL4NaText = {
      ...FULL_REVIEWERS,
      L4: { verdict: 'N/A', rationale: 'doc-only commit; no clinical-data tables touched; no patient-harm class' },
    };
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/x.ts'],
      commitMessage: 'chore: schema cleanup',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: buildArtifact({ reviewers: reviewersWithL4NaText }),
    });
    expect(result.pass).toBe(true);
  });
});

describe('verifyAttestation — final BLOCK verdicts forbidden', () => {
  it('REJECTs when any reviewer carries final verdict=BLOCK', () => {
    const reviewersWithBlock = {
      ...FULL_REVIEWERS,
      L5: { verdict: 'BLOCK', cycle: 1 },
    };
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/x.ts'],
      commitMessage: 'chore',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: buildArtifact({ reviewers: reviewersWithBlock }),
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("verdict='BLOCK'");
  });

  it('PASSes when reviewer absorbed BLOCK→PASS with absorbedFrom audit-trail', () => {
    const reviewersWithAbsorb = {
      ...FULL_REVIEWERS,
      L5: { verdict: 'PASS', cycle: 2, absorbedFrom: 'BLOCK' },
    };
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/x.ts'],
      commitMessage: 'chore',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: buildArtifact({ reviewers: reviewersWithAbsorb }),
    });
    expect(result.pass).toBe(true);
  });
});

describe('verifyAttestation — L3 cycle-1 absorb #1: verdict enum validation', () => {
  // Pre-fix any string passed Step 6 (only checked for non-empty); spec
  // line 85 defines verdict as a closed enum. Cycle-1 L3 review caught
  // the mutation gap.
  it('REJECTs when reviewer.verdict is an arbitrary string outside the enum', () => {
    const reviewersWithBadVerdict = {
      ...FULL_REVIEWERS,
      L5: { verdict: 'WHATEVER' as 'PASS', cycle: 1 },
    };
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/x.ts'],
      commitMessage: 'chore',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: buildArtifact({ reviewers: reviewersWithBadVerdict }),
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("verdict='WHATEVER'");
    expect(result.reason).toContain('valid enum');
  });

  it('REJECTs when reviewers field is null', () => {
    // Bypass buildArtifact's `?? FULL_REVIEWERS` coalescer by writing the
    // raw JSON directly (the production-time path is null in JSON, which
    // survives JSON.parse as null but `??` would replace at construction).
    const rawJson = JSON.stringify({
      version: 1,
      treeHash: VALID_TREE_HASH,
      createdAt: '2026-05-06T11:42:00.000Z',
      triggerKind: ['migrations'],
      reviewers: null,
    });
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/x.ts'],
      commitMessage: 'chore',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: rawJson,
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('null/missing/non-object');
  });
});

describe('verifyAttestation — L3 cycle-1 absorb #2: final PARTIAL verdicts forbidden', () => {
  // Pre-fix only BLOCK was rejected at Step 8; spec line 93 makes PARTIAL
  // equally forbidden as a FINAL verdict (must be absorbed-then-PASS).
  // Cycle-1 L3 review caught the mutation gap.
  it('REJECTs when any reviewer carries final verdict=PARTIAL', () => {
    const reviewersWithPartial = {
      ...FULL_REVIEWERS,
      L3: { verdict: 'PARTIAL', cycle: 1 },
    };
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/x.ts'],
      commitMessage: 'chore',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: buildArtifact({ reviewers: reviewersWithPartial }),
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("verdict='PARTIAL'");
    expect(result.reason).toContain('absorbed');
  });

  it('PASSes when reviewer absorbed PARTIAL→PASS with absorbedFrom audit-trail', () => {
    const reviewersWithAbsorb = {
      ...FULL_REVIEWERS,
      'gold-standard-enforcer': { verdict: 'PASS', cycle: 2, absorbedFrom: 'PARTIAL' },
    };
    const result = verifyAttestation({
      stagedFiles: ['apps/api/migrations/x.ts'],
      commitMessage: 'chore',
      currentTreeHash: VALID_TREE_HASH,
      artifactRaw: buildArtifact({ reviewers: reviewersWithAbsorb }),
    });
    expect(result.pass).toBe(true);
  });
});
