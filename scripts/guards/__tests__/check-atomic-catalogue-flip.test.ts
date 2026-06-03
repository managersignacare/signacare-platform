/*
 * scripts/guards/__tests__/check-atomic-catalogue-flip.test.ts
 *
 * Phase R1 PR-R1-8 — symmetric vitest spec for the atomic catalogue
 * flip guard. Imports the actual `evaluateCommit()` from the guard
 * (not a re-implementation) per L3 PR-R1-7 cycle-2 absorb precedent.
 */
import { describe, it, expect } from 'vitest';
import { evaluateCommit } from '../check-atomic-catalogue-flip';

function commit(opts: {
  sha?: string;
  subject: string;
  body?: string;
  files: string[];
}) {
  return {
    sha: opts.sha ?? 'abcd1234567890',
    subject: opts.subject,
    body: opts.body ?? '',
    files: opts.files,
  };
}

describe('evaluateCommit — POSITIVE flag (missing catalogue flip)', () => {
  it('flags fix(phase-b-bug-X) with production code but no catalogue', () => {
    const v = evaluateCommit(
      commit({
        subject: 'fix(phase-b-bug-371): wire opt-locking',
        files: ['apps/api/src/features/episode/episodeService.ts'],
      }),
    );
    expect(v).not.toBeNull();
    expect(v!.reason).toContain('did NOT include docs/quality/bugs-remaining.md');
  });

  it('flags fix(phase-a-bug-X) (any phase prefix)', () => {
    const v = evaluateCommit(
      commit({
        subject: 'fix(phase-a-bug-100): security patch',
        files: ['apps/api/src/features/auth/authService.ts'],
      }),
    );
    expect(v).not.toBeNull();
  });

  it('flags fix(...bug-X...) with apps/web/src changes', () => {
    const v = evaluateCommit(
      commit({
        subject: 'fix(phase-b-bug-555): frontend hook update',
        files: ['apps/web/src/features/medications/hooks/useMedications.ts'],
      }),
    );
    expect(v).not.toBeNull();
  });

  it('flags fix(...bug-X...) with packages/shared/src changes', () => {
    const v = evaluateCommit(
      commit({
        subject: 'fix(phase-b-bug-200): shared schema update',
        files: ['packages/shared/src/medications.schemas.ts'],
      }),
    );
    expect(v).not.toBeNull();
  });
});

describe('evaluateCommit — NEGATIVE accept (rule does not apply)', () => {
  it('accepts fix(phase-b-bug-X) WITH catalogue flip', () => {
    expect(
      evaluateCommit(
        commit({
          subject: 'fix(phase-b-bug-371): wire opt-locking',
          files: [
            'apps/api/src/features/episode/episodeService.ts',
            'docs/quality/bugs-remaining.md',
          ],
        }),
      ),
    ).toBeNull();
  });

  it('accepts cycle-2 absorb commits (catalogue already flipped)', () => {
    expect(
      evaluateCommit(
        commit({
          subject: 'fix(phase-b-bug-371-cycle2): absorb L3 cycle-1 REJECT',
          files: ['apps/api/src/features/episode/episodeService.ts'],
        }),
      ),
    ).toBeNull();
  });

  it('accepts cycle3 / absorb-2 commits', () => {
    expect(
      evaluateCommit(
        commit({
          subject: 'fix(phase-b-bug-371-cycle3): absorb-2 cycle-2 REJECT',
          files: ['apps/api/src/features/episode/episodeService.ts'],
        }),
      ),
    ).toBeNull();
  });

  it('accepts chore SHA-backfill commits', () => {
    expect(
      evaluateCommit(
        commit({
          subject: 'chore(phase-b-bug-371-sha): backfill HASH + progress.md',
          files: ['docs/quality/progress.md'],
        }),
      ),
    ).toBeNull();
  });

  it('accepts phase-r1 discipline-enforcement commits', () => {
    expect(
      evaluateCommit(
        commit({
          subject: 'fix(phase-r1-pr2): wire AuthContext propagation guard',
          files: ['scripts/guards/check-service-auth-context.ts'],
        }),
      ),
    ).toBeNull();
  });

  it('accepts non-fix commits (docs/, refactor/, chore/)', () => {
    expect(
      evaluateCommit(
        commit({
          subject: 'docs(phase-r1): regenerate schema-snapshot',
          files: ['apps/api/src/db/schema-snapshot.json'],
        }),
      ),
    ).toBeNull();
  });

  it('accepts fix-commits that touch ONLY non-production code', () => {
    expect(
      evaluateCommit(
        commit({
          subject: 'fix(phase-b-bug-100): test fixture update',
          files: ['apps/api/tests/integration/foo.test.ts'],
        }),
      ),
    ).toBeNull();
  });

  it('honours @atomic-flip-exempt opt-out in commit body', () => {
    expect(
      evaluateCommit(
        commit({
          subject: 'fix(phase-b-bug-X): cross-cutting refactor',
          body: '@atomic-flip-exempt: this is a refactor that does not close any specific BUG',
          files: ['apps/api/src/shared/db.ts'],
        }),
      ),
    ).toBeNull();
  });

  it('rejects empty @atomic-flip-exempt: (no reason)', () => {
    // Cycle-1: empty exempt would silently pass. Cycle-2: require non-empty reason.
    // Note: the regex /@atomic-flip-exempt:\s*\S/ requires at least one non-whitespace
    // char after the colon. An empty `@atomic-flip-exempt:` won't match → guard fires.
    const v = evaluateCommit(
      commit({
        subject: 'fix(phase-b-bug-X): cross-cutting refactor',
        body: '@atomic-flip-exempt:',
        files: ['apps/api/src/shared/db.ts'],
      }),
    );
    expect(v).not.toBeNull();
  });
});

describe('evaluateCommit — cycle-2 absorb (advisories A1+A2)', () => {
  it('A1: flags fix-commit changing apps/mobile/lib without catalogue', () => {
    // Cycle-1 PRODUCTION_CODE_PREFIXES did not include apps/mobile/lib;
    // a Flutter fix-commit silently bypassed the rule. Cycle-2 covers it.
    const v = evaluateCommit(
      commit({
        subject: 'fix(phase-b-bug-700): mobile credential bug',
        files: ['apps/mobile/lib/features/auth/auth_screen.dart'],
      }),
    );
    expect(v).not.toBeNull();
  });

  it('A1: flags fix-commit changing apps/patient-app/lib without catalogue', () => {
    const v = evaluateCommit(
      commit({
        subject: 'fix(phase-b-bug-701): patient app navigation',
        files: ['apps/patient-app/lib/features/home/home_screen.dart'],
      }),
    );
    expect(v).not.toBeNull();
  });

  it('A1: flags fix-commit changing apps/emr-gateway/src without catalogue', () => {
    const v = evaluateCommit(
      commit({
        subject: 'fix(phase-b-bug-702): gateway routing bug',
        files: ['apps/emr-gateway/src/middleware/auth.ts'],
      }),
    );
    expect(v).not.toBeNull();
  });

  it('A2: does NOT skip when "sha" / "backfill" appear in DESCRIPTION (not scope)', () => {
    // Cycle-1 false-skip: subject like `fix(phase-b-bug-X): SHA hash regression`
    // matched \\bsha\\b anywhere in subject and was silently skipped. Cycle-2
    // requires the token to be INSIDE the scope.
    const v = evaluateCommit(
      commit({
        subject: 'fix(phase-b-bug-X): SHA hash regression in auth',
        files: ['apps/api/src/features/auth/authService.ts'],
      }),
    );
    expect(v).not.toBeNull();
  });

  it('A2: does NOT skip when "absorb" appears in DESCRIPTION (not scope)', () => {
    const v = evaluateCommit(
      commit({
        subject: 'fix(phase-b-bug-X): correctly absorb upstream errors',
        files: ['apps/api/src/features/llm/llmService.ts'],
      }),
    );
    expect(v).not.toBeNull();
  });

  it('A2: still skips when token is INSIDE the scope (legitimate cycle2)', () => {
    expect(
      evaluateCommit(
        commit({
          subject: 'fix(phase-b-bug-371-cycle2): absorb L3 cycle-1 REJECT',
          files: ['apps/api/src/features/episode/episodeService.ts'],
        }),
      ),
    ).toBeNull();
  });
});

describe('evaluateCommit — edge cases', () => {
  it('matches case-insensitively on bug- token (BUG- vs bug-)', () => {
    const v1 = evaluateCommit(
      commit({
        subject: 'fix(phase-b-BUG-100): foo',
        files: ['apps/api/src/foo.ts'],
      }),
    );
    expect(v1).not.toBeNull();
  });

  it('handles multi-segment BUG IDs (BUG-A5.0, BUG-371b)', () => {
    const v1 = evaluateCommit(
      commit({
        subject: 'fix(phase-b-bug-371b): foo',
        files: ['apps/api/src/foo.ts'],
      }),
    );
    expect(v1).not.toBeNull();
  });

  it('does NOT match bare "bug" word in subject without dash-number', () => {
    expect(
      evaluateCommit(
        commit({
          subject: 'fix(some-feature): correct a debugging issue',
          files: ['apps/api/src/foo.ts'],
        }),
      ),
    ).toBeNull();
  });
});
