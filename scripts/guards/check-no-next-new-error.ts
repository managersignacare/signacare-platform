#!/usr/bin/env tsx
/*
 * scripts/guards/check-no-next-new-error.ts
 *
 * BUG-275 — prevents the `next(new Error(msg))` anti-pattern in
 * Express route handlers.
 *
 * Wrapping an unknown error in `new Error(msg)` before calling
 * `next(err)` destroys the original error class, stack trace,
 * cause chain, and any custom fields like `.code` / `.status`
 * that downstream middleware (HttpError handler, Zod handler,
 * Pino err serializer) relies on to produce the correct HTTP
 * response + forensic log. Pre-fix, the /ambient-note handler
 * wrapped every non-matched error this way, rendering the
 * global errorHandler effectively blind to typed errors.
 *
 * The fix is always the same: `next(err)` passes the original
 * instance through. This guard rejects the `next(new Error(...))`
 * literal shape so it can't be reintroduced.
 *
 * ── Guard scope (absorbed from R2 pre-exec review) ───────────────
 * This is a NARROW SAFETY RAIL, not a comprehensive ban on all
 * error wrapping. Specifically:
 *
 *   - It catches:  next(new Error(...))    ← the BUG-275 shape
 *
 *   - It does NOT catch:
 *       const e = new Error('x'); next(e);     (indirect wrap)
 *       next(new HttpError(...));              (typed-class wrap)
 *       throw new Error(msg); (handled elsewhere by error-middleware)
 *
 * Indirect wrapping + typed-class wrapping are legitimate in many
 * cases (deliberate class reshaping, typed-error bubbling). The
 * guard focuses on the specific pattern that destroyed diagnostic
 * context in BUG-275.
 *
 * Scope: apps/api/src/features/ ** / *.ts (production handlers).
 * Tests + legacy scripts are excluded because `next(new Error(x))`
 * is legitimate in mock/failure-injection contexts.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'apps', 'api', 'src', 'features');

// Matches `next(new Error(...))` with arbitrary whitespace + an
// optional semicolon.  Stops at the closing `)` of Error(...) —
// nested calls inside Error's argument are handled by JS grammar
// at a deeper level; this regex is deliberately literal.
const VIOLATION_RE = /\bnext\s*\(\s*new\s+Error\s*\(/;

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      await walk(p, acc);
    } else if (e.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))) {
      if (p.includes('.test.') || p.includes('.spec.')) continue;
      acc.push(p);
    }
  }
  return acc;
}

async function main(): Promise<number> {
  console.log('→ check-no-next-new-error');
  const files = await walk(SCAN_ROOT);
  console.log(`  files scanned:   ${files.length}`);

  const violations: { file: string; line: number; text: string }[] = [];

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Strip trailing single-line comments before matching so the
      // guard doesn't false-positive on prose like "Pre-fix
      // next(new Error(...)) erased …" inside code comments.
      const codePart = line.replace(/\/\/.*$/, '');
      // Also skip if the whole line is inside a block comment. We
      // don't do full state-machine parsing; but single-line *-only
      // block comments are rejected cheaply.
      if (/^\s*\*/.test(line)) continue;
      if (VIOLATION_RE.test(codePart)) {
        violations.push({
          file: path.relative(REPO_ROOT, file),
          line: i + 1,
          text: line.trim(),
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log('✓ No next(new Error(...)) violations found.');
    return 0;
  }

  console.error(`✗ Found ${violations.length} next(new Error(...)) violation(s):`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.text}`);
  }
  console.error('');
  console.error('Fix: replace `next(new Error(msg))` with `next(err)` so the');
  console.error('original error instance passes through unchanged.');
  console.error('Downstream middleware relies on error class + stack + fields.');
  console.error('See BUG-275 and R-FIX-AMBIENT-CATCH-PASSTHROUGH in');
  console.error('docs/fix-registry.md for the rationale.');
  return 1;
}

main().then((code) => process.exit(code));
