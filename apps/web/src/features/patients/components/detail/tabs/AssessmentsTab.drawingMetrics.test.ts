/**
 * Source-level contract test for AssessmentsTab drawing-metrics strip
 * (P-CLAUDE-LANE 4B/5).
 *
 * Pins the read-back analytics integration: each captured drawing in
 * the expand-view renders a small chip row below its canvas surfacing
 * the clinically relevant stroke characteristics (count, cumulative
 * pen-down time, mean pressure, canvas coverage). The chips are derived
 * from the canonical drawingAnalytics module in @signacare/shared, so
 * the .NET parity reads the same numbers when the same payload is
 * passed through `computeDrawingMetrics`.
 *
 * Why source-level: apps/web/vitest.config.ts is pure-logic only (no
 * JSDOM). The metric VALUES are exhaustively covered by
 * drawingAnalytics.test.ts (14 cases) and drawingField.test.ts
 * formatter cases. This file pins the integration's wiring at the
 * AssessmentsTab source level so a future refactor cannot silently
 * remove the chip row without the test failing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AssessmentsTab — captured-drawings metrics strip (read-back)', () => {
  const source = readFileSync(resolve(__dirname, './AssessmentsTab.tsx'), 'utf8');

  it('imports the canonical describeCapturedDrawingChips formatter from the shared component path', () => {
    expect(source).toMatch(/describeCapturedDrawingChips/);
    expect(source).toMatch(/from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/shared\/components\/drawingField'/);
  });

  it('imports readDrawingFieldValue to bridge persisted JSON → DrawingPayload before metrics', () => {
    expect(source).toContain('readDrawingFieldValue');
  });

  it('derives the chip labels from the persisted payload via the canonical helpers', () => {
    // Pin the bridge: the chip array is the result of
    // describeCapturedDrawingChips(readDrawingFieldValue(drawing.payload)).
    // A regression that bypasses readDrawingFieldValue would drop the
    // null-safety wrapper and could crash on a corrupt cell.
    expect(source).toContain('describeCapturedDrawingChips(');
    expect(source).toMatch(/readDrawingFieldValue\(\s*drawing\.payload\s*\)/);
  });

  it('renders the metrics strip behind a length-guarded check', () => {
    // Empty chip arrays (e.g. when the payload failed to parse) must
    // NOT render an empty container box — keeps the expand-view tidy.
    expect(source).toMatch(/metricsChips\.length\s*>\s*0/);
  });

  it('renders each chip via the MUI Chip primitive with an outlined variant', () => {
    // Pin the chip shape so a refactor doesn't accidentally inline-render
    // labels as <Typography> rows — the operator brief explicitly
    // requested a compact chip strip for the metrics analytics.
    expect(source).toMatch(/metricsChips\.map\(\(label, ci\) =>[\s\S]{0,400}<Chip/);
    expect(source).toMatch(/<Chip[\s\S]{0,400}label=\{label\}/);
    expect(source).toMatch(/<Chip[\s\S]{0,400}variant="outlined"/);
  });

  it('attaches an aria-label to the metrics strip container for screen readers', () => {
    // The chip row carries an accessible name so AT users hear
    // "Drawing metrics" before traversing the chip list.
    expect(source).toContain('aria-label="Drawing metrics"');
  });
});
