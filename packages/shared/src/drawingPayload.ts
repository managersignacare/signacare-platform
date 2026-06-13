/**
 * Canonical schema for clinician-rated cognitive scale drawing items.
 *
 * Operator brief (P-CLAUDE-LANE tranche 4 sub-B):
 *   "For MMSE and MoCA: support real tablet drawing/writing for items
 *    like copy-picture rather than score-only entry. Store/round-trip
 *    the drawing payload properly."
 *
 * Architectural placement:
 *
 *   This module is the SSoT for the stored shape of a drawing capture.
 *   It is consumed by:
 *     - the web canvas renderer (writes the JSON into the
 *       FormValues string slot at stroke-end),
 *     - the API template-form save path (stores the same JSON in the
 *       assessment_responses.values JSONB column),
 *     - the chronology / playback views (read the JSON, rescale to fit
 *       the current viewport, replay the strokes).
 *
 *   Placing the schema in @signacare/shared means there is exactly ONE
 *   definition. Frontend canvas component, backend storage, .NET split-
 *   platform parity, and any future native Viva client all bind against
 *   it. The drift class that bit MMSE/MoCA interpretation bands
 *   (P-CLAUDE-LANE 4 sub-A) cannot recur on the drawing-payload surface
 *   because there is no second copy.
 *
 * Storage shape choice (vector points, not raster):
 *
 *   Strokes are stored as ordered point lists in capture-pixel
 *   coordinates plus the capture-time canvas dimensions. Playback
 *   rescales to fit any viewport without rasterisation loss. The
 *   alternative (PNG dataURL) was rejected because:
 *     - typical pentagon / cube / clock copy = 5-50 strokes ≈ 1-5 KB
 *       as vectors, vs 50-200 KB as PNG dataURLs;
 *     - vector storage preserves the temporal sequence (the `t` field)
 *       which is a published prognostic marker in some cognitive
 *       assessment research;
 *     - chronology playback can render at any zoom without artefacts.
 *
 * Schema versioning:
 *
 *   Every payload carries a `schemaVersion` literal so the shape can
 *   evolve (e.g. v2 adding eraser strokes, v3 adding annotation
 *   layers) without breaking historical data. Parsers are version-
 *   strict: a v2 reader rejects v1 input unless an upgrade migration
 *   has been applied. The current SSoT-pinned version is
 *   DRAWING_PAYLOAD_SCHEMA_VERSION.
 *
 * Bounds:
 *
 *   Every numeric and array bound below is deliberate. Pentagons /
 *   cubes / clocks captured on a 1024×1024 tablet canvas at 30 Hz over
 *   90 seconds produce at most ~2700 points across ~50 strokes — well
 *   within the bounds. The upper limits exist to reject pathological
 *   or hostile input (a buggy client looping forever, or a tampered
 *   payload trying to exhaust storage / parser memory) without
 *   constraining legitimate clinical use.
 */

import { z } from 'zod';

/**
 * Literal version marker on every payload. Bump (and add the upgrade
 * path) when the wire shape changes.
 */
export const DRAWING_PAYLOAD_SCHEMA_VERSION = 1 as const;

/**
 * Maximum canvas dimension in either axis. 8192 covers every tablet
 * resolution shipped to date with headroom; values above this almost
 * certainly indicate tampered input.
 */
export const DRAWING_PAYLOAD_MAX_DIMENSION = 8192;

/**
 * Maximum number of points per stroke. A 90 s stroke at 240 Hz =
 * 21,600 points; we cap at 10,000 which still covers any clinically
 * realistic continuous gesture (the longest single stroke in cube /
 * clock drawing is the clock circumference at ≈ 1-2 s ≈ 60-480 points
 * depending on input frequency).
 */
export const DRAWING_PAYLOAD_MAX_POINTS_PER_STROKE = 10_000;

/**
 * Maximum number of strokes in a payload. Pentagons / cubes / clocks
 * involve 5-50 strokes typically; 2000 is a generous ceiling that
 * still bounds storage to ~5 MB per cell in the pathological case.
 */
export const DRAWING_PAYLOAD_MAX_STROKES = 2_000;

const DrawingPointSchema = z.object({
  /** x coordinate in capture-time canvas pixels. */
  x: z.number().finite(),
  /** y coordinate in capture-time canvas pixels. */
  y: z.number().finite(),
  /**
   * Optional millisecond timestamp since the start of THIS stroke
   * (NOT since the start of the payload). Lets playback replay at
   * the original cadence; absent for client implementations that
   * cannot capture timing.
   */
  t: z.number().finite().nonnegative().optional(),
  /**
   * Optional 0-1 normalised pen pressure (PointerEvent.pressure).
   * Absent for finger / mouse input that cannot report pressure.
   */
  pressure: z.number().finite().min(0).max(1).optional(),
});

const DrawingStrokeSchema = z.object({
  /**
   * Optional CSS colour for the stroke (e.g. "#000", "rgb(0,0,0)").
   * Absent → renderer uses its default. Kept open as a string rather
   * than a strict CSS-colour regex so the wire shape stays simple;
   * the canvas component is responsible for safe rendering.
   */
  color: z.string().min(1).max(32).optional(),
  /**
   * Optional stroke width in canvas pixels. Absent → renderer uses
   * its default. Capped at 64 px to reject malformed payloads (a 64
   * px brush stroke on a 256 px tablet item is already extreme).
   */
  width: z.number().finite().positive().max(64).optional(),
  /**
   * Captured points in chronological order. Bounded both ways: at
   * least 1 (an empty stroke has no clinical meaning and is rejected
   * to keep storage clean), at most DRAWING_PAYLOAD_MAX_POINTS_PER_STROKE.
   */
  points: z.array(DrawingPointSchema).min(1).max(DRAWING_PAYLOAD_MAX_POINTS_PER_STROKE),
});

export const DrawingPayloadSchema = z.object({
  /**
   * Literal version marker. Parsers are version-strict; mismatched
   * values are rejected so the shape can evolve safely.
   */
  schemaVersion: z.literal(DRAWING_PAYLOAD_SCHEMA_VERSION),
  /**
   * Canvas width when the strokes were captured. Playback rescales
   * to fit the current viewport from this baseline.
   */
  width: z.number().finite().positive().max(DRAWING_PAYLOAD_MAX_DIMENSION),
  /**
   * Canvas height when the strokes were captured.
   */
  height: z.number().finite().positive().max(DRAWING_PAYLOAD_MAX_DIMENSION),
  /**
   * Strokes in chronological order. An empty array is valid — it
   * represents "renderer mounted but patient produced no strokes",
   * which is a legitimate clinical signal on cognitive scales (an
   * inability to attempt the task).
   */
  strokes: z.array(DrawingStrokeSchema).max(DRAWING_PAYLOAD_MAX_STROKES),
});

export type DrawingPayload = z.infer<typeof DrawingPayloadSchema>;
export type DrawingStroke = z.infer<typeof DrawingStrokeSchema>;
export type DrawingPoint = z.infer<typeof DrawingPointSchema>;

/**
 * Build a fresh, empty payload for a canvas of the given dimensions.
 * Useful as the initial value the renderer round-trips through
 * FormValues before the patient produces the first stroke.
 *
 * Throws if width / height fall outside the schema bounds — the
 * caller is responsible for clamping to canvas-pixel reality before
 * passing them in.
 */
export function emptyDrawingPayload(width: number, height: number): DrawingPayload {
  return DrawingPayloadSchema.parse({
    schemaVersion: DRAWING_PAYLOAD_SCHEMA_VERSION,
    width,
    height,
    strokes: [],
  });
}

/**
 * Serialise a payload for storage in the FormValues string slot or
 * the assessment_responses JSONB column. Validates the payload via
 * the schema before serialising so a buggy caller cannot smuggle
 * malformed data through.
 */
export function serializeDrawingPayload(payload: DrawingPayload): string {
  return JSON.stringify(DrawingPayloadSchema.parse(payload));
}

/**
 * Parse a stored value back into a typed payload.
 *
 * Returns null for any non-parseable input — empty string, non-JSON,
 * schema-violating JSON, wrong schema version. The renderer treats a
 * null result as "no drawing captured yet" and shows the empty
 * canvas; this is intentional so a freshly-mounted field with no
 * prior value cannot crash on render.
 *
 * Validation errors are swallowed deliberately at this seam — the
 * caller has no recourse to fix the stored value, and crashing the
 * renderer on a single corrupt cell would block the whole
 * assessments view. Surface-level monitoring should run on the API
 * write path, not the read path.
 */
export function tryParseDrawingPayload(raw: unknown): DrawingPayload | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = DrawingPayloadSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * True iff the payload contains at least one stroke with at least
 * one captured point. Used by the renderer to distinguish "empty
 * canvas" (patient may legitimately produce zero strokes — a
 * meaningful clinical signal on cognitive scales) from "patient drew
 * something". Also used by the save-side reducer to decide whether
 * to send `null` (no capture) or the serialised payload.
 */
export function isDrawingPayloadCaptured(payload: DrawingPayload | null): boolean {
  if (!payload) return false;
  for (const stroke of payload.strokes) {
    if (stroke.points.length > 0) return true;
  }
  return false;
}
