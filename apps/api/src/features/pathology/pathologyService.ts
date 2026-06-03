// apps/api/src/features/pathology/pathologyService.ts
//
// Audit Tier 3.4 (HIGH-D4) — service-layer AuthContext migration per
// CLAUDE.md §13. Clinician-facing methods enforce
// requirePatientRelationship. `ingestResult` is called from the HL7
// webhook which authenticates the LIS integration via a separate API
// key path, not a clinician session — it keeps a
// (clinicId, dto) signature but is ONLY mounted behind the integration
// auth middleware (enforced at the route layer).
import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import type { AuthContext } from '@signacare/shared';
import logger from '../../utils/logger';
import { db, dbAdmin } from '../../db/db';
import * as pathologyRepo from './pathologyRepository';
import { requirePatientRelationship } from '../../shared/authGuards';
import { ensureClinicalNoteConsent } from '../../shared/recordingConsent';
import { resolveStaffRecipientsWithAdminFallback } from '../../shared/staffActivenessResolver';
import { getHl7OutboundRetryProfile } from '../../integrations/hl7/hl7OutboundRetryProfile';
import type {
  PathologyOrderCreateDTO,
  PathologyOrderResponse,
  PathologyResultIngestDTO,
  PathologyResultResponse,
} from '@signacare/shared';

// BUG-238 L4 fix established the baseline retry posture for outbound HL7.
// BUG-263 keeps routine/urgent on that baseline while allowing per-job STAT
// overrides at enqueue time.
const hl7OutboundQueue = new Queue('hl7-outbound', {
  connection: { host: process.env['REDIS_HOST'] ?? 'localhost', port: 6379 },
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 86_400 },
    removeOnFail: { age: 604_800 },
  },
});

function generateOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `PATH-${date}-${randomUUID().substring(0, 8).toUpperCase()}`;
}

function parseJsonValue<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') return value as T;
  return null;
}

function clinicalNotesToResponse(row: Record<string, unknown>) {
  const structuredFields = parseJsonValue<Record<string, unknown>>(row['structured_fields']);
  const contactMeta = parseJsonValue<Record<string, unknown>>(row['contact_meta']);
  return {
    structuredFields,
    contactMeta,
  };
}

function mapOrder(row: Record<string, unknown>): PathologyOrderResponse {
  return {
    id: row['id'] as string,
    clinicId: row['clinic_id'] as string,
    patientId: row['patient_id'] as string,
    episodeId: (row['episode_id'] as string | null) ?? null,
    appointmentId: (row['appointment_id'] as string | null) ?? null,
    orderedById: row['ordered_by_id'] as string,
    orderNumber: row['order_number'] as string,
    panelName: row['panel_name'] as string,
    tests: Array.isArray(row['tests'])
      ? (row['tests'] as string[])
      : JSON.parse(row['tests'] as string),
    urgency: row['urgency'] as PathologyOrderResponse['urgency'],
    clinicalNotes: (row['clinical_notes'] as string | null) ?? null,
    fasting: row['fasting'] as boolean,
    copyToGp: row['copy_to_gp'] as boolean,
    status: row['status'] as PathologyOrderResponse['status'],
    hl7SentAt: (row['hl7_sent_at'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

function mapResult(row: Record<string, unknown>): PathologyResultResponse {
  return {
    id: row['id'] as string,
    clinicId: row['clinic_id'] as string,
    patientId: row['patient_id'] as string,
    pathologyOrderId: row['pathology_order_id'] as string,
    testCode: row['test_code'] as string,
    testName: row['test_name'] as string,
    resultValue: row['result_value'] as string,
    resultUnit: (row['result_unit'] as string | undefined) ?? undefined,
    referenceRange: (row['reference_range'] as string | undefined) ?? undefined,
    abnormalFlag: row['abnormal_flag'] as PathologyResultResponse['abnormalFlag'],
    resultStatus: row['result_status'] as PathologyResultResponse['resultStatus'],
    collectionDate: row['collection_date'] as string,
    resultDate: row['result_date'] as string,
    performingLab: (row['performing_lab'] as string | undefined) ?? undefined,
    hl7Raw: (row['hl7_raw'] as string | undefined) ?? undefined,
    isCritical: row['is_critical'] as boolean,
    criticalAcknowledgedAt: (row['critical_acknowledged_at'] as string | null) ?? null,
    criticalAcknowledgedById: (row['critical_acknowledged_by_id'] as string | null) ?? null,
    flagTaskId: (row['flag_task_id'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

async function resolveEpisodeIdForOrderLink(
  clinicId: string,
  patientId: string,
  requestedEpisodeId: string | undefined,
): Promise<string | null> {
  if (requestedEpisodeId) {
    const requestedEpisode = await db('episodes')
      .where({ id: requestedEpisodeId, clinic_id: clinicId, patient_id: patientId })
      .whereNull('deleted_at')
      .first('id');
    if (!requestedEpisode) {
      const err = new Error('Episode not found for pathology request') as Error & { status: number; code: string };
      err.status = 422;
      err.code = 'PATHOLOGY_EPISODE_NOT_FOUND';
      throw err;
    }
    return requestedEpisode.id as string;
  }

  const activeEpisode = await db('episodes')
    .where({ clinic_id: clinicId, patient_id: patientId, status: 'open' })
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc')
    .first('id');
  return (activeEpisode?.id as string | undefined) ?? null;
}

function buildPathologyOrderTimelineContent(
  orderNumber: string,
  dto: PathologyOrderCreateDTO,
): string {
  const lines = [
    `Pathology request created (${orderNumber}).`,
    `Panel: ${dto.panelName}`,
    `Urgency: ${dto.urgency}`,
    `Fasting: ${dto.fasting ? 'Yes' : 'No'}`,
    `Copy to GP: ${dto.copyToGp ? 'Yes' : 'No'}`,
    `Tests: ${dto.tests.join(', ')}`,
  ];
  if (dto.clinicalNotes && dto.clinicalNotes.trim().length > 0) {
    lines.push(`Clinical notes: ${dto.clinicalNotes.trim()}`);
  }
  return lines.join('\n');
}

async function createPathologyOrderEpisodeArtifacts(
  auth: AuthContext,
  order: { id: string; orderNumber: string },
  dto: PathologyOrderCreateDTO,
  episodeId: string | null,
): Promise<void> {
  if (!episodeId) return;

  const now = new Date();
  const noteId = randomUUID();
  const consentId = await ensureClinicalNoteConsent({
    clinicId: auth.clinicId,
    patientId: dto.patientId,
    clinicianId: auth.staffId,
  });
  const contactMetaPayload = {
    source: 'pathology_order',
    orderId: order.id,
    orderNumber: order.orderNumber,
    contactDate: now.toISOString().slice(0, 10),
    contactType: 'Non-face-to-face — Clinical documentation',
    contactMedium: 'Pathology request',
    patientPresent: false,
  };
  const mappedClinicalNote = clinicalNotesToResponse({
    structured_fields: null,
    contact_meta: contactMetaPayload,
  });
  void mappedClinicalNote;
  await db('clinical_notes').insert({
    id: noteId,
    clinic_id: auth.clinicId,
    patient_id: dto.patientId,
    consent_id: consentId,
    episode_id: episodeId,
    author_id: auth.staffId,
    title: `Pathology request ${order.orderNumber}`,
    note_type: 'correspondence',
    content: buildPathologyOrderTimelineContent(order.orderNumber, dto),
    status: 'signed',
    is_draft: false,
    is_signed: true,
    is_reportable_contact: true,
    contact_meta: JSON.stringify(mappedClinicalNote.contactMeta),
    signed_by_id: auth.staffId,
    signed_at: now,
    created_at: now,
    updated_at: now,
  });

  try {
    const { createAutoContactRecord } = await import('../contacts/autoContactRecord');
    await createAutoContactRecord({
      clinicId: auth.clinicId,
      patientId: dto.patientId,
      episodeId,
      staffId: auth.staffId,
      sourceType: 'correspondence',
      sourceId: noteId,
      briefSummary: `Pathology request ${order.orderNumber}`,
    });
  } catch (err) {
    logger.warn(
      { err, patientId: dto.patientId, orderId: order.id, episodeId },
      'Pathology order contact-record auto-create failed',
    );
  }
}

export async function placeOrder(
  auth: AuthContext,
  dto: PathologyOrderCreateDTO,
): Promise<PathologyOrderResponse> {
  await requirePatientRelationship(auth, dto.patientId);
  const resolvedEpisodeId = await resolveEpisodeIdForOrderLink(
    auth.clinicId,
    dto.patientId,
    dto.episodeId,
  );
  const effectiveDto: PathologyOrderCreateDTO = {
    ...dto,
    episodeId: resolvedEpisodeId ?? undefined,
  };
  const orderNumber = generateOrderNumber();
  const row = await pathologyRepo.createOrder(auth.clinicId, auth.staffId, effectiveDto, orderNumber);
  await createPathologyOrderEpisodeArtifacts(
    auth,
    { id: row.id, orderNumber },
    effectiveDto,
    resolvedEpisodeId,
  );
  // BUG-263 — urgency-aware retry profile:
  //   - routine/urgent: 5 attempts, 30s exponential (existing posture)
  //   - stat: 3 attempts, 10s exponential + early alert at attempt 2
  const retryProfile = getHl7OutboundRetryProfile(effectiveDto.urgency);
  await hl7OutboundQueue.add(
    'send-order',
    { orderId: row.id, clinicId: auth.clinicId, orderNumber, urgency: effectiveDto.urgency },
    { attempts: retryProfile.attempts, backoff: retryProfile.backoff },
  );
  logger.info({ orderId: row.id, orderNumber }, 'Pathology order placed, HL7 job queued');
  return mapOrder(row as unknown as Record<string, unknown>);
}

export async function listOrders(
  auth: AuthContext,
  patientId: string,
): Promise<PathologyOrderResponse[]> {
  await requirePatientRelationship(auth, patientId);
  const rows = await pathologyRepo.findOrdersByPatient(auth.clinicId, patientId);
  return rows.map((r) => mapOrder(r as unknown as Record<string, unknown>));
}

export async function getOrderWithResults(
  auth: AuthContext,
  orderId: string,
): Promise<{ order: PathologyOrderResponse; results: PathologyResultResponse[] }> {
  const order = await pathologyRepo.findOrderById(auth.clinicId, orderId);
  if (!order) {
    const err = new Error('Pathology order not found') as Error & { status: number; code: string };
    err.status = 404;
    err.code = 'PATHOLOGY_ORDER_NOT_FOUND';
    throw err;
  }
  await requirePatientRelationship(auth, order.patient_id);
  const results = await pathologyRepo.findResultsByOrder(auth.clinicId, orderId);
  return {
    order: mapOrder(order as unknown as Record<string, unknown>),
    results: results.map((r) => mapResult(r as unknown as Record<string, unknown>)),
  };
}

export async function ingestResult(
  clinicId: string,
  dto: PathologyResultIngestDTO,
): Promise<PathologyResultResponse> {
  const order = await pathologyRepo.findOrderById(clinicId, dto.pathologyOrderId);
  if (!order) {
    const err = new Error('Order not found for result ingestion') as Error & { status: number; code: string };
    err.status = 404;
    err.code = 'PATHOLOGY_ORDER_NOT_FOUND';
    throw err;
  }
  const isCritical = dto.abnormalFlag === 'critical_low' || dto.abnormalFlag === 'critical_high';
  const row = await pathologyRepo.createResult(clinicId, order.patient_id, dto, isCritical);
  if (isCritical) {
    // Import lazily to avoid circular dep; task creation lives in task service
    const { createTaskInternal } = await import('../tasks/taskService');
    const task = await createTaskInternal(clinicId, order.ordered_by_id, {
      patientId: order.patient_id,
      episodeId: order.episode_id ?? undefined,
      assignedToId: order.ordered_by_id,
      title: `CRITICAL RESULT: ${dto.testName} — ${dto.resultValue} ${dto.resultUnit ?? ''}`.trim(),
      description: `Critical pathology result received for order ${order.order_number}`,
      priority: 'urgent',
    });
    await pathologyRepo.setFlagTaskId(clinicId, row.id, task.id);
    logger.warn({ resultId: row.id, taskId: task.id }, 'Critical pathology result — flag task created');

    // Fan-out to patient's MDT: Consultant Psychiatrist and Junior Medical Officer
    // (Psychiatry Registrar). Skip silently if the lookup fails so the primary
    // task creation is never blocked.
    try {
      await createMdtTasksForPathology(
        clinicId,
        order.patient_id,
        order.episode_id ?? null,
        order.ordered_by_id,
        {
          testName: dto.testName,
          resultValue: dto.resultValue,
          resultUnit: dto.resultUnit,
          orderNumber: order.order_number,
          primaryTaskAssignee: order.ordered_by_id,
        },
      );
    } catch (err) {
      logger.warn({ err, patientId: order.patient_id }, 'MDT pathology fan-out failed');
    }
  }
  await pathologyRepo.updateOrderStatus(
    clinicId,
    dto.pathologyOrderId,
    'partial',
  );
  return mapResult(row as unknown as Record<string, unknown>);
}

/**
 * BUG-262 — HL7 inbound ingestion path. Mirror of `ingestResult` above,
 * but designed for the BullMQ worker context:
 *
 *   - No AuthContext (no request). Accepts the clinicId directly + a
 *     pre-resolved OrderRow that the worker already looked up via
 *     findOrderByNumberAdmin.
 *   - Uses `createResultAdmin` + `setFlagTaskIdAdmin` (dbAdmin pool)
 *     because the worker has no rlsStore transaction scope.
 *   - Idempotent — if a row with the same
 *     (pathology_order_id, test_code, result_status, collection_date)
 *     already exists, returns it unchanged. Guards against BullMQ retry
 *     duplicates.
 *   - Does NOT advance order.status to 'partial' on each observation;
 *     the worker marks the whole order 'complete' once all observations
 *     are ingested. That's the correct semantic for HL7 inbound —
 *     ORU^R01 is a single atomic delivery, not a stream of individual
 *     fragments.
 */
export async function ingestResultFromHl7(
  clinicId: string,
  order: {
    id: string;
    patient_id: string;
    episode_id: string | null;
    ordered_by_id: string;
    order_number: string;
  },
  dto: PathologyResultIngestDTO,
): Promise<PathologyResultResponse> {
  // Idempotency check — same tuple already ingested? Return as-is.
  const existing = await pathologyRepo.findExistingResultAdmin(
    clinicId,
    dto.pathologyOrderId,
    dto.testCode,
    dto.resultStatus,
    dto.collectionDate,
  );
  if (existing) {
    logger.info(
      { clinicId, orderId: order.id, testCode: dto.testCode, resultStatus: dto.resultStatus },
      'HL7 inbound: duplicate result skipped (idempotency)',
    );
    return mapResult(existing as unknown as Record<string, unknown>);
  }

  const isCritical = dto.abnormalFlag === 'critical_low' || dto.abnormalFlag === 'critical_high';
  const row = await pathologyRepo.createResultAdmin(clinicId, order.patient_id, dto, isCritical);

  if (isCritical) {
    // BUG-262-FU — inactive-assignee guard. If `order.ordered_by_id`
    // has been offboarded between ordering the test and the result
    // arriving (retired, on long leave, deleted), the critical-result
    // task would land in a nobody's queue. Resolve the assignee:
    //   - If the ordering staff is still active → use them (normal case)
    //   - Else if the clinic has a nominated admin (BUG-354) → reassign
    //     to that admin queue with a "REASSIGNED_FROM_INACTIVE_ORDERER"
    //     audit signal
    //   - Else → still create the task but emit a WARN + audit row so
    //     ops sees the orphaned critical result (clinical-safety
    //     monitoring must detect this pattern)
    const assignee = await resolveCriticalAssigneeAdmin(
      clinicId,
      order.ordered_by_id,
      row.id,
    );

    const { createTaskInternalAdmin } = await import('../tasks/taskService');
    const task = await createTaskInternalAdmin(clinicId, assignee.createdById, {
      patientId: order.patient_id,
      episodeId: order.episode_id ?? undefined,
      assignedToId: assignee.assigneeId,
      title: `CRITICAL RESULT: ${dto.testName} — ${dto.resultValue} ${dto.resultUnit ?? ''}`.trim(),
      description: assignee.reassigned
        ? `Critical pathology result for order ${order.order_number}. Original ordering clinician inactive — reassigned to ${assignee.reason}.`
        : `Critical pathology result received for order ${order.order_number}`,
      priority: 'urgent',
    });
    await pathologyRepo.setFlagTaskIdAdmin(clinicId, row.id, task.id);
    if (assignee.reassigned) {
      logger.error(
        { resultId: row.id, taskId: task.id, orderNumber: order.order_number,
          originalOrdererId: order.ordered_by_id, reassignedTo: assignee.assigneeId,
          kind: 'hl7_critical_reassigned_inactive_orderer' },
        'HL7 inbound: critical task reassigned (ordering clinician inactive)',
      );
    } else {
      logger.warn(
        { resultId: row.id, taskId: task.id, orderNumber: order.order_number },
        'HL7 inbound: critical result — flag task created',
      );
    }

    // BUG-262-FU MDT fan-out admin mirror — restores the safety-signal
    // parity between request-path `ingestResult` (which fans out via
    // `createMdtTasksForPathology`) and this HL7-path. Uses dbAdmin +
    // explicit clinic_id so it works in worker context.
    try {
      await createMdtTasksForPathologyAdmin(
        clinicId,
        order.patient_id,
        order.episode_id ?? null,
        assignee.createdById,
        {
          testName: dto.testName,
          resultValue: dto.resultValue,
          resultUnit: dto.resultUnit,
          orderNumber: order.order_number,
          primaryTaskAssignee: assignee.assigneeId,
        },
      );
    } catch (err) {
      logger.warn(
        { err, patientId: order.patient_id, orderNumber: order.order_number },
        'HL7 inbound: MDT fan-out admin mirror failed (non-blocking — primary task ensures safety signal)',
      );
    }
  }

  return mapResult(row as unknown as Record<string, unknown>);
}

/**
 * BUG-262-FU — determine who a critical-result task should be assigned
 * to when the ordering clinician may be inactive (offboarded,
 * deactivated, or soft-deleted). Uses dbAdmin for worker-context
 * reads.
 *
 * Contract:
 *   - assigneeId — who gets the task
 *   - createdById — who the task is written as "created by" (audit actor)
 *   - reassigned — true iff assigneeId differs from the ordering clinician
 *   - reason — human-readable label for audit / UI
 */
async function resolveCriticalAssigneeAdmin(
  clinicId: string,
  orderingStaffId: string,
  resultId: string,
): Promise<{ assigneeId: string; createdById: string; reassigned: boolean; reason: string }> {
  const resolution = await resolveStaffRecipientsWithAdminFallback({
    clinicId,
    candidateStaffIds: [orderingStaffId],
    conn: dbAdmin,
    onNoAdmin: 'first_candidate',
    auditFallback: {
      clinicId,
      tableName: 'pathology_results',
      recordId: resultId,
      systemActor: 'hl7-inbound-pathology',
      reassignedAction: 'CRITICAL_RECIPIENT_REASSIGNED',
      noRecipientAction: 'CRITICAL_NO_RECIPIENT_AVAILABLE',
      metadata: {
        ordering_staff_id: orderingStaffId,
      },
    },
  });
  const resolvedAssigneeId = resolution.active[0] ?? orderingStaffId;

  if (!resolution.reassignedToAdmin && !resolution.usedNoAdminFallbackCandidate) {
    return {
      assigneeId: resolvedAssigneeId,
      createdById: resolvedAssigneeId,
      reassigned: false,
      reason: 'ordering clinician',
    };
  }

  if (resolution.reassignedToAdmin) {
    return {
      assigneeId: resolution.reassignedToAdmin,
      createdById: resolution.reassignedToAdmin,
      reassigned: true,
      reason: resolution.adminSource === 'nominated'
        ? 'clinic nominated admin (original orderer inactive)'
        : 'clinic delegated admin (original orderer inactive)',
    };
  }

  // No admin configured. Keep compatibility with existing behaviour:
  // assign to the original orderer so the task row still exists.
  return {
    assigneeId: resolvedAssigneeId,
    createdById: resolvedAssigneeId,
    reassigned: true,
    reason: 'no clinic admin configured — task will appear orphaned; ops alert raised',
  };
}

/**
 * BUG-262-FU — dbAdmin mirror of `createMdtTasksForPathology`. Same
 * shape, uses dbAdmin for staff/team lookups + `createTaskInternalAdmin`
 * for task creation. Worker context has no rlsStore transaction scope;
 * the RLS-proxied `db()` would fail with 55P03 on `tasks` / `patient_team_assignments`.
 */
async function createMdtTasksForPathologyAdmin(
  clinicId: string,
  patientId: string,
  episodeId: string | null,
  _actingUserId: string,
  ctx: {
    testName: string;
    resultValue: string;
    resultUnit?: string | null;
    orderNumber: string;
    primaryTaskAssignee: string;
  },
): Promise<void> {
  // patient_team_assignments has no clinic_id column — tenant isolation
  // flows through patient_id (UUID-unique globally). The inner JOIN on
  // `patients` filters to the caller's clinic as a belt-and-braces guard.
  const assignment = await dbAdmin('patient_team_assignments as pta')
    .join('patients as p', 'p.id', 'pta.patient_id')
    .where('pta.patient_id', patientId)
    .where('p.clinic_id', clinicId)
    .where('pta.is_active', true)
    .orderBy('pta.created_at', 'desc')
    .select('pta.org_unit_id')
    .first();
  if (!assignment) return;

  const MDT_ROLES = ['Consultant Psychiatrist', 'Psychiatry Registrar'];
  const staff = await dbAdmin('staff_role_assignments as sra')
    .join('clinical_roles as cr', 'cr.id', 'sra.clinical_role_id')
    .join('staff as s', 's.id', 'sra.staff_id')
    .where('sra.org_unit_id', assignment.org_unit_id)
    .where('sra.is_active', true)
    .whereIn('cr.name', MDT_ROLES)
    .where('cr.clinic_id', clinicId)
    .where('s.is_active', true)
    .whereNull('s.deleted_at')
    .select('sra.staff_id', 'cr.name as role_name');

  if (staff.length === 0) return;

  const { createTaskInternalAdmin } = await import('../tasks/taskService');
  const seen = new Set<string>([ctx.primaryTaskAssignee]);
  for (const s of staff) {
    if (seen.has(s.staff_id)) continue;
    seen.add(s.staff_id);
    await createTaskInternalAdmin(clinicId, ctx.primaryTaskAssignee, {
      patientId,
      episodeId: episodeId ?? undefined,
      assignedToId: s.staff_id,
      title: `CRITICAL RESULT (FYI — ${s.role_name}): ${ctx.testName} — ${ctx.resultValue} ${ctx.resultUnit ?? ''}`.trim(),
      description: `Critical pathology result on order ${ctx.orderNumber} — assigned to you as ${s.role_name} on this patient's MDT.`,
      priority: 'urgent',
    });
  }
}

export async function listCriticalUnacknowledged(
  auth: AuthContext,
): Promise<PathologyResultResponse[]> {
  // Admin/medical-director dashboard call — no patient-specific
  // relationship check (cross-patient by design). clinic-scoped
  // filter + RLS keeps this within tenant.
  const rows = await pathologyRepo.findCriticalUnacknowledged(auth.clinicId);
  return rows.map((r) => mapResult(r as unknown as Record<string, unknown>));
}

export async function acknowledgeCritical(
  auth: AuthContext,
  resultId: string,
): Promise<void> {
  // BUG-437 L4 absorb-1: query by id directly, NOT through the capped list.
  // The list-fetch ceiling (5000 rows) is a DoS guard; the acknowledge path
  // must never depend on it. Pre-absorb shape used `findCriticalUnacknowledged
  // .find(r => r.id === resultId)` which silently 404'd any result clipped
  // by the cap — converting the DoS guard into a clinical-safety hazard
  // (un-acknowledgeable critical labs).
  const target = await pathologyRepo.findCriticalUnacknowledgedById(
    auth.clinicId,
    resultId,
  );
  if (!target) {
    const err = new Error('Critical result not found or already acknowledged') as Error & {
      status: number;
      code: string;
    };
    err.status = 404;
    err.code = 'RESULT_NOT_FOUND';
    throw err;
  }
  await requirePatientRelationship(auth, (target as { patient_id: string }).patient_id);
  await pathologyRepo.acknowledgeResult(auth.clinicId, resultId, auth.staffId);
}

/**
 * Fan-out critical pathology tasks to the patient's MDT — Consultant Psychiatrist
 * and Junior Medical Officer (Psychiatry Registrar) — so the result isn't only
 * seen by the ordering clinician.
 *
 * Staff for these roles are resolved from staff_role_assignments scoped to the
 * patient's active team (org_unit). Any assignee who is already the primary
 * task recipient is skipped to avoid duplicate tasks.
 */
async function createMdtTasksForPathology(
  clinicId: string,
  patientId: string,
  episodeId: string | null,
  _actingUserId: string,
  ctx: {
    testName: string;
    resultValue: string;
    resultUnit?: string | null;
    orderNumber: string;
    primaryTaskAssignee: string;
  },
): Promise<void> {
  const assignment = await db('patient_team_assignments')
    .where({ patient_id: patientId, is_active: true })
    .orderBy('created_at', 'desc')
    .first();
  if (!assignment) return;

  const MDT_ROLES = ['Consultant Psychiatrist', 'Psychiatry Registrar'];
  const staff = await db('staff_role_assignments as sra')
    .join('clinical_roles as cr', 'cr.id', 'sra.clinical_role_id')
    .where('sra.org_unit_id', assignment.org_unit_id)
    .where('sra.is_active', true)
    .whereIn('cr.name', MDT_ROLES)
    .where('cr.clinic_id', clinicId)
    .select('sra.staff_id', 'cr.name as role_name');

  if (staff.length === 0) return;

  const { createTaskInternal } = await import('../tasks/taskService');
  const seen = new Set<string>([ctx.primaryTaskAssignee]);
  for (const s of staff) {
    if (seen.has(s.staff_id)) continue;
    seen.add(s.staff_id);
    await createTaskInternal(clinicId, ctx.primaryTaskAssignee, {
      patientId,
      episodeId: episodeId ?? undefined,
      assignedToId: s.staff_id,
      title: `CRITICAL RESULT (FYI — ${s.role_name}): ${ctx.testName} — ${ctx.resultValue} ${ctx.resultUnit ?? ''}`.trim(),
      description: `Critical pathology result on order ${ctx.orderNumber} — assigned to you as ${s.role_name} on this patient's MDT.`,
      priority: 'urgent',
    });
  }
}
