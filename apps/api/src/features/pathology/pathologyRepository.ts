// apps/api/src/features/pathology/pathologyRepository.ts
import { db, dbAdmin } from '../../db/db';
import type {
  PathologyOrderCreateDTO,
  PathologyResultIngestDTO,
} from '@signacare/shared';
import { randomUUID } from 'crypto';

// Phase R3 — real schema (verified via psql + baseline):
//   pathology_orders: 19 cols (HAS deleted_at)
//   pathology_results: 21 cols (NO deleted_at — append-only)
//
// Pre-R2 drift: ResultRow declared reviewed_at + reviewed_by_id which
// are GHOST columns. Real names are critical_acknowledged_at +
// critical_acknowledged_by_id. The acknowledgeResult writer + the
// findCriticalUnacknowledged reader were both writing/reading ghosts.
// All 3 fixed in this commit.

const PATHOLOGY_ORDER_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'appointment_id',
  'ordered_by_id', 'order_number', 'panel_name', 'tests', 'urgency',
  'clinical_notes', 'fasting', 'copy_to_gp', 'status',
  'hl7_sent_at', 'hl7_message',
  'created_at', 'updated_at', 'deleted_at',
] as const;
const PATHOLOGY_RESULT_COLUMNS = [
  'id', 'clinic_id', 'pathology_order_id', 'patient_id',
  'test_code', 'test_name', 'result_value', 'result_unit',
  'reference_range', 'abnormal_flag', 'result_status',
  'collection_date', 'result_date', 'collected_at',
  'performing_lab', 'hl7_raw', 'is_critical',
  'critical_acknowledged_at', 'critical_acknowledged_by_id',
  'flag_task_id',
  'created_at', 'updated_at',
] as const;

interface OrderRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  appointment_id: string | null;
  ordered_by_id: string;
  order_number: string;
  panel_name: string;
  tests: string[];
  urgency: string;
  clinical_notes: string | null;
  fasting: boolean;
  copy_to_gp: boolean;
  status: string;
  hl7_sent_at: string | null;
  hl7_message: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ResultRow {
  id: string;
  clinic_id: string;
  pathology_order_id: string;
  patient_id: string;
  test_code: string;
  test_name: string;
  result_value: string;
  result_unit: string | null;
  reference_range: string | null;
  abnormal_flag: string;
  result_status: string;
  collection_date: string;
  result_date: string;
  collected_at: string | null;
  performing_lab: string | null;
  hl7_raw: string | null;
  is_critical: boolean;
  critical_acknowledged_at: string | null;
  critical_acknowledged_by_id: string | null;
  flag_task_id: string | null;
  lock_version?: number;
  created_at: string;
  updated_at: string;
}

export async function createOrder(
  clinicId: string,
  orderedById: string,
  dto: PathologyOrderCreateDTO,
  orderNumber: string,
): Promise<OrderRow> {
  const [row] = await db('pathology_orders')
    .insert({
      id: randomUUID(),
      clinic_id: clinicId,
      patient_id: dto.patientId,
      episode_id: dto.episodeId ?? null,
      appointment_id: dto.appointmentId ?? null,
      ordered_by_id: orderedById,
      order_number: orderNumber,
      panel_name: dto.panelName,
      // pathology_orders.tests is a Postgres text[] column.
      // Writing JSON text here throws malformed-array errors at runtime.
      tests: dto.tests,
      urgency: dto.urgency,
      clinical_notes: dto.clinicalNotes ?? null,
      fasting: dto.fasting,
      copy_to_gp: dto.copyToGp,
      status: 'pending',
      updated_at: db.fn.now(),
    })
    .returning(PATHOLOGY_ORDER_COLUMNS);
  return row as OrderRow;
}

export async function findOrderById(clinicId: string, id: string): Promise<OrderRow | undefined> {
  return db('pathology_orders')
    .where({ id, clinic_id: clinicId })
    .whereNull('deleted_at')
    .first() as Promise<OrderRow | undefined>;
}

export async function findOrdersByPatient(
  clinicId: string,
  patientId: string,
): Promise<OrderRow[]> {
  return db('pathology_orders')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc')
    .limit(500) as Promise<OrderRow[]>; // BUG-437 — pathology-ceiling per-patient orders
}

export async function updateOrderStatus(
  clinicId: string,
  id: string,
  status: string,
  hl7SentAt?: Date,
): Promise<void> {
  await db('pathology_orders')
    .where({ id, clinic_id: clinicId })
    .update({
      status,
      hl7_sent_at: hl7SentAt ?? null,
      updated_at: db.fn.now(),
    });
}

/**
 * BUG-238 — background-job (no RLS context) variants for HL7 outbound
 * worker. Worker has no AsyncLocalStorage-based RLS scope, so reads via
 * `db()` return 0 rows against RLS-protected tables. These variants use
 * `dbAdmin` + explicit clinic_id in the WHERE — same tenant isolation,
 * different role. Named '*Admin' to make the privilege boundary explicit
 * at the call site (cf. sessionCleanupWorker pattern).
 */
export async function findOrderByIdAdmin(clinicId: string, id: string): Promise<OrderRow | undefined> {
  return dbAdmin('pathology_orders')
    .where({ id, clinic_id: clinicId })
    .whereNull('deleted_at')
    .first() as Promise<OrderRow | undefined>;
}

/**
 * BUG-238 — record the outcome of an outbound HL7 transport attempt.
 * Writes status, hl7_sent_at, and hl7_message atomically so the order
 * row preserves the exact bytes that went to the lab for later audit.
 * Admin variant for worker context (see findOrderByIdAdmin rationale).
 * §1.3 — clinic_id included in WHERE to satisfy tenant isolation even
 * when the DB layer is admin-pool.
 */
export async function recordTransportOutcomeAdmin(
  clinicId: string,
  id: string,
  outcome: { status: string; hl7Message?: string; sentAt?: Date },
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: outcome.status,
    updated_at: dbAdmin.fn.now(),
  };
  if (outcome.hl7Message !== undefined) patch['hl7_message'] = outcome.hl7Message;
  if (outcome.sentAt !== undefined) patch['hl7_sent_at'] = outcome.sentAt;
  await dbAdmin('pathology_orders')
    .where({ id, clinic_id: clinicId })
    .update(patch);
}

export async function createResult(
  clinicId: string,
  patientId: string,
  dto: PathologyResultIngestDTO,
  isCritical: boolean,
): Promise<ResultRow> {
  const [row] = await db('pathology_results')
    .insert({
      id: randomUUID(),
      clinic_id: clinicId,
      pathology_order_id: dto.pathologyOrderId,
      patient_id: patientId,
      test_code: dto.testCode,
      test_name: dto.testName,
      result_value: dto.resultValue,
      result_unit: dto.resultUnit ?? null,
      reference_range: dto.referenceRange ?? null,
      abnormal_flag: dto.abnormalFlag,
      result_status: dto.resultStatus,
      collection_date: dto.collectionDate,
      result_date: dto.resultDate,
      performing_lab: dto.performingLab ?? null,
      hl7_raw: dto.hl7Raw ?? null,
      is_critical: isCritical,
      updated_at: db.fn.now(),
    })
    .returning(PATHOLOGY_RESULT_COLUMNS);
  return row as ResultRow;
}

export async function findResultsByOrder(
  clinicId: string,
  orderId: string,
): Promise<ResultRow[]> {
  return db('pathology_results')
    .where({ clinic_id: clinicId, pathology_order_id: orderId })
    .orderBy('result_date', 'desc') as Promise<ResultRow[]>;
}

export async function findCriticalUnacknowledged(clinicId: string): Promise<ResultRow[]> {
  // Real column is critical_acknowledged_at (Phase R3 — was the ghost
  // 'reviewed_at' pre-R2). Filters: critical AND not yet acknowledged.
  return db('pathology_results')
    .where({ clinic_id: clinicId, is_critical: true })
    .whereNull('critical_acknowledged_at')
    .orderBy('created_at', 'asc')
    .limit(5000) as Promise<ResultRow[]>; // BUG-437 — pathology-ceiling clinic-wide critical-result scan; acknowledge path uses findCriticalUnacknowledgedById (BUG-437 absorb-1) so cap does NOT block acknowledgement of clipped rows
}

/**
 * BUG-437 L4 absorb-1: by-id lookup for the critical-result acknowledge
 * path. The list-fetch is capped at 5000 (defence-in-depth ceiling); the
 * acknowledge path MUST NOT depend on the list cap or critical results in
 * positions 5001..N silently become un-acknowledgeable (clinician sees
 * misleading 404 "already acknowledged" when the result is in fact
 * unacknowledged but invisible behind the cap). Filters mirror the list
 * predicate so a result that's already acknowledged still 404s correctly.
 */
export async function findCriticalUnacknowledgedById(
  clinicId: string,
  resultId: string,
): Promise<ResultRow | undefined> {
  return db('pathology_results')
    .where({ id: resultId, clinic_id: clinicId, is_critical: true })
    .whereNull('critical_acknowledged_at')
    .first() as Promise<ResultRow | undefined>;
}

export async function acknowledgeResult(
  clinicId: string,
  resultId: string,
  userId: string,
): Promise<void> {
  // Real columns are critical_acknowledged_at + critical_acknowledged_by_id
  // (Phase R3 — was reviewed_at + reviewed_by_id ghosts pre-R2).
  await db('pathology_results')
    .where({ id: resultId, clinic_id: clinicId })
    .update({
      critical_acknowledged_at: db.fn.now(),
      critical_acknowledged_by_id: userId,
      lock_version: db.raw('lock_version + 1'),
      updated_at: db.fn.now(),
    });
}

export async function setFlagTaskId(
  clinicId: string,
  resultId: string,
  taskId: string,
): Promise<void> {
  await db('pathology_results')
    .where({ id: resultId, clinic_id: clinicId })
    .update({
      flag_task_id: taskId,
      lock_version: db.raw('lock_version + 1'),
      updated_at: db.fn.now(),
    });
}

// ─── BUG-262 admin-variant helpers for the HL7 inbound worker ───────────
// Worker has no AsyncLocalStorage-based RLS scope (same rationale as
// findOrderByIdAdmin at :152 / recordTransportOutcomeAdmin at :167).
// These variants use dbAdmin + explicit clinic_id in the WHERE — same
// tenant isolation, different role.

/** Find a pathology order by its (clinic_id, order_number) pair.
 *  order_number has a UNIQUE constraint per (clinic_id, order_number),
 *  so this returns at most one row. */
export async function findOrderByNumberAdmin(
  clinicId: string,
  orderNumber: string,
): Promise<OrderRow | undefined> {
  return dbAdmin('pathology_orders')
    .where({ clinic_id: clinicId, order_number: orderNumber })
    .whereNull('deleted_at')
    .first() as Promise<OrderRow | undefined>;
}

/** BUG-262 idempotency check — returns an existing result row with the
 *  same (pathology_order_id, test_code, result_status, collection_date)
 *  tuple, or undefined. Used by the HL7 inbound worker so a BullMQ retry
 *  of the same job doesn't create duplicate rows. Application-level —
 *  a DB-level unique constraint is a separate follow-up. */
export async function findExistingResultAdmin(
  clinicId: string,
  pathologyOrderId: string,
  testCode: string,
  resultStatus: string,
  collectionDate: string,
): Promise<ResultRow | undefined> {
  return dbAdmin('pathology_results')
    .where({
      clinic_id: clinicId,
      pathology_order_id: pathologyOrderId,
      test_code: testCode,
      result_status: resultStatus,
      collection_date: collectionDate,
    })
    .first() as Promise<ResultRow | undefined>;
}

/** BUG-262 admin mirror of createResult. Worker context — no RLS scope. */
export async function createResultAdmin(
  clinicId: string,
  patientId: string,
  dto: PathologyResultIngestDTO,
  isCritical: boolean,
): Promise<ResultRow> {
  const [row] = await dbAdmin('pathology_results')
    .insert({
      id: randomUUID(),
      clinic_id: clinicId,
      pathology_order_id: dto.pathologyOrderId,
      patient_id: patientId,
      test_code: dto.testCode,
      test_name: dto.testName,
      result_value: dto.resultValue,
      result_unit: dto.resultUnit ?? null,
      reference_range: dto.referenceRange ?? null,
      abnormal_flag: dto.abnormalFlag,
      result_status: dto.resultStatus,
      collection_date: dto.collectionDate,
      result_date: dto.resultDate,
      performing_lab: dto.performingLab ?? null,
      hl7_raw: dto.hl7Raw ?? null,
      is_critical: isCritical,
      updated_at: dbAdmin.fn.now(),
    })
    .returning(PATHOLOGY_RESULT_COLUMNS);
  return row as ResultRow;
}

/** BUG-262 admin mirror of setFlagTaskId. */
export async function setFlagTaskIdAdmin(
  clinicId: string,
  resultId: string,
  taskId: string,
): Promise<void> {
  await dbAdmin('pathology_results')
    .where({ id: resultId, clinic_id: clinicId })
    .update({
      flag_task_id: taskId,
      lock_version: dbAdmin.raw('lock_version + 1'),
      updated_at: dbAdmin.fn.now(),
    });
}

/** BUG-262 admin mirror of updateOrderStatus. */
export async function updateOrderStatusAdmin(
  clinicId: string,
  id: string,
  status: string,
): Promise<void> {
  await dbAdmin('pathology_orders')
    .where({ id, clinic_id: clinicId })
    .update({
      status,
      updated_at: dbAdmin.fn.now(),
    });
}
