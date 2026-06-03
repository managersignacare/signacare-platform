#!/usr/bin/env tsx
/**
 * guard:e2e-selector-stability
 *
 * Enforces stable selector discipline for critical E2E packs:
 * - e2e/accessibility/<recursive>/*.spec.ts
 * - e2e/visual/<recursive>/*.spec.ts
 *
 * Why:
 * - These suites are gate evidence for C3/A1/B-family UI trust.
 * - Fragile CSS/XPath/text-engine locators in these packs can create
 *   false regressions and mask real regressions.
 *
 * Rule (scoped, fail-closed):
 * - Reject `locator('<fragile selector>')` where selector begins with:
 *   `.`, `#`, `div`, `span`, `[class`, `xpath=`, `text=`.
 * - Encourage role/test-id based selectors (`getByRole`, `getByTestId`,
 *   `getByLabel`, `getByPlaceholder`) in critical packs.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const TARGET_DIRS = [
  resolve(ROOT, 'e2e', 'accessibility'),
  resolve(ROOT, 'e2e', 'visual'),
];

const SPEC_FILE_RE = /\.spec\.ts$/;
const LOCATOR_RE = /\blocator\s*\(\s*(['"`])([^'"`]+)\1/g;
const FRAGILE_SELECTOR_RE = /^(?:\.|#|div\b|span\b|\[class|xpath=|text=)/i;

interface Violation {
  file: string;
  line: number;
  selector: string;
}

function walkSpecs(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkSpecs(full, out);
      continue;
    }
    if (st.isFile() && SPEC_FILE_RE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function lineFromOffset(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function scanFile(file: string): Violation[] {
  const src = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  const violations: Violation[] = [];

  let m: RegExpExecArray | null;
  LOCATOR_RE.lastIndex = 0;
  while ((m = LOCATOR_RE.exec(src)) !== null) {
    const selector = m[2].trim();
    if (!FRAGILE_SELECTOR_RE.test(selector)) {
      continue;
    }
    violations.push({
      file: rel,
      line: lineFromOffset(src, m.index),
      selector,
    });
  }

  return violations;
}

function main(): number {
  const files = TARGET_DIRS.flatMap((d) => walkSpecs(d));
  const violations = files.flatMap((f) => scanFile(f));

  if (violations.length > 0) {
    for (const v of violations) {
      console.error(
        `${v.file}:${v.line} fragile locator selector "${v.selector}" in critical E2E pack`,
      );
    }
    console.error(
      `\ncheck-e2e-selector-stability: FAIL (${violations.length} fragile locator(s))`,
    );
    return 1;
  }

  console.log(
    `check-e2e-selector-stability: PASS (${files.length} critical spec file(s), 0 fragile locators)`,
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
