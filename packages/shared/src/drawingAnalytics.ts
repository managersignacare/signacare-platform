/**
 * Drawing analytics — pure-logic stroke metrics for captured
 * cognitive-scale drawings (P-CLAUDE-LANE 4B/5).
 *
 * Architectural placement: this module sits in @signacare/shared
 * alongside drawingPayload.ts so the metrics SSoT is shared by every
 * consumer of a stored DrawingPayload (web review surface, .NET split-
 * platform parity, any future native client). Placing it here means
 * "what does '12 strokes / 47 s / pressure 0.55' mean" is defined
 * exactly once.
 *
 * Pure-logic only: no DOM, no React, no I/O. Consumed by the
 * AssessmentsTab read-back view, where the captured drawing is rendered
 * via DrawingFieldCanvas in readOnly mode and the metrics strip beside
 * it surfaces clinically interesting characteristics (micrographia
 * markers, pen pressure quality, stroke economy) without making the
 * clinician eye-ball them off the figure.
 *
 * Timing semantics: the canvas captures `t` per point in milliseconds
 * RELATIVE TO THE STROKE START, not the overall recording start. This
 * means `cumulativeStrokeDurationMs` is the sum of intra-stroke
 * durations — it excludes inter-stroke gaps (which are the time the
 * patient spent thinking between strokes, not drawing). Total
 * wall-clock time of the drawing session is NOT computable from the
 * stored payload by design; the relevant clinical signal is pen-down
 * time, not pen-up time.
 *
 * Pressure semantics: the canvas captures PointerEvent.pressure (0-1)
 * per point. Hover-only mice + finger input frequently report 0.5
 * across all points; that's a true reading from the input device, not
 * a signal of consistent patient pressure. The mean / range surfaced
 * here is descriptive, not diagnostic — the clinician interprets it
 * alongside the drawing itself.
 */

import type { DrawingPayload } from './drawingPayload';

/**
 * Tight bounding box of all captured points in canvas-pixel
 * coordinates. Used to surface stroke economy (micrographia marker:
 * drawing confined to a small region) and stroke spread.
 */
export interface DrawingBoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Mean / range descriptor for an optional per-point metric (timing,
 * pressure). null when no point in the payload carried the metric.
 */
export interface DrawingPressureSummary {
  mean: number;
  min: number;
  max: number;
}

export interface DrawingMetrics {
  /** Number of strokes the patient drew (each pointer-down → pointer-up). */
  strokeCount: number;
  /** Total captured points across all strokes. */
  totalPoints: number;
  /**
   * Sum of (last.t − first.t) for strokes whose points carry the
   * optional `t` field. Excludes inter-stroke gaps by design (see
   * module comment). `null` when NO stroke had at least two points
   * with `t` data, so the metric is not derivable.
   */
  cumulativeStrokeDurationMs: number | null;
  /**
   * Mean / min / max of per-point pressure across all points that
   * carry the optional `pressure` field. `null` when no point had
   * pressure data, so the metric is not derivable.
   */
  pressure: DrawingPressureSummary | null;
  /**
   * Tight bounding box of all captured points. `null` when no points
   * exist (the patient produced zero strokes, a legitimate clinical
   * signal on cognitive scales).
   */
  boundingBox: DrawingBoundingBox | null;
  /**
   * Bounding-box area as a fraction of canvas area (0..1). `null`
   * when boundingBox is null. A small ratio (< 0.05) on items that
   * normally fill the canvas (clock, pentagons) is a documented
   * micrographia marker — clinician interprets in context.
   */
  canvasCoverageRatio: number | null;
}

/**
 * Compute the metrics for a captured drawing.
 *
 * Defensive: handles every absent-optional-field case so a payload
 * captured by a client without timing / pressure support yields a
 * meaningful metrics object (just with `null` for the unavailable
 * fields). NEVER throws on a valid payload — this is the read path
 * and we cannot block the read-back surface on a metric.
 */
export function computeDrawingMetrics(payload: DrawingPayload): DrawingMetrics {
  let strokeCount = 0;
  let totalPoints = 0;

  let cumulativeStrokeDurationMs = 0;
  let strokesWithTiming = 0;

  let pressureSum = 0;
  let pressureCount = 0;
  let pressureMin = Number.POSITIVE_INFINITY;
  let pressureMax = Number.NEGATIVE_INFINITY;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const stroke of payload.strokes) {
    if (stroke.points.length === 0) continue;
    strokeCount += 1;
    totalPoints += stroke.points.length;

    let strokeFirstT: number | null = null;
    let strokeLastT: number | null = null;

    for (const point of stroke.points) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;

      if (typeof point.t === 'number') {
        if (strokeFirstT === null) strokeFirstT = point.t;
        strokeLastT = point.t;
      }

      if (typeof point.pressure === 'number') {
        pressureSum += point.pressure;
        pressureCount += 1;
        if (point.pressure < pressureMin) pressureMin = point.pressure;
        if (point.pressure > pressureMax) pressureMax = point.pressure;
      }
    }

    if (strokeFirstT !== null && strokeLastT !== null && strokeLastT > strokeFirstT) {
      cumulativeStrokeDurationMs += strokeLastT - strokeFirstT;
      strokesWithTiming += 1;
    }
  }

  const boundingBox: DrawingBoundingBox | null = totalPoints > 0
    ? { minX, minY, maxX, maxY }
    : null;

  const canvasArea = payload.width * payload.height;
  const canvasCoverageRatio: number | null = boundingBox && canvasArea > 0
    ? Math.max(0, ((boundingBox.maxX - boundingBox.minX) * (boundingBox.maxY - boundingBox.minY)) / canvasArea)
    : null;

  const pressure: DrawingPressureSummary | null = pressureCount > 0
    ? { mean: pressureSum / pressureCount, min: pressureMin, max: pressureMax }
    : null;

  return {
    strokeCount,
    totalPoints,
    cumulativeStrokeDurationMs: strokesWithTiming > 0 ? cumulativeStrokeDurationMs : null,
    pressure,
    boundingBox,
    canvasCoverageRatio,
  };
}
