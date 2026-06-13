/**
 * Source-level contract test for AssessmentsTab drawing-payload
 * persistence (P-CLAUDE-LANE 4B/4).
 *
 * Pins the two seams that close the read-back path for completed
 * MMSE / MoCA assessments with captured drawing fields:
 *
 *   1. SAVE path — the save mutation conditionally includes the
 *      `drawings` field in `contactMeta` when at least one drawing was
 *      populated. Empty captures stay out of the persisted record so
 *      the saved note stays lean.
 *   2. READ path — the expand-view renders DrawingFieldCanvas in
 *      readOnly mode for each captured drawing on `cm.drawings`. The
 *      readOnly prop is critical: a signed clinical record's captured
 *      figure must not be mutable from a review surface.
 *
 * Why source-level: apps/web/vitest.config.ts is pure-logic only
 * (React 19's hooks dispatcher boundary makes JSDOM renders
 * unreliable here). The canvas-render behavior is exercised via the
 * pure-logic helpers in drawingField.test.ts + the structural
 * regression in DrawingFieldCanvas.contract.test.ts (4B/3). This file
 * pins the integration's two source-level seams.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AssessmentsTab — captured-drawings persistence (write path)', () => {
  const source = readFileSync(resolve(__dirname, './AssessmentsTab.tsx'), 'utf8');

  it('imports the extractCapturedDrawings helper from the canonical util module', () => {
    expect(source).toMatch(/import \{[\s\S]*?extractCapturedDrawings[\s\S]*?\} from '\.\/assessmentsTemplateUtils'/);
  });

  it('calls extractCapturedDrawings against the same fields + values the score logic uses', () => {
    // Pin that the captured-drawings extraction reads from the exact
    // same field+value pair the save action computes score data from.
    // A regression that splits these inputs would persist drawings that
    // don't match the scored items.
    expect(source).toContain('extractCapturedDrawings(ratingFields, ratingFormValues)');
  });

  it('conditionally adds `drawings` to contactMeta only when at least one drawing was captured', () => {
    // The spread form `...(capturedDrawings.length > 0 ? { drawings: ... } : {})`
    // keeps the persisted contactMeta lean: empty templates produce
    // identical contactMeta to today, so existing data shape is
    // backward-compatible.
    expect(source).toContain('...(capturedDrawings.length > 0 ? { drawings: capturedDrawings } : {})');
  });
});

describe('AssessmentsTab — captured-drawings read-back (expand view)', () => {
  const source = readFileSync(resolve(__dirname, './AssessmentsTab.tsx'), 'utf8');

  it('imports DrawingFieldCanvas from the canonical shared component', () => {
    expect(source).toContain("import { DrawingFieldCanvas } from '../../../../../shared/components/DrawingFieldCanvas';");
  });

  it('renders the Captured Drawings section behind a length-guarded check', () => {
    // Pin the conditional guard so an empty `drawings` array does NOT
    // render a header with no canvases below it.
    expect(source).toContain('cm?.drawings && cm.drawings.length > 0');
    expect(source).toContain('Captured Drawings');
  });

  it('maps each captured drawing to a readOnly DrawingFieldCanvas with label + payload', () => {
    // The map must pass `readOnly` (no value — the prop is the boolean
    // shorthand `readOnly`), AND the label + payload from the artefact.
    // A regression that drops `readOnly` would let a clinician
    // accidentally mutate the captured drawing on a signed record.
    // The map body may legitimately include intermediate analytics
    // (e.g. the 4B/5 metrics-strip) between the opener and the
    // DrawingFieldCanvas — pin the opener separately from the prop
    // shape to keep the assertion stable across that evolution.
    expect(source).toMatch(/cm\.drawings\.map\(\(drawing, i\) =>/);
    expect(source).toMatch(/<DrawingFieldCanvas[\s\S]{0,400}label=\{drawing\.label\}/);
    expect(source).toMatch(/<DrawingFieldCanvas[\s\S]{0,400}value=\{drawing\.payload\}/);
    expect(source).toMatch(/<DrawingFieldCanvas[\s\S]{0,400}\breadOnly\b/);
  });

  it('provides a no-op onValueChange so the controlled component contract is satisfied without permitting writes', () => {
    // Pin the no-op shape so a future refactor cannot accidentally
    // route the review surface's no-op into the parent state.
    expect(source).toMatch(/onValueChange=\{\(\) => \{ \/\* read-only review surface; no-op \*\/ \}\}/);
  });
});
