#!/usr/bin/env tsx
// scripts/qa-agent/level-2-narrative.ts
//
// Signacare EMR QA Agent — Level 2 (narrative + protocol adherence)
//
// Parses the PR body and validates 13 narrative + artefact-backing checks.
// Exits non-zero on any violation.
//
// Usage:
//   tsx scripts/qa-agent/level-2-narrative.ts --pr-body pr.md
//   tsx scripts/qa-agent/level-2-narrative.ts < pr-body.md
//   PR_BODY="$(cat pr.md)" tsx scripts/qa-agent/level-2-narrative.ts

import { readFileSync } from 'node:fs';

interface Violation {
  check: string;
  severity: 'error' | 'warn';
  quote: string;
  message: string;
}

interface Report {
  passed: boolean;
  violations: Violation[];
  sections_detected: string[];
  duration_ms: number;
}

// ─────────────────────────────────────────────────────────────
// PR body input
// ─────────────────────────────────────────────────────────────

function readPrBody(): string {
  const argv = process.argv.slice(2);
  const fileIdx = argv.indexOf('--pr-body');
  if (fileIdx !== -1 && argv[fileIdx + 1]) {
    return readFileSync(argv[fileIdx + 1], 'utf8');
  }
  if (process.env.PR_BODY) return process.env.PR_BODY;
  // Stdin fallback
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────────────────────
// Section parser
// ─────────────────────────────────────────────────────────────

const REQUIRED_SECTIONS = [
  'DIAGNOSIS',
  'APPROACH',
  'IMPLEMENTATION',
  'TESTS',
  'VERIFICATION',
  'RESIDUAL RISK',
  'CHANGE METADATA',
] as const;

type Section = (typeof REQUIRED_SECTIONS)[number];

function parseSections(body: string): Record<Section, string | null> {
  const sections: Record<Section, string | null> = {
    DIAGNOSIS: null,
    APPROACH: null,
    IMPLEMENTATION: null,
    TESTS: null,
    VERIFICATION: null,
    'RESIDUAL RISK': null,
    'CHANGE METADATA': null,
  };
  // Match ## HEADER lines, capture content until next ## or end
  const regex = /^##\s+(DIAGNOSIS|APPROACH|IMPLEMENTATION|TESTS|VERIFICATION|RESIDUAL RISK|CHANGE METADATA)\s*$([\s\S]*?)(?=^##\s|$(?![\r\n]))/gm;
  let match;
  while ((match = regex.exec(body)) !== null) {
    const sec = match[1] as Section;
    sections[sec] = match[2].trim();
  }
  return sections;
}

// ─────────────────────────────────────────────────────────────
// CHECKS L2.1–L2.13
// ─────────────────────────────────────────────────────────────

// L2.1 — pr-body-format
function checkPrBodyFormat(sections: Record<Section, string | null>): Violation[] {
  const violations: Violation[] = [];
  for (const sec of REQUIRED_SECTIONS) {
    if (!sections[sec] || sections[sec]!.length < 10) {
      violations.push({
        check: 'L2.1 pr-body-format',
        severity: 'error',
        quote: `## ${sec}`,
        message: `Required section '${sec}' missing or empty. PR body must contain all 7 sections.`,
      });
    }
  }
  return violations;
}

// L2.2 — diagnosis-one-sentence
function checkDiagnosisOneSentence(sections: Record<Section, string | null>): Violation[] {
  const body = sections.DIAGNOSIS;
  if (!body) return [];
  const rcMatch = body.match(/Root cause:\s*(.+?)(?:\n|$)/);
  if (!rcMatch) {
    return [{
      check: 'L2.2 diagnosis-one-sentence',
      severity: 'error',
      quote: body.slice(0, 100),
      message: `DIAGNOSIS section must contain 'Root cause: <one sentence>'`,
    }];
  }
  const sentence = rcMatch[1].trim();
  if (sentence.length > 200) {
    return [{
      check: 'L2.2 diagnosis-one-sentence',
      severity: 'error',
      quote: sentence.slice(0, 100) + '...',
      message: `Root cause sentence is ${sentence.length} chars; must be ≤200. If longer, the root cause is not yet understood.`,
    }];
  }
  if (sentence.split('.').filter((s) => s.trim().length > 5).length > 1) {
    return [{
      check: 'L2.2 diagnosis-one-sentence',
      severity: 'warn',
      quote: sentence,
      message: `Root cause contains multiple sentences. Should be one.`,
    }];
  }
  return [];
}

// L2.3 — classification-stated
function checkClassificationStated(sections: Record<Section, string | null>): Violation[] {
  const body = sections.DIAGNOSIS;
  if (!body) return [];
  const match = body.match(/Classification:\s*(isolated|symptomatic|structural)\b/);
  if (!match) {
    return [{
      check: 'L2.3 classification-stated',
      severity: 'error',
      quote: body.slice(0, 100),
      message: `DIAGNOSIS must state 'Classification: <isolated | symptomatic | structural>'`,
    }];
  }
  const cls = match[1];
  if (cls === 'symptomatic') {
    const otherMatch = body.match(/Other instances:\s*(.+)/);
    if (!otherMatch || (!otherMatch[1].includes('none found') && otherMatch[1].trim().length < 10)) {
      return [{
        check: 'L2.3 classification-stated',
        severity: 'error',
        quote: otherMatch?.[0] ?? '(missing)',
        message: `Symptomatic classification requires 'Other instances: <list>' OR 'Other instances: none found after grep <pattern>'`,
      }];
    }
  }
  return [];
}

// L2.4 — pattern-reference-given
function checkPatternReferenceGiven(sections: Record<Section, string | null>): Violation[] {
  const body = sections.APPROACH;
  if (!body) return [];
  const match = body.match(/Follows existing pattern in:\s*(\S+)/);
  if (!match) {
    return [{
      check: 'L2.4 pattern-reference-given',
      severity: 'error',
      quote: body.slice(0, 100),
      message: `APPROACH must cite 'Follows existing pattern in: <file:line>' or explicitly 'N/A — net-new pattern with CAB approval'`,
    }];
  }
  const ref = match[1];
  if (!ref.includes(':') && !/N\/A/.test(ref)) {
    return [{
      check: 'L2.4 pattern-reference-given',
      severity: 'warn',
      quote: match[0],
      message: `Pattern reference should include file:line, not just file name`,
    }];
  }
  return [];
}

// L2.5 — implementation-no-placeholders
function checkImplementationNoPlaceholders(sections: Record<Section, string | null>): Violation[] {
  const body = sections.IMPLEMENTATION;
  if (!body) return [];
  const violations: Violation[] = [];
  const forbidden = [/TODO/, /FIXME/, /placeholder/i, /extend\s+later/i, /\.\.\.\s*$/m, /for now/i];
  for (const pattern of forbidden) {
    const match = body.match(pattern);
    if (match) {
      violations.push({
        check: 'L2.5 implementation-no-placeholders',
        severity: 'error',
        quote: match[0],
        message: `IMPLEMENTATION contains placeholder/TODO language: '${match[0]}'. Fix must be complete.`,
      });
    }
  }
  return violations;
}

// L2.6 — tests-assert-specific
function checkTestsAssertSpecific(sections: Record<Section, string | null>): Violation[] {
  const body = sections.TESTS;
  if (!body) return [];
  const violations: Violation[] = [];
  const weakPatterns = [/toBeDefined\(\s*\)(?!\.)/, /toBeTruthy\(\s*\)(?!\.)/, /toBeFalsy\(\s*\)(?!\.)/];
  for (const p of weakPatterns) {
    const match = body.match(p);
    if (match) {
      // Check if accompanied by a specific assertion on same test block
      // Heuristic: look for another assertion within 3 lines
      const idx = body.indexOf(match[0]);
      const window = body.slice(idx, idx + 300);
      const hasSpecific = /toBe\(\s*[^)]*\)/.test(window) || /toEqual\(/.test(window) || /toStrictEqual\(/.test(window) || /toContain\(/.test(window);
      if (!hasSpecific) {
        violations.push({
          check: 'L2.6 tests-assert-specific',
          severity: 'error',
          quote: match[0],
          message: `Bare '${match[0]}' assertion without a specific value check. Mutation-insufficient.`,
        });
      }
    }
  }
  // Count assertions — require ≥3
  const assertions = (body.match(/expect\s*\(/g) ?? []).length;
  if (assertions < 3) {
    violations.push({
      check: 'L2.6 tests-assert-specific',
      severity: 'error',
      quote: `${assertions} expect() calls`,
      message: `Only ${assertions} assertion(s). Minimum 3: regression + 2 boundary cases.`,
    });
  }
  return violations;
}

// L2.7 — verification-traces-explicit
function checkVerificationTracesExplicit(sections: Record<Section, string | null>): Violation[] {
  const body = sections.VERIFICATION;
  if (!body) return [];
  const traces = [
    'Original failing scenario',
    'Null/empty input',
    'Concurrent/race',
    'Max payload',
  ];
  const violations: Violation[] = [];
  for (const t of traces) {
    if (!new RegExp(`${t.replace(/\//g, '.?')}`, 'i').test(body)) {
      violations.push({
        check: 'L2.7 verification-traces-explicit',
        severity: 'error',
        quote: t,
        message: `VERIFICATION missing trace for '${t}'. Must be explicit result OR 'N/A: <reason>'`,
      });
    }
  }
  return violations;
}

// L2.8 — residual-risk-honest
function checkResidualRiskHonest(sections: Record<Section, string | null>): Violation[] {
  const body = sections['RESIDUAL RISK'];
  if (!body) return [];
  const violations: Violation[] = [];
  if (/^(none|no risk|nothing)/i.test(body.trim())) {
    violations.push({
      check: 'L2.8 residual-risk-honest',
      severity: 'error',
      quote: body.slice(0, 80),
      message: `Residual risk stated as 'none' — not honest. Every non-trivial change has some residual risk.`,
    });
  }
  if (!/What catches it/i.test(body) && !/accepted risk/i.test(body)) {
    violations.push({
      check: 'L2.8 residual-risk-honest',
      severity: 'error',
      quote: body.slice(0, 100),
      message: `Residual risk must name 'What catches it: <test/monitoring>' OR 'accepted risk: <rationale>'`,
    });
  }
  return violations;
}

// L2.9 — audit-points-cited
function checkAuditPointsCited(body: string, changeClass: string | null): Violation[] {
  const match = body.match(/Audit-Points:\s*(.+)/);
  if (!match) {
    return [{
      check: 'L2.9 audit-points-cited',
      severity: 'error',
      quote: '(not found)',
      message: `CHANGE METADATA must contain 'Audit-Points: #N, #N, ...' citing the 13-point audit`,
    }];
  }
  const points = match[1].split(',').map((s) => s.trim()).filter(Boolean);
  const expected = changeClass === 'trivial' ? 1 : changeClass === 'standard' ? 2 : 4;
  if (points.length < expected) {
    return [{
      check: 'L2.9 audit-points-cited',
      severity: 'error',
      quote: match[1],
      message: `Change-Class='${changeClass}' requires ≥${expected} audit points cited; got ${points.length}`,
    }];
  }
  return [];
}

// L2.10 — bug-fix-6-step-discoverable
function checkBugFix6StepDiscoverable(sections: Record<Section, string | null>): Violation[] {
  const violations: Violation[] = [];
  const stepMap: Record<string, Section> = {
    'STEP 1 DIAGNOSE': 'DIAGNOSIS',
    'STEP 2 CLASSIFY': 'DIAGNOSIS',
    'STEP 3 VERIFY SCOPE': 'APPROACH',
    'STEP 4 FIX': 'IMPLEMENTATION',
    'STEP 5 HARDEN': 'TESTS',
    'STEP 6 VERIFY': 'VERIFICATION',
  };
  for (const [step, sec] of Object.entries(stepMap)) {
    if (!sections[sec] || sections[sec]!.length < 20) {
      violations.push({
        check: 'L2.10 bug-fix-6-step-discoverable',
        severity: 'error',
        quote: step,
        message: `Cannot map ${step} to PR section '${sec}' (missing or too short)`,
      });
    }
  }
  return violations;
}

// L2.11 — no-guess-language
function checkNoGuessLanguage(body: string): Violation[] {
  const violations: Violation[] = [];
  const banned = [
    /\bI\s+assume\b/i,
    /\bprobably\b/i,
    /\bshould\s+work\b/i,
    /\blikely\b/i,
    /\bseems\s+to\b/i,
    /\bmight\s+be\b/i,
    /\bappears\s+to\b/i,
  ];
  for (const p of banned) {
    const match = body.match(p);
    if (match) {
      const idx = body.indexOf(match[0]);
      const surrounding = body.slice(Math.max(0, idx - 40), Math.min(body.length, idx + 60));
      violations.push({
        check: 'L2.11 no-guess-language',
        severity: 'error',
        quote: surrounding,
        message: `Guess language detected: '${match[0]}'. Re-read source to replace with verified fact.`,
      });
    }
  }
  return violations;
}

// L2.12 — escalation-compliance
function checkEscalationCompliance(body: string): Violation[] {
  if (!/I need to see/i.test(body)) return [];
  // If PR body contains 'I need to see X', it must also have:
  // - A Verification trace showing the read happened, OR
  // - An explicit 'blocked-on-user-clarification' label
  if (!/Read tool/i.test(body) && !/blocked[- ]on[- ]user[- ]clarification/i.test(body) && !/See:.*\.ts/.test(body)) {
    return [{
      check: 'L2.12 escalation-compliance',
      severity: 'error',
      quote: body.match(/I need to see.*?\./i)?.[0] ?? 'I need to see',
      message: `'I need to see X' declared but no evidence of read OR 'blocked-on-user-clarification' label`,
    }];
  }
  return [];
}

// L2.13 — artefact-backed-claims (new per v4.0 D.6)
function checkArtefactBackedClaims(body: string): Violation[] {
  const violations: Violation[] = [];
  // Claim types that REQUIRE an artefact block

  // "Root cause is X" — require psql/grep/stack-trace evidence nearby
  const rcMatch = body.match(/Root cause:\s*(.+?)(?:\n|$)/);
  if (rcMatch) {
    const afterSection = body.slice(body.indexOf(rcMatch[0])).slice(0, 2000);
    const hasEvidence = /psql|\$\s*rg|\$\s*grep|error TS|KnexTimeoutError|AssertionError|\d+\s+lines/i.test(afterSection);
    if (!hasEvidence) {
      violations.push({
        check: 'L2.13 artefact-backed-claims',
        severity: 'warn',
        quote: rcMatch[0],
        message: `Root cause claim has no evidence artefact (expected psql output, grep output, or test-failure trace in PR body)`,
      });
    }
  }

  // "Other instances: none found" — require grep output
  const noneMatch = body.match(/Other instances:\s*none found(?!\s+after\s+grep)/i);
  if (noneMatch) {
    violations.push({
      check: 'L2.13 artefact-backed-claims',
      severity: 'error',
      quote: noneMatch[0],
      message: `'Other instances: none found' must include grep command: 'none found after grep <pattern>'`,
    });
  }

  // "Test catches regression" without pre-fix FAIL and post-fix PASS output
  if (/Test catches regression/i.test(body) || /would have caught/i.test(body)) {
    const hasPreFail = /Pre-fix.*FAIL/i.test(body) || /BEFORE fix.*fail/i.test(body);
    const hasPostPass = /Post-fix.*PASS/i.test(body) || /AFTER fix.*pass/i.test(body) || /\d+\s+passed/.test(body);
    if (!hasPreFail || !hasPostPass) {
      violations.push({
        check: 'L2.13 artefact-backed-claims',
        severity: 'error',
        quote: 'Test catches regression',
        message: `Claim 'test catches regression' requires both pre-fix FAIL and post-fix PASS output in PR body`,
      });
    }
  }

  return violations;
}

// ─────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────

function main(): void {
  const start = Date.now();
  const body = readPrBody();

  if (!body || body.length < 100) {
    console.error(JSON.stringify({ passed: false, violations: [{ check: 'L2.0 input', severity: 'error', quote: '', message: 'PR body empty or too short' }], sections_detected: [], duration_ms: 0 }, null, 2));
    process.exit(1);
  }

  const sections = parseSections(body);
  const detected = (Object.entries(sections).filter(([, v]) => v !== null).map(([k]) => k)) as Section[];

  const classMatch = body.match(/Change-Class:\s*(trivial|standard|risky)/);
  const changeClass = classMatch?.[1] ?? null;

  const all: Violation[] = [];
  all.push(...checkPrBodyFormat(sections));
  all.push(...checkDiagnosisOneSentence(sections));
  all.push(...checkClassificationStated(sections));
  all.push(...checkPatternReferenceGiven(sections));
  all.push(...checkImplementationNoPlaceholders(sections));
  all.push(...checkTestsAssertSpecific(sections));
  all.push(...checkVerificationTracesExplicit(sections));
  all.push(...checkResidualRiskHonest(sections));
  all.push(...checkAuditPointsCited(body, changeClass));
  all.push(...checkBugFix6StepDiscoverable(sections));
  all.push(...checkNoGuessLanguage(body));
  all.push(...checkEscalationCompliance(body));
  all.push(...checkArtefactBackedClaims(body));

  const report: Report = {
    passed: all.filter((v) => v.severity === 'error').length === 0,
    violations: all,
    sections_detected: detected,
    duration_ms: Date.now() - start,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.passed ? 0 : 1);
}

main();
