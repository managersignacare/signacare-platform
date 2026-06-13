/**
 * parseTemplateFields drawing-field pass-through (P-CLAUDE-LANE 4B).
 *
 * The deserializer's validTypes allowlist is the single point where a
 * built-in or clinic-supplied template's 'drawing' field could be
 * silently dropped before it reaches the renderer. This test pins the
 * pass-through so a future refactor of the allowlist cannot
 * re-introduce the BUG-class "save doesn't render" failure.
 */
import { describe, expect, it } from 'vitest';
import type { FormValues, TemplateField } from '../../../../../shared/components/TemplateFormRenderer';
import {
  emptyDrawingPayload,
  serializeDrawingPayload,
  type DrawingPayload,
} from '@signacare/shared';
import { extractCapturedDrawings, parseTemplateFields } from './assessmentsTemplateUtils';

// The deserializer's contract is to take wire-shaped content (which
// arrives as raw JSON / unknown at runtime) and produce a TemplateField
// array. These tests intentionally feed wire-shaped values via an
// `unknown` cast rather than the static TemplateField[] type so the
// deserializer's runtime allowlist + reject path are both exercised.
function asRawContent<T>(raw: T): TemplateField[] {
  return raw as unknown as TemplateField[];
}

describe('parseTemplateFields — drawing field pass-through', () => {
  it('accepts a drawing field and preserves its label', () => {
    const fields = parseTemplateFields(asRawContent([
      { type: 'drawing', label: 'Intersecting pentagons — copy the figure (tablet capture)' },
    ]));
    expect(fields).toHaveLength(1);
    expect(fields[0].type).toBe('drawing');
    expect(fields[0].label).toBe('Intersecting pentagons — copy the figure (tablet capture)');
  });

  it('round-trips a stringified content array containing a drawing field', () => {
    const raw = JSON.stringify([
      { type: 'heading', text: 'MoCA' },
      { type: 'drawing', label: 'Cube' },
      { type: 'drawing', label: 'Clock 11:10' },
    ]);
    const fields = parseTemplateFields(raw);
    expect(fields).toHaveLength(3);
    expect(fields[1].type).toBe('drawing');
    expect(fields[1].label).toBe('Cube');
    expect(fields[2].type).toBe('drawing');
    expect(fields[2].label).toBe('Clock 11:10');
  });

  it('drops a field with an unknown type rather than silently passing it through', () => {
    const fields = parseTemplateFields(asRawContent([
      { type: 'unknown_field_type', label: 'should be dropped' },
      { type: 'drawing', label: 'should survive' },
    ]));
    expect(fields).toHaveLength(1);
    expect(fields[0].type).toBe('drawing');
  });
});

/**
 * P-CLAUDE-LANE 4B/4 — captured drawings persistence helper.
 *
 * extractCapturedDrawings walks the template fields, picks out the
 * drawing-typed ones, and emits a self-describing artefact (label +
 * serialised payload) for each one the clinician actually populated.
 * Empty / unparseable / not-captured slots are skipped so the saved
 * record stays lean and the expand-view does not render empty
 * placeholder canvases.
 */
describe('extractCapturedDrawings', () => {
  function capturedPayload(): string {
    const payload: DrawingPayload = emptyDrawingPayload(800, 500);
    payload.strokes.push({ points: [{ x: 10, y: 10 }, { x: 12, y: 12 }] });
    return serializeDrawingPayload(payload);
  }

  function emptyPayload(): string {
    return serializeDrawingPayload(emptyDrawingPayload(800, 500));
  }

  it('returns an empty array when the template has no drawing fields', () => {
    const fields: TemplateField[] = [
      { type: 'heading', text: 'MMSE' },
      { type: 'likert', label: 'Orientation', min: 0, max: 5 },
    ];
    const values: FormValues = { '1': 3 };
    expect(extractCapturedDrawings(fields, values)).toEqual([]);
  });

  it('returns an empty array when drawing fields exist but none were populated', () => {
    const fields: TemplateField[] = [
      { type: 'drawing', label: 'Pentagons' },
      { type: 'drawing', label: 'Cube' },
    ];
    const values: FormValues = {
      '0': emptyPayload(),
      '1': '',
    };
    expect(extractCapturedDrawings(fields, values)).toEqual([]);
  });

  it('returns one artefact per populated drawing field, preserving labels in field order', () => {
    const fields: TemplateField[] = [
      { type: 'heading', text: 'MoCA' },
      { type: 'likert', label: 'Visuospatial', min: 0, max: 5 },
      { type: 'drawing', label: 'Cube' },
      { type: 'drawing', label: 'Clock 11:10' },
      { type: 'score', label: 'Total', formula: 'sum' },
    ];
    const cube = capturedPayload();
    const clock = capturedPayload();
    const values: FormValues = {
      '1': 4,
      '2': cube,
      '3': clock,
    };
    const captured = extractCapturedDrawings(fields, values);
    expect(captured).toEqual([
      { label: 'Cube', payload: cube },
      { label: 'Clock 11:10', payload: clock },
    ]);
  });

  it('skips drawing fields whose slot is missing / not a string', () => {
    const fields: TemplateField[] = [
      { type: 'drawing', label: 'Pentagons' },
      { type: 'drawing', label: 'Cube' },
    ];
    const values: FormValues = {
      '0': capturedPayload(),
      // '1' missing
    };
    const captured = extractCapturedDrawings(fields, values);
    expect(captured).toHaveLength(1);
    expect(captured[0].label).toBe('Pentagons');
  });

  it('skips drawing fields whose serialised payload fails to parse', () => {
    const fields: TemplateField[] = [
      { type: 'drawing', label: 'Pentagons' },
      { type: 'drawing', label: 'Cube' },
    ];
    const values: FormValues = {
      '0': 'not a json payload',
      '1': capturedPayload(),
    };
    const captured = extractCapturedDrawings(fields, values);
    expect(captured).toHaveLength(1);
    expect(captured[0].label).toBe('Cube');
  });

  it('falls back to "Drawing N" when a drawing field has no label', () => {
    const fields: TemplateField[] = [
      { type: 'drawing' },
    ];
    const values: FormValues = {
      '0': capturedPayload(),
    };
    const captured = extractCapturedDrawings(fields, values);
    expect(captured).toEqual([
      { label: 'Drawing 1', payload: values['0'] },
    ]);
  });
});
