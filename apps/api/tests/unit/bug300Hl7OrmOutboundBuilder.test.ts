import { describe, expect, it, vi, beforeEach } from 'vitest';

const transportMock = vi.hoisted(() => ({
  dispatchHl7: vi.fn(),
}));
vi.mock('../../src/integrations/hl7/hl7Transport', () => ({
  dispatchHl7: transportMock.dispatchHl7,
}));

import { AppError } from '../../src/shared/errors';
import {
  buildPharmacyOrmO01,
  dispatchPharmacyOrmO01,
  parseRdeO11DispenseConfirmation,
  type Hl7PharmacyOrderInput,
} from '../../src/integrations/hl7/hl7OrmBuilder';

const ORDER_FIXTURE: Hl7PharmacyOrderInput = {
  orderNumber: 'ORD-300-1',
  patientId: 'PAT-123',
  patientGivenName: 'Ada',
  patientFamilyName: 'Lovelace',
  prescriberStaffId: 'STAFF-111',
  medicationCode: '123456789',
  medicationDisplay: 'Clozapine 25mg tablet',
  doseAmount: '1',
  doseUnit: 'TAB',
  route: 'PO',
  frequency: 'BID',
  quantity: '60',
  quantityUnit: 'TAB',
  messageControlId: 'MCID-300-1',
};

beforeEach(() => {
  transportMock.dispatchHl7.mockReset();
});

describe('BUG-300 — HL7 ORM^O01 outbound pharmacy builder + RDE^O11 parser', () => {
  it('builds ORM^O01 with MSH/PID/ORC/RXO/RXE segments', () => {
    const message = buildPharmacyOrmO01(ORDER_FIXTURE, new Date('2026-05-14T00:00:00.000Z'));
    const segments = message.split('\r');

    expect(segments[0]).toContain('MSH|^~\\&|SIGNACARE_EMR|SIGNACARE|PHARMACY|');
    expect(segments[0]).toContain('ORM^O01');
    expect(segments[0]).toContain('MCID-300-1');
    expect(segments[1]).toContain('PID|1||PAT-123^^^SIGNACARE||Lovelace^Ada');
    expect(segments[2]).toContain('ORC|NW|ORD-300-1');
    expect(segments[3]).toContain('RXO|123456789^Clozapine 25mg tablet||1|TAB|PO|BID|60|TAB');
    expect(segments[4]).toContain('RXE|');
    expect(segments[4]).toContain('|1|TAB|BID|PO|60|TAB');
  });

  it('dispatches built ORM^O01 through existing HL7 transport', async () => {
    transportMock.dispatchHl7.mockResolvedValue({
      ack: 'MSA|AA|ORD-300-1',
      protocol: 'mllp',
      transmittedAt: new Date('2026-05-14T00:00:01.000Z'),
    });

    const out = await dispatchPharmacyOrmO01(ORDER_FIXTURE);

    expect(transportMock.dispatchHl7).toHaveBeenCalledTimes(1);
    expect(out.message).toContain('ORM^O01');
    expect(out.message).toContain('RXO|123456789^Clozapine 25mg tablet');
    expect(out.dispatch.protocol).toBe('mllp');
    expect(out.dispatch.ack).toContain('MSA|AA');
  });

  it('parses RDE^O11 dispense confirmation core fields', () => {
    const parsed = parseRdeO11DispenseConfirmation([
      'MSH|^~\\&|PHARMACY|SITEA|SIGNACARE_EMR|SIGNACARE|20260514091500||RDE^O11|RDE-ACK-1|P|2.5',
      'MSA|AA|MCID-300-1',
      'ORC|OK|ORD-300-1||F',
      'RXD|1|20260514091400|20260514091400|60|TAB',
    ].join('\r'));

    expect(parsed).toMatchObject({
      messageControlId: 'RDE-ACK-1',
      orderNumber: 'ORD-300-1',
      orderStatus: 'F',
      ackCode: 'AA',
      dispenseDateTime: '20260514091400',
      actualDispenseAmount: '60',
      actualDispenseUnit: 'TAB',
    });
  });

  it('fails closed on non-RDE message type', () => {
    expect(() => parseRdeO11DispenseConfirmation([
      'MSH|^~\\&|PHARMACY|SITEA|SIGNACARE_EMR|SIGNACARE|20260514091500||ORM^O01|RDE-ACK-1|P|2.5',
      'ORC|OK|ORD-300-1||F',
    ].join('\r'))).toThrowError(AppError);

    try {
      parseRdeO11DispenseConfirmation([
        'MSH|^~\\&|PHARMACY|SITEA|SIGNACARE_EMR|SIGNACARE|20260514091500||ORM^O01|RDE-ACK-1|P|2.5',
        'ORC|OK|ORD-300-1||F',
      ].join('\r'));
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('HL7_RDE_INVALID_MESSAGE_TYPE');
    }
  });
});

