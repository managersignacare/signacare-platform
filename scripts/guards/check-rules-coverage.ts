#!/usr/bin/env tsx
/**
 * Phase 0a.8 — rules-coverage matrix guard.
 *
 * Walks `CLAUDE.md` to enumerate every rule (top-level §N + sub-rules
 * §N.M) and validates that `docs/quality/rules-coverage-matrix.md`
 * has a row mapping each rule to a mechanism.
 *
 * Per the plan's "Mechanical enforcement 10/10" axis: NEW CLAUDE.md
 * rule without a matrix row → CI fails.
 *
 * Mechanism types accepted in the matrix:
 *   - `guard:<name>` — static guard
 *   - `eslint:<rule>` — ESLint rule
 *   - `ts:<concept>` — TypeScript constraint
 *   - `runtime:<location>` — runtime assertion
 *   - `migration:<convention>` — migration discipline
 *   - `agent:<name>` — discipline-check agent
 *   - `advisory-permanent:<reason>` — explicit no-mechanical-enforcement (with rationale)
 *
 * Multi-mechanism rows (defence-in-depth) are encouraged: cite all
 * mechanisms that contribute to enforcing the rule.
 *
 * Usage: tsx scripts/guards/check-rules-coverage.ts
 *   exit 0 = every rule has a matrix row; PASS
 *   exit 1 = rules without coverage; BLOCK
 */
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const CLAUDE_MD = resolve(REPO_ROOT, 'CLAUDE.md');
const MATRIX_MD = resolve(REPO_ROOT, 'docs/quality/rules-coverage-matrix.md');

interface Rule {
  id: string;
  section: string;
  title: string;
  source: 'top-level' | 'sub-rule';
}

const VALID_MECHANISM_PREFIXES = [
  'guard:',
  'eslint:',
  'ts:',
  'runtime:',
  'migration:',
  'agent:',
  'advisory-permanent:',
];

// ─── Parse CLAUDE.md headings into rules ────────────────────────────────────

function parseClaudeMd(): Rule[] {
  const content = readFileSync(CLAUDE_MD, 'utf8');
  const lines = content.split('\n');
  const rules: Rule[] = [];

  for (const line of lines) {
    // Top-level: "## 1. DATABASE QUERIES"
    let m = /^##\s+(\d+)\.\s+(.+)$/.exec(line);
    if (m) {
      rules.push({
        id: m[1],
        section: m[1],
        title: m[2].trim(),
        source: 'top-level',
      });
      continue;
    }
    // Sub-rules: "### 1.1 Column names must match..." OR "### 1.6 Use atomic..."
    // Some headings include trailing dot (### 12.1.) — handle both
    m = /^###\s+(\d+)\.(\d+)\.?(\.(\d+))?\s+(.+)$/.exec(line);
    if (m) {
      const id = m[3] ? `${m[1]}.${m[2]}.${m[4]}` : `${m[1]}.${m[2]}`;
      rules.push({
        id,
        section: m[1],
        title: m[5].trim(),
        source: 'sub-rule',
      });
    }
  }

  return rules;
}

// ─── Parse matrix file: extract every rule ID + its mechanism citations ─────

function parseMatrix(): { rulesCovered: Set<string>; mechanisms: Map<string, string[]> } {
  const content = readFileSync(MATRIX_MD, 'utf8');
  const lines = content.split('\n');
  const covered = new Set<string>();
  const mechanisms = new Map<string, string[]>();

  for (const line of lines) {
    // Table rows: `| <id> | <title> | <mechanism> |`
    // Strip leading `|` and split
    if (!line.trimStart().startsWith('|')) continue;
    if (line.trimStart().startsWith('|---') || line.trimStart().startsWith('| ---')) continue;
    if (line.trimStart().startsWith('| Rule |')) continue; // header
    if (!line.includes('|')) continue;

    const cols = line.split('|').map((c) => c.trim()).filter((_c, idx, arr) => idx > 0 && idx < arr.length - 1);
    if (cols.length < 3) continue;

    const id = cols[0];
    const mechanismCol = cols.slice(2).join(' | '); // mechanism may span multiple columns if pipes inside

    // Detect rule ID patterns: 1.1, 1.6-atomic, 7.3.1, 9.6, 12-orphan, 11-L0a, AL-EXPIRY, DISC-MEM, etc.
    if (!/^[A-Z0-9.-]+$/i.test(id) && !/^\d+(\.\d+)*(-[a-z0-9]+)?$/i.test(id)) continue;
    if (id.length === 0) continue;

    covered.add(id);

    // Validate at least one mechanism cited
    const mechs: string[] = [];
    for (const prefix of VALID_MECHANISM_PREFIXES) {
      const re = new RegExp(`\\b${prefix.replace(':', '')}:[\\w./-]+`, 'g');
      const found = mechanismCol.match(re);
      if (found) mechs.push(...found);
    }
    if (mechs.length === 0 && mechanismCol.length > 0) {
      // Fallback: look for backtick-wrapped citations
      const tickedMechs = mechanismCol.match(/`([^`]+)`/g);
      if (tickedMechs) mechs.push(...tickedMechs.map((s) => s.slice(1, -1)));
    }
    mechanisms.set(id, mechs);
  }

  return { rulesCovered: covered, mechanisms };
}

// ─── Match rules to matrix; report gaps ─────────────────────────────────────

const rules = parseClaudeMd();
const { rulesCovered, mechanisms } = parseMatrix();

console.log('\n=== check-rules-coverage (Phase 0a.8) ===\n');
console.log(`CLAUDE.md rules enumerated: ${rules.length}`);
console.log(`  top-level (§N): ${rules.filter((r) => r.source === 'top-level').length}`);
console.log(`  sub-rules (§N.M): ${rules.filter((r) => r.source === 'sub-rule').length}`);
console.log(`Matrix entries: ${rulesCovered.size}`);
console.log('');

// Compute which top-level sections have at least one sub-rule covered.
// Top-level umbrella sections (§N) don't need their own matrix row IF ≥1
// sub-rule (§N.M) is covered — the umbrella's enforcement IS the sum of
// its sub-rules.
const sectionsWithCoveredSubRules = new Set<string>();
for (const rule of rules) {
  if (rule.source === 'sub-rule' && rulesCovered.has(rule.id)) {
    sectionsWithCoveredSubRules.add(rule.section);
  }
}

const missingFromMatrix: Rule[] = [];
const noMechanism: string[] = [];

for (const rule of rules) {
  if (!rulesCovered.has(rule.id)) {
    // Top-level §N is acceptable if it has ≥1 covered sub-rule
    if (rule.source === 'top-level' && sectionsWithCoveredSubRules.has(rule.section)) {
      continue;
    }
    // Top-level §N with NO sub-rules (e.g., §10, §13, §15) MUST have its own matrix row
    missingFromMatrix.push(rule);
    continue;
  }
  const mechs = mechanisms.get(rule.id);
  if (!mechs || mechs.length === 0) {
    noMechanism.push(rule.id);
  }
}

if (missingFromMatrix.length === 0 && noMechanism.length === 0) {
  console.log(`✓ Every rule in CLAUDE.md has a matrix row with at least one mechanism.`);
  console.log(`  Total rules covered: ${rules.length}/${rules.length}`);
  process.exit(0);
}

if (missingFromMatrix.length > 0) {
  console.log(`✗ ${missingFromMatrix.length} rule(s) in CLAUDE.md missing from matrix:`);
  for (const r of missingFromMatrix) {
    console.log(`    §${r.id} ${r.title}`);
  }
  console.log('');
  console.log('  Action: add a row to docs/quality/rules-coverage-matrix.md mapping each rule above to a mechanism.');
  console.log('  Mechanism prefixes: guard: / eslint: / ts: / runtime: / migration: / agent: / advisory-permanent:');
}

if (noMechanism.length > 0) {
  console.log('');
  console.log(`✗ ${noMechanism.length} rule(s) have a matrix row but no recognized mechanism citation:`);
  for (const id of noMechanism) {
    console.log(`    §${id}`);
  }
  console.log('');
  console.log('  Action: ensure each row has at least one mechanism cited (e.g., "guard:check-name" or "advisory-permanent:reason").');
}

console.log('');
console.log('Hint: a rule is mechanically enforced if there is a guard / ESLint rule / runtime check for it.');
console.log('  If genuinely no mechanism applies, use "advisory-permanent: <rationale>" with a concrete reason.');
process.exit(1);
