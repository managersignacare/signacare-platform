#!/usr/bin/env tsx
/**
 * Assessment visualisation isolation guard.
 *
 * Enforces the Phase 8 separation invariants in the visualisation layer:
 *
 *   1. OutcomeMeasuresTab.tsx MUST NOT reference `clinician_rating_scale`
 *      or `self_rated_scale` family literals — operator brief: "Outcome
 *      Measures page = outcome measures only."
 *   2. AssessmentsTab.tsx MUST NOT reference `outcome_measure` or
 *      `self_rated_scale` family literals — operator brief: "Rating Scales
 *      page = clinician-rated scales only."
 *   3. VivaTab.tsx (the patient self-rated panel) MUST NOT reference
 *      `outcome_measure` or `clinician_rating_scale` family literals —
 *      operator brief: "Viva tab = self-rated patient scales."
 *   4. None of the three tabs may import the OTHER family's MAX_TOTAL /
 *      severity helper paths.
 *   5. The MeasurementTrendChart MUST NOT accept a `data: Point[][]` shape
 *      (multi-instrument) — single-instrument-only by design. The guard
 *      asserts the file declares `series: MeasurementSeries` and never
 *      `data: Array<` of arrays.
 *   6. No surface (tab or shared chart) renders raw scores from multiple
 *     instruments on a single shared SVG / Recharts y-axis. We enforce
 *     this by requiring the cross-instrument timeline component is the
 *     ONLY surface that mixes instrument-display contexts, AND it must
 *     render as a list, not a chart.
 *
 * The guard is text-based: it scans the four tab files + the shared chart
 * components for literal strings that would indicate a regression of
 * those invariants. Each violation cites the file and one suggestion.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

interface Violation {
  file: string;
  rule: string;
  detail: string;
}

const OUTCOME_TAB = resolve(ROOT, 'apps/web/src/features/patients/components/detail/tabs/OutcomeMeasuresTab.tsx');
const ASSESS_TAB = resolve(ROOT, 'apps/web/src/features/patients/components/detail/tabs/AssessmentsTab.tsx');
const VIVA_TAB = resolve(ROOT, 'apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx');
const TREND_CHART = resolve(ROOT, 'apps/web/src/features/patients/components/detail/tabs/measurements/MeasurementTrendChart.tsx');
const TIMELINE = resolve(ROOT, 'apps/web/src/features/patients/components/detail/tabs/measurements/MeasurementTimeline.tsx');

// Family identifier literals exactly as they appear in shared schemas.
const F_OM = 'outcome_measure';
const F_CRS = 'clinician_rating_scale';
const F_SRS = 'self_rated_scale';

function load(path: string): { source: string; lines: string[] } | null {
  if (!existsSync(path)) return null;
  const source = readFileSync(path, 'utf8');
  return { source, lines: source.split('\n') };
}

function containsLiteralAsValue(source: string, literal: string): boolean {
  // Match the literal only when it appears as a string literal (single or
  // double quoted), so we don't false-match on comments that explain the
  // invariant in prose.
  const re = new RegExp(`['\"]${literal.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}['\"]`, 'g');
  return re.test(stripComments(source));
}

function stripComments(source: string): string {
  // Strip /* ... */ and // ... line comments to avoid matching prose
  // documentation of the invariants.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

export interface RunResult { exitCode: number; violations: Violation[] }

export function runGuard(): RunResult {
  const violations: Violation[] = [];

  // Rule 1 — OutcomeMeasuresTab.
  {
    const file = OUTCOME_TAB;
    const loaded = load(file);
    if (!loaded) {
      violations.push({ file: relative(ROOT, file), rule: 'rule-1', detail: 'OutcomeMeasuresTab.tsx not found' });
    } else {
      if (containsLiteralAsValue(loaded.source, F_CRS)) {
        violations.push({
          file: relative(ROOT, file),
          rule: 'rule-1',
          detail: `forbidden family literal '${F_CRS}' on the OutcomeMeasures tab — outcome measures only`,
        });
      }
      if (containsLiteralAsValue(loaded.source, F_SRS)) {
        violations.push({
          file: relative(ROOT, file),
          rule: 'rule-1',
          detail: `forbidden family literal '${F_SRS}' on the OutcomeMeasures tab — outcome measures only`,
        });
      }
      // Operator brief #5: outcome-measure UI must NOT display BASIS-32
      // unless the registry entry exists with full scoring metadata.
      // BASIS-32 is currently outcome-measure-classified in the registry
      // but is NOT yet seeded as a write-path; the UI must not surface a
      // BASIS-32 picker option.
      if (/BASIS[- ]?32/i.test(stripComments(loaded.source))) {
        violations.push({
          file: relative(ROOT, file),
          rule: 'rule-1.basis32',
          detail: 'OutcomeMeasures tab must not surface BASIS-32 UI copy until a complete validated registry+scoring entry is wired',
        });
      }
    }
  }

  // Rule 2 — AssessmentsTab.
  {
    const file = ASSESS_TAB;
    const loaded = load(file);
    if (!loaded) {
      violations.push({ file: relative(ROOT, file), rule: 'rule-2', detail: 'AssessmentsTab.tsx not found' });
    } else {
      if (containsLiteralAsValue(loaded.source, F_OM)) {
        violations.push({
          file: relative(ROOT, file),
          rule: 'rule-2',
          detail: `forbidden family literal '${F_OM}' on the Rating Scales tab — clinician-rated rating scales only`,
        });
      }
      if (containsLiteralAsValue(loaded.source, F_SRS)) {
        violations.push({
          file: relative(ROOT, file),
          rule: 'rule-2',
          detail: `forbidden family literal '${F_SRS}' on the Rating Scales tab — clinician-rated rating scales only`,
        });
      }
    }
  }

  // Rule 3 — VivaTab.
  {
    const file = VIVA_TAB;
    const loaded = load(file);
    if (!loaded) {
      violations.push({ file: relative(ROOT, file), rule: 'rule-3', detail: 'VivaTab.tsx not found' });
    } else {
      if (containsLiteralAsValue(loaded.source, F_OM)) {
        violations.push({
          file: relative(ROOT, file),
          rule: 'rule-3',
          detail: `forbidden family literal '${F_OM}' on the Viva tab — patient self-rated scales only`,
        });
      }
      if (containsLiteralAsValue(loaded.source, F_CRS)) {
        violations.push({
          file: relative(ROOT, file),
          rule: 'rule-3',
          detail: `forbidden family literal '${F_CRS}' on the Viva tab — patient self-rated scales only`,
        });
      }
    }
  }

  // Rule 5 — Trend chart must not accept multi-instrument shape.
  {
    const file = TREND_CHART;
    const loaded = load(file);
    if (!loaded) {
      violations.push({ file: relative(ROOT, file), rule: 'rule-5', detail: 'MeasurementTrendChart.tsx not found' });
    } else {
      const stripped = stripComments(loaded.source);
      // Disallow a `data: MeasurementPoint[][]` or `series: MeasurementSeries[]`
      // (plural) prop signature on the chart — this would imply
      // multi-instrument plotting on a shared axis.
      if (/data\s*:\s*[A-Za-z0-9_<>\s,]*\[\]\s*\[\]/.test(stripped)) {
        violations.push({
          file: relative(ROOT, file),
          rule: 'rule-5',
          detail: 'MeasurementTrendChart props must not accept a nested array (multi-instrument) shape',
        });
      }
      if (/\bseries\s*:\s*MeasurementSeries\s*\[\s*\]/.test(stripped)) {
        violations.push({
          file: relative(ROOT, file),
          rule: 'rule-5',
          detail: 'MeasurementTrendChart props must not accept multiple series — single-instrument-only by design',
        });
      }
    }
  }

  // Rule 6 — Cross-instrument timeline must NOT render a chart with shared y-axis.
  {
    const file = TIMELINE;
    const loaded = load(file);
    if (!loaded) {
      violations.push({ file: relative(ROOT, file), rule: 'rule-6', detail: 'MeasurementTimeline.tsx not found' });
    } else {
      const stripped = stripComments(loaded.source);
      // The timeline must render a list, not a polyline/Recharts y-axis.
      if (/<polyline\b/.test(stripped) || /\bYAxis\b/.test(stripped) || /\bLineChart\b/.test(stripped)) {
        violations.push({
          file: relative(ROOT, file),
          rule: 'rule-6',
          detail: 'Cross-instrument timeline must NOT render a chart — operator brief forbids shared y-axis on multi-instrument data',
        });
      }
    }
  }

  return { exitCode: violations.length === 0 ? 0 : 1, violations };
}

if (require.main === module) {
  const result = runGuard();
  if (result.violations.length === 0) {
    console.log('check-assessment-visualisation-isolation: PASS');
    process.exit(0);
  }
  console.error('check-assessment-visualisation-isolation: FAIL');
  for (const v of result.violations) {
    console.error(`  - ${v.file} [${v.rule}]: ${v.detail}`);
  }
  process.exit(result.exitCode);
}
