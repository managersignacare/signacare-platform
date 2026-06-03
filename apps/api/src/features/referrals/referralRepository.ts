// apps/api/src/features/referrals/referralRepository.ts
import { db } from '../../db/db';
import { AppError } from '../../shared/errors';
import { OUTBOUND_REFERRAL_SOURCE, ReferralListFilters } from '@signacare/shared';
import type { Knex } from 'knex';
// Phase 0b.2c-batch-1 migration (2026-05-04): drain hand-written
// referral-table column constants to migration-driven equivalents per
// Phase 0b.2 plan + CLAUDE.md §15.
//
// permanent: the alias re-exports below ARE the end-state for Phase
// 0b.2's DoD ("0 remaining hand-written *_COLUMNS array literals").
// The runtime constants resolve to the migration-driven SSoT, so when
// a future migration adds a column to any of these 5 referral tables,
// the aliases update automatically. Migrating consumer call sites from
// the legacy local names to the canonical generated names is a separate
// consumer-rename concern outside Phase 0b.2's drain scope; these
// aliases are not band-aids waiting for cleanup.
import { REFERRALS_COLUMNS } from '../../db/types/referrals';
import { REFERRAL_ATTACHMENTS_COLUMNS } from '../../db/types/referral_attachments';
import { REFERRAL_CLINICIAN_OFFERS_COLUMNS } from '../../db/types/referral_clinician_offers';
import { REFERRAL_FEEDBACK_LOG_COLUMNS } from '../../db/types/referral_feedback_log';
import { REFERRAL_STATE_TRANSITIONS_COLUMNS } from '../../db/types/referral_state_transitions';
import { assertReferralStatusTransition } from './referralStatusStateMachine';

// Mirrors the `referrals` table exactly. Verified against
// `psql \d referrals` on 2026-04-17 during Phase 0.7.5 c24 C3 (SD13 fix).
//
// Before c24 the interface declared 17 ghost fields (referrer_name,
// referrer_organisation, presenting_problem, ocr_file_key, ocr_confirmed,
// sla_due_at, accepted_at, review_notes, decline_reason, source_type,
// episode_id, assigned_to_id, reviewed_by_id, referrer_phone,
// referrer_fax, referrer_email, ocr_data). Every referral create, list,
// search, or state change that touched these columns crashed at runtime.
// Canonical DB names are the single source of truth — the
// mapReferralRowToResponse layer converts to the stable camelCase
// API contract (fromProviderName, referringOrg, reason, assignedToStaffId,
// linkedEpisodeId, rejectionReason, slaDueDate, internalNotes, ocrExtracted).
export interface ReferralDbRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  referral_number: string;
  referral_date: string;
  source: string;
  from_service: string;
  from_provider_name: string | null;
  from_provider_phone: string | null;
  from_provider_email: string | null;
  from_provider_prescriber_no: string | null;
  referring_org: string | null;
  reason: string;
  clinical_summary: string | null;
  current_medications: string | null;
  diagnosis_info: string | null;
  urgency: string;
  status: string;
  status_changed_at: Date | null;
  received_at: Date;
  assigned_to_staff_id: string | null;
  linked_episode_id: string | null;
  has_attachment: boolean;
  ocr_extracted: unknown | null;
  rejection_reason: string | null;
  redirect_to: string | null;
  sla_due_date: string | null;
  sla_breached: boolean;
  internal_notes: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  // Solo & Team module columns
  referral_mode: string;
  target_clinician_id: string | null;
  distribution_mode: string | null;
  distribution_speciality: string | null;
  accepted_by_staff_id: string | null;
  broadcast_at: Date | null;
  reminder_sent_at: Date | null;
  final_reminder_sent_at: Date | null;
  auto_close_at: Date | null;
  feedback_sent_at: Date | null;
  clarification_notes: string | null;
  created_by_staff_id: string | null;
  // Phase 1: multi-specialty + FHIR ServiceRequest/Task split
  target_specialty_code: string;
  service_request_status: string;
  task_status: string;
  coordinator_id: string | null;
  triaged_at: Date | null;
  triaged_by: string | null;
}

export interface ReferralStateTransitionRow {
  id: string;
  clinic_id: string;
  referral_id: string;
  from_task_status: string | null;
  to_task_status: string;
  actor_id: string | null;
  reason: string | null;
  created_at: Date;
}

// Phase 0.7.5 c24 D8 — explicit column lists matching the 6 referral
// tables. Column lists pulled from schema-snapshot.json 2026-04-18.
// Used in `.returning(X_COLUMNS) as Row[]` to preserve interface
// contract (Knex types .returning(arr) as Partial<T>[]).
//
// Phase 0b.2c-batch-1 (2026-05-04): re-exports of the auto-generated
// column constants from `apps/api/src/db/types/<table>.ts` under the
// legacy local names. Migration-driven SSoT — when a future migration
// adds a column to any of these 5 tables, this constant updates
// automatically (compile error surfaces consumers that need to opt in).
export const REFERRAL_COLUMNS = REFERRALS_COLUMNS;
export const REFERRAL_ATTACHMENT_COLUMNS = REFERRAL_ATTACHMENTS_COLUMNS;
export const OFFER_COLUMNS = REFERRAL_CLINICIAN_OFFERS_COLUMNS;
export const FEEDBACK_LOG_COLUMNS = REFERRAL_FEEDBACK_LOG_COLUMNS;
export const REFERRAL_STATE_TRANSITION_COLUMNS = REFERRAL_STATE_TRANSITIONS_COLUMNS;

export interface OfferDbRow {
  id: string;
  clinic_id: string;
  referral_id: string;
  staff_id: string;
  offered_at: Date;
  response: string;
  responded_at: Date | null;
  decline_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

function applyDirectionFilter(
  query: Knex.QueryBuilder,
  direction: 'intake' | 'outbound' | undefined,
): void {
  if (!direction) return;
  if (direction === 'outbound') {
    query.where('referrals.source', OUTBOUND_REFERRAL_SOURCE);
    return;
  }
  query.whereNot('referrals.source', OUTBOUND_REFERRAL_SOURCE);
}

export interface FeedbackLogDbRow {
  id: string;
  clinic_id: string;
  referral_id: string;
  feedback_type: string;
  recipient_email: string;
  sent_at: Date;
  message_body: string | null;
  sent_by_staff_id: string | null;
  delivery_status: string;
  created_at: Date;
}

// Phase 0.7.5 c24 D8 — stale comment removed. The referral_attachments
// table DOES exist (15 cols, verified via psql \d on 2026-04-18 and
// schema-snapshot.json). Prior comment claimed the table didn't exist.
// Callers can rely on INSERTs succeeding.
export interface ReferralAttachmentDbRow {
  id: string;
  clinic_id: string;
  referral_id: string;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  file_size_bytes: number;
  storage_key: string;
  category: string;
  ocr_status: string;
  ocr_result: unknown | null;
  ocr_error_message: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export class ReferralRepository {
  async createReferral(row: Partial<ReferralDbRow>): Promise<ReferralDbRow> {
    const rows = await db<ReferralDbRow>('referrals')
      .insert(row)
      .returning(REFERRAL_COLUMNS) as ReferralDbRow[];
    return rows[0];
  }

  /**
   * BUG-583 — `conn` defaults to the request-scoped `db` proxy (RLS
   * applies). Schedulers that run outside any request context (no
   * `app.clinic_id` GUC set) must pass `dbAdmin` so the RLS predicate
   * `clinic_id = NULL` does not silently zero the UPDATE.
   */
  async updateReferral(
    clinicId: string,
    id: string,
    patch: Partial<ReferralDbRow>,
    conn: Knex = db,
  ): Promise<ReferralDbRow | null> {
    if (patch.status === undefined) {
      const rows = await conn<ReferralDbRow>('referrals')
        .where({ clinic_id: clinicId, id })
        .whereNull('deleted_at')
        .update({ ...patch, updated_at: new Date() })
        .returning(REFERRAL_COLUMNS) as ReferralDbRow[];
      return rows[0] ?? null;
    }

    return conn.transaction(async (trx) => {
      const current = await trx<ReferralDbRow>('referrals')
        .where({ clinic_id: clinicId, id })
        .whereNull('deleted_at')
        .forUpdate()
        .first();
      if (!current) return null;

      assertReferralStatusTransition(current.status, String(patch.status));

      const rows = await trx<ReferralDbRow>('referrals')
        .where({ clinic_id: clinicId, id })
        .whereNull('deleted_at')
        .update({ ...patch, updated_at: new Date() })
        .returning(REFERRAL_COLUMNS) as ReferralDbRow[];
      return rows[0] ?? null;
    });
  }

  /**
   * BUG-602 — `conn` defaults to the request-scoped `db` proxy. Schedulers
   * MUST pass `dbAdmin` so the SELECT does not RLS-zero outside any
   * request context.
   */
  async findById(clinicId: string, id: string, conn: Knex = db): Promise<ReferralDbRow | null> {
    const referral = await conn<ReferralDbRow>('referrals')
      .where({ clinic_id: clinicId, id })
      .whereNull('deleted_at')
      .first();
    return referral ?? null;
  }

  async list(
    clinicId: string,
    filters: ReferralListFilters,
  ): Promise<{ rows: (ReferralDbRow & { patient_given_name?: string; patient_family_name?: string; patient_dob?: string; patient_ur_no?: string })[]; total: number }> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;

    const baseQuery = db('referrals')
      .leftJoin('patients', 'patients.id', 'referrals.patient_id')
      .where('referrals.clinic_id', clinicId)
      .whereNull('referrals.deleted_at')
      .whereNotNull('referrals.patient_id');

    applyDirectionFilter(baseQuery, filters.direction);

    if (filters.status && filters.status.length > 0) {
      baseQuery.whereIn('referrals.status', filters.status);
    }
    if (filters.urgency && filters.urgency.length > 0) {
      baseQuery.whereIn('referrals.urgency', filters.urgency);
    }
    if (filters.fromDate) {
      baseQuery.where('referrals.referral_date', '>=', filters.fromDate);
    }
    if (filters.toDate) {
      baseQuery.where('referrals.referral_date', '<=', filters.toDate);
    }
    if (filters.search) {
      // Phase 0.7.5 c24 C3 (SD13) — LIKE columns now canonical. Previously
      // searched against ghost columns `presenting_problem`, `referrer_name`,
      // `referrer_organisation` — every list filter crashed at runtime.
      const q = `%${filters.search}%`;
      baseQuery.andWhere((qb) => {
        qb.whereILike('referrals.reason', q)
          .orWhereILike('referrals.from_provider_name', q)
          .orWhereILike('referrals.referring_org', q)
          .orWhereILike('referrals.from_service', q)
          .orWhere('referrals.referral_number', 'ilike', q)
          .orWhereILike('patients.given_name', q)
          .orWhereILike('patients.family_name', q);
      });
    }

    const countRows = await baseQuery.clone().count('* as count') as { count: string }[];
    const count = countRows[0]?.count ?? '0';

    const rows = await baseQuery.clone()
      .select(
        'referrals.*',
        'patients.given_name as patient_given_name',
        'patients.family_name as patient_family_name',
        'patients.date_of_birth as patient_dob',
        'patients.emr_number as patient_ur_no',
      )
      .orderBy('referrals.created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { rows, total: Number(count) };
  }

  // ── Attachments ──────────────────────────────────────────────────────────

  async createAttachment(
    row: Partial<ReferralAttachmentDbRow>,
  ): Promise<ReferralAttachmentDbRow> {
    const rows = await db<ReferralAttachmentDbRow>('referral_attachments')
      .insert(row)
      .returning(REFERRAL_ATTACHMENT_COLUMNS) as ReferralAttachmentDbRow[];
    return rows[0];
  }

  async listAttachments(
    clinicId: string,
    referralId: string,
  ): Promise<ReferralAttachmentDbRow[]> {
    return db<ReferralAttachmentDbRow>('referral_attachments')
      .where({ clinic_id: clinicId, referral_id: referralId })
      .whereNull('deleted_at')
      .orderBy('created_at', 'asc');
  }

  async findAttachmentById(
    clinicId: string,
    id: string,
  ): Promise<ReferralAttachmentDbRow | null> {
    const row = await db<ReferralAttachmentDbRow>('referral_attachments')
      .where({ clinic_id: clinicId, id })
      .whereNull('deleted_at')
      .first();
    return row ?? null;
  }

  async updateAttachment(
    clinicId: string,
    id: string,
    patch: Partial<ReferralAttachmentDbRow>,
  ): Promise<ReferralAttachmentDbRow | null> {
    const rows = await db<ReferralAttachmentDbRow>('referral_attachments')
      .where({ clinic_id: clinicId, id })
      .whereNull('deleted_at')
      .update({ ...patch, updated_at: new Date() })
      .returning(REFERRAL_ATTACHMENT_COLUMNS) as ReferralAttachmentDbRow[];
    return rows[0] ?? null;
  }

  // ── Workflow Events ────────────────────────────────────────────────────

  /**
   * BUG-583 — `conn` defaults to the request-scoped `db` proxy.
   * Schedulers must pass `dbAdmin` so the INSERT does not RLS-zero.
   */
  async insertWorkflowEvent(params: {
    clinicId: string;
    referralId: string;
    eventType: string;
    performedByStaffId?: string;
    notes?: string;
    outcome?: string;
  }, conn: Knex = db): Promise<void> {
    await conn('referral_workflow_events').insert({
      clinic_id: params.clinicId,
      referral_id: params.referralId,
      event_type: params.eventType,
      performed_by_staff_id: params.performedByStaffId ?? null,
      notes: params.notes ?? null,
      outcome: params.outcome ?? null,
      event_at: new Date(),
    });
  }

  async listWorkflowEvents(
    clinicId: string,
    referralId: string,
  ): Promise<Array<{ id: string; event_type: string; performed_by_staff_id: string | null; notes: string | null; outcome: string | null; event_at: Date }>> {
    return db('referral_workflow_events')
      .where({ clinic_id: clinicId, referral_id: referralId })
      .orderBy('event_at', 'asc');
  }

  // ── Clinician Offers (Team module) ─────────────────────────────────────

  async createOffersBatch(
    rows: Array<Partial<OfferDbRow>>,
    trx?: Knex.Transaction,
  ): Promise<OfferDbRow[]> {
    if (rows.length === 0) return [];
    const conn = trx ?? db;
    return conn<OfferDbRow>('referral_clinician_offers')
      .insert(rows)
      .returning(OFFER_COLUMNS) as Promise<OfferDbRow[]>;
  }

  async findOfferForUpdate(
    offerId: string,
    staffId: string,
    trx: Knex.Transaction,
  ): Promise<OfferDbRow | null> {
    const row = await trx<OfferDbRow>('referral_clinician_offers')
      .where({ id: offerId, staff_id: staffId })
      .forUpdate()
      .first();
    return row ?? null;
  }

  async updateOffer(
    offerId: string,
    patch: Partial<OfferDbRow>,
    trx?: Knex.Transaction,
  ): Promise<OfferDbRow | null> {
    const conn = trx ?? db;
    const rows = await conn<OfferDbRow>('referral_clinician_offers')
      .where({ id: offerId })
      .update({ ...patch, updated_at: new Date() })
      .returning(OFFER_COLUMNS) as OfferDbRow[];
    return rows[0] ?? null;
  }

  async expirePendingOffers(
    referralId: string,
    excludeOfferId: string,
    trx: Knex.Transaction,
  ): Promise<number> {
    return trx('referral_clinician_offers')
      .where({ referral_id: referralId, response: 'pending' })
      .whereNot({ id: excludeOfferId })
      .update({ response: 'expired', responded_at: new Date(), updated_at: new Date() });
  }

  async listOffersForReferral(
    clinicId: string,
    referralId: string,
  ): Promise<Array<OfferDbRow & { staff_given_name: string; staff_family_name: string; staff_specialisation: string | null }>> {
    return db('referral_clinician_offers')
      .join('staff', 'staff.id', 'referral_clinician_offers.staff_id')
      .where('referral_clinician_offers.clinic_id', clinicId)
      .where('referral_clinician_offers.referral_id', referralId)
      .select(
        'referral_clinician_offers.*',
        'staff.given_name as staff_given_name',
        'staff.family_name as staff_family_name',
        'staff.specialisation as staff_specialisation',
      )
      .orderBy('referral_clinician_offers.offered_at', 'asc');
  }

  async listMyOffers(
    clinicId: string,
    staffId: string,
    filters: { response?: string; page?: number; pageSize?: number },
  ): Promise<{ rows: Array<OfferDbRow & { referral_number: string; referral_date: string; urgency: string; referral_status: string; reason: string | null; from_provider_name: string | null; from_service: string; referring_org: string | null; patient_id: string | null; linked_episode_id: string | null; broadcast_at: Date | null; auto_close_at: Date | null; patient_given_name?: string; patient_family_name?: string }>; total: number }> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;

    const baseQuery = db('referral_clinician_offers')
      .join('referrals', 'referrals.id', 'referral_clinician_offers.referral_id')
      .leftJoin('patients', 'patients.id', 'referrals.patient_id')
      .where('referral_clinician_offers.clinic_id', clinicId)
      .where('referral_clinician_offers.staff_id', staffId)
      .whereNull('referrals.deleted_at');

    if (filters.response) {
      baseQuery.where('referral_clinician_offers.response', filters.response);
    } else {
      baseQuery.where('referral_clinician_offers.response', 'pending');
    }

    const countRows = await baseQuery.clone().count('* as count') as { count: string }[];
    const total = Number(countRows[0]?.count ?? '0');

    const rows = await baseQuery.clone()
      .select(
        'referral_clinician_offers.*',
        'referrals.referral_number',
        'referrals.referral_date',
        'referrals.urgency',
        'referrals.status as referral_status',
        'referrals.reason',
        'referrals.from_provider_name',
        'referrals.from_service',
        'referrals.referring_org',
        'referrals.patient_id',
        'referrals.linked_episode_id',
        'referrals.broadcast_at',
        'referrals.auto_close_at',
        'patients.given_name as patient_given_name',
        'patients.family_name as patient_family_name',
      )
      .orderBy('referral_clinician_offers.offered_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { rows, total };
  }

  async findReferralForUpdate(
    clinicId: string,
    referralId: string,
    trx: Knex.Transaction,
  ): Promise<ReferralDbRow | null> {
    const row = await trx<ReferralDbRow>('referrals')
      .where({ id: referralId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .forUpdate()
      .first();
    return row ?? null;
  }

  /**
   * BUG-583 — `connOrTrx` defaults to the request-scoped `db` proxy
   * (RLS applies). Schedulers must pass `dbAdmin` to bypass the RLS
   * silent-zero. The historical `trx?: Knex.Transaction` override is
   * preserved for in-request transaction-scoped callers.
   */
  async listPendingOfferStaffIds(
    referralId: string,
    connOrTrx?: Knex | Knex.Transaction,
  ): Promise<string[]> {
    const conn = connOrTrx ?? db;
    const rows = await conn('referral_clinician_offers')
      .where({ referral_id: referralId, response: 'pending' })
      .select('staff_id');
    return rows.map((r: { staff_id: string }) => r.staff_id);
  }

  // ── Feedback Log ───────────────────────────────────────────────────────

  /**
   * BUG-602 — `conn` defaults to the request-scoped `db` proxy. Schedulers
   * MUST pass `dbAdmin` so the INSERT does not RLS-reject outside any
   * request context.
   */
  async insertFeedbackLog(
    row: Partial<FeedbackLogDbRow>,
    conn: Knex = db,
  ): Promise<FeedbackLogDbRow> {
    const rows = await conn<FeedbackLogDbRow>('referral_feedback_log')
      .insert(row)
      .returning(FEEDBACK_LOG_COLUMNS) as FeedbackLogDbRow[];
    return rows[0];
  }

  async listFeedbackLog(
    clinicId: string,
    referralId: string,
  ): Promise<Array<FeedbackLogDbRow & { sent_by_staff_name: string | null }>> {
    return db('referral_feedback_log')
      .leftJoin('staff', 'staff.id', 'referral_feedback_log.sent_by_staff_id')
      .where('referral_feedback_log.clinic_id', clinicId)
      .where('referral_feedback_log.referral_id', referralId)
      .select(
        'referral_feedback_log.*',
        db.raw("COALESCE(staff.given_name || ' ' || staff.family_name, NULL) as sent_by_staff_name"),
      )
      .orderBy('referral_feedback_log.sent_at', 'desc');
  }

  // ── Scheduler + referral-out queue ─────────────────────────────────────
  async listCoordinatorQueue(
    clinicId: string,
    filters: {
      specialty?: string;
      taskStatus?: string;
      direction?: 'intake' | 'outbound';
      mineOnly?: boolean;
      coordinatorId?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<{
    rows: Array<
      ReferralDbRow & {
        patient_given_name?: string;
        patient_family_name?: string;
        patient_dob?: string;
        target_specialty_display?: string;
        coordinator_name?: string | null;
      }
    >;
    total: number;
  }> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;

    const baseQuery = db('referrals')
      .leftJoin('patients', 'patients.id', 'referrals.patient_id')
      .leftJoin('specialties as sp', 'sp.code', 'referrals.target_specialty_code')
      .leftJoin('staff as coord', 'coord.id', 'referrals.coordinator_id')
      .where('referrals.clinic_id', clinicId)
      .whereNull('referrals.deleted_at')
      .where('referrals.service_request_status', 'active');

    applyDirectionFilter(baseQuery, filters.direction);

    if (filters.specialty) {
      baseQuery.where('referrals.target_specialty_code', filters.specialty);
    }
    if (filters.taskStatus) {
      baseQuery.where('referrals.task_status', filters.taskStatus);
    }
    if (filters.mineOnly && filters.coordinatorId) {
      baseQuery.where('referrals.coordinator_id', filters.coordinatorId);
    }

    const countRows = (await baseQuery.clone().count('* as count')) as { count: string }[];
    const total = Number(countRows[0]?.count ?? '0');

    const rows = await baseQuery
      .clone()
      .select(
        'referrals.*',
        'patients.given_name as patient_given_name',
        'patients.family_name as patient_family_name',
        'patients.date_of_birth as patient_dob',
        'sp.display as target_specialty_display',
        db.raw("COALESCE(coord.given_name || ' ' || coord.family_name, NULL) as coordinator_name"),
      )
      .orderBy([
        { column: 'referrals.urgency', order: 'asc' },
        { column: 'referrals.referral_date', order: 'asc' },
      ])
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { rows, total };
  }

  async countCoordinatorsForSpecialty(clinicId: string, specialtyCode: string): Promise<number> {
    const row = (await db('staff_specialties as ss')
      .join('staff as s', 's.id', 'ss.staff_id')
      .where('ss.clinic_id', clinicId)
      .where('ss.specialty_code', specialtyCode)
      .whereNull('ss.deleted_at')
      .where('s.role', 'referral_coordinator')
      .whereNull('s.deleted_at')
      .where('s.is_active', true)
      .count('* as count')
      .first()) as { count: string } | undefined;
    return Number(row?.count ?? '0');
  }

  // Atomic task-state transition with same-transaction audit row.
  async transitionTaskStatus(params: {
    clinicId: string;
    referralId: string;
    from?: readonly string[]; // allowed current states
    to: string;
    actorId: string;
    reason?: string;
    patch?: Partial<ReferralDbRow>;
  }): Promise<ReferralDbRow> {
    return db.transaction(async (trx) => {
      const current = await trx<ReferralDbRow>('referrals')
        .where({ id: params.referralId, clinic_id: params.clinicId })
        .whereNull('deleted_at')
        .forUpdate()
        .first();
      if (!current) {
        throw new AppError('Referral not found', 404, 'NOT_FOUND');
      }
      if (params.from && !params.from.includes(current.task_status)) {
        throw Object.assign(
          new Error(`Task cannot transition from '${current.task_status}' to '${params.to}'`),
          { status: 409, code: 'INVALID_TRANSITION' },
        );
      }

      const updatedRows = await trx<ReferralDbRow>('referrals')
        .where({ id: params.referralId, clinic_id: params.clinicId })
        .update({
          task_status: params.to,
          updated_at: new Date(),
          ...(params.patch ?? {}),
        })
        .returning(REFERRAL_COLUMNS) as ReferralDbRow[];
      const updated = updatedRows[0];

      await trx('referral_state_transitions').insert({
        clinic_id: params.clinicId,
        referral_id: params.referralId,
        from_task_status: current.task_status,
        to_task_status: params.to,
        actor_id: params.actorId,
        reason: params.reason ?? null,
        created_at: new Date(),
      });

      return updated;
    });
  }

  /**
   * BUG-583 — `conn` defaults to the request-scoped `db` proxy. Schedulers
   * MUST pass `dbAdmin` so the SELECT does not RLS-zero outside any
   * request context (proxy falls through to `appPool` with empty
   * `app.clinic_id` GUC → `clinic_id = NULL` rejects every row).
   */
  async listReferralsForReminder(
    type: '3day' | '7day' | 'auto_close',
    conn: Knex = db,
  ): Promise<ReferralDbRow[]> {
    const query = conn<ReferralDbRow>('referrals')
      .where({ referral_mode: 'team', status: 'pending_broadcast' })
      .whereNull('deleted_at');

    if (type === '3day') {
      query
        .where('broadcast_at', '<', conn.raw("now() - interval '3 days'"))
        .whereNull('reminder_sent_at');
    } else if (type === '7day') {
      query
        .where('broadcast_at', '<', conn.raw("now() - interval '7 days'"))
        .whereNull('final_reminder_sent_at');
    } else {
      query
        .whereNotNull('auto_close_at')
        .where('auto_close_at', '<', conn.raw('now()'));
    }

    return query;
  }
}

export const referralRepository = new ReferralRepository();
