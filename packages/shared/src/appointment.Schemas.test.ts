import { describe, expect, it } from 'vitest';
import {
  AppointmentModeSchema,
  CreateAppointmentDTO,
  UpdateAppointmentDTO,
} from './appointment.Schemas';

/**
 * Source-of-truth contract tests for the appointment create/update DTOs.
 *
 * Specifically pins the operator-defined acceptance targets for the
 * Calendar tranche:
 *
 *   - title is NOT a mandatory field on the create DTO. The shared
 *     schema does not declare a `title` key at all; this test asserts
 *     a minimal payload (no title) parses successfully and that an
 *     unknown `title` key is gracefully ignored (Zod default behavior
 *     for object schemas — no .strict()).
 *
 *   - mode is pinned to exactly {direct, telehealth, videoconference,
 *     other}. Any drift away from that set should fail Zod parsing
 *     and the test loudly.
 */
describe('appointment schemas — create/update contract', () => {
  const MINIMAL_VALID_PAYLOAD = {
    patientId: '11111111-1111-1111-1111-111111111111',
    startTime: '2026-07-01T09:00:00.000Z',
    endTime: '2026-07-01T09:30:00.000Z',
  } as const;

  it('CreateAppointmentDTO accepts a payload with no title field', () => {
    const result = CreateAppointmentDTO.safeParse(MINIMAL_VALID_PAYLOAD);
    expect(result.success).toBe(true);
  });

  it('CreateAppointmentDTO does not declare a title field on its schema shape', () => {
    // The schema is a plain z.object — if a `title` key sneaks in, the
    // shape Object.keys list will include it.
    const shapeKeys = Object.keys(CreateAppointmentDTO.shape);
    expect(shapeKeys).not.toContain('title');
  });

  it('CreateAppointmentDTO tolerates an unknown title key without rejecting', () => {
    // Zod object schemas default to strip — unknown keys are silently
    // dropped, not rejected. Any future change to .strict() would break
    // this test, which is intentional: the contract must not require
    // callers to scrub a phantom title field.
    const result = CreateAppointmentDTO.safeParse({
      ...MINIMAL_VALID_PAYLOAD,
      title: 'ignored-legacy-title',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).title).toBeUndefined();
    }
  });

  it('UpdateAppointmentDTO accepts an empty patch (no title, no anything)', () => {
    const result = UpdateAppointmentDTO.safeParse({});
    expect(result.success).toBe(true);
  });

  it('AppointmentModeSchema accepts exactly the four supported values', () => {
    for (const v of ['direct', 'telehealth', 'videoconference', 'other'] as const) {
      expect(AppointmentModeSchema.safeParse(v).success).toBe(true);
    }
  });

  it('AppointmentModeSchema rejects values outside the four-option set', () => {
    for (const v of ['in_person', 'phone', 'video', 'DIRECT', '']) {
      expect(AppointmentModeSchema.safeParse(v).success).toBe(false);
    }
  });

  it('AppointmentModeSchema enum.options matches the operator-pinned four-option set exactly', () => {
    // Pin the order + set membership at the schema level so any drift
    // in shared/appointment.Schemas.ts is caught at the contract test
    // before it can ripple into the .NET split-platform parity.
    expect(AppointmentModeSchema.options).toEqual([
      'direct',
      'telehealth',
      'videoconference',
      'other',
    ]);
  });
});
