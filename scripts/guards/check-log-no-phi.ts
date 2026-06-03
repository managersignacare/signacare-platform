#!/usr/bin/env tsx
/*
 * scripts/guards/check-log-no-phi.ts
 *
 * BUG-269 — preventive CI guard for PHI-field additions to log calls.
 *
 * ── Why this exists ──────────────────────────────────────────────
 * PHI_FIELDS in apps/api/src/utils/phiFields.ts is a static allow-list.
 * When a migration adds a new PHI-flavoured column, developers can
 * inadvertently log it via `logger.info({ patient: { new_column: x } })`
 * and it leaks until someone reviews the log output. BUG-216 expanded
 * PHI_FIELDS from 16 → ~130 entries; BUG-267 added PHI_CATEGORY_BLIND_INDEX;
 * the set keeps growing. BUG-216 also added checkSchemaPhiDrift() which
 * WARNs on BOOT if schema columns match the PHI regex but aren't in
 * PHI_FIELDS — but only at boot, not at commit time.
 *
 * This guard is the COMMIT-TIME companion: it scans all
 * apps/api/src/**\/*.ts files for `logger.METHOD(...)` calls and
 * rejects any object-literal key that (a) matches the PHI regex, (b)
 * is NOT in PHI_FIELDS, (c) is not in the allowlist.
 *
 * ── Scope (fail-closed where AST can't prove safety) ─────────────
 * | Shape                                  | Rule                          |
 * |----------------------------------------|-------------------------------|
 * | logger.info({ a: x, b: y })            | Scan each key vs regex/allow  |
 * | logger.info({ a, ...rest })            | WARN + rule out whole call    |
 * | logger.info(payload)                   | WARN + rule out (identifier)  |
 * | logger.info('msg', { meta })           | Scan arg[1] if object literal |
 * | logger.info(`template ${v}`)           | Accept (no object keys)       |
 * | childLogger = logger.child({...})      | Scan child binding keys       |
 * |                                        | (top-level only; nested       |
 * |                                        |  identifiers: WARN on that    |
 * |                                        |  key)                         |
 * | logger.info({ a: { b: 'x' } })         | Recursively scan nested       |
 *
 * ── Limitations (documented here + in plan doc) ──────────────────
 *
 * 1. Static analysis only. Runtime-constructed log payloads
 *    (Object.assign(...), computed keys, reflected property sets)
 *    are invisible.
 *
 * 2. First-level keys only for identifier-valued properties. Nested
 *    PHI behind `{ a: somePatientObj }` requires explicit-key logging
 *    to be caught — nested identifiers emit a WARN at the outer key.
 *
 * 3. Regex coupling with checkSchemaPhiDrift in utils/logger.ts. Any
 *    change to the PHI-detection regex here MUST be mirrored in
 *    logger.ts — the two share semantics by design. Drift → silent
 *    coverage gaps.
 *
 * 4. Second-argument metadata IS scanned (pino's (msg, meta) shape)
 *    but the rule only fires on object literals. Non-literal
 *    metadata → WARN.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'apps', 'api', 'src');
const PHI_FIELDS_SRC = path.join(SCAN_ROOT, 'utils', 'phiFields.ts');
const ALLOWLIST_PATH = path.join(__dirname, 'log-phi.allowlist');

// Must match the PHI-suspect regex in apps/api/src/utils/logger.ts
// checkSchemaPhiDrift. When one changes, update the other.
const PHI_REGEX = /(?:phone|email|address|medicare|ihi\b|hpii|dva|ndis|prescriber|dob|given|family|preferred|nok|pbs|narrative|complaint|diagnosis|lookup|blind_?index)/i;

const LOG_METHODS = new Set(['info', 'warn', 'error', 'debug', 'fatal', 'trace', 'child']);

// Keys that match the PHI regex but are legitimate in specific logging
// contexts. Keep this list SHORT — prefer explicit-key logging over
// allowlist growth.
function loadAllowlist(): Set<string> {
  try {
    const raw = fs.readFileSync(ALLOWLIST_PATH, 'utf8');
    const keys = new Set<string>();
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      keys.add(trimmed);
    }
    return keys;
  } catch {
    return new Set<string>();
  }
}

function loadPhiFields(): Set<string> {
  const rawSrc = fs.readFileSync(PHI_FIELDS_SRC, 'utf8');
  // Strip single-line // comments BEFORE regex extraction — an
  // apostrophe in comment prose (e.g. "They're") otherwise breaks
  // the paired-quote extractor.
  const src = rawSrc
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  const fields = new Set<string>();
  const categoryRe = /export const PHI_CATEGORY_[A-Z_]+ = \[([\s\S]*?)\] as const;/g;
  let m: RegExpExecArray | null;
  while ((m = categoryRe.exec(src)) !== null) {
    const body = m[1]!;
    const strRe = /'([^']+)'/g;
    let s: RegExpExecArray | null;
    while ((s = strRe.exec(body)) !== null) {
      fields.add(s[1]!);
    }
  }
  return fields;
}

interface Finding {
  file: string;
  line: number;
  kind: 'fail' | 'warn';
  key?: string;
  reason: string;
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'db') continue;
      walk(p, acc);
    } else if (e.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))) {
      if (p.includes('.test.') || p.includes('.spec.')) continue;
      acc.push(p);
    }
  }
  return acc;
}

function isLogCallExpression(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const methodName = callee.name.text;
  if (!LOG_METHODS.has(methodName)) return false;
  // Match on the final segment of the access chain — loose match for
  // logger, logger.child-result, req.log, ctx.logger, etc.
  return true;
}

function keyIsPhiViolation(key: string, phiFields: Set<string>, allow: Set<string>): boolean {
  if (allow.has(key)) return false;
  if (phiFields.has(key)) return false;
  return PHI_REGEX.test(key);
}

function scanObjectLiteral(
  obj: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  filePath: string,
  phiFields: Set<string>,
  allow: Set<string>,
  findings: Finding[],
): void {
  for (const prop of obj.properties) {
    if (ts.isSpreadAssignment(prop)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(prop.getStart(sourceFile));
      findings.push({
        file: filePath,
        line: line + 1,
        kind: 'warn',
        reason: 'spread assignment — keys not statically visible',
      });
      continue;
    }
    if (ts.isShorthandPropertyAssignment(prop)) {
      const keyName = prop.name.text;
      if (keyIsPhiViolation(keyName, phiFields, allow)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(prop.getStart(sourceFile));
        findings.push({
          file: filePath,
          line: line + 1,
          kind: 'fail',
          key: keyName,
          reason: `shorthand property '${keyName}' matches PHI regex but is NOT in PHI_FIELDS`,
        });
      }
      continue;
    }
    if (!ts.isPropertyAssignment(prop)) continue;
    // Extract key name.
    let keyName: string | null = null;
    if (ts.isIdentifier(prop.name)) keyName = prop.name.text;
    else if (ts.isStringLiteral(prop.name)) keyName = prop.name.text;
    if (keyName === null) continue;

    const { line } = sourceFile.getLineAndCharacterOfPosition(prop.getStart(sourceFile));
    if (keyIsPhiViolation(keyName, phiFields, allow)) {
      findings.push({
        file: filePath,
        line: line + 1,
        kind: 'fail',
        key: keyName,
        reason: `key '${keyName}' matches PHI regex but is NOT in PHI_FIELDS`,
      });
    }
    // Recurse into nested object literals.
    const value = prop.initializer;
    if (ts.isObjectLiteralExpression(value)) {
      scanObjectLiteral(value, sourceFile, filePath, phiFields, allow, findings);
    } else if (ts.isIdentifier(value)) {
      // Nested identifier — can't see inside. If the OUTER key name
      // hints at PHI shape (patient, staff, etc.), the identifier
      // contents might carry PHI fields. We can't prove safety.
      if (/patient|staff|clinician|user|record|consent|note|prescription/i.test(keyName)) {
        findings.push({
          file: filePath,
          line: line + 1,
          kind: 'warn',
          key: keyName,
          reason: `nested identifier assigned to '${keyName}' — contents not statically visible`,
        });
      }
    }
  }
}

function scanLogCall(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string,
  phiFields: Set<string>,
  allow: Set<string>,
  findings: Finding[],
): void {
  // Consider the first two arguments. Pino supports:
  //   logger.info(obj, 'msg')
  //   logger.info('msg', obj)  (less common but seen)
  for (let i = 0; i < Math.min(call.arguments.length, 2); i++) {
    const arg = call.arguments[i]!;
    if (ts.isObjectLiteralExpression(arg)) {
      scanObjectLiteral(arg, sourceFile, filePath, phiFields, allow, findings);
    } else if (ts.isIdentifier(arg)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(arg.getStart(sourceFile));
      findings.push({
        file: filePath,
        line: line + 1,
        kind: 'warn',
        reason: `identifier argument '${arg.text}' — keys not statically visible`,
      });
    }
    // StringLiteral / TemplateExpression / ArrayLiteral: accept silently.
  }
}

function main(): number {
  console.log('→ check-log-no-phi');
  const phiFields = loadPhiFields();
  const allow = loadAllowlist();
  console.log(`  PHI_FIELDS loaded: ${phiFields.size} entries`);
  console.log(`  allowlist loaded:  ${allow.size} entries`);

  const files = walk(SCAN_ROOT);
  console.log(`  files scanned:     ${files.length}`);

  const findings: Finding[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, src, ts.ScriptTarget.ES2020, true);
    const rel = path.relative(REPO_ROOT, file);
    const visit = (node: ts.Node): void => {
      if (isLogCallExpression(node)) {
        scanLogCall(node, sourceFile, rel, phiFields, allow, findings);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  const fails = findings.filter((f) => f.kind === 'fail');
  const warns = findings.filter((f) => f.kind === 'warn');
  console.log(`  warnings: ${warns.length}`);
  console.log(`  failures: ${fails.length}`);

  if (warns.length > 0 && process.env.SHOW_WARNS) {
    console.log('\nWARNINGS (informational — not blocking):');
    for (const w of warns) {
      console.log(`  ${w.file}:${w.line} — ${w.reason}`);
    }
  }

  if (fails.length === 0) {
    console.log('✓ No PHI-field drift detected in logger calls.');
    return 0;
  }

  console.error(`\n✗ Found ${fails.length} PHI-drift violation(s):`);
  for (const f of fails) {
    console.error(`  ${f.file}:${f.line} — ${f.reason}`);
  }
  console.error('');
  console.error('Fix options:');
  console.error('  1. If the key IS PHI: add it to the matching PHI_CATEGORY_*');
  console.error('     array in apps/api/src/utils/phiFields.ts (and extend');
  console.error('     tests/unit/loggerRedaction.test.ts).');
  console.error('  2. If the key is a legitimate non-PHI workflow field that');
  console.error('     happens to match the regex, add it to');
  console.error('     scripts/guards/log-phi.allowlist with a rationale comment.');
  console.error('  3. Rename the key to something that doesn\'t match the regex.');
  console.error('');
  console.error('See BUG-269 and R-FIX-PHI-LOG-GUARD in docs/fix-registry.md.');
  return 1;
}

process.exit(main());
