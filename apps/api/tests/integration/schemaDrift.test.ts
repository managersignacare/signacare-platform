/**
 * Integration test — every `export interface X(Row|Db)` bound to a DB table
 * must declare only fields that exist in that table's live schema.
 *
 * Companion to `scripts/guards/check-row-interface-matches-db.ts`. The guard
 * uses a committed JSON snapshot; this test runs against the real integration
 * Postgres (`test-integration` CI job) and catches drift the snapshot missed
 * (e.g. a migration that added a column but the snapshot wasn't regenerated).
 *
 * Why both: the snapshot is the pre-merge tripwire (no DB needed to run).
 * This test is the post-merge tripwire that catches snapshot-vs-live drift.
 *
 * Phase 0.7.5 c24 — SD12–SD21 + SD28 root cause was hand-maintained interfaces
 * diverging from migrations.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { isIntegrationReady } from './_helpers';
import { dbAdmin } from '../../src/db/db';

interface DbColumn { table_name: string; column_name: string }

interface InterfaceCheck {
  file: string;
  lineNo: number;
  interfaceName: string;
  fields: string[];
  boundTable: string | null;
  exemptReason: string | null;
}

const SCAN_ROOT = resolve(__dirname, '..', '..', 'src');

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
      walkTs(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function parseFile(file: string): InterfaceCheck[] {
  const src = readFileSync(file, 'utf-8');
  const lines = src.split('\n');
  const checks: InterfaceCheck[] = [];
  const ifaceRe = /^export interface (\w+(?:Row|Db))\s*\{/;

  for (let i = 0; i < lines.length; i++) {
    const m = ifaceRe.exec(lines[i]);
    if (!m) continue;
    const interfaceName = m[1];

    let exemptReason: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const line = lines[j];
      const em = /@schema-drift-exempt\s+(select-aliased|aggregation|response-shape|partial-shape)/.exec(line);
      if (em) { exemptReason = em[1]; break; }
      const trimmed = line.trim();
      const isJsdoc = trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//');
      if (!isJsdoc && trimmed !== '') break;
    }

    // Field extraction: handles BOTH multi-line and inline-semicolon
    // interface styles. Walk character-by-character at depth 1 only.
    const fields: string[] = [];
    let depth = 1;
    let bodyDone = false;
    for (let j = i + 1; j < lines.length && !bodyDone; j++) {
      const line = lines[j];
      const segments: string[] = [''];
      for (const ch of line) {
        if (ch === '{') { depth++; continue; }
        if (ch === '}') {
          depth--;
          if (depth <= 0) { bodyDone = true; break; }
          continue;
        }
        if (depth === 1) {
          if (ch === ';') segments.push('');
          else segments[segments.length - 1] += ch;
        }
      }
      for (const seg of segments) {
        const fm = /^\s*(\w+)\??\s*:/.exec(seg);
        if (fm && !fm[1].startsWith('_')) fields.push(fm[1]);
      }
    }

    let boundTable: string | null = null;
    const genericRe = new RegExp(
      `(?:db|trx|dbAdmin|dbRead|dbConn|dbWrite|conn)\\s*<\\s*${interfaceName}\\s*>\\s*\\(\\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]`,
    );
    const gm = genericRe.exec(src);
    if (gm) boundTable = gm[1];

    if (!boundTable) {
      const castRe = new RegExp(`as\\s+${interfaceName}(?:\\s*\\[\\s*\\]|\\s*\\||\\s*;|\\s*\\))`);
      const cm = castRe.exec(src);
      if (cm) {
        const window = src.substring(Math.max(0, cm.index - 2000), cm.index);
        const matches = [
          ...window.matchAll(/(?:db|trx|dbAdmin|dbRead|dbConn|dbWrite)(?:<[^>]+>)?\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g),
          ...window.matchAll(/\(\s*(?:trx|db|dbAdmin|dbRead|dbConn|dbWrite)\s*(?:\?\?|\|\|)\s*(?:trx|db|dbAdmin|dbRead|dbConn|dbWrite)\s*\)\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g),
        ];
        if (matches.length > 0) {
          matches.sort((a, b) => (b.index ?? 0) - (a.index ?? 0));
          boundTable = matches[0][1];
        }
      }
    }

    if (!boundTable) {
      const classRe = new RegExp(`extends\\s+\\w*Repository\\s*<\\s*${interfaceName}\\s*>`);
      if (classRe.test(src)) {
        const tblConst = /(?:TABLE_NAME|TABLE)\s*=\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/.exec(src);
        if (tblConst) boundTable = tblConst[1];
      }
    }

    checks.push({ file, lineNo: i + 1, interfaceName, fields, boundTable, exemptReason });
  }
  return checks;
}

function loadAllowlist(): Set<string> {
  const path = resolve(__dirname, '..', '..', '..', '..', 'scripts', 'guards', 'check-row-interface-matches-db.allowlist');
  const entries = new Set<string>();
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return entries;
  }
  for (const raw of content.split('\n')) {
    const before = raw.indexOf('#') >= 0 ? raw.substring(0, raw.indexOf('#')) : raw;
    const t = before.trim();
    if (t === '') continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(t);
    if (m) entries.add(`${m[1]}.${m[2]}`);
  }
  return entries;
}

describe.skipIf(!(await isIntegrationReady().catch(() => false)))(
  'schema drift — Row/Db interfaces match the live DB (BUG-529 bidirectional)',
  () => {
    it('every interface declares only real columns AND every real column is declared (or exempt)', async () => {
      // Load every public-schema column from the live DB
      const rows = (await dbAdmin
        .withSchema('information_schema')
        .from('columns')
        .where({ table_schema: 'public' })
        .select('table_name', 'column_name')) as DbColumn[];
      const tables: Record<string, Set<string>> = {};
      for (const r of rows) {
        if (!tables[r.table_name]) tables[r.table_name] = new Set();
        tables[r.table_name].add(r.column_name);
      }

      const allowlist = loadAllowlist();
      const tsFiles = walkTs(SCAN_ROOT);
      const violations: string[] = [];
      for (const f of tsFiles) {
        for (const c of parseFile(f)) {
          // Whole-interface exemptions skip BOTH directions, except
          // partial-shape which only skips reverse.
          if (c.exemptReason && c.exemptReason !== 'partial-shape') continue;
          if (!c.boundTable) continue;
          const cols = tables[c.boundTable];
          if (!cols) {
            violations.push(`${c.file}:${c.lineNo}  ${c.interfaceName} → ghost table "${c.boundTable}"`);
            continue;
          }

          // Forward direction (always enforced even for partial-shape).
          const phantom = c.fields.filter((field) => !cols.has(field));
          if (phantom.length > 0) {
            violations.push(
              `${c.file}:${c.lineNo}  ${c.interfaceName} → ${c.boundTable}: forward drift — fields not in DB: ${phantom.join(', ')}`,
            );
          }

          // Reverse direction (skipped if partial-shape, or if column allowlisted).
          if (c.exemptReason === 'partial-shape') continue;
          const undeclared: string[] = [];
          for (const col of cols) {
            if (c.fields.includes(col)) continue;
            if (allowlist.has(`${c.boundTable}.${col}`)) continue;
            undeclared.push(col);
          }
          if (undeclared.length > 0) {
            violations.push(
              `${c.file}:${c.lineNo}  ${c.interfaceName} → ${c.boundTable}: reverse drift (BUG-529) — DB columns not declared: ${undeclared.join(', ')}`,
            );
          }
        }
      }

      if (violations.length > 0) {
        // One failure message lists every drift — the most useful shape for
        // CI logs. The scripts/guards/check-row-interface-matches-db.ts
        // companion guard provides detailed suggestions at PR time.
        expect.fail(
          `Schema drift detected in ${violations.length} interface(s) against live DB:\n\n` +
          violations.join('\n') +
          '\n\nRule: CLAUDE.md §15 (bidirectional, BUG-529). Fix-registry: ROW-IFACE-DRIFT.',
        );
      }
    });
  },
);
