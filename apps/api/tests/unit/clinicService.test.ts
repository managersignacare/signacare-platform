import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClinicCreateDTO } from '@signacare/shared';
import { ClinicService } from '../../src/features/clinic/clinicService';
import type { ClinicRow } from '../../src/features/clinic/clinicRepository';

const adminAlertMock = vi.hoisted(() => ({
  sendAdminAlert: vi.fn(async () => undefined),
}));

vi.mock('../../src/features/patient-outreach/adminAlert', () => ({
  sendAdminAlert: adminAlertMock.sendAdminAlert,
}));

type ClinicRowWithAdminSlots = ClinicRow & {
  nominated_admin_staff_id?: string | null;
  delegated_admin_staff_id?: string | null;
};

function makeClinicRow(overrides: Partial<ClinicRowWithAdminSlots> = {}): ClinicRowWithAdminSlots {
  const now = new Date('2026-05-13T00:00:00.000Z');
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Test Clinic',
    legal_name: null,
    abn: null,
    address_line1: null,
    address_line2: null,
    suburb: null,
    state: null,
    postcode: null,
    country: null,
    phone: null,
    email: null,
    timezone: 'Australia/Melbourne',
    time_zone: 'Australia/Melbourne',
    is_active: true,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    hpio: '8003621234567890',
    npds_conformance_id: null,
    erx_etp1_site_id: null,
    nominated_admin_staff_id: null,
    delegated_admin_staff_id: null,
    ...overrides,
  };
}

function makeCreateDto(): ClinicCreateDTO {
  return {
    name: 'Test Clinic',
    timeZone: 'Australia/Melbourne',
    isActive: true,
    hpio: '8003621234567890',
  };
}

describe('ClinicService.createClinic admin-slot bootstrap alert', () => {
  beforeEach(() => {
    adminAlertMock.sendAdminAlert.mockReset();
    adminAlertMock.sendAdminAlert.mockResolvedValue(undefined);
  });

  it('emits admin alert when nominated/delegated admin slots are both missing', async () => {
    const repo = {
      insert: vi.fn(async () => makeClinicRow()),
    } as unknown as ConstructorParameters<typeof ClinicService>[0];
    const service = new ClinicService(repo);

    await service.createClinic(makeCreateDto());

    expect(adminAlertMock.sendAdminAlert).toHaveBeenCalledTimes(1);
    expect(adminAlertMock.sendAdminAlert).toHaveBeenCalledWith({
      clinicId: '11111111-1111-1111-1111-111111111111',
      kind: 'clinic_admin_slots_unconfigured',
      payload: expect.objectContaining({
        source: 'clinicService.createClinic',
        reason: 'bootstrap_admin_slots_missing',
      }),
    });
  });

  it('does not emit admin alert when at least one admin slot is configured', async () => {
    const repo = {
      insert: vi.fn(async () =>
        makeClinicRow({
          nominated_admin_staff_id: '22222222-2222-2222-2222-222222222222',
        })),
    } as unknown as ConstructorParameters<typeof ClinicService>[0];
    const service = new ClinicService(repo);

    await service.createClinic(makeCreateDto());

    expect(adminAlertMock.sendAdminAlert).not.toHaveBeenCalled();
  });

  it('keeps clinic creation successful even if admin alert dispatch throws', async () => {
    adminAlertMock.sendAdminAlert.mockRejectedValueOnce(new Error('alert-failure'));

    const repo = {
      insert: vi.fn(async () => makeClinicRow()),
    } as unknown as ConstructorParameters<typeof ClinicService>[0];
    const service = new ClinicService(repo);

    const out = await service.createClinic(makeCreateDto());

    expect(out.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(adminAlertMock.sendAdminAlert).toHaveBeenCalledTimes(1);
  });
});
