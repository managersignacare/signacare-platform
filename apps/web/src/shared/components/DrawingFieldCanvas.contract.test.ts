/**
 * Source-level contract test for DrawingFieldCanvas (P-CLAUDE-LANE 4B/3).
 *
 * Pins the read-back path for completed MMSE/MoCA assessments with
 * captured drawing fields. When a clinician opens a signed assessment
 * via TemplateFormRenderer with readOnly={true}, the canvas component
 * must:
 *
 *   1. Render the captured strokes — the redraw effect runs regardless
 *      of readOnly state, so historical drawings show on review.
 *   2. Disable new stroke capture — handlePointerDown early-returns
 *      when readOnly so the clinician's review pointer doesn't add
 *      strokes to a signed assessment.
 *   3. Hide the Undo / Clear controls — those mutators are only
 *      rendered behind a `!readOnly` gate so the clinician's review
 *      surface cannot mutate a signed clinical record.
 *
 * Why source-level: apps/web/vitest.config.ts is pure-logic only (no
 * JSDOM, React 19 hooks dispatcher boundary). Component-render tests
 * would not run in this harness; the canonical behavioural verification
 * lives in Playwright E2E. This contract test pins the structural
 * properties at the source level so a future refactor cannot silently
 * remove the readOnly gates without the test failing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DrawingFieldCanvas read-back contract', () => {
  const source = readFileSync(resolve(__dirname, './DrawingFieldCanvas.tsx'), 'utf8');

  it('blocks new stroke capture when readOnly is true', () => {
    // The first statement of handlePointerDown MUST be the readOnly
    // early-return so a review-surface pointer event cannot start a
    // stroke on a signed assessment. Pinning the exact opener prevents
    // the gate from being silently moved inside a later conditional.
    expect(source).toMatch(/handlePointerDown = useCallback\(\(e: React\.PointerEvent<HTMLCanvasElement>\) => \{\s*if \(readOnly\) return;/);
  });

  it('hides the Undo control behind a !readOnly gate', () => {
    expect(source).toContain('{!readOnly && (');
    expect(source).toContain('Undo');
    // Reject the regression shape where Undo is rendered unconditionally
    // and only `disabled` flips on readOnly — that surface still emits
    // hover/focus affordances which would mislead the reviewer.
    expect(source).not.toMatch(/<Button[\s\S]{0,200}startIcon=\{<UndoIcon[\s\S]{0,200}disabled=\{readOnly\b/);
  });

  it('hides the Clear control behind a !readOnly gate', () => {
    expect(source).toContain('Clear');
    expect(source).not.toMatch(/<Button[\s\S]{0,200}startIcon=\{<ClearIcon[\s\S]{0,200}disabled=\{readOnly\b/);
  });

  it('draws strokes regardless of readOnly so historical drawings render on review', () => {
    // The redraw effect must NOT short-circuit on readOnly — clinicians
    // need to see the captured figure when reviewing a signed assessment.
    // Pin via the exact deps-array of the redraw callback: payload only.
    expect(source).toMatch(/const redraw = useCallback\(\(\) => \{[\s\S]*?\}, \[payload\]\);/);
    // Belt-and-braces: assert the redraw callback's deps line literally
    // names only `payload`, no readOnly.
    expect(source).toContain('}, [payload]);');
  });

  it('keeps the canvas backing store decoupled from CSS responsive sizing', () => {
    // The backing store dimensions are sourced from the payload
    // (width × height), which are stored in device-independent
    // coordinates so two clinicians on different-sized tablets see
    // the same geometry. The on-screen CSS width is responsive
    // (`width: '100%'`) — a regression that ties the backing store
    // to the on-screen rect would break the cross-device invariant.
    expect(source).toContain('width={payload.width}');
    expect(source).toContain('height={payload.height}');
    expect(source).toContain("width: '100%'");
  });

  it('exposes readOnly via the canvas cursor for clinician affordance', () => {
    // Cursor explicitly switches between 'crosshair' (capture surface)
    // and 'default' (review surface) so the clinician's UX signal
    // matches the underlying behavior gate.
    expect(source).toContain("cursor: readOnly ? 'default' : 'crosshair'");
  });
});

describe('TemplateFormRenderer → DrawingFieldCanvas readOnly pass-through', () => {
  const source = readFileSync(resolve(__dirname, './TemplateFormRenderer.tsx'), 'utf8');

  it('propagates readOnly from the renderer dispatch into DrawingFieldCanvas', () => {
    // The renderer's case 'drawing' is the seam where a signed
    // assessment's readOnly intent must reach the canvas component.
    // If the prop is silently dropped or hardcoded to false here,
    // a clinician reviewing a signed assessment could accidentally
    // mutate the captured drawing. Pin the pass-through.
    expect(source).toMatch(/<DrawingFieldCanvas[\s\S]{0,400}readOnly=\{readOnly\}/);
  });

  it('routes value + onValueChange through the FormValues slot', () => {
    expect(source).toMatch(/<DrawingFieldCanvas[\s\S]{0,400}value=\{value\}/);
    expect(source).toMatch(/<DrawingFieldCanvas[\s\S]{0,400}onValueChange=\{\(next\) => onValueChange\(next\)\}/);
  });
});
