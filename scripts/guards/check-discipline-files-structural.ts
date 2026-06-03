#!/usr/bin/env tsx
/**
 * Structural verification of Phase 0a discipline files.
 *
 * Promotes two confidence labels from MEDIUM/LOW → HIGH on file
 * correctness:
 *
 *   1. "Agents invokable via Agent tool"
 *      - Verifies `.claude/agents/<name>.md` for the 4 NEW agents (3 from
 *        Phase 0a + 1 from Phase 0a.9 gold-standard-enforcer) has:
 *        * Valid YAML frontmatter (name + description + tools + model)
 *        * Same structural shape as existing 3 registered agents
 *        * Required system-prompt sections (rubric / examples / rules)
 *      - PASS confirms file format matches what Claude Code's agent
 *        registry expects. Runtime registration still gated on session
 *        restart (per claude-code-guide answer: agent registry loads at
 *        session start; new files require restart). Promote runtime to
 *        HIGH only after `Agent({ subagent_type: '<name>', ... })`
 *        succeeds in a fresh session.
 *
 *   2. "Discipline mechanisms persist across sessions"
 *      - Verifies 5 NEW memory files (Phase 0a; Phase 0a.9 reuses
 *        existing `feedback_absolute_gold_standard.md` so no NEW
 *        memory file added at Phase 0a.9; CLAUDE.md §11 documents 6
 *        memory entries total including the reused canonical one) at
 *        ~/.claude/projects/.../memory/feedback_<name>.md have:
 *        * Valid YAML frontmatter (name + description + type)
 *        * Same structural shape as existing memory files
 *        * Required sections (Why / How to apply / Triggers)
 *        * Indexed in MEMORY.md
 *      - PASS confirms file format matches what Claude reads on each
 *        session start. Cross-session "applied" verification still
 *        requires operator running a fresh session and asking Claude
 *        to reference one of the new rules.
 *
 *   3. "Per-deliverable DoD discipline is available"
 *      - Verifies `docs/quality/deliverable-dod-template.md` exists
 *        and includes the canonical sections used by the
 *        `dod-completion-checker` agent.
 *
 * Outputs:
 *   exit 0  — all files pass structural verification (PROMOTE TO HIGH on file correctness)
 *   exit 1  — one or more files fail structural verification (CONFIDENCE STAYS at LOW/MEDIUM)
 *
 * Run: tsx scripts/guards/check-discipline-files-structural.ts
 */

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { REPO_ROOT } from './lib/repoRoot';

// Phase 0a.11 absorb of L5 0a.10 advisory #1: REPO_ROOT now imported from
// `./lib/repoRoot` (single source of truth across discipline guards).
const MEMORY_ROOT = join(homedir(), '.claude/projects/-Users-drprakashkamath-Projects-Signacare/memory');
const DOD_TEMPLATE_PATH = join(REPO_ROOT, 'docs/quality/deliverable-dod-template.md');
const SKIP_MEMORY_CHECKS = process.env.SIGNACARE_DISCIPLINE_SKIP_MEMORY === '1';

interface Verdict {
  file: string;
  pass: boolean;
  notes: string[];
}

const verdicts: Verdict[] = [];

// ─── Agent file structural shape ──────────────────────────────────────────────

interface AgentFrontmatter {
  name: string;
  description: string;
  tools: string;
  model: string;
}

function parseFrontmatter(content: string): { fm: AgentFrontmatter | null; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);
  if (!match) return { fm: null, body: content };
  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const kv = /^(\w+):\s*(.+)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2];
  }
  if (!fm.name || !fm.description || !fm.tools || !fm.model) {
    return { fm: null, body: match[2] };
  }
  return { fm: fm as unknown as AgentFrontmatter, body: match[2] };
}

function checkAgent(filename: string, expectedName: string, requireNewAgentSections: boolean): Verdict {
  const path = join(REPO_ROOT, '.claude/agents', filename);
  const v: Verdict = { file: path, pass: true, notes: [] };
  if (!existsSync(path)) {
    return { ...v, pass: false, notes: ['file does not exist'] };
  }
  const content = readFileSync(path, 'utf8');
  const { fm, body } = parseFrontmatter(content);
  if (!fm) {
    v.pass = false;
    v.notes.push('frontmatter missing or incomplete (need name+description+tools+model)');
    return v;
  }
  if (fm.name !== expectedName) {
    v.pass = false;
    v.notes.push(`name mismatch: file '${expectedName}.md' has frontmatter name='${fm.name}'`);
  }
  if (!['opus', 'sonnet', 'haiku'].some((m) => fm.model.includes(m))) {
    v.pass = false;
    v.notes.push(`model field unrecognized: '${fm.model}' — expected opus|sonnet|haiku`);
  }
  // System prompt header is required for all agents (canonical convention).
  if (!body.toUpperCase().includes('# SYSTEM PROMPT')) {
    v.pass = false;
    v.notes.push("missing '# SYSTEM PROMPT' header");
  }
  // The 3 NEW Layer 0a agents (cycle-2 absorb format) require an
  // explicit RUBRIC + EXAMPLES + RULES section structure. Existing
  // agents predate this convention and use freeform structure —
  // their registration is verified by Claude Code SDK at startup.
  if (requireNewAgentSections) {
    const requiredSections = ['RUBRIC', 'EXAMPLES', 'RULES OF ENGAGEMENT'];
    for (const s of requiredSections) {
      if (!body.toUpperCase().includes(s)) {
        v.pass = false;
        v.notes.push(`missing required section (Layer 0a convention): '${s}'`);
      }
    }
  }
  if (v.pass) {
    v.notes.push(
      requireNewAgentSections
        ? 'OK — frontmatter valid + canonical Layer 0a sections present'
        : 'OK — frontmatter valid (existing-agent convention; freeform body acceptable)',
    );
  }
  return v;
}

// ─── Memory file structural shape ────────────────────────────────────────────

interface MemoryFrontmatter {
  name: string;
  description: string;
  type: string;
}

function parseMemoryFrontmatter(content: string): { fm: MemoryFrontmatter | null; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);
  if (!match) return { fm: null, body: content };
  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const kv = /^(\w+):\s*(.+)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2];
  }
  if (!fm.name || !fm.description || !fm.type) {
    return { fm: null, body: match[2] };
  }
  return { fm: fm as unknown as MemoryFrontmatter, body: match[2] };
}

function checkMemory(filename: string): Verdict {
  const path = join(MEMORY_ROOT, filename);
  const v: Verdict = { file: path, pass: true, notes: [] };
  if (!existsSync(path)) {
    return { ...v, pass: false, notes: ['file does not exist'] };
  }
  const content = readFileSync(path, 'utf8');
  const { fm, body } = parseMemoryFrontmatter(content);
  if (!fm) {
    v.pass = false;
    v.notes.push('frontmatter missing or incomplete (need name+description+type)');
    return v;
  }
  if (!['user', 'feedback', 'project', 'reference'].includes(fm.type)) {
    v.pass = false;
    v.notes.push(`type field unrecognized: '${fm.type}' — expected user|feedback|project|reference`);
  }
  // Memory body must contain actionable guidance — Why and How sections
  const lowerBody = body.toLowerCase();
  if (!lowerBody.includes('**why')) {
    v.pass = false;
    v.notes.push('missing "Why" section (actionable guidance)');
  }
  if (!lowerBody.includes('**how to apply')) {
    v.pass = false;
    v.notes.push('missing "How to apply" section');
  }
  if (!lowerBody.includes('trigger')) {
    v.pass = false;
    v.notes.push('missing "Triggers" guidance');
  }
  if (v.pass) v.notes.push('OK — frontmatter valid + actionable guidance sections present');
  return v;
}

function checkMemoryIndexed(filename: string): Verdict {
  const indexPath = join(MEMORY_ROOT, 'MEMORY.md');
  const v: Verdict = { file: `${indexPath} -> ${filename}`, pass: true, notes: [] };
  if (!existsSync(indexPath)) {
    return { ...v, pass: false, notes: ['MEMORY.md does not exist'] };
  }
  const index = readFileSync(indexPath, 'utf8');
  if (!index.includes(filename)) {
    v.pass = false;
    v.notes.push(`MEMORY.md does not reference '${filename}'`);
  } else {
    v.notes.push(`OK — '${filename}' referenced in MEMORY.md`);
  }
  return v;
}

// Phase 0a.11 absorb of L5 0a.10 advisory #3: export both the snippet list
// AND the function so the adversarial-input fixture imports the canonical
// helper rather than replicating the contract. Closes the deliberate
// two-rail duplication that was acceptable at landing time.
export const CANONICAL_REQUIRED_SNIPPETS: readonly string[] = [
  '# Per-Deliverable Definition-of-Done Template',
  '## Template (paste + adapt per deliverable)',
  '#### Artifact existence',
  '#### Local verification (commands + outputs)',
  '#### Reviewer agents (L1-L5)',
  '#### Discipline agents (Layer 0a — when available)',
  '#### Confidence label',
  'ANY line is unchecked',
];

export function checkSnippetsPresent(content: string, required: readonly string[] = CANONICAL_REQUIRED_SNIPPETS): { pass: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const snippet of required) {
    if (!content.includes(snippet)) missing.push(snippet);
  }
  return { pass: missing.length === 0, missing };
}

export function checkDodTemplate(): Verdict {
  const v: Verdict = { file: DOD_TEMPLATE_PATH, pass: true, notes: [] };
  if (!existsSync(DOD_TEMPLATE_PATH)) {
    return { ...v, pass: false, notes: ['file does not exist'] };
  }
  const content = readFileSync(DOD_TEMPLATE_PATH, 'utf8');
  const result = checkSnippetsPresent(content, CANONICAL_REQUIRED_SNIPPETS);
  if (!result.pass) {
    v.pass = false;
    for (const snippet of result.missing) {
      v.notes.push(`missing required template content: '${snippet}'`);
    }
  } else {
    v.notes.push('OK — DoD template exists with canonical deliverable-checklist sections');
  }
  return v;
}

// ─── Run all checks ─────────────────────────────────────────────────────────
//
// Phase 0a.11: top-level execution wrapped in `main()` so the module is
// import-safe (the adversarial-input fixture test imports
// `checkSnippetsPresent` + `CANONICAL_REQUIRED_SNIPPETS` from this file
// without triggering the verdict-collection / process.exit side effects).
// Convention: only run when invoked directly via `tsx scripts/guards/...`,
// not when imported.

function main(): void {
  console.log('\n=== Phase 0a structural verification ===\n');

  console.log('[1/3] Agent file structural shape (4 NEW with Layer 0a convention [Phase 0a + Phase 0a.9] + 3 EXISTING with freeform body)\n');
  verdicts.push(checkAgent('shortcut-detector.md', 'shortcut-detector', true));
  verdicts.push(checkAgent('confidence-label-enforcer.md', 'confidence-label-enforcer', true));
  verdicts.push(checkAgent('dod-completion-checker.md', 'dod-completion-checker', true));
  // Phase 0a.9 — gold-standard-enforcer (Layer 0a discipline, paired with check-no-band-aid-annotations.ts guard)
  verdicts.push(checkAgent('gold-standard-enforcer.md', 'gold-standard-enforcer', true));
  // Existing agents — frontmatter parity check only; body convention is freeform (predates Layer 0a)
  verdicts.push(checkAgent('architecture-reviewer.md', 'architecture-reviewer', false));
  verdicts.push(checkAgent('clinical-safety-reviewer.md', 'clinical-safety-reviewer', false));
  verdicts.push(checkAgent('code-reviewer-general.md', 'code-reviewer-general', false));

  console.log('[2/3] Deliverable DoD template structure\n');
  verdicts.push(checkDodTemplate());

  if (SKIP_MEMORY_CHECKS) {
    console.log('[3/3] Memory file structural shape + indexed in MEMORY.md\n');
    console.log('⚠ SKIP  Memory checks disabled via SIGNACARE_DISCIPLINE_SKIP_MEMORY=1');
    console.log('         Repo/CI mode can verify repo-backed discipline files only;');
    console.log('         local ~/.claude memory persistence still requires a local run.\n');
  } else {
    console.log('[3/3] Memory file structural shape + indexed in MEMORY.md\n');
    const memFiles = [
      'feedback_audit_vs_walkthrough.md',
      'feedback_per_deliverable_dod.md',
      'feedback_phase_boundary_signoff.md',
      'feedback_confidence_labels.md',
      'feedback_honesty_triggers.md',
    ];
    for (const m of memFiles) {
      verdicts.push(checkMemory(m));
      verdicts.push(checkMemoryIndexed(m));
    }
  }

  // ─── Output ─────────────────────────────────────────────────────────────────

  let failures = 0;
  for (const v of verdicts) {
    const tag = v.pass ? '✓ PASS' : '✗ FAIL';
    console.log(`${tag}  ${v.file}`);
    for (const n of v.notes) console.log(`         ${n}`);
    if (!v.pass) failures++;
  }

  console.log(`\nTotal: ${verdicts.length} checks; PASS: ${verdicts.length - failures}; FAIL: ${failures}\n`);

  if (failures === 0) {
    printPostSuccessProtocol(SKIP_MEMORY_CHECKS);
    process.exit(0);
  } else {
    console.log('=== STRUCTURAL VERIFICATION: FAIL ===');
    console.log('Confidence labels stay at MEDIUM/LOW until structural failures fixed.');
    process.exit(1);
  }
}

// Phase 0a.11 absorb of L5 0a.9b advisory #1: extract `printAgentInvocationProtocol()`
// helper. Steps 1-5 were byte-identical between the SKIP_MEMORY and full-memory
// branches (~25 LOC duplicated). Now in one place; only the memory-verification
// step diverges.
function printAgentInvocationProtocol(): void {
  console.log('  Step 1 — exit current Claude Code session');
  console.log('  Step 2 — start a fresh Claude Code session in this repo');
  console.log('');
  console.log('  Agent invocation test:');
  console.log('    Step 3 — invoke shortcut-detector via Agent tool with Fixture 1 input');
  console.log('             (see .claude/agents/__fixtures__/shortcut-detector-fixtures.md)');
  console.log('    Step 4 — verify verdict matches expected: [BLOCK] with 7+ trigger matches');
  console.log('    Step 5 — repeat for confidence-label-enforcer + dod-completion-checker');
  console.log('    PASS → "Agents invokable" RUNTIME confidence: HIGH');
  console.log('');
}

function printPostSuccessProtocol(skipMemory: boolean): void {
  console.log('=== STRUCTURAL VERIFICATION: PASS ===');
  console.log('');
  console.log('Confidence promotions earned (file correctness HIGH):');
  console.log('');
  console.log('  - "Agents invokable via Agent tool" file format: HIGH');
  console.log('    (Runtime registration still gated on session restart per claude-code-guide answer.');
  console.log('     Operator validates by running the post-restart protocol below.)');
  console.log('');

  if (skipMemory) {
    console.log('  - "Discipline mechanisms persist across sessions" file format: NOT VERIFIED IN THIS RUN');
    console.log('    (SIGNACARE_DISCIPLINE_SKIP_MEMORY=1 skips ~/.claude memory checks for repo/CI mode.)');
    console.log('    (Run locally without the skip flag to verify memory files + MEMORY.md indexing.)');
    console.log('');
    console.log('=== POST-RESTART VERIFICATION PROTOCOL ===');
    console.log('');
    console.log('To promote agent runtime to HIGH after a repo/CI pass:');
    console.log('');
    printAgentInvocationProtocol();
    console.log('  Separate local-memory verification:');
    console.log('    Step 6 — run this guard locally WITHOUT SIGNACARE_DISCIPLINE_SKIP_MEMORY=1');
    console.log('    Step 7 — confirm the 5 memory files + MEMORY.md index PASS');
    console.log('');
  } else {
    console.log('  - "Discipline mechanisms persist across sessions" file format: HIGH');
    console.log('    (Cross-session application gated on next session reading MEMORY.md.');
    console.log('     Operator validates by running the cross-session protocol below.)');
    console.log('');
    console.log('=== POST-RESTART VERIFICATION PROTOCOL ===');
    console.log('');
    console.log('To promote BOTH items to HIGH on RUNTIME (not just file correctness):');
    console.log('');
    printAgentInvocationProtocol();
    console.log('  Cross-session persistence test:');
    console.log('    Step 6 — in fresh session, ask Claude: "what discipline rule applies when');
    console.log('             I claim something is comprehensive?"');
    console.log('    Step 7 — Claude should reference feedback_audit_vs_walkthrough.md and');
    console.log('             explain audit-vs-walkthrough distinction');
    console.log('    Step 8 — repeat for each of the 5 new memory entries');
    console.log('    PASS → "Discipline persists across sessions" RUNTIME confidence: HIGH');
    console.log('');
  }
}

// Only run main() when invoked directly (not when imported by tests).
// `require.main === module` is the CommonJS pattern; this script runs as
// CJS under tsx since the workspace package.json has no `"type": "module"`.
if (require.main === module) {
  main();
}
