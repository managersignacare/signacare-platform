import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_SLOT_ALERT_DEDUPE_HOURS,
  processClinicAdminSlotBootstrapCheck,
  type ClinicAdminSlotBootstrapContext,
} from '../../src/jobs/schedulers/clinicAdminSlotBootstrapCheck';

function makeContext(
  overrides: Partial<ClinicAdminSlotBootstrapContext> = {},
): ClinicAdminSlotBootstrapContext & {
  logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
} {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    listClinicsMissingAdminSlots: vi.fn(async () => []),
    listRecentlyAlertedClinicIds: vi.fn(async () => []),
    sendMissingAdminAlert: vi.fn(async () => undefined),
    logger,
    ...overrides,
  };
}

describe('clinicAdminSlotBootstrapCheck processor', () => {
  it('returns zero outcome and logs error when clinic listing fails', async () => {
    const ctx = makeContext({
      listClinicsMissingAdminSlots: vi.fn(async () => {
        throw new Error('db-down');
      }),
    });

    const out = await processClinicAdminSlotBootstrapCheck(
      new Date('2026-05-13T10:00:00.000Z'),
      ctx,
    );

    expect(out).toEqual({
      scanned: 0,
      alerted: 0,
      skippedRecent: 0,
      errors: 0,
    });
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('logs empty signal and does not call dedupe lookup when no clinics are missing', async () => {
    const ctx = makeContext({
      listClinicsMissingAdminSlots: vi.fn(async () => []),
    });

    const out = await processClinicAdminSlotBootstrapCheck(
      new Date('2026-05-13T10:00:00.000Z'),
      ctx,
    );

    expect(out).toEqual({
      scanned: 0,
      alerted: 0,
      skippedRecent: 0,
      errors: 0,
    });
    expect(ctx.listRecentlyAlertedClinicIds).not.toHaveBeenCalled();
    expect(ctx.sendMissingAdminAlert).not.toHaveBeenCalled();
    expect(ctx.logger.info).toHaveBeenCalledWith(
      { kind: 'CLINIC_ADMIN_SLOT_BOOTSTRAP_EMPTY' },
      expect.any(String),
    );
  });

  it('applies 24h dedupe and isolates per-clinic alert failures', async () => {
    const now = new Date('2026-05-13T12:00:00.000Z');
    const clinicA = { id: 'c-a', name: 'Clinic A' };
    const clinicB = { id: 'c-b', name: 'Clinic B' };
    const clinicC = { id: 'c-c', name: 'Clinic C' };

    const ctx = makeContext({
      listClinicsMissingAdminSlots: vi.fn(async () => [clinicA, clinicB, clinicC]),
      listRecentlyAlertedClinicIds: vi.fn(async (clinicIds, cutoff) => {
        expect(clinicIds).toEqual(['c-a', 'c-b', 'c-c']);
        expect(cutoff.toISOString()).toBe(
          new Date(now.getTime() - ADMIN_SLOT_ALERT_DEDUPE_HOURS * 60 * 60 * 1000).toISOString(),
        );
        return ['c-a'];
      }),
      sendMissingAdminAlert: vi.fn(async (clinic) => {
        if (clinic.id === 'c-c') throw new Error('dispatch-failed');
      }),
    });

    const out = await processClinicAdminSlotBootstrapCheck(now, ctx);

    expect(out).toEqual({
      scanned: 3,
      alerted: 1,
      skippedRecent: 1,
      errors: 1,
    });
    expect(ctx.sendMissingAdminAlert).toHaveBeenCalledTimes(2);
    expect(ctx.sendMissingAdminAlert).toHaveBeenCalledWith(clinicB);
    expect(ctx.sendMissingAdminAlert).toHaveBeenCalledWith(clinicC);
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'c-c' }),
      expect.stringContaining('failed to send missing-admin alert'),
    );
  });
});
