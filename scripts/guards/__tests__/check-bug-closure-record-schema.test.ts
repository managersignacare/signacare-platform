import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-bug-closure-record-schema';

const TMP_BASE = join(tmpdir(), 'bug-closure-record-schema-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixtureFile(root: string, relPath: string, content: string): void {
  const fullPath = join(root, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

function fixtureRoot(name: string): string {
  const root = join(TMP_BASE, name);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeSchema(root: string): void {
  writeFixtureFile(
    root,
    'docs/quality/remediation/schemas/bug-closure-record.schema.json',
    JSON.stringify({ version: 1, note: 'fixture schema json only' }, null, 2),
  );
}

describe('check-bug-closure-record-schema guard', () => {
  it('passes with valid empty registry', () => {
    const root = fixtureRoot('pass_empty');
    writeSchema(root);
    writeFixtureFile(
      root,
      '.github/bug-closure-records.json',
      JSON.stringify(
        {
          version: 1,
          generatedAt: '2026-05-15T00:00:00.000Z',
          records: [],
        },
        null,
        2,
      ),
    );

    const result = runGuard(root);
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when required fields are malformed', () => {
    const root = fixtureRoot('fail_malformed');
    writeSchema(root);
    writeFixtureFile(
      root,
      '.github/bug-closure-records.json',
      JSON.stringify(
        {
          version: 2,
          generatedAt: 'not-a-date',
          records: [
            {
              bugId: 'BAD-1',
              lane: '',
              status: 'bad_status',
              fixCommitSha: 'abc',
              guards: ['guardbad'],
              regressionTests: [],
              evidenceArtifacts: [],
              approvers: [],
              lastValidatedAt: 'bad',
            },
          ],
        },
        null,
        2,
      ),
    );

    const result = runGuard(root);
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('version must be 1'))).toBe(true);
    expect(result.violations.some((v) => v.reason.includes('bugId invalid'))).toBe(true);
  });

  it('fails when closed record rollout evidence file is missing', () => {
    const root = fixtureRoot('fail_missing_rollout_ref');
    writeSchema(root);
    writeFixtureFile(root, 'docs/quality/remediation/evidence/existing-evidence.md', '# ok');
    writeFixtureFile(
      root,
      '.github/bug-closure-records.json',
      JSON.stringify(
        {
          version: 1,
          generatedAt: '2026-05-15T00:00:00.000Z',
          records: [
            {
              bugId: 'BUG-999',
              lane: 'A1b',
              status: 'closed',
              fixCommitSha: 'abcdef1234',
              guards: ['guard:all'],
              regressionTests: ['tests/integration/example.int.test.ts'],
              evidenceArtifacts: ['docs/quality/remediation/evidence/existing-evidence.md'],
              approvers: [{ role: 'Security lead', name: 'Dr X', date: '2026-05-15' }],
              lastValidatedAt: '2026-05-15T12:00:00.000Z',
              rolloutEvidence: {
                canaryEvidenceRef: 'docs/quality/remediation/evidence/missing-canary.md',
                burnInEvidenceRef: 'docs/quality/remediation/evidence/missing-burnin.md',
                postBurnInEvidenceRef: 'docs/quality/remediation/evidence/missing-postburn.md',
              },
            },
          ],
        },
        null,
        2,
      ),
    );

    const result = runGuard(root);
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('rolloutEvidence ref missing file'))).toBe(true);
  });
});
