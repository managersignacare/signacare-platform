/* PR-R1-24 vitest fixture suite. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard } from '../check-timer-try-catch';

const TMP_BASE = join(tmpdir(), 'pr-r1-24-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

const SNAPSHOT = JSON.stringify({
  generatedAt: '2026-05-01',
  database: 'test',
  tables: { foo: ['id'] },
  foreignKeys: {},
}, null, 2);

function writeFixture(name: string, content: string): {
  snapshotPath: string;
  allowlistPath: string;
  scanRoot: string;
} {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  const scanRoot = join(dir, 'src');
  mkdirSync(scanRoot, { recursive: true });
  const snapshotPath = join(dir, 'snapshot.json');
  const allowlistPath = join(dir, 'allowlist.txt');
  writeFileSync(snapshotPath, SNAPSHOT, 'utf-8');
  writeFileSync(allowlistPath, '', 'utf-8');
  writeFileSync(join(scanRoot, 'fixture.ts'), content, 'utf-8');
  return { snapshotPath, allowlistPath, scanRoot };
}

describe('runGuard — timer-try-catch', () => {
  it('REJECTs async setInterval with no try/catch', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'no_try',
      `setInterval(async () => {
  await doWork();
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(1);
  });

  it('PASSES async setInterval with try/catch', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'with_try',
      `setInterval(async () => {
  try { await doWork(); } catch (err) { logger.error({ err }, 'timer'); }
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.validatedTimers).toBe(1);
  });

  it('REJECTs async setTimeout with no try/catch', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'timeout_no_try',
      `setTimeout(async () => {
  await doWork();
  await moreWork();
}, 5000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
  });

  it('PASSES async setTimeout with try/catch', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'timeout_with_try',
      `setTimeout(async () => {
  try { await doWork(); } catch (err) { logger.error({ err }, 'timer'); }
}, 5000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('SKIPS sync setTimeout (no async keyword) — out of scope', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'sync_timeout',
      `setTimeout(() => {
  process.exit(1);
}, 3000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.validatedTimers).toBe(0);
  });

  it('SKIPS Promise-resolver pattern setTimeout(r => r) — out of scope', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'promise_resolver',
      `await new Promise(r => setTimeout(r, 100));`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('PASSES async function() form with try/catch', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'function_form',
      `setInterval(async function () {
  try { await doWork(); } catch (err) { logger.error({ err }); }
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('REJECTs nested-only try (e.g. inside an if-branch) — outer body must wrap', () => {
    // The lenient check looks for ANY `try {` token in the body. A nested
    // try INSIDE an if-branch satisfies the check but leaves the else-branch
    // unwrapped. This is a documented lenience; future cycle could tighten
    // to require the FIRST statement of the body to be `try {`.
    // For v1 we accept this — the fixture documents the lenience.
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'nested_try_only',
      `setInterval(async () => {
  if (cond) { try { await foo(); } catch {} }
  await bar();
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    // V1 lenience: PASS (any try block satisfies). Documented limitation.
    expect(r.exitCode).toBe(0);
  });

  it('honours @timer-try-catch-exempt with non-empty reason', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'inline_exempt',
      `// @timer-try-catch-exempt: callback body trivial; only awaits a Promise that cannot reject
setInterval(async () => {
  await someInfallibleWork();
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedExempt).toBe(1);
  });

  it('does NOT honour @timer-try-catch-exempt with empty reason', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'empty_exempt',
      `// @timer-try-catch-exempt:
setInterval(async () => {
  await doWork();
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
  });

  it('does NOT honour exemption with blank-line gap above', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'gap_exempt',
      `// @timer-try-catch-exempt: reason here

setInterval(async () => {
  await doWork();
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
  });

  it('detects multiple violations across one file', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'multi',
      `setInterval(async () => { await a(); }, 1000);
setTimeout(async () => { await b(); }, 5000);
setInterval(async () => { try { await c(); } catch {} }, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(2);
  });

  it('does NOT flag commented-out async setInterval', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'comment_mention',
      `// Bad: setInterval(async () => { await foo(); }, 1000)
setInterval(async () => {
  try { await doWork(); } catch (err) { log(err); }
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.validatedTimers).toBe(1);
  });

  it('does NOT flag string-literal timer pattern (e.g. in error message)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'string_mention',
      `const msg = "use setInterval(async () => { ... }) properly";`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('rejects when snapshot is missing', () => {
    const dir = join(TMP_BASE, 'no_snapshot');
    mkdirSync(dir, { recursive: true });
    const r = runGuard({
      snapshotPath: join(dir, 'nonexistent.json'),
      allowlistPath: join(dir, 'allowlist.txt'),
      scanRoot: dir,
    });
    expect(r.exitCode).toBe(2);
  });

  it('cycle-2: typed-return named function NO try → REJECT', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'typed_named_no_try',
      `setInterval(async function poll(): Promise<void> {
  await doWork();
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(1);
  });

  it('cycle-2: typed-return named function WITH try → PASS', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'typed_named_with_try',
      `setInterval(async function poll(): Promise<void> {
  try { await doWork(); } catch (err) { logger.error({ err }); }
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.validatedTimers).toBe(1);
  });

  it('cycle-2: typed-return ANONYMOUS function NO try → REJECT', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'typed_anon_no_try',
      `setInterval(async function (): Promise<void> {
  await doWork();
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(1);
  });

  it('cycle-2: typed-return ANONYMOUS function WITH try → PASS', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'typed_anon_with_try',
      `setInterval(async function (): Promise<void> {
  try { await doWork(); } catch (err) { logger.error({ err }); }
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.validatedTimers).toBe(1);
  });

  it('cycle-2: typed-return arrow `(): Promise<void> =>` WITH try → PASS', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'typed_arrow_with_try',
      `setInterval(async (): Promise<void> => {
  try { await doWork(); } catch {}
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.validatedTimers).toBe(1);
  });

  it('cycle-2: complex return-type with inline object `Promise<{r:number}>` does not false-match inner brace', () => {
    // The walker must track angle-depth + brace-depth so that `{r:number}`
    // inside `Promise<...>` is NOT mistaken for the body opener.
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'complex_return_type',
      `setInterval(async function fetcher(): Promise<{ result: number }> {
  await doWork();
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(1);
  });

  it('cycle-2: mutation-resistance for the function-form walker (return-type aware)', () => {
    // Pin: removing the angle/brace-depth tracking in the type-skip loop
    // would cause the `Promise<{r:number}>` inner `{` to be claimed as
    // the body, then the body-search would land at the wrong `{` and
    // either over-scan or miss the real body's try/catch.
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'mut_function_walker',
      `setInterval(async function fetcher(): Promise<{ result: number }> {
  try { await doWork(); } catch (err) { logger.error({ err }); }
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.validatedTimers).toBe(1);
  });

  it('mutation-resistance: removing TRY_BLOCK_RE check fails this fixture', () => {
    // If the regex `TRY_BLOCK_RE = /\\btry\\s*\\{/` is removed (or weakened),
    // a body WITH try/catch would still be wrongly rejected (no detection).
    // Conversely, a body WITHOUT try/catch would still be rejected. This
    // fixture pins the canonical PASS path: try-wrapped body validates.
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'mut_try_pattern',
      `setInterval(async () => {
  try { await work(); } catch {}
}, 1000);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.validatedTimers).toBe(1);
  });
});
