/**
 * BUG-238 regression: HL7 outbound transport dispatcher.
 *
 * Asserts the post-fix contract on the dispatcher function
 * dispatchHl7 — the HTTP-layer-style equivalent of a unit test for
 * this integration module. Separate from the integration test
 * (which exercises the full BullMQ + DB + audit chain).
 *
 * What these tests pin:
 *   1. HL7_LAB_PROTOCOL unset → NOT_CONFIGURED (not a silent stall).
 *   2. `sftp` → PROTOCOL_UNSUPPORTED pointing at BUG-260.
 *   3. `rest` → PROTOCOL_UNSUPPORTED pointing at BUG-261.
 *   4. mllp + successful ACK → resolves with DispatchResult.
 *   5. mllp + NACK from library → HL7_TRANSPORT_NACK.
 *
 * Red-first trace: running these tests against the pre-fix state
 * (no dispatcher module) produces a module-resolution error on
 * every test — they cannot even load. After the fix, all 5 pass.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AppError } from '../../src/shared/errors';

// sendMllpMessage is the seam we control. vi.hoisted keeps the mock
// refs accessible to both the factory and the test bodies.
const mllpMock = vi.hoisted(() => ({
  sendMllpMessage: vi.fn(),
}));
vi.mock('../../src/integrations/pathology/mllpTransport', () => ({
  sendMllpMessage: mllpMock.sendMllpMessage,
  isMllpConfigured: () => true,
  startMllpListener: vi.fn(),
}));

// Logger stub (the mllpTransport module imports logger at the top
// level of its sibling, not ours, but keep noise down anyway).
vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { dispatchHl7 } from '../../src/integrations/hl7/hl7Transport';

beforeEach(() => {
  delete process.env['HL7_LAB_PROTOCOL'];
  delete process.env['HL7_LAB_HOST'];
  delete process.env['HL7_LAB_PORT'];
  mllpMock.sendMllpMessage.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('BUG-238 — dispatchHl7', () => {
  it('HL7_LAB_PROTOCOL unset → AppError HL7_TRANSPORT_NOT_CONFIGURED', async () => {
    await expect(dispatchHl7('MSH|...')).rejects.toMatchObject({
      code: 'HL7_TRANSPORT_NOT_CONFIGURED',
      status: 503,
    });
    expect(mllpMock.sendMllpMessage).not.toHaveBeenCalled();
  });

  it('HL7_LAB_PROTOCOL=sftp → HL7_TRANSPORT_PROTOCOL_UNSUPPORTED referencing BUG-260', async () => {
    process.env['HL7_LAB_PROTOCOL'] = 'sftp';
    const err = await dispatchHl7('MSH|...').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('HL7_TRANSPORT_PROTOCOL_UNSUPPORTED');
    expect((err as AppError).status).toBe(501);
    expect((err as AppError).message).toContain('BUG-260');
    expect(mllpMock.sendMllpMessage).not.toHaveBeenCalled();
  });

  it('HL7_LAB_PROTOCOL=rest → HL7_TRANSPORT_PROTOCOL_UNSUPPORTED referencing BUG-261', async () => {
    process.env['HL7_LAB_PROTOCOL'] = 'rest';
    const err = await dispatchHl7('MSH|...').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('HL7_TRANSPORT_PROTOCOL_UNSUPPORTED');
    expect((err as AppError).message).toContain('BUG-261');
    expect(mllpMock.sendMllpMessage).not.toHaveBeenCalled();
  });

  it('mllp + successful ACK → DispatchResult with ack and protocol=mllp', async () => {
    process.env['HL7_LAB_PROTOCOL'] = 'mllp';
    process.env['HL7_LAB_HOST'] = 'lab.example.com';
    process.env['HL7_LAB_PORT'] = '2575';
    const ack = 'MSH|^~\\&|LAB||SIGNACARE_EMR||20260420||ACK^R01|ACK-123|P|2.5\rMSA|AA|ORD-123';
    mllpMock.sendMllpMessage.mockResolvedValue({ success: true, ack });

    const result = await dispatchHl7('MSH|^~\\&|SIGNACARE_EMR||LAB||20260420||ORM^O01|ORD-123|P|2.5');

    expect(result.protocol).toBe('mllp');
    expect(result.ack).toBe(ack);
    expect(result.transmittedAt).toBeInstanceOf(Date);
    expect(mllpMock.sendMllpMessage).toHaveBeenCalledTimes(1);
  });

  it('mllp + NACK (MSA|AE) → HL7_TRANSPORT_NACK with ack in details', async () => {
    process.env['HL7_LAB_PROTOCOL'] = 'mllp';
    process.env['HL7_LAB_HOST'] = 'lab.example.com';
    process.env['HL7_LAB_PORT'] = '2575';
    const nackAck = 'MSH|^~\\&|LAB||SIGNACARE_EMR||20260420||ACK^R01|ACK-123|P|2.5\rMSA|AE|ORD-123|panel-unknown';
    mllpMock.sendMllpMessage.mockResolvedValue({
      success: false,
      ack: nackAck,
      error: 'Lab rejected the message (NACK)',
    });

    const err = await dispatchHl7('MSH|...').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('HL7_TRANSPORT_NACK');
    expect((err as AppError).status).toBe(502);
    expect((err as AppError).details).toMatchObject({ ack: nackAck });
  });
});
