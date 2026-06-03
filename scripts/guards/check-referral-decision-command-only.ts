/**
 * Guard: decision status changes must use referral decision commands.
 *
 * Prevents FE regressions where code mutates referral terminal states
 * (`accepted` / `rejected` / `declined` / `redirected` / `info_requested`)
 * via generic PATCH `/referrals/:id` instead of POST `/referrals/:id/decision`.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, relative } from 'path';

const ROOT = resolve(__dirname, '..', '..');
const WEB_SRC = resolve(ROOT, 'apps', 'web', 'src');
const DECISION_STATUS_PATTERN = /status\s*:\s*['"](accepted|rejected|declined|redirected|info_requested)['"]/g;

export interface Violation {
  file: string;
  reason: string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/.*$/gm, '');
}

export function scanSource(source: string): boolean {
  const clean = stripComments(source);
  const hasReferralPatch = /(?:apiClient|intakeApi)\.patch\s*\([^)]*referrals\/\$\{[^}]+\}/.test(clean);
  if (!hasReferralPatch) return false;
  return DECISION_STATUS_PATTERN.test(clean);
}

export function runGuard(): { ok: boolean; violations: Violation[] } {
  const files = walk(WEB_SRC);
  const violations: Violation[] = [];

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (!scanSource(src)) continue;
    violations.push({
      file: relative(ROOT, file),
      reason: 'Decision status is mutated through PATCH referral path. Use POST /referrals/:id/decision command.',
    });
  }

  return { ok: violations.length === 0, violations };
}

function main(): number {
  const result = runGuard();
  if (!result.ok) {
    console.error('✗ Referral decision command ownership violations detected:');
    for (const v of result.violations) {
      console.error(`  - ${v.file}: ${v.reason}`);
    }
    return 1;
  }
  console.log('✓ referral decision command ownership guard passed.');
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

