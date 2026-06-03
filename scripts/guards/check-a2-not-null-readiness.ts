#!/usr/bin/env tsx
/**
 * A2-2 / BUG-315 + BUG-334 guard:
 * block premature NOT NULL enforcement for:
 *   - clinical_notes.consent_id
 *   - clinics.hpio
 *
 * Contract (v4.4 A2-2):
 * - Phase A/B: guard/backfill/app-readiness only, NO NOT NULL enforcement.
 * - Phase C: enforcement allowed only after manifest explicitly flips
 *   allowNotNullEnforcement=true with verified evidence.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

type BackfillStatus = 'pending' | 'in_progress' | 'complete';
type AppReadinessStatus = 'pending' | 'verified';

interface ReadinessTarget {
  bugId: string;
  table: string;
  column: string;
  backfillStatus: BackfillStatus;
  backfillEvidence: string;
  appReadinessStatus: AppReadinessStatus;
  appReadinessEvidence: string;
}

interface ReadinessManifest {
  version: number;
  lane: string;
  slice: string;
  updatedAt: string;
  allowNotNullEnforcement: boolean;
  targets: ReadinessTarget[];
  notes?: string[];
}

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_MANIFEST = resolve(ROOT, '.github', 'a2-not-null-readiness.json');
const DEFAULT_MIGRATIONS_DIR = resolve(ROOT, 'apps', 'api', 'migrations');

const EXPECTED_TARGETS: Array<Pick<ReadinessTarget, 'bugId' | 'table' | 'column'>> = [
  { bugId: 'BUG-315', table: 'clinical_notes', column: 'consent_id' },
  { bugId: 'BUG-334', table: 'clinics', column: 'hpio' },
];

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasNotNullEnforcement(source: string, table: string, column: string): boolean {
  const tableEscaped = escapeRegex(table);
  const columnEscaped = escapeRegex(column);

  const rawSetNotNull = new RegExp(
    `ALTER\\s+TABLE\\s+["\`]??${tableEscaped}["\`]??\\s+ALTER\\s+COLUMN\\s+["\`]??${columnEscaped}["\`]??\\s+SET\\s+NOT\\s+NULL`,
    'i',
  );

  const builderDropNullable = new RegExp(
    `alterTable\\(\\s*['"\`]${tableEscaped}['"\`][\\s\\S]{0,1400}?dropNullable\\(\\s*['"\`]${columnEscaped}['"\`]\\s*\\)`,
    'i',
  );

  const builderAlterNotNullable = new RegExp(
    `alterTable\\(\\s*['"\`]${tableEscaped}['"\`][\\s\\S]{0,1800}?\\(\\s*['"\`]${columnEscaped}['"\`][\\s\\S]{0,500}?notNullable\\(\\)[\\s\\S]{0,500}?alter\\(\\)`,
    'i',
  );

  return rawSetNotNull.test(source) || builderDropNullable.test(source) || builderAlterNotNullable.test(source);
}

function validateManifest(manifest: ReadinessManifest, violations: string[]): void {
  if (manifest.version !== 1) violations.push('version must be 1');
  if (manifest.lane !== 'A2') violations.push('lane must be A2');
  if (manifest.slice !== 'A2-2') violations.push('slice must be A2-2');
  if (!isIsoDate(manifest.updatedAt)) violations.push('updatedAt must be YYYY-MM-DD');
  if (!Array.isArray(manifest.targets) || manifest.targets.length !== EXPECTED_TARGETS.length) {
    violations.push(`targets must contain exactly ${EXPECTED_TARGETS.length} entries`);
    return;
  }

  const seen = new Set<string>();
  for (const [idx, target] of manifest.targets.entries()) {
    const p = `targets[${idx}]`;
    const id = `${target.bugId}:${target.table}.${target.column}`;
    if (seen.has(id)) violations.push(`${p} duplicate target ${id}`);
    seen.add(id);

    if (!target.backfillEvidence) violations.push(`${p}.backfillEvidence is required`);
    if (!target.appReadinessEvidence) violations.push(`${p}.appReadinessEvidence is required`);
    if (!['pending', 'in_progress', 'complete'].includes(target.backfillStatus)) {
      violations.push(`${p}.backfillStatus must be pending | in_progress | complete`);
    }
    if (!['pending', 'verified'].includes(target.appReadinessStatus)) {
      violations.push(`${p}.appReadinessStatus must be pending | verified`);
    }
  }

  for (const expected of EXPECTED_TARGETS) {
    const found = manifest.targets.find(
      (t) => t.bugId === expected.bugId && t.table === expected.table && t.column === expected.column,
    );
    if (!found) {
      violations.push(`missing target ${expected.bugId} (${expected.table}.${expected.column})`);
    }
  }

  if (manifest.allowNotNullEnforcement) {
    for (const target of manifest.targets) {
      if (target.appReadinessStatus !== 'verified') {
        violations.push(
          `allowNotNullEnforcement=true requires appReadinessStatus=verified for ${target.bugId}`,
        );
      }
      if (target.backfillStatus !== 'complete') {
        violations.push(
          `allowNotNullEnforcement=true requires backfillStatus=complete for ${target.bugId}`,
        );
      }
    }
  }
}

function main(): number {
  const manifestPath = process.argv[2] ? resolve(ROOT, process.argv[2]) : DEFAULT_MANIFEST;
  const migrationsDir = process.argv[3] ? resolve(ROOT, process.argv[3]) : DEFAULT_MIGRATIONS_DIR;
  const violations: string[] = [];

  let manifest: ReadinessManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ReadinessManifest;
  } catch (error) {
    console.error(
      `✗ failed to load manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  validateManifest(manifest, violations);

  if (!manifest.allowNotNullEnforcement) {
    const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.ts')).sort();
    for (const file of files) {
      const full = resolve(migrationsDir, file);
      const source = readFileSync(full, 'utf8');
      for (const target of manifest.targets) {
        if (hasNotNullEnforcement(source, target.table, target.column)) {
          violations.push(
            `premature NOT NULL enforcement detected in ${file} for ${target.table}.${target.column} while allowNotNullEnforcement=false`,
          );
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('✗ check-a2-not-null-readiness');
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    return 1;
  }

  console.log('✓ check-a2-not-null-readiness');
  console.log(`  manifest: ${manifestPath}`);
  console.log(`  allowNotNullEnforcement: ${manifest.allowNotNullEnforcement}`);
  console.log(`  migrationsDir: ${migrationsDir}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
