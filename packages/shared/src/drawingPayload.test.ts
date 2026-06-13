import { describe, expect, it } from 'vitest';
import {
  DRAWING_PAYLOAD_MAX_DIMENSION,
  DRAWING_PAYLOAD_MAX_POINTS_PER_STROKE,
  DRAWING_PAYLOAD_MAX_STROKES,
  DRAWING_PAYLOAD_SCHEMA_VERSION,
  DrawingPayloadSchema,
  emptyDrawingPayload,
  isDrawingPayloadCaptured,
  serializeDrawingPayload,
  tryParseDrawingPayload,
  type DrawingPayload,
} from './drawingPayload';

const CANVAS_W = 1024;
const CANVAS_H = 1024;

function singleStrokePayload(
  points: Array<{ x: number; y: number }> = [
    { x: 100, y: 100 },
    { x: 110, y: 105 },
    { x: 120, y: 110 },
  ],
): DrawingPayload {
  return {
    schemaVersion: DRAWING_PAYLOAD_SCHEMA_VERSION,
    width: CANVAS_W,
    height: CANVAS_H,
    strokes: [{ points }],
  };
}

describe('DrawingPayloadSchema — happy path', () => {
  it('accepts an empty-strokes payload (legitimate clinical signal: patient did not draw)', () => {
    const empty = emptyDrawingPayload(CANVAS_W, CANVAS_H);
    expect(empty.schemaVersion).toBe(DRAWING_PAYLOAD_SCHEMA_VERSION);
    expect(empty.strokes).toEqual([]);
    expect(DrawingPayloadSchema.safeParse(empty).success).toBe(true);
  });

  it('accepts a multi-stroke payload with timing + pressure on each point', () => {
    const payload: DrawingPayload = {
      schemaVersion: DRAWING_PAYLOAD_SCHEMA_VERSION,
      width: CANVAS_W,
      height: CANVAS_H,
      strokes: [
        {
          color: '#000000',
          width: 3,
          points: [
            { x: 50, y: 50, t: 0, pressure: 0.4 },
            { x: 55, y: 55, t: 16, pressure: 0.55 },
            { x: 60, y: 58, t: 32, pressure: 0.6 },
          ],
        },
        {
          points: [
            { x: 200, y: 200 },
            { x: 210, y: 205 },
          ],
        },
      ],
    };
    const parsed = DrawingPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });
});

describe('DrawingPayloadSchema — rejection cases', () => {
  it('rejects a payload whose schemaVersion does not match the SSoT', () => {
    const bad = { ...singleStrokePayload(), schemaVersion: 2 };
    expect(DrawingPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-positive canvas width', () => {
    expect(
      DrawingPayloadSchema.safeParse({ ...singleStrokePayload(), width: 0 }).success,
    ).toBe(false);
    expect(
      DrawingPayloadSchema.safeParse({ ...singleStrokePayload(), width: -10 }).success,
    ).toBe(false);
  });

  it('rejects a canvas dimension above the schema cap', () => {
    expect(
      DrawingPayloadSchema.safeParse({
        ...singleStrokePayload(),
        width: DRAWING_PAYLOAD_MAX_DIMENSION + 1,
      }).success,
    ).toBe(false);
  });

  it('rejects an empty stroke (no points)', () => {
    const bad = {
      ...singleStrokePayload(),
      strokes: [{ points: [] }],
    };
    expect(DrawingPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects pressure outside 0..1', () => {
    const bad = singleStrokePayload();
    bad.strokes[0].points[0] = { x: 1, y: 1, pressure: 1.5 };
    expect(DrawingPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects negative timing', () => {
    const bad = singleStrokePayload();
    bad.strokes[0].points[0] = { x: 1, y: 1, t: -1 };
    expect(DrawingPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects non-finite coordinates (NaN / Infinity)', () => {
    const bad = singleStrokePayload();
    bad.strokes[0].points[0] = { x: Number.NaN, y: 1 };
    expect(DrawingPayloadSchema.safeParse(bad).success).toBe(false);
    bad.strokes[0].points[0] = { x: 1, y: Number.POSITIVE_INFINITY };
    expect(DrawingPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects payloads that exceed the per-stroke point cap', () => {
    const bad = singleStrokePayload(
      Array.from({ length: DRAWING_PAYLOAD_MAX_POINTS_PER_STROKE + 1 }, (_, i) => ({
        x: i,
        y: i,
      })),
    );
    expect(DrawingPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects payloads that exceed the strokes cap', () => {
    const bad = {
      schemaVersion: DRAWING_PAYLOAD_SCHEMA_VERSION,
      width: CANVAS_W,
      height: CANVAS_H,
      strokes: Array.from({ length: DRAWING_PAYLOAD_MAX_STROKES + 1 }, () => ({
        points: [{ x: 1, y: 1 }],
      })),
    };
    expect(DrawingPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an over-wide stroke (sanity bound on stroke width)', () => {
    const bad = singleStrokePayload();
    bad.strokes[0].width = 128;
    expect(DrawingPayloadSchema.safeParse(bad).success).toBe(false);
  });
});

describe('emptyDrawingPayload', () => {
  it('produces a parseable payload at the schema version', () => {
    const empty = emptyDrawingPayload(800, 600);
    expect(empty).toEqual({
      schemaVersion: DRAWING_PAYLOAD_SCHEMA_VERSION,
      width: 800,
      height: 600,
      strokes: [],
    });
  });

  it('throws when called with out-of-bounds dimensions', () => {
    expect(() => emptyDrawingPayload(0, 100)).toThrow();
    expect(() => emptyDrawingPayload(100, DRAWING_PAYLOAD_MAX_DIMENSION + 1)).toThrow();
  });
});

describe('serializeDrawingPayload + tryParseDrawingPayload — round-trip', () => {
  it('round-trips a captured payload exactly', () => {
    const original: DrawingPayload = {
      schemaVersion: DRAWING_PAYLOAD_SCHEMA_VERSION,
      width: 640,
      height: 480,
      strokes: [
        {
          color: '#1F2937',
          width: 2.5,
          points: [
            { x: 10, y: 20, t: 0, pressure: 0.3 },
            { x: 12, y: 22, t: 8, pressure: 0.35 },
          ],
        },
      ],
    };
    const round = tryParseDrawingPayload(serializeDrawingPayload(original));
    expect(round).toEqual(original);
  });

  it('round-trips an empty-strokes payload (no captured drawing)', () => {
    const empty = emptyDrawingPayload(CANVAS_W, CANVAS_H);
    const round = tryParseDrawingPayload(serializeDrawingPayload(empty));
    expect(round).toEqual(empty);
  });

  it('serializer rejects a payload that fails schema validation rather than emitting garbage', () => {
    // The serializer's contract is that what comes out is guaranteed
    // schema-valid. A buggy caller passing in malformed input should
    // throw at serialise time, not silently leak corrupt JSON.
    const bad = { ...singleStrokePayload(), width: -1 } as unknown as DrawingPayload;
    expect(() => serializeDrawingPayload(bad)).toThrow();
  });
});

describe('tryParseDrawingPayload — null / failure surfaces', () => {
  it('returns null for null/undefined/empty inputs (no drawing captured)', () => {
    expect(tryParseDrawingPayload(null)).toBeNull();
    expect(tryParseDrawingPayload(undefined)).toBeNull();
    expect(tryParseDrawingPayload('')).toBeNull();
  });

  it('returns null for non-string inputs (defends against FormValues drift)', () => {
    expect(tryParseDrawingPayload(123)).toBeNull();
    expect(tryParseDrawingPayload({ schemaVersion: 1 })).toBeNull();
    expect(tryParseDrawingPayload([])).toBeNull();
  });

  it('returns null for invalid JSON (defends against truncated DB reads)', () => {
    expect(tryParseDrawingPayload('not json')).toBeNull();
    expect(tryParseDrawingPayload('{"unterminated')).toBeNull();
  });

  it('returns null for schema-violating JSON (defends against tampered payloads)', () => {
    // Valid JSON, invalid payload shape.
    expect(tryParseDrawingPayload('{"hello":"world"}')).toBeNull();
    expect(
      tryParseDrawingPayload(
        JSON.stringify({ schemaVersion: 99, width: 100, height: 100, strokes: [] }),
      ),
    ).toBeNull();
  });
});

describe('isDrawingPayloadCaptured', () => {
  it('returns false for null', () => {
    expect(isDrawingPayloadCaptured(null)).toBe(false);
  });

  it('returns false for an empty-strokes payload', () => {
    expect(isDrawingPayloadCaptured(emptyDrawingPayload(CANVAS_W, CANVAS_H))).toBe(false);
  });

  it('returns true as soon as any stroke contains at least one point', () => {
    const captured = singleStrokePayload([{ x: 10, y: 10 }]);
    expect(isDrawingPayloadCaptured(captured)).toBe(true);
  });

  it('returns true on a multi-stroke payload', () => {
    const captured: DrawingPayload = {
      schemaVersion: DRAWING_PAYLOAD_SCHEMA_VERSION,
      width: CANVAS_W,
      height: CANVAS_H,
      strokes: [
        { points: [{ x: 1, y: 1 }] },
        { points: [{ x: 2, y: 2 }, { x: 3, y: 3 }] },
      ],
    };
    expect(isDrawingPayloadCaptured(captured)).toBe(true);
  });
});
