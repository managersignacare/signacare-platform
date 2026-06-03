// apps/api/src/jobs/workers/hl7Worker.ts
// NOTE: Source in the spec was partially truncated (BullMQ Worker class wrapper).
// HL7 builder, parser, and utility helpers are complete as extracted.
import { Worker, Queue, UnrecoverableError } from 'bullmq';
import logger from '../../utils/logger';
import * as pathologyRepo from '../../features/pathology/pathologyRepository';
import { dispatchHl7 } from '../../integrations/hl7/hl7Transport';
import { getHl7OutboundRetryProfile, type Hl7OutboundUrgency } from '../../integrations/hl7/hl7OutboundRetryProfile';
import { AppError } from '../../shared/errors';
import { writeAuditLog } from '../../utils/audit';
// BUG-042 — canonical shutdown registry (static import per §9.6).
import { registerShutdownHook } from '../../shared/gracefulShutdown';

const connection = { host: process.env['REDIS_HOST'] ?? 'localhost', port: 6379 };

// ─── HL7 v2.5 ORM^O01 Builder ─────────────────────────────────────────────────
function buildOrmO01(
  orderNumber: string,
  panelName: string,
  tests: string[],
  patientId: string,
  urgency: string,
): string {
  const now = formatHL7DateTime(new Date());
  const msh = `MSH|^~\\&|SIGNACARE_EMR||LAB||${now}||ORM^O01|${orderNumber}|P|2.5`;
  const pid = `PID|1||${patientId}^^^SIGNACARE`;
  const orc = `ORC|NW|${orderNumber}|||||||${now}`;
  const obr = `OBR|1|${orderNumber}||${panelName}|||${now}||||${urgency === 'stat' ? 'S' : urgency === 'urgent' ? 'A' : 'R'}`;
  const obrRows = tests
    .map((t, i) => `OBX|${i + 1}|ST|${t}||||||`)
    .join('\r');
  return [msh, pid, orc, obr, obrRows].filter(Boolean).join('\r');
}

// ─── HL7 v2 Parser ────────────────────────────────────────────────────────────
interface ParsedObservation {
  testCode: string;
  testName: string;
  resultValue: string;
  resultUnit?: string;
  referenceRange?: string;
  hl7Flag: string;
  resultStatus: string;
}

interface ParsedOruR01 {
  orderNumber: string;
  collectionDate: string;
  resultDate: string;
  performingLab: string;
  observations: ParsedObservation[];
}

function parseOruR01(hl7: string): ParsedOruR01 {
  const segments = hl7.split('\r').filter(Boolean);
  const get = (seg: string, field: number, sub?: number): string => {
    const fields = seg.split('|');
    const f = fields[field] ?? '';
    if (sub !== undefined) return f.split('^')[sub] ?? '';
    return f;
  };
  const obr = segments.find((s) => s.startsWith('OBR')) ?? '';
  const orderNumber = get(obr, 2);
  const collectionDate = formatIso(get(obr, 7).substring(0, 8));
  const resultDate = formatIso(get(obr, 22).substring(0, 8) || get(obr, 7).substring(0, 8));
  const performingLab = get(obr, 28, 0) || 'Unknown Lab';
  const observations: ParsedObservation[] = segments
    .filter((s) => s.startsWith('OBX'))
    .map((obx) => ({
      testCode: get(obx, 3, 0),
      testName: get(obx, 3, 1),
      resultValue: get(obx, 5),
      resultUnit: get(obx, 6, 0) || undefined,
      referenceRange: get(obx, 7) || undefined,
      hl7Flag: get(obx, 8),
      resultStatus: get(obx, 11),
    }));
  return { orderNumber, collectionDate, resultDate, performingLab, observations };
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function formatHL7DateTime(d: Date): string {
  return d.toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
}

function formatIso(hl7Date: string): string {
  if (hl7Date.length < 8) return new Date().toISOString().slice(0, 10);
  return `${hl7Date.slice(0, 4)}-${hl7Date.slice(4, 6)}-${hl7Date.slice(6, 8)}`;
}

type AbnormalFlag =
  | 'normal'
  | 'low'
  | 'high'
  | 'critical_low'
  | 'critical_high'
  | 'abnormal';

export function mapHL7Flag(flag: string): AbnormalFlag {
  const map: Record<string, AbnormalFlag> = {
    '': 'normal',
    N: 'normal',
    L: 'low',
    H: 'high',
    LL: 'critical_low',
    HH: 'critical_high',
    A: 'abnormal',
  };
  return map[flag.toUpperCase()] ?? 'abnormal';
}

type ResultStatus = 'preliminary' | 'final' | 'corrected' | 'cancelled';

export function mapHL7ResultStatus(status: string): ResultStatus {
  const map: Record<string, ResultStatus> = {
    P: 'preliminary',
    F: 'final',
    C: 'corrected',
    X: 'cancelled',
  };
  return map[status.toUpperCase()] ?? 'final';
}

// ─── BullMQ Outbound Worker (send ORM^O01 to lab) ────────────────────────────
// BUG-238: build → dispatch via hl7Transport → record outcome + audit.
// Error discipline:
//   - HL7_TRANSPORT_NOT_CONFIGURED → write audit + admin alert + throw
//     UnrecoverableError (retrying won't set env vars).
//   - HL7_TRANSPORT_PROTOCOL_UNSUPPORTED → UnrecoverableError (same logic —
//     the protocol won't become supported between retries).
//   - Any other transport failure → throw; BullMQ retries. Retry-exhausted
//     jobs land in the `failed` handler below which flips status to
//     'failed' and alerts admin.
//
// Exported so integration tests can invoke the processor with a synthetic
// job object without round-tripping through BullMQ orchestration.
export interface OutboundJobData {
  orderId: string;
  clinicId: string;
  orderNumber: string;
  urgency?: Hl7OutboundUrgency;
}
export async function processOutboundHl7Job(job: { data: OutboundJobData }): Promise<void> {
    const { orderId, clinicId, orderNumber } = job.data;
    const order = await pathologyRepo.findOrderByIdAdmin(clinicId, orderId);
    if (!order) {
      logger.warn({ orderId }, 'HL7 outbound: order not found, skipping');
      return;
    }

    const hl7 = buildOrmO01(
      orderNumber,
      order.panel_name,
      order.tests,
      order.patient_id,
      order.urgency,
    );

    try {
      const result = await dispatchHl7(hl7);
      await pathologyRepo.recordTransportOutcomeAdmin(clinicId, orderId, {
        status: 'sent',
        hl7Message: hl7,
        sentAt: result.transmittedAt,
      });
      await writeAuditLog({
        clinicId,
        action: 'HL7_DISPATCH_SUCCESS',
        tableName: 'pathology_orders',
        recordId: orderId,
        newData: {
          orderNumber,
          protocol: result.protocol,
          ackSummary: result.ack.slice(0, 120),
        },
      });
      logger.info(
        { orderId, orderNumber, protocol: result.protocol },
        'HL7 outbound: dispatched + ACK received',
      );
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'HL7_TRANSPORT_UNKNOWN';
      const message = err instanceof Error ? err.message : String(err);

      if (err instanceof AppError && err.code === 'HL7_TRANSPORT_NOT_CONFIGURED') {
        // L4 fix: flip status to 'held' so the clinician-facing view
        // reflects non-delivery (not still 'pending'). Writes are
        // best-effort — if the status write fails, the audit + alert
        // still run so the signal isn't fully lost.
        try {
          await pathologyRepo.recordTransportOutcomeAdmin(clinicId, orderId, { status: 'held' });
        } catch (statusErr) {
          logger.warn(
            { err: statusErr },
            'HL7 outbound: held-status write failed (non-blocking)',
          );
        }
        // Fail-loud: audit + admin alert inline, then skip retries.
        await writeAuditLog({
          clinicId,
          action: 'HL7_DISPATCH_HELD_UNCONFIGURED',
          tableName: 'pathology_orders',
          recordId: orderId,
          newData: { orderNumber, code, message },
        });
        try {
          const { sendAdminAlert } = await import('../../features/patient-outreach/adminAlert');
          await sendAdminAlert({
            clinicId,
            kind: 'integration_unreachable',
            payload: {
              integration: 'hl7-outbound',
              reason: 'not-configured',
              orderId,
              orderNumber,
              raisedAt: new Date().toISOString(),
            },
          });
        } catch (alertErr) {
          logger.warn(
            { err: alertErr },
            'HL7 outbound: admin alert dispatch failed (non-blocking)',
          );
        }
        throw new UnrecoverableError(message);
      }

      if (err instanceof AppError && err.code === 'HL7_TRANSPORT_PROTOCOL_UNSUPPORTED') {
        // L4 fix: status → 'held' so the clinician surface reflects
        // non-delivery rather than "pending" indefinitely.
        try {
          await pathologyRepo.recordTransportOutcomeAdmin(clinicId, orderId, { status: 'held' });
        } catch (statusErr) {
          logger.warn(
            { err: statusErr },
            'HL7 outbound: held-status write failed (non-blocking)',
          );
        }
        await writeAuditLog({
          clinicId,
          action: 'HL7_DISPATCH_FAILURE',
          tableName: 'pathology_orders',
          recordId: orderId,
          newData: { orderNumber, code, message },
        });
        throw new UnrecoverableError(message);
      }

      // Retryable failure (NACK, timeout, socket-error, unknown): audit
      // and rethrow so BullMQ applies its retry policy. The `failed`
      // handler below reacts only when retries are exhausted.
      await writeAuditLog({
        clinicId,
        action: 'HL7_DISPATCH_FAILURE',
        tableName: 'pathology_orders',
        recordId: orderId,
        newData: { orderNumber, code, message },
      });
      throw err;
    }
}

// L5 fix: guard BullMQ worker registration so importing this module
// in tests doesn't auto-subscribe to the real Redis queue. Tests
// invoke processOutboundHl7Job directly with a synthetic job object.
// Production + dev still register normally.
const outboundWorker: Worker | null =
  process.env.NODE_ENV === 'test'
    ? null
    : new Worker(
        'hl7-outbound',
        processOutboundHl7Job,
        { connection, concurrency: 5 },
      );

interface OutboundFailureJobLike {
  data: OutboundJobData;
  attemptsMade?: number;
  opts?: {
    attempts?: number;
  };
}

// Audit Tier 7.4 (MED-I1) — failed-permanent handler. BullMQ's
// `failed` event fires on EVERY attempt failure, so we only act when
// attemptsMade equals opts.attempts (i.e. the queue has exhausted
// retries). Action: audit_log row + admin alert + mark the order
// status as 'failed' so the clinic surface shows it needs manual
// attention (paper fax / call the lab).
export async function handleOutboundHl7JobFailure(
  job: OutboundFailureJobLike | null,
  err: Error,
): Promise<void> {
  if (!job) return;

  // BUG-238 — the inline worker handler already wrote the audit row +
  // admin alert for UnrecoverableError paths (NOT_CONFIGURED /
  // PROTOCOL_UNSUPPORTED). Skip here to avoid duplicated side effects.
  const errCode = err instanceof AppError ? err.code : undefined;
  const isHandledInline =
    err.name === 'UnrecoverableError' ||
    errCode === 'HL7_TRANSPORT_NOT_CONFIGURED' ||
    errCode === 'HL7_TRANSPORT_PROTOCOL_UNSUPPORTED';
  if (isHandledInline) return;

  const attemptsMade = job.attemptsMade ?? 0;
  const maxAttempts = job.opts?.attempts ?? 1;
  const { orderId, clinicId, orderNumber } = job.data;
  const rawUrgency = (job.data as { urgency?: string }).urgency;
  const urgency: Hl7OutboundUrgency =
    rawUrgency === 'stat' || rawUrgency === 'urgent' || rawUrgency === 'routine'
      ? rawUrgency
      : 'routine';
  const retryProfile = getHl7OutboundRetryProfile(urgency);
  const earlyAlertAttempt = retryProfile.alertAtAttempt;

  // BUG-263 — STAT orders should surface failure signal before final
  // retry exhaustion. We emit an early integration_unreachable alert at
  // the configured failed-attempt threshold while allowing remaining
  // retries to proceed.
  if (
    urgency === 'stat' &&
    earlyAlertAttempt !== null &&
    attemptsMade === earlyAlertAttempt
  ) {
    try {
      const { sendAdminAlert } = await import('../../features/patient-outreach/adminAlert');
      await sendAdminAlert({
        clinicId,
        kind: 'integration_unreachable',
        payload: {
          integration: 'hl7-outbound',
          retryProfile: 'stat',
          alertReason: 'retry-threshold-breached',
          orderId,
          orderNumber,
          attempts: attemptsMade,
          maxAttempts,
          lastError: err.message,
          raisedAt: new Date().toISOString(),
        },
      });
    } catch (alertErr) {
      logger.warn(
        { err: alertErr },
        'HL7 outbound: STAT early admin alert dispatch failed (non-blocking)',
      );
    }
  }

  if (attemptsMade < maxAttempts) return;
  logger.error(
    { orderId, orderNumber, clinicId, attempts: attemptsMade, err },
    'HL7 outbound: retries exhausted — raising admin alert',
  );
  try {
    // BUG-238: worker runs without RLS context, so use Admin variant.
    await pathologyRepo.recordTransportOutcomeAdmin(clinicId, orderId, { status: 'failed' });
  } catch (upd) {
    logger.warn({ err: upd }, 'HL7 outbound: order status update failed');
  }
  try {
    const { sendAdminAlert } = await import('../../features/patient-outreach/adminAlert');
    await sendAdminAlert({
      clinicId,
      kind: 'integration_unreachable',
      payload: {
        integration: 'hl7-outbound',
        orderId,
        orderNumber,
        attempts: attemptsMade,
        lastError: err.message,
        raisedAt: new Date().toISOString(),
      },
    });
  } catch (alertErr) {
    logger.warn(
      { err: alertErr },
      'HL7 outbound: admin alert dispatch failed (non-blocking)',
    );
  }
}

outboundWorker?.on('failed', async (job, err) => {
  await handleOutboundHl7JobFailure(job as OutboundFailureJobLike, err);
});

// ─── BullMQ Inbound Worker (receive ORU^R01 from lab) ────────────────────────
const inboundQueue = new Queue('hl7-inbound', { connection });

// Exported so integration tests covering inbound can invoke directly
// without BullMQ orchestration, matching the outbound pattern.
//
// BUG-262 — previously a stub that ACK'd and threw. Now does the real
// ingestion: parse → resolve order by (clinic_id, order_number) →
// ingest each observation via pathologyService.ingestResultFromHl7 →
// mark order complete → write audit row. Per-observation idempotency
// at the repo layer guards BullMQ retry.
//
// Non-retryable errors → UnrecoverableError (BullMQ DLQ):
//   - Parse failure (malformed HL7)
//   - Missing order number (HL7 violates ORU^R01 spec)
//   - Order not found for (clinic, order_number) — won't fix with retry
// Retryable errors (DB down, Redis down) → plain throw → BullMQ retries.
export async function processInboundHl7Job(job: {
  data: { clinicId: string; hl7Message: string };
}): Promise<void> {
  const { clinicId, hl7Message } = job.data;

  let parsed: ParsedOruR01;
  try {
    parsed = parseOruR01(hl7Message);
  } catch (e) {
    logger.error({ err: e, clinicId }, 'HL7 inbound ORU^R01: parse failed');
    throw new UnrecoverableError(
      `HL7 ORU^R01 parse failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!parsed.orderNumber) {
    logger.error({ clinicId }, 'HL7 inbound ORU^R01: missing order number');
    throw new UnrecoverableError('HL7 ORU^R01 missing required order number (OBR-2)');
  }

  const order = await pathologyRepo.findOrderByNumberAdmin(clinicId, parsed.orderNumber);
  if (!order) {
    logger.error(
      { clinicId, orderNumber: parsed.orderNumber, observations: parsed.observations.length },
      'HL7 inbound ORU^R01: order not found',
    );
    await writeAuditLog({
      clinicId,
      actorId: undefined,
      action: 'HL7_INBOUND_ORDER_NOT_FOUND',
      tableName: 'pathology_orders',
      // No order row to anchor to. Passing a non-UUID so writeAuditLog
      // (utils/audit.ts:160-169) coerces `record_id` to the nil UUID
      // and stashes the human-meaningful reference in `new_data._recordRef`.
      // Preserves the invariant that `record_id` points to a real subject
      // row when one exists, and makes "no subject row" queryable via
      // `record_id = 00000000-0000-0000-0000-000000000000 AND operation =
      // 'HL7_INBOUND_ORDER_NOT_FOUND'`.
      recordId: `hl7-inbound-order-not-found:${parsed.orderNumber}`,
      newData: {
        orderNumber: parsed.orderNumber,
        observations: parsed.observations.length,
        performingLab: parsed.performingLab,
      },
    });
    throw new UnrecoverableError(
      `HL7 ORU^R01 order ${parsed.orderNumber} not found in clinic ${clinicId}`,
    );
  }

  // Lazy-import pathologyService to avoid circular dep; BUG-238 outbound
  // already does the same pattern at line 301.
  const pathologyService = await import('../../features/pathology/pathologyService');

  const ingestedIds: string[] = [];
  for (const obs of parsed.observations) {
    const dto: import('@signacare/shared').PathologyResultIngestDTO = {
      pathologyOrderId: order.id,
      testCode: obs.testCode,
      testName: obs.testName || obs.testCode,
      resultValue: obs.resultValue,
      resultUnit: obs.resultUnit,
      referenceRange: obs.referenceRange,
      abnormalFlag: mapHL7Flag(obs.hl7Flag),
      resultStatus: mapHL7ResultStatus(obs.resultStatus),
      collectionDate: parsed.collectionDate,
      resultDate: parsed.resultDate,
      performingLab: parsed.performingLab,
      hl7Raw: hl7Message,
    };
    const result = await pathologyService.ingestResultFromHl7(clinicId, order, dto);
    ingestedIds.push(result.id);
  }

  await pathologyRepo.updateOrderStatusAdmin(clinicId, order.id, 'complete');

  await writeAuditLog({
    clinicId,
    actorId: undefined,
    action: 'HL7_INBOUND_INGESTED',
    tableName: 'pathology_results',
    recordId: order.id,
    newData: {
      orderNumber: parsed.orderNumber,
      resultCount: ingestedIds.length,
      resultIds: ingestedIds,
      performingLab: parsed.performingLab,
    },
  });

  logger.info(
    { clinicId, orderId: order.id, orderNumber: parsed.orderNumber, resultCount: ingestedIds.length },
    'HL7 inbound ORU^R01 ingested successfully',
  );
}

// L5 fix: guard BullMQ worker registration in test mode (same rationale
// as outboundWorker).
const inboundWorker: Worker | null = process.env.NODE_ENV === 'test'
  ? null
  : new Worker('hl7-inbound', processInboundHl7Job, { connection, concurrency: 5 });

if (process.env.NODE_ENV !== 'test') {
  logger.info('HL7 workers registered (outbound: hl7-outbound, inbound: hl7-inbound)');

  // BUG-042 — drain HL7 outbound + inbound workers before DB close.
  // HL7 dispatch mid-flight is the most important drain: an interrupted
  // job re-queues, and without BUG-202 idempotency the lab could
  // receive duplicate orders. Default 5s timeout sufficient for MLLP
  // (lab ACK typically returns in <1s).
  if (outboundWorker) {
    registerShutdownHook({
      name: 'bullmq-worker:hl7-outbound',
      priority: 60,
      handler: async () => { await outboundWorker.close(); },
    });
  }
  if (inboundWorker) {
    registerShutdownHook({
      name: 'bullmq-worker:hl7-inbound',
      priority: 60,
      handler: async () => { await inboundWorker.close(); },
    });
  }
}

export { inboundQueue };
