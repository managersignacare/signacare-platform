import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErxPrescriptionPayload } from '../../src/integrations/escript/erxRestPayloads';

const {
  writeAuditLogMock,
  checkoutForAmendMock,
  amendPrescriptionMock,
  ceasePrescriptionMock,
  cancelPrescriptionMock,
} = vi.hoisted(() => ({
  writeAuditLogMock: vi.fn(async () => undefined),
  checkoutForAmendMock: vi.fn(async () => ({ success: true, status: 200, body: '<ok />' })),
  amendPrescriptionMock: vi.fn(async () => ({ success: true, status: 200, body: '<ok />' })),
  ceasePrescriptionMock: vi.fn(async () => ({ success: true, status: 200, body: '<ok />' })),
  cancelPrescriptionMock: vi.fn(async () => ({ success: true, status: 200, body: '<ok />' })),
}));

vi.mock('../../src/utils/audit', () => ({
  writeAuditLog: writeAuditLogMock,
}));

vi.mock('../../src/integrations/escript/npdsClient', () => ({
  isNpdsConfigured: () => false,
  submitToNpds: vi.fn(),
  cancelOnNpds: vi.fn(),
}));

vi.mock('../../src/integrations/escript/erxAdapterService', () => ({
  erxAdapterService: {
    isConfigured: () => false,
    submit: vi.fn(),
  },
}));

vi.mock('../../src/integrations/escript/erxRestClient', () => ({
  isConfigured: () => true,
  checkoutForAmend: checkoutForAmendMock,
  amendPrescription: amendPrescriptionMock,
  ceasePrescription: ceasePrescriptionMock,
  cancelPrescription: cancelPrescriptionMock,
}));

import { escriptService } from '../../src/integrations/escript/escriptService';

const BASE_PAYLOAD: ErxPrescriptionPayload = {
  scid: '2BUGP600000000001',
  guid: '8e68b4ec-e70f-4a02-9445-7359a1e73953',
  conformanceId: 'Signacare|1.0.0',
  patient: {
    familyName: 'Citizen',
    givenName: 'Jane',
    dob: '1990-01-01',
    gender: 'F',
  },
  clinician: {
    prescriberNumber: '12345A',
    providerNumber: '12345A',
    givenName: 'Amit',
    familyName: 'Zutshi',
    practiceName: 'Signacare Clinic',
    hpii: '8003610000000008',
    hpio: '8003620000000005',
  },
  item: {
    prescriptionDate: '2026-05-15',
    tradeName: 'Clozapine 25mg',
    genericName: 'Clozapine',
    genericIntention: 'G',
    quantity: 30,
    repeats: 2,
    directions: 'Take as directed',
  },
};

describe('BUG-P6 eRx audit extension', () => {
  beforeEach(() => {
    writeAuditLogMock.mockClear();
    checkoutForAmendMock.mockClear();
    amendPrescriptionMock.mockClear();
    ceasePrescriptionMock.mockClear();
    cancelPrescriptionMock.mockClear();
  });

  it('amend operation writes regulated extension fields', async () => {
    const result = await escriptService.amendPrescription(
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      BASE_PAYLOAD.scid,
      BASE_PAYLOAD,
    );
    expect(result.success).toBe(true);
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        tableName: 'erx_tokens',
        recordId: BASE_PAYLOAD.scid,
        newData: expect.objectContaining({
          operation: 'amend',
          outcome: 'success',
          guid: BASE_PAYLOAD.guid,
          scid: BASE_PAYLOAD.scid,
          timezone: expect.any(String),
          auditSpec: 'dh3945-2B-dh4155-4',
        }),
      }),
    );
  });

  it('cease operation writes regulated extension fields', async () => {
    const result = await escriptService.ceasePrescription(
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      BASE_PAYLOAD.scid,
    );
    expect(result.success).toBe(true);
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        tableName: 'erx_tokens',
        recordId: BASE_PAYLOAD.scid,
        newData: expect.objectContaining({
          operation: 'cease',
          outcome: 'success',
          scid: BASE_PAYLOAD.scid,
          timezone: expect.any(String),
          auditSpec: 'dh3945-2B-dh4155-4',
        }),
      }),
    );
  });

  it('cancel operation writes GUID + scid + timezone extension fields', async () => {
    const result = await escriptService.cancelToken(
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      'BUGP6-TOKEN',
      'test-cancel',
      { scid: BASE_PAYLOAD.scid, prescriptionPayload: BASE_PAYLOAD },
    );
    expect(result.success).toBe(true);
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        tableName: 'erx_tokens',
        recordId: 'BUGP6-TOKEN',
        newData: expect.objectContaining({
          operation: 'cancel',
          outcome: 'attempted',
          guid: BASE_PAYLOAD.guid,
          scid: BASE_PAYLOAD.scid,
          erxToken: 'BUGP6-TOKEN',
          timezone: expect.any(String),
          auditSpec: 'dh3945-2B-dh4155-4',
        }),
      }),
    );
  });
});
