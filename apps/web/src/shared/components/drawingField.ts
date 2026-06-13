/**
 * Pure-logic helpers for drawing-type template fields (P-CLAUDE-LANE 4B).
 *
 * These live in a separate module from DrawingFieldCanvas.tsx so they
 * can be covered by vitest (apps/web/vitest.config.ts is pure-logic only
 * — no JSDOM, no React renders). The component itself is exercised via
 * Playwright E2E + TypeScript type-checking.
 *
 * The canonical source-of-truth for the stored shape is
 * packages/shared/src/drawingPayload.ts. This file does NOT redefine the
 * schema — it only provides ergonomic predicates / value-extractors for
 * the renderer and the `formValuesToText` path.
 */
import {
  computeDrawingMetrics,
  emptyDrawingPayload,
  isDrawingPayloadCaptured,
  tryParseDrawingPayload,
  type DrawingMetrics,
  type DrawingPayload,
} from '@signacare/shared';
import type { TemplateField } from './TemplateFormRenderer';

/**
 * Default canvas backing-store size used by the drawing renderer. This
 * is the persisted DrawingPayload.width / .height — NOT the on-screen
 * CSS pixel size (the canvas element can be scaled responsively for
 * different tablet form factors; the backing store stays fixed so the
 * stored stroke coordinates are device-independent).
 */
export const DRAWING_FIELD_DEFAULT_WIDTH = 800;
export const DRAWING_FIELD_DEFAULT_HEIGHT = 500;

export function isDrawingField(field: TemplateField): boolean {
  return field.type === 'drawing';
}

/**
 * Read the stored DrawingPayload for a drawing field out of the
 * FormValues map. Returns null when the field has no captured drawing
 * yet (FormValues string slot is empty / not a string / not a parseable
 * payload). The contract intentionally collapses all three "no
 * captured drawing" failure modes into `null` — see
 * tryParseDrawingPayload tests.
 */
export function readDrawingFieldValue(
  value: string | number | string[] | undefined,
): DrawingPayload | null {
  if (typeof value !== 'string') return null;
  return tryParseDrawingPayload(value);
}

/**
 * Capture-state predicate used by formValuesToText so the clinician's
 * exported record shows whether a drawing was attempted. We never embed
 * the strokes themselves in the text export — drawings render via the
 * canvas component and the structured DB column. The text export only
 * needs to carry the signal that this item was administered.
 */
export function describeDrawingFieldForText(
  value: string | number | string[] | undefined,
): 'captured' | 'not-captured' {
  const payload = readDrawingFieldValue(value);
  if (!payload) return 'not-captured';
  return isDrawingPayloadCaptured(payload) ? 'captured' : 'not-captured';
}

/**
 * Bootstrap an empty payload that matches the schema. Used by the
 * canvas when the renderer mounts against a field that has never been
 * touched and needs an initial backing buffer to draw into.
 */
export function makeEmptyDrawingFieldPayload(
  width: number = DRAWING_FIELD_DEFAULT_WIDTH,
  height: number = DRAWING_FIELD_DEFAULT_HEIGHT,
): DrawingPayload {
  return emptyDrawingPayload(width, height);
}

/**
 * Format a DrawingMetrics object into a small set of clinician-facing
 * chip labels for the AssessmentsTab expand-view metrics strip
 * (P-CLAUDE-LANE 4B/5). Each entry in the returned array corresponds
 * to ONE chip; absent metrics produce no chip rather than a placeholder
 * so the strip stays compact.
 *
 * Display rules:
 *   - "N strokes" — always rendered (zero strokes = "0 strokes", which
 *     is itself a clinical signal on cognitive scales).
 *   - "Ns drawing time" — rendered ONLY when cumulativeStrokeDurationMs
 *     is known. Formatted to one decimal place at sub-minute durations.
 *   - "Pressure {mean}" — rendered ONLY when pressure data exists.
 *     Formatted to two decimal places; the range is omitted to keep
 *     the chip compact (the clinician can see the figure for shape
 *     judgement).
 *   - "Coverage {pct}%" — rendered ONLY when bounding-box derivation
 *     succeeded. Formatted as a whole percentage; sub-percent values
 *     are floored to 0 to surface micrographia (canvas barely used).
 */
export function formatDrawingMetricsChips(metrics: DrawingMetrics): string[] {
  const chips: string[] = [];

  chips.push(`${metrics.strokeCount} stroke${metrics.strokeCount === 1 ? '' : 's'}`);

  if (metrics.cumulativeStrokeDurationMs !== null) {
    const seconds = metrics.cumulativeStrokeDurationMs / 1000;
    const formatted = seconds < 60
      ? `${seconds.toFixed(1)}s`
      : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    chips.push(`${formatted} drawing time`);
  }

  if (metrics.pressure !== null) {
    chips.push(`Pressure ${metrics.pressure.mean.toFixed(2)}`);
  }

  if (metrics.canvasCoverageRatio !== null) {
    const pct = Math.floor(metrics.canvasCoverageRatio * 100);
    chips.push(`Coverage ${pct}%`);
  }

  return chips;
}

/**
 * Compute + format chip labels in one call. Convenience for the
 * AssessmentsTab read-back render path; returns an empty array when
 * the payload is null / unparseable.
 */
export function describeCapturedDrawingChips(payload: DrawingPayload | null): string[] {
  if (!payload) return [];
  return formatDrawingMetricsChips(computeDrawingMetrics(payload));
}
