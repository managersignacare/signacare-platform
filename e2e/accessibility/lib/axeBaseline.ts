import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AxeResults, Result } from 'axe-core';

const BASELINE_PATH = resolve(__dirname, '..', 'a11y-baseline-allowlist.json');
const CRITICAL_IMPACTS = new Set(['critical', 'serious']);

interface BaselineEntry {
  surface: string;
  impact: 'critical' | 'serious';
  ruleId: string;
  bugId: string;
  expiresOn: string;
  reason: string;
}

interface BaselineFile {
  version: number;
  generatedAt: string;
  sourceCommand: string;
  entries: BaselineEntry[];
}

let baselineCache: BaselineFile | null = null;

function loadBaseline(): BaselineFile {
  if (baselineCache) return baselineCache;
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as BaselineFile;
  baselineCache = parsed;
  return parsed;
}

function toKey(surface: string, impact: string | null | undefined, ruleId: string): string {
  return `${surface}|${impact ?? 'unknown'}|${ruleId}`;
}

function collectCriticalSerious(results: AxeResults): Array<Result & { impact: 'critical' | 'serious' }> {
  return results.violations.filter(
    (v): v is Result & { impact: 'critical' | 'serious' } =>
      CRITICAL_IMPACTS.has(v.impact ?? '') && (v.impact === 'critical' || v.impact === 'serious'),
  );
}

export function assertCriticalSeriousWithinBaseline(surface: string, results: AxeResults): void {
  const criticals = collectCriticalSerious(results);
  if (criticals.length === 0) return;

  const baseline = loadBaseline();
  const baselineByKey = new Map<string, BaselineEntry>();
  for (const entry of baseline.entries) {
    baselineByKey.set(toKey(entry.surface, entry.impact, entry.ruleId), entry);
  }

  const unknown: Array<Result & { impact: 'critical' | 'serious' }> = [];
  const matched: BaselineEntry[] = [];
  for (const violation of criticals) {
    const entry = baselineByKey.get(toKey(surface, violation.impact, violation.id));
    if (entry) {
      matched.push(entry);
      continue;
    }
    unknown.push(violation);
  }

  if (matched.length > 0) {
    const bugSet = [...new Set(matched.map((m) => m.bugId))].join(', ');
    const ids = [...new Set(matched.map((m) => `${m.impact}:${m.ruleId}`))].join(', ');
    console.log(
      `[a11y-baseline] ${surface}: suppressed ${matched.length} known critical/serious violations (${ids}) mapped to ${bugSet}.`,
    );
  }

  if (unknown.length === 0) return;

  const formatted = unknown
    .map((v) => `  [${v.impact}] ${v.id}: ${v.help} — ${v.helpUrl}`)
    .join('\n');
  throw new Error(
    `Axe found ${unknown.length} NEW critical/serious WCAG violations on ${surface} (outside baseline allowlist):\n${formatted}`,
  );
}

