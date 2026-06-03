import { describe, expect, it } from 'vitest';
import { buildAuditDedupeKey } from '../../src/shared/auditDedupeKey';

describe('buildAuditDedupeKey', () => {
  it('ADK-1: returns the same key for equivalent inputs (case/trim normalized)', () => {
    const keyA = buildAuditDedupeKey({
      clinicId: 'clinic-1',
      tableName: 'staff_sessions',
      recordId: 'staff-1',
      action: 'login',
      eventTimeIso: '2026-05-07T12:00:00.000Z',
    });
    const keyB = buildAuditDedupeKey({
      clinicId: 'clinic-1',
      tableName: 'staff_sessions',
      recordId: 'staff-1',
      action: 'LOGIN',
      eventTimeIso: '2026-05-07T12:00:00.000Z',
    });

    expect(keyA).toBe(keyB);
  });

  it('ADK-2: changes the key when the event time differs', () => {
    const keyA = buildAuditDedupeKey({
      clinicId: 'clinic-1',
      tableName: 'staff_sessions',
      recordId: 'staff-1',
      action: 'LOGIN',
      eventTimeIso: '2026-05-07T12:00:04.999Z',
    });
    const keyB = buildAuditDedupeKey({
      clinicId: 'clinic-1',
      tableName: 'staff_sessions',
      recordId: 'staff-1',
      action: 'LOGIN',
      eventTimeIso: '2026-05-07T12:00:05.000Z',
    });

    expect(keyA).not.toBe(keyB);
  });

  it('ADK-3: trims fields and normalizes action to uppercase', () => {
    const key = buildAuditDedupeKey({
      clinicId: ' clinic-1 ',
      tableName: ' staff_sessions ',
      recordId: ' staff-1 ',
      action: ' login ',
      eventTimeIso: '2026-05-07T12:00:00.000Z',
    });

    expect(key).toContain('audit:clinic-1:staff_sessions:staff-1:LOGIN:');
  });

  it('ADK-4: rejects invalid timestamps', () => {
    expect(() =>
      buildAuditDedupeKey({
        clinicId: 'clinic-1',
        tableName: 'staff_sessions',
        recordId: 'staff-1',
        action: 'LOGIN',
        eventTimeIso: 'not-a-date',
      }),
    ).toThrow('buildAuditDedupeKey eventTimeIso must be a valid ISO timestamp');
  });
});
