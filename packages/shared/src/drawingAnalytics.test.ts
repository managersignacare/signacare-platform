import { describe, expect, it } from 'vitest';
import {
  DRAWING_PAYLOAD_SCHEMA_VERSION,
  emptyDrawingPayload,
  type DrawingPayload,
} from './drawingPayload';
import { computeDrawingMetrics } from './drawingAnalytics';

const CANVAS_W = 1000;
const CANVAS_H = 800;

function payload(strokes: DrawingPayload['strokes']): DrawingPayload {
  return {
    schemaVersion: DRAWING_PAYLOAD_SCHEMA_VERSION,
    width: CANVAS_W,
    height: CANVAS_H,
    strokes,
  };
}

describe('computeDrawingMetrics — empty / zero-stroke', () => {
  it('returns a zeroed metrics object on an empty-strokes payload', () => {
    const m = computeDrawingMetrics(emptyDrawingPayload(CANVAS_W, CANVAS_H));
    expect(m).toEqual({
      strokeCount: 0,
      totalPoints: 0,
      cumulativeStrokeDurationMs: null,
      pressure: null,
      boundingBox: null,
      canvasCoverageRatio: null,
    });
  });
});

describe('computeDrawingMetrics — stroke + point counts', () => {
  it('counts strokes and aggregates total points', () => {
    const m = computeDrawingMetrics(payload([
      { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] },
      { points: [{ x: 10, y: 10 }, { x: 11, y: 11 }] },
    ]));
    expect(m.strokeCount).toBe(2);
    expect(m.totalPoints).toBe(5);
  });
});

describe('computeDrawingMetrics — timing (cumulativeStrokeDurationMs)', () => {
  it('returns null when no point in any stroke has timing data', () => {
    const m = computeDrawingMetrics(payload([
      { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
    ]));
    expect(m.cumulativeStrokeDurationMs).toBeNull();
  });

  it('sums per-stroke durations (last.t − first.t) and excludes inter-stroke gaps', () => {
    const m = computeDrawingMetrics(payload([
      { points: [{ x: 1, y: 1, t: 0 }, { x: 2, y: 2, t: 100 }, { x: 3, y: 3, t: 250 }] },
      // Inter-stroke gap of "thinking time" exists in wall-clock but is NOT in the payload
      { points: [{ x: 10, y: 10, t: 0 }, { x: 11, y: 11, t: 500 }] },
    ]));
    // Stroke 1: 250 − 0 = 250 ms. Stroke 2: 500 − 0 = 500 ms. Sum = 750 ms.
    expect(m.cumulativeStrokeDurationMs).toBe(750);
  });

  it('ignores strokes whose last.t is not strictly greater than first.t (one-point or stuck-clock strokes)', () => {
    const m = computeDrawingMetrics(payload([
      { points: [{ x: 1, y: 1, t: 0 }] }, // single point, no duration
      { points: [{ x: 1, y: 1, t: 100 }, { x: 2, y: 2, t: 100 }] }, // same t, no duration
      { points: [{ x: 10, y: 10, t: 0 }, { x: 11, y: 11, t: 50 }] }, // valid 50 ms
    ]));
    expect(m.cumulativeStrokeDurationMs).toBe(50);
  });

  it('still returns timing when only SOME strokes have timing data', () => {
    const m = computeDrawingMetrics(payload([
      { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }, // no timing
      { points: [{ x: 10, y: 10, t: 0 }, { x: 11, y: 11, t: 200 }] }, // 200 ms
    ]));
    expect(m.cumulativeStrokeDurationMs).toBe(200);
  });
});

describe('computeDrawingMetrics — pressure', () => {
  it('returns null when no point has pressure data', () => {
    const m = computeDrawingMetrics(payload([
      { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
    ]));
    expect(m.pressure).toBeNull();
  });

  it('computes mean / min / max across all points carrying pressure', () => {
    const m = computeDrawingMetrics(payload([
      { points: [{ x: 1, y: 1, pressure: 0.2 }, { x: 2, y: 2, pressure: 0.4 }] },
      { points: [{ x: 10, y: 10, pressure: 0.6 }, { x: 11, y: 11, pressure: 0.8 }] },
    ]));
    expect(m.pressure).not.toBeNull();
    expect(m.pressure!.mean).toBeCloseTo(0.5, 5);
    expect(m.pressure!.min).toBe(0.2);
    expect(m.pressure!.max).toBe(0.8);
  });

  it('ignores points without pressure when computing mean (mixed-input case)', () => {
    const m = computeDrawingMetrics(payload([
      { points: [{ x: 1, y: 1, pressure: 0.4 }, { x: 2, y: 2 }, { x: 3, y: 3, pressure: 0.6 }] },
    ]));
    expect(m.pressure).not.toBeNull();
    expect(m.pressure!.mean).toBeCloseTo(0.5, 5);
  });
});

describe('computeDrawingMetrics — bounding box + canvas coverage', () => {
  it('computes a tight bounding box across all captured points', () => {
    const m = computeDrawingMetrics(payload([
      { points: [{ x: 100, y: 50 }, { x: 200, y: 150 }] },
      { points: [{ x: 50, y: 200 }, { x: 300, y: 75 }] },
    ]));
    expect(m.boundingBox).toEqual({ minX: 50, minY: 50, maxX: 300, maxY: 200 });
  });

  it('computes the canvas coverage ratio as bbox area / canvas area', () => {
    const m = computeDrawingMetrics(payload([
      { points: [{ x: 0, y: 0 }, { x: 500, y: 400 }] },
    ]));
    // BBox area = 500 × 400 = 200000. Canvas area = 1000 × 800 = 800000.
    // Ratio = 0.25.
    expect(m.canvasCoverageRatio).toBeCloseTo(0.25, 5);
  });

  it('surfaces a tiny coverage ratio (micrographia marker scenario)', () => {
    const m = computeDrawingMetrics(payload([
      { points: [{ x: 500, y: 400 }, { x: 510, y: 410 }, { x: 520, y: 405 }] },
    ]));
    // BBox 20×10 = 200. Canvas 800000. Ratio 0.00025.
    expect(m.canvasCoverageRatio).toBeLessThan(0.001);
    expect(m.canvasCoverageRatio).toBeGreaterThan(0);
  });

  it('returns 0 coverage for a degenerate single-point stroke (avoids NaN)', () => {
    const m = computeDrawingMetrics(payload([
      { points: [{ x: 500, y: 400 }] },
    ]));
    // BBox is a point: minX=maxX=500, minY=maxY=400. Area = 0. Ratio = 0.
    expect(m.boundingBox).toEqual({ minX: 500, minY: 400, maxX: 500, maxY: 400 });
    expect(m.canvasCoverageRatio).toBe(0);
  });
});

describe('computeDrawingMetrics — full clinical-scenario integration', () => {
  it('returns every metric for a MoCA clock-style payload', () => {
    // Realistic: clock face (1 circular stroke, 30 points, 1.5 s),
    // 12 number strokes (single point each), 2 hand strokes.
    const strokes: DrawingPayload['strokes'] = [];
    // Clock face
    const clockPoints = Array.from({ length: 30 }, (_, i) => ({
      x: 500 + 200 * Math.cos((i / 30) * 2 * Math.PI),
      y: 400 + 200 * Math.sin((i / 30) * 2 * Math.PI),
      t: i * 50,
      pressure: 0.5,
    }));
    strokes.push({ points: clockPoints });
    // 12 numbers (single-point strokes; no duration contribution)
    for (let n = 1; n <= 12; n += 1) {
      strokes.push({ points: [{ x: 500 + n * 5, y: 400, t: 0, pressure: 0.6 }] });
    }
    // 2 hands (short strokes)
    strokes.push({ points: [{ x: 500, y: 400, t: 0, pressure: 0.7 }, { x: 600, y: 300, t: 800, pressure: 0.7 }] });
    strokes.push({ points: [{ x: 500, y: 400, t: 0, pressure: 0.7 }, { x: 580, y: 380, t: 600, pressure: 0.7 }] });

    const m = computeDrawingMetrics(payload(strokes));
    expect(m.strokeCount).toBe(15);
    expect(m.totalPoints).toBe(30 + 12 + 2 + 2);
    // Clock face: 29 * 50 = 1450 ms. Hands: 800 + 600 = 1400 ms. Numbers: 0.
    expect(m.cumulativeStrokeDurationMs).toBe(1450 + 800 + 600);
    expect(m.pressure?.min).toBeCloseTo(0.5, 5);
    expect(m.pressure?.max).toBeCloseTo(0.7, 5);
    expect(m.boundingBox).not.toBeNull();
    expect(m.canvasCoverageRatio).toBeGreaterThan(0);
    expect(m.canvasCoverageRatio).toBeLessThanOrEqual(1);
  });
});
