/**
 * Pure-logic tests for the drawing-field helpers (P-CLAUDE-LANE 4B).
 *
 * The canvas component itself (DrawingFieldCanvas.tsx) is not rendered
 * here — apps/web/vitest.config.ts is pure-logic only (React 19's hooks
 * dispatcher boundary makes JSDOM renders unreliable). Component-level
 * verification is covered by Playwright E2E.
 *
 * What this file pins:
 *   - the predicate that flags a TemplateField as a drawing field
 *   - the value extractor that goes from FormValues string slot →
 *     DrawingPayload (or null when nothing is captured)
 *   - the captured-state describer used by formValuesToText so the
 *     clinician's exported record carries the signal
 *   - the empty-payload bootstrap matches the canonical schema
 */
import { describe, expect, it } from 'vitest';
import {
  DRAWING_PAYLOAD_SCHEMA_VERSION,
  emptyDrawingPayload,
  serializeDrawingPayload,
  type DrawingMetrics,
} from '@signacare/shared';
import {
  DRAWING_FIELD_DEFAULT_HEIGHT,
  DRAWING_FIELD_DEFAULT_WIDTH,
  describeCapturedDrawingChips,
  describeDrawingFieldForText,
  formatDrawingMetricsChips,
  isDrawingField,
  makeEmptyDrawingFieldPayload,
  readDrawingFieldValue,
} from './drawingField';
import type { TemplateField } from './TemplateFormRenderer';

function buildMetrics(overrides: Partial<DrawingMetrics> = {}): DrawingMetrics {
  return {
    strokeCount: 1,
    totalPoints: 2,
    cumulativeStrokeDurationMs: null,
    pressure: null,
    boundingBox: null,
    canvasCoverageRatio: null,
    ...overrides,
  };
}

describe('isDrawingField', () => {
  it('returns true for a drawing field', () => {
    const field: TemplateField = { type: 'drawing', label: 'Pentagons' };
    expect(isDrawingField(field)).toBe(true);
  });

  it.each<TemplateField['type']>([
    'heading', 'instruction', 'text_block', 'short_answer', 'yes_no',
    'multiple_choice', 'multi_select', 'likert', 'score',
  ])('returns false for non-drawing field type %s', (type) => {
    const field: TemplateField = { type, label: 'x' };
    expect(isDrawingField(field)).toBe(false);
  });
});

describe('readDrawingFieldValue', () => {
  it('returns null for a missing / non-string FormValues slot', () => {
    expect(readDrawingFieldValue(undefined)).toBeNull();
    expect(readDrawingFieldValue(42)).toBeNull();
    expect(readDrawingFieldValue(['stroke'])).toBeNull();
  });

  it('returns null for an unparseable string', () => {
    expect(readDrawingFieldValue('not json')).toBeNull();
    expect(readDrawingFieldValue('{"bad":1}')).toBeNull();
  });

  it('returns the parsed DrawingPayload when the slot carries a valid serialised payload', () => {
    const payload = makeEmptyDrawingFieldPayload();
    const raw = serializeDrawingPayload(payload);
    const round = readDrawingFieldValue(raw);
    expect(round).toEqual(payload);
  });

  it('returns the parsed payload for a captured drawing too', () => {
    const captured = emptyDrawingPayload(640, 480);
    captured.strokes.push({ points: [{ x: 10, y: 10 }, { x: 12, y: 12 }] });
    const round = readDrawingFieldValue(serializeDrawingPayload(captured));
    expect(round).toEqual(captured);
  });
});

describe('describeDrawingFieldForText', () => {
  it('returns "not-captured" when the slot is empty', () => {
    expect(describeDrawingFieldForText(undefined)).toBe('not-captured');
    expect(describeDrawingFieldForText('')).toBe('not-captured');
  });

  it('returns "not-captured" when the slot carries a payload with zero strokes', () => {
    const empty = makeEmptyDrawingFieldPayload();
    expect(describeDrawingFieldForText(serializeDrawingPayload(empty))).toBe('not-captured');
  });

  it('returns "captured" as soon as the payload contains at least one stroke', () => {
    const drawn = emptyDrawingPayload(800, 500);
    drawn.strokes.push({ points: [{ x: 1, y: 1 }] });
    expect(describeDrawingFieldForText(serializeDrawingPayload(drawn))).toBe('captured');
  });

  it('returns "not-captured" for unparseable input rather than throwing', () => {
    expect(describeDrawingFieldForText('not json')).toBe('not-captured');
  });
});

describe('makeEmptyDrawingFieldPayload', () => {
  it('produces a parseable payload at the canonical schema version', () => {
    const empty = makeEmptyDrawingFieldPayload();
    expect(empty).toEqual({
      schemaVersion: DRAWING_PAYLOAD_SCHEMA_VERSION,
      width: DRAWING_FIELD_DEFAULT_WIDTH,
      height: DRAWING_FIELD_DEFAULT_HEIGHT,
      strokes: [],
    });
  });

  it('round-trips through the canonical serializer / parser', () => {
    const empty = makeEmptyDrawingFieldPayload();
    expect(readDrawingFieldValue(serializeDrawingPayload(empty))).toEqual(empty);
  });
});

describe('formatDrawingMetricsChips — stroke count', () => {
  it('always renders a stroke-count chip (including the zero-stroke clinical signal)', () => {
    expect(formatDrawingMetricsChips(buildMetrics({ strokeCount: 0 }))).toContain('0 strokes');
  });

  it('uses the singular form for exactly one stroke', () => {
    expect(formatDrawingMetricsChips(buildMetrics({ strokeCount: 1 }))).toContain('1 stroke');
  });

  it('uses the plural form for multi-stroke captures', () => {
    expect(formatDrawingMetricsChips(buildMetrics({ strokeCount: 12 }))).toContain('12 strokes');
  });
});

describe('formatDrawingMetricsChips — drawing time', () => {
  it('omits the drawing-time chip when timing data is absent', () => {
    const chips = formatDrawingMetricsChips(buildMetrics({ cumulativeStrokeDurationMs: null }));
    expect(chips.some((c) => /drawing time/.test(c))).toBe(false);
  });

  it('formats sub-minute durations as seconds with one decimal', () => {
    const chips = formatDrawingMetricsChips(buildMetrics({ cumulativeStrokeDurationMs: 4700 }));
    expect(chips).toContain('4.7s drawing time');
  });

  it('formats >= 60 second durations as minutes + seconds', () => {
    // 92.4 s → 1 m 32 s (round of 32.4 → 32)
    const chips = formatDrawingMetricsChips(buildMetrics({ cumulativeStrokeDurationMs: 92_400 }));
    expect(chips).toContain('1m 32s drawing time');
  });
});

describe('formatDrawingMetricsChips — pressure summary', () => {
  it('omits the pressure chip when no pressure data was captured', () => {
    const chips = formatDrawingMetricsChips(buildMetrics({ pressure: null }));
    expect(chips.some((c) => /Pressure/.test(c))).toBe(false);
  });

  it('formats the mean to two decimal places', () => {
    const chips = formatDrawingMetricsChips(buildMetrics({
      pressure: { mean: 0.456, min: 0.2, max: 0.8 },
    }));
    expect(chips).toContain('Pressure 0.46');
  });
});

describe('formatDrawingMetricsChips — canvas coverage', () => {
  it('omits the coverage chip when no bounding box was derived', () => {
    const chips = formatDrawingMetricsChips(buildMetrics({ canvasCoverageRatio: null }));
    expect(chips.some((c) => /Coverage/.test(c))).toBe(false);
  });

  it('formats the coverage ratio as a whole percentage', () => {
    const chips = formatDrawingMetricsChips(buildMetrics({ canvasCoverageRatio: 0.247 }));
    expect(chips).toContain('Coverage 24%');
  });

  it('floors sub-percent coverage to 0% (surfaces micrographia marker visually)', () => {
    const chips = formatDrawingMetricsChips(buildMetrics({ canvasCoverageRatio: 0.0008 }));
    expect(chips).toContain('Coverage 0%');
  });
});

describe('describeCapturedDrawingChips', () => {
  it('returns an empty array on null payload', () => {
    expect(describeCapturedDrawingChips(null)).toEqual([]);
  });

  it('returns at least the stroke-count chip for a captured payload', () => {
    const payload = makeEmptyDrawingFieldPayload();
    payload.strokes.push({ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
    const chips = describeCapturedDrawingChips(payload);
    expect(chips.length).toBeGreaterThan(0);
    expect(chips).toContain('1 stroke');
  });
});
