/**
 * HL7 outbound transport dispatcher (BUG-238).
 *
 * Chooses a transport based on an EXPLICIT HL7_LAB_PROTOCOL env var
 * (never inferred from host presence — PART 3.6 Explicit-Over-Implicit).
 * Currently only `mllp` is implemented. `sftp` and `rest` are reserved
 * values that throw HL7_TRANSPORT_PROTOCOL_UNSUPPORTED with a pointer
 * at the owning BUG rows (BUG-260 / BUG-261) so a future executor
 * files the work correctly rather than shipping a placeholder.
 *
 * All error paths throw AppError (per integrations/nhsd/nhsdClient.ts
 * convention). Workers interpret the error code to decide whether to
 * retry (transport failure), hold (not configured), or fail-permanent.
 *
 * Referenced from: apps/api/src/jobs/workers/hl7Worker.ts
 */

import { AppError } from '../../shared/errors';
import { sendMllpMessage } from '../pathology/mllpTransport';

export type HL7Protocol = 'mllp' | 'sftp' | 'rest';

export interface DispatchResult {
  ack: string;
  transmittedAt: Date;
  protocol: HL7Protocol;
}

/**
 * Send an outbound HL7 message via the configured transport and return
 * the lab's ACK on success.
 *
 * @throws AppError('HL7_TRANSPORT_NOT_CONFIGURED')     — env missing
 * @throws AppError('HL7_TRANSPORT_PROTOCOL_UNSUPPORTED') — sftp/rest/unknown
 * @throws AppError('HL7_TRANSPORT_NACK')               — lab sent MSA|AE/AR/CR
 * @throws AppError('HL7_TRANSPORT_TIMEOUT')            — socket timed out
 * @throws AppError('HL7_TRANSPORT_SOCKET_ERROR')       — other TCP error
 */
export async function dispatchHl7(message: string): Promise<DispatchResult> {
  const rawProtocol = process.env['HL7_LAB_PROTOCOL'];
  if (!rawProtocol) {
    throw new AppError(
      'HL7 transport not configured — set HL7_LAB_PROTOCOL (mllp) and the protocol-specific host/port env vars',
      503,
      'HL7_TRANSPORT_NOT_CONFIGURED',
    );
  }
  const protocol = rawProtocol as HL7Protocol;

  if (protocol === 'mllp') {
    if (!process.env['HL7_LAB_HOST'] || !process.env['HL7_LAB_PORT']) {
      throw new AppError(
        'MLLP protocol requires HL7_LAB_HOST and HL7_LAB_PORT env vars',
        503,
        'HL7_TRANSPORT_NOT_CONFIGURED',
      );
    }
    const result = await sendMllpMessage(message);
    if (!result.success) {
      // Distinguish NACK / timeout / other-socket-error so the worker
      // can decide on retry strategy and the audit trail records the
      // cause, not a generic failure.
      const isNack =
        result.ack?.includes('MSA|AE') === true ||
        result.ack?.includes('MSA|AR') === true ||
        result.ack?.includes('MSA|CR') === true;
      if (isNack) {
        throw new AppError(
          `Lab rejected the message (NACK): ${result.error ?? 'no detail'}`,
          502,
          'HL7_TRANSPORT_NACK',
          { ack: result.ack },
        );
      }
      if (result.error?.toLowerCase().includes('timeout') === true) {
        throw new AppError(
          result.error,
          504,
          'HL7_TRANSPORT_TIMEOUT',
        );
      }
      throw new AppError(
        result.error ?? 'MLLP send failed without diagnostic',
        502,
        'HL7_TRANSPORT_SOCKET_ERROR',
      );
    }
    return {
      ack: result.ack ?? '',
      transmittedAt: new Date(),
      protocol,
    };
  }

  if (protocol === 'sftp') {
    // Explicit refusal; do NOT ship a placeholder. Owning BUG row is
    // BUG-260. A new BUG row must land before a real SFTP lab comes on.
    throw new AppError(
      `HL7 protocol 'sftp' is not implemented. File against BUG-260 before wiring an SFTP lab.`,
      501,
      'HL7_TRANSPORT_PROTOCOL_UNSUPPORTED',
    );
  }
  if (protocol === 'rest') {
    throw new AppError(
      `HL7 protocol 'rest' is not implemented. File against BUG-261 before wiring a REST lab.`,
      501,
      'HL7_TRANSPORT_PROTOCOL_UNSUPPORTED',
    );
  }
  throw new AppError(
    `Unknown HL7 protocol '${String(rawProtocol)}' — valid values are: mllp (sftp/rest reserved)`,
    400,
    'HL7_TRANSPORT_PROTOCOL_UNSUPPORTED',
  );
}
