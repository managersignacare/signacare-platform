#!/usr/bin/env tsx
/**
 * Enforce M1 structural rule:
 * Feature modules must emit via the centralized clinical-signal facade
 * (`features/events/clinicalSignalEmitter.ts`) instead of calling
 * `notificationService.emit(...)` directly.
 *
 * Scope:
 * - scans TypeScript files under apps/api/src
 * - allows only:
 *   - features/notifications/notificationService.ts (source of truth)
 *   - features/events/clinicalSignalEmitter.ts (centralized facade)
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const API_SRC_ROOT = path.join(REPO_ROOT, 'apps', 'api', 'src');

const ALLOWED_RELATIVE = new Set([
  'features/notifications/notificationService.ts',
  'features/events/clinicalSignalEmitter.ts',
]);

const EMIT_RE = /\bnotificationService\.emit\s*\(/g;

interface Violation {
  file: string;
  line: number;
}

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
      continue;
    }
    if (entry.isFile() && full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function toRelative(fullPath: string, baseRoot: string): string {
  return path.relative(baseRoot, fullPath).replace(/\\/g, '/');
}

function isAllowedPath(rel: string): boolean {
  if (ALLOWED_RELATIVE.has(rel)) return true;
  if (ALLOWED_RELATIVE.has(`features/${rel}`)) return true;
  if (rel.startsWith('features/')) {
    return ALLOWED_RELATIVE.has(rel.slice('features/'.length));
  }
  return false;
}

function findViolations(source: string, file: string): Violation[] {
  const rows = source.split('\n');
  const violations: Violation[] = [];
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i] ?? '';
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }
    if (EMIT_RE.test(line)) {
      violations.push({ file, line: i + 1 });
    }
    EMIT_RE.lastIndex = 0;
  }
  return violations;
}

export function runGuard(opts?: { featuresRoot?: string; scanRoots?: string[] }): {
  filesScanned: number;
  violations: Violation[];
} {
  const roots = opts?.scanRoots ?? (opts?.featuresRoot ? [opts.featuresRoot] : [API_SRC_ROOT]);
  const relBase = opts?.featuresRoot ? opts.featuresRoot : API_SRC_ROOT;
  const files = roots.flatMap((root) => walkTsFiles(root));
  const violations: Violation[] = [];

  for (const file of files) {
    const rel = toRelative(file, relBase);
    if (isAllowedPath(rel)) continue;
    const src = fs.readFileSync(file, 'utf8');
    violations.push(...findViolations(src, rel));
  }

  return { filesScanned: files.length, violations };
}

function main(): number {
  const result = runGuard();
  console.error('→ check-centralized-notification-emitter');
  console.error(`  files scanned: ${result.filesScanned}`);
  console.error(`  violations:   ${result.violations.length}`);
  console.error('');

  if (result.violations.length === 0) {
    console.error('✓ No direct notificationService.emit calls outside centralized emitter.');
    return 0;
  }

  console.error('✗ Direct notificationService.emit call(s) found in feature modules:');
  for (const v of result.violations) {
    console.error(`  - ${v.file}:${v.line}`);
  }
  console.error(
    '\nFix shape: route emits through features/events/clinicalSignalEmitter.ts ' +
      '(M1 structural rule) and keep notificationService.emit as an internal delivery primitive.',
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}
