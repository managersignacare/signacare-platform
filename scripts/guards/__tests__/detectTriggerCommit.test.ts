/*
 * scripts/guards/__tests__/detectTriggerCommit.test.ts
 *
 * BUG-PRECOMMIT-REVIEW-CHAIN-FOR-S1 (S2) — D1 trigger detection unit tests.
 *
 * Cycle-1 symmetric tests for each trigger kind (positive + negative)
 * + combined-trigger cases + closure-language edge cases.
 */
import { describe, it, expect } from 'vitest';
import {
  detectTriggerCommit,
  parseStagedFilesOutput,
  FEATURES_THRESHOLD,
} from '../lib/detectTriggerCommit';

describe('detectTriggerCommit — empty inputs', () => {
  it('returns not-triggered when stagedFiles is empty AND commitMessage is empty', () => {
    const result = detectTriggerCommit({ stagedFiles: [], commitMessage: '' });
    expect(result.triggered).toBe(false);
    expect(result.kinds).toEqual([]);
  });
});

describe('detectTriggerCommit — migrations trigger', () => {
  it('fires on a single staged migration file', () => {
    const result = detectTriggerCommit({
      stagedFiles: ['apps/api/migrations/20260601000000_some_change.ts'],
      commitMessage: 'chore: tidy schema',
    });
    expect(result.triggered).toBe(true);
    expect(result.kinds).toContain('migrations');
  });

  it('does NOT fire on a non-migration file under apps/api/ with .ts extension', () => {
    const result = detectTriggerCommit({
      stagedFiles: ['apps/api/src/db/db.ts'],
      commitMessage: 'chore: refactor',
    });
    expect(result.triggered).toBe(false);
    expect(result.kinds).toEqual([]);
  });

  it('does NOT fire on a file in a migration subdirectory (Knex migrations live flat)', () => {
    const result = detectTriggerCommit({
      stagedFiles: ['apps/api/migrations/old/20260101000000_archived.ts'],
      commitMessage: 'docs: archive note',
    });
    expect(result.triggered).toBe(false);
  });
});

describe('detectTriggerCommit — features-3plus trigger', () => {
  it('fires when ≥FEATURES_THRESHOLD staged files match apps/api/src/features/', () => {
    expect(FEATURES_THRESHOLD).toBe(3);
    const result = detectTriggerCommit({
      stagedFiles: [
        'apps/api/src/features/episode/episodeRoutes.ts',
        'apps/api/src/features/referrals/referralRoutes.ts',
        'apps/api/src/features/medications/medicationService.ts',
      ],
      commitMessage: 'refactor: tidy 3 features',
    });
    expect(result.triggered).toBe(true);
    expect(result.kinds).toContain('features-3plus');
  });

  it('does NOT fire when exactly 2 features files are staged', () => {
    const result = detectTriggerCommit({
      stagedFiles: [
        'apps/api/src/features/episode/episodeRoutes.ts',
        'apps/api/src/features/referrals/referralRoutes.ts',
      ],
      commitMessage: 'refactor: 2 file change',
    });
    expect(result.triggered).toBe(false);
  });

  it('counts .tsx files in features directory toward the threshold', () => {
    const result = detectTriggerCommit({
      stagedFiles: [
        'apps/api/src/features/foo/Foo.tsx',
        'apps/api/src/features/bar/Bar.tsx',
        'apps/api/src/features/baz/baz.ts',
      ],
      commitMessage: 'refactor: tsx + ts mix',
    });
    expect(result.triggered).toBe(true);
    expect(result.kinds).toContain('features-3plus');
  });

  it('does NOT count files outside features/ toward the threshold', () => {
    const result = detectTriggerCommit({
      stagedFiles: [
        'apps/api/src/features/foo/foo.ts',
        'apps/api/src/shared/bar.ts',
        'apps/api/src/middleware/baz.ts',
      ],
      commitMessage: 'refactor: 1 features + 2 elsewhere',
    });
    expect(result.triggered).toBe(false);
  });
});

describe('detectTriggerCommit — bug-closure-s012 trigger', () => {
  it('fires on severity tag BUG-X (S1)', () => {
    const result = detectTriggerCommit({
      stagedFiles: [],
      commitMessage:
        'fix(bug-staff-settings-clinic-id-filter): close S1 cross-tenant write authz gap\n\nBUG-STAFF-SETTINGS-CLINIC-ID-FILTER (S1) closure',
    });
    expect(result.triggered).toBe(true);
    expect(result.kinds).toContain('bug-closure-s012');
  });

  it('fires on severity tag BUG-X (S0) and BUG-X (S2)', () => {
    const sev0 = detectTriggerCommit({
      stagedFiles: [],
      commitMessage: 'fix something\n\nBUG-CRITICAL-PROD-DOWN (S0) closure',
    });
    const sev2 = detectTriggerCommit({
      stagedFiles: [],
      commitMessage: 'fix process gap\n\nBUG-PROCESS-GAP (S2) closure',
    });
    expect(sev0.triggered).toBe(true);
    expect(sev0.kinds).toContain('bug-closure-s012');
    expect(sev2.triggered).toBe(true);
    expect(sev2.kinds).toContain('bug-closure-s012');
  });

  it('does NOT fire on severity S3 or S4', () => {
    const sev3 = detectTriggerCommit({
      stagedFiles: [],
      commitMessage: 'fix cosmetic\n\nBUG-COSMETIC (S3) closure',
    });
    const sev4 = detectTriggerCommit({
      stagedFiles: [],
      commitMessage: 'fix nit\n\nBUG-NIT (S4) closure',
    });
    expect(sev3.triggered).toBe(false);
    expect(sev4.triggered).toBe(false);
  });

  it('fires on imperative closure verb (closes BUG-X) without severity tag', () => {
    const result = detectTriggerCommit({
      stagedFiles: [],
      commitMessage: 'misc cleanup\n\nThis change closes BUG-OBSERVED-FAILURE.',
    });
    expect(result.triggered).toBe(true);
    expect(result.kinds).toContain('bug-closure-s012');
  });

  it('fires on conventional-commits closure shape `fix(bug-x): ...`', () => {
    const result = detectTriggerCommit({
      stagedFiles: [],
      commitMessage: 'fix(bug-some-issue): scope description here',
    });
    expect(result.triggered).toBe(true);
    expect(result.kinds).toContain('bug-closure-s012');
  });

  it('does NOT fire on narrative non-closure reference like "see BUG-X for context"', () => {
    const result = detectTriggerCommit({
      stagedFiles: [],
      commitMessage:
        'refactor something\n\nThis is unrelated to BUG-NARRATIVE-REF; see BUG-NARRATIVE-REF for background context only.',
    });
    expect(result.triggered).toBe(false);
  });
});

describe('detectTriggerCommit — combined triggers', () => {
  it('returns both kinds when migration + S1 closure both fire', () => {
    const result = detectTriggerCommit({
      stagedFiles: ['apps/api/migrations/20260601000001_x.ts'],
      commitMessage: 'fix(bug-x): close S1 thing\n\nBUG-X (S1) closure',
    });
    expect(result.triggered).toBe(true);
    expect(result.kinds).toContain('migrations');
    expect(result.kinds).toContain('bug-closure-s012');
    expect(result.kinds.length).toBe(2);
  });

  it('returns all three kinds when migration + 3 features + S0 message all fire', () => {
    const result = detectTriggerCommit({
      stagedFiles: [
        'apps/api/migrations/20260601000002_x.ts',
        'apps/api/src/features/a/a.ts',
        'apps/api/src/features/b/b.ts',
        'apps/api/src/features/c/c.ts',
      ],
      commitMessage: 'fix(bug-x): all of it\n\nBUG-X (S0) closure',
    });
    expect(result.triggered).toBe(true);
    expect(result.kinds).toEqual(['migrations', 'features-3plus', 'bug-closure-s012']);
  });
});

describe('parseStagedFilesOutput', () => {
  it('parses git diff --cached --name-only output into a clean list', () => {
    const raw = '\napps/api/migrations/x.ts\napps/api/src/features/y/y.ts\n\n';
    expect(parseStagedFilesOutput(raw)).toEqual([
      'apps/api/migrations/x.ts',
      'apps/api/src/features/y/y.ts',
    ]);
  });

  it('returns empty array on empty input', () => {
    expect(parseStagedFilesOutput('')).toEqual([]);
  });
});
