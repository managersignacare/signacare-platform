/* PR-R1-23 vitest fixture suite. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard } from '../check-stream-error-handler';

const TMP_BASE = join(tmpdir(), 'pr-r1-23-fixtures');

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

describe('runGuard — stream-error-handler', () => {
  it('REJECTs createReadStream with no error handler', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'no_handler',
      `import * as fs from 'fs';
const s = fs.createReadStream('/tmp/x');
s.pipe(somewhere);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(1);
  });

  it('PASSES createReadStream with .on(\'error\') on assigned variable', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'with_var_handler',
      `import * as fs from 'fs';
const s = fs.createReadStream('/tmp/x');
s.on('error', (err) => logger.error({ err }, 'stream failed'));`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('PASSES createReadStream with chained .on(\'error\')', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'chained',
      `import * as fs from 'fs';
fs.createReadStream('/tmp/x').on('error', (err) => logger.error({ err }, 'stream failed')).pipe(out);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('REJECTs createWriteStream with no error handler', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'no_handler_write',
      `import * as fs from 'fs';
const w = fs.createWriteStream('/tmp/out');
w.write('hello');`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(1);
  });

  it('PASSES createWriteStream with variable error handler', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'with_handler_write',
      `import * as fs from 'fs';
const w = fs.createWriteStream('/tmp/out');
w.on('error', (err) => logger.error({ err }, 'write failed'));`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('honours @stream-error-exempt with non-empty reason', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'inline_exempt',
      `import * as fs from 'fs';
// @stream-error-exempt: piped to gzip which owns error handling, see fail() below
const s = fs.createReadStream('/tmp/x');
s.pipe(gzip);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedExempt).toBe(1);
  });

  it('does NOT honour @stream-error-exempt with empty reason', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'empty_exempt',
      `import * as fs from 'fs';
// @stream-error-exempt:
const s = fs.createReadStream('/tmp/x');
s.pipe(out);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
  });

  it('detects multiple violations across one file', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'multi',
      `import * as fs from 'fs';
const a = fs.createReadStream('/a');
a.pipe(x);
const b = fs.createWriteStream('/b');
b.write('hi');
const c = fs.createReadStream('/c');
c.on('error', (err) => log(err));`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(2);
  });

  it('handles bare createReadStream after named import', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'bare_import',
      `import { createReadStream } from 'fs';
const s = createReadStream('/tmp/x');
s.pipe(out);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
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

  it('cycle-2: typed-variable declaration — captures the variable, not the type', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'typed_var',
      `import * as fs from 'fs';
const s: fs.ReadStream = fs.createReadStream('/tmp/x');
s.on('error', (err) => log(err));`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.validatedStreams).toBe(1);
  });

  it('cycle-2: typed-variable WITHOUT handler is rejected (not silently passed via type capture)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'typed_var_no_handler',
      `import * as fs from 'fs';
const s: fs.ReadStream = fs.createReadStream('/tmp/x');
s.pipe(somewhere);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(1);
  });

  it('cycle-2: variable shadowing across two streams in same scope is detected', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'shadow',
      `import * as fs from 'fs';
function go(p1: string, p2: string) {
  let s = fs.createReadStream(p1);
  s.pipe(somewhere);
  s = fs.createReadStream(p2);
  s.on('error', (err) => log(err));
}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(1);
  });

  it('cycle-2b: factory-function returning a stream (no assignment, no chain) is rejected', () => {
    // Caller is responsible for handling errors — but the guard cannot
    // see the caller. Conservative position: factory functions returning
    // streams without a chained handler must annotate with @stream-error-exempt
    // OR attach the handler before returning.
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'factory_no_handler',
      `import * as fs from 'fs';
const makeStream = (p: string) => fs.createReadStream(p);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
  });

  it('cycle-2b: multi-line type annotation walks back through newlines to find the variable', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'multiline_type',
      `import * as fs from 'fs';
const s:
  fs.ReadStream
  = fs.createReadStream('/tmp/x');
s.on('error', (err) => log(err));`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.validatedStreams).toBe(1);
  });

  it('cycle-2b: @stream-error-exempt with blank-line gap above is NOT honoured', () => {
    // Exemption MUST be on the line directly above the create call.
    // A blank-line gap means the comment annotates something else.
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'exempt_gap',
      `import * as fs from 'fs';
// @stream-error-exempt: reason here

const s = fs.createReadStream('/tmp/x');
s.pipe(out);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.counts.skippedExempt).toBe(0);
  });

  it('cycle-2b: variable name with $ and underscore special chars is captured correctly', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'special_chars',
      `import * as fs from 'fs';
const _stream$ = fs.createReadStream('/tmp/x');
_stream$.on('error', (err) => log(err));`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.validatedStreams).toBe(1);
  });

  it('cycle-2: createReadStream mentioned only in a comment is NOT flagged', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'comment_mention',
      `import * as fs from 'fs';
// Documentation example: fs.createReadStream(path) without handler is wrong
/* Block comment: const z = fs.createReadStream('/x'); */
const s = fs.createReadStream('/tmp/x');
s.on('error', (err) => log(err));`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.validatedStreams).toBe(1);
  });

  it('mutation-resistance: removing chained-handler detection fails this fixture', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'mut_chained_pattern',
      `import * as fs from 'fs';
fs.createReadStream('/tmp/x').on('error', (err) => log(err)).pipe(out);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.validatedStreams).toBe(1);
  });
});
