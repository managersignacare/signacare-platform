// apps/api/src/features/privacy/anonymisePatientService.ts
//
// BUG-374b — TS replacement for ghost SQL function `anonymise_patient(uuid, reason)`.
//
// Verified non-existent in repo (no migration defines it; privacyRoutes.ts:128
// would 500 in production every time anonymise was called) → BUG-594 cascade
// closes atomically with this service landing.
//
// Locked policy (project_data_retention_policy.md + Q-B/Q-C/Q-G):
//   - Scrub identity columns on `patients` to canonical sentinels
//   - DOB → '1900-01-01' (Q-G)
//   - DO NOT scrub free-text in clinical_notes (Q-C — patient identity wipe
//     only; clinical narrative preserved)
//   - PRESERVE consent_* booleans (Q-B kept consent records)
//   - Idempotent — purged_at IS NOT NULL → no-op
//   - Audit-log entry per anonymisation
//   - Transactional — rollback on any failure
//
// fix-registry: BUG-374B-NO-FREE-TEXT-SCRUB, BUG-374B-AUDIT-ANONYMISE,
// BUG-374B-IDEMPOTENT-PURGED-AT.

import type { AuthContext } from '@signacare/shared';
import { Result } from '@signacare/shared';
import type { Knex } from 'knex';
import { AppError } from '../../shared/errors';
import { dbAdmin } from '../../db/db';
import { writeAuditLog } from '../../utils/audit';
import { logger as pinoLogger } from '../../utils/logger';

// Scrubber version stamp — bump when scrub-list semantics change. The
// version is captured in the AnonymiseOutcome + audit_log so future
// re-anonymisation logic (BUG-600) can identify which rule-set was applied.
const SCRUBBER_VERSION = 'v1.0-bug374b';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * @schema-drift-exempt partial-shape
 * BUG-374b — PatientIdentityRow is a deliberate sub-projection of
 * `patients` covering ONLY the columns the anonymisation flow reads:
 * id + clinic_id (FK targets), names + DOB (idempotency check + audit
 * oldData capture), identifiers + lookups (oldData reference), and
 * `purged_at` (idempotency bright-line per Q-E). The remaining ~80
 * columns on `patients` (gender, emr_number, contact, GP details, NOK,
 * consent_*, last_contact_at, deceased_date, etc.) are scrubbed via
 * `PatientScrubPatch` (a write-only shape) but never read here.
 * Sub-projection is intentional — flattening would couple every
 * `patients` schema change to this service.
 *
 * Eventual flattening tracked in `BUG-374b-CASCADE-6` (filed in this
 * cycle): formalise the read shape as a typed view OR audit whether
 * the full row is needed (reading more columns might surface drift
 * earlier). Until then, partial-shape exemption is the documented
 * trade-off.
 */
export interface PatientIdentityRow {
  id: string;
  clinic_id: string;
  given_name: string | null;
  family_name: string | null;
  preferred_name: string | null;
  date_of_birth: string | null;
  medicare_number: string | null;
  medicare_number_lookup: string | null;
  ihi_number_lookup: string | null;
  dva_number_lookup: string | null;
  purged_at: Date | null;
  // Other identity fields are scrubbed via the patch but not read back here.
}

export interface AnonymiseOutcome {
  patientId: string;
  /** false when patient was already purged (idempotent no-op). */
  mutated: boolean;
  /** Scrubber version stamp for forensic re-anonymisation tracking. */
  scrubberVersion: string;
}

export interface PatientScrubPatch {
  given_name: string;
  family_name: string;
  preferred_name: string;
  date_of_birth: string;  // Q-G sentinel '1900-01-01'
  email: null;
  email_primary: null;
  phone_mobile: null;
  phone_home: null;
  address_line1: null;
  address_line2: null;
  suburb: null;
  state: null;
  postcode: null;
  country: null;
  gender: null;
  pronouns: null;
  indigenous_status: null;
  atsi_status: null;
  interpreter_required: false;
  interpreter_language: null;
  medicare_number: null;
  medicare_reference: null;
  medicare_expiry: null;
  ihi_number: null;
  dva_number: null;
  dva_card_type: null;
  medicare_number_lookup: null;
  ihi_number_lookup: null;
  dva_number_lookup: null;
  emergency_contact_name: null;
  emergency_contact_phone: null;
  emergency_contact_relationship: null;
  gp_name: null;
  gp_practice: null;
  gp_phone: null;
  gp_fax: null;
  gp_email: null;
  gp_provider_number: null;
  gp_address_street: null;
  gp_address_suburb: null;
  gp_address_state: null;
  gp_address_postcode: null;
  nok_name: null;
  nok_relationship: null;
  nok_phone: null;
  viva_triage_number: null;
  health_fund_name: null;
  health_fund_number: null;
  photo_url: null;
  emr_number: null;
  status: 'anonymised';
  purged_at: Date;
}

export interface AnonymiseAuditEntry {
  action: 'ANONYMISE';
  tableName: 'patients';
  actorId: string;
  clinicId: string;
  recordId: string;
  oldData: Record<string, unknown>;
  newData: Record<string, unknown>;
}

export interface AnonymisePatientContext {
  fetchPatient(clinicId: string, patientId: string): Promise<PatientIdentityRow | null>;
  /**
   * BUG-374b L3 absorb-1 F5 — clinicId required in the UPDATE WHERE per
   * CLAUDE.md §1.3 defence-in-depth. dbAdmin bypasses RLS so the
   * application-layer clinic predicate is the only protection against
   * a mis-bound `patientId`.
   */
  scrubAndUpdatePatient(
    trx: Knex.Transaction,
    clinicId: string,
    patientId: string,
    scrubbed: PatientScrubPatch,
  ): Promise<void>;
  writeAudit(trx: Knex.Transaction, entry: AnonymiseAuditEntry): Promise<void>;
  runInTransaction<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T>;
  /**
   * Pino-compatible structured logger. The `(obj, msg)` shape mirrors
   * pino's `LogFn` so callers can drop in `logger.info({err, ...}, 'msg')`.
   * Loose `unknown` typing on `extras` accommodates pino's
   * variadic-args legacy callers without resorting to `any`.
   */
  logger: {
    info(obj: object | string, msg?: string, ...extras: unknown[]): void;
    warn(obj: object | string, msg?: string, ...extras: unknown[]): void;
    error(obj: object | string, msg?: string, ...extras: unknown[]): void;
  };
  // INTENTIONALLY ABSENT (Q-C none-scrub policy):
  //   loadScrubRules, scrubClinicalNotes — would imply free-text scrubbing.
  //   The compile-time absence of these hooks is the structural enforcement
  //   that Q-C's "DO NOT scrub free-text" policy cannot be silently violated.
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildScrubPatch(now: Date): PatientScrubPatch {
  return {
    given_name: '[REDACTED]',
    family_name: '[REDACTED]',
    preferred_name: '[REDACTED]',
    date_of_birth: '1900-01-01',
    email: null,
    email_primary: null,
    phone_mobile: null,
    phone_home: null,
    address_line1: null,
    address_line2: null,
    suburb: null,
    state: null,
    postcode: null,
    country: null,
    gender: null,
    pronouns: null,
    indigenous_status: null,
    atsi_status: null,
    interpreter_required: false,
    interpreter_language: null,
    medicare_number: null,
    medicare_reference: null,
    medicare_expiry: null,
    ihi_number: null,
    dva_number: null,
    dva_card_type: null,
    medicare_number_lookup: null,
    ihi_number_lookup: null,
    dva_number_lookup: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    emergency_contact_relationship: null,
    gp_name: null,
    gp_practice: null,
    gp_phone: null,
    gp_fax: null,
    gp_email: null,
    gp_provider_number: null,
    gp_address_street: null,
    gp_address_suburb: null,
    gp_address_state: null,
    gp_address_postcode: null,
    nok_name: null,
    nok_relationship: null,
    nok_phone: null,
    viva_triage_number: null,
    health_fund_name: null,
    health_fund_number: null,
    photo_url: null,
    emr_number: null,
    status: 'anonymised',
    purged_at: now,
  };
}

function captureOldIdentity(p: PatientIdentityRow): Record<string, unknown> {
  return {
    given_name: p.given_name,
    family_name: p.family_name,
    preferred_name: p.preferred_name,
    date_of_birth: p.date_of_birth,
    medicare_number: p.medicare_number,
  };
}

// ── Service ────────────────────────────────────────────────────────────────

export const anonymisePatientService = {
  async anonymise(
    auth: AuthContext,
    patientId: string,
    reason: string,
    ctx: AnonymisePatientContext = liveContext(),
  ): Promise<Result<AnonymiseOutcome, AppError>> {
    if (auth.role !== 'superadmin') {
      return Result.err(
        new AppError(
          'Patient anonymisation is restricted to platform superadmins per BUG-374 policy',
          403,
          'FORBIDDEN',
        ),
      );
    }
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      return Result.err(
        new AppError('Anonymisation reason is required (non-empty)', 422, 'VALIDATION_ERROR'),
      );
    }

    try {
      const existing = await ctx.fetchPatient(auth.clinicId, patientId);
      if (!existing) {
        return Result.err(
          new AppError('Patient not found in this clinic', 404, 'NOT_FOUND'),
        );
      }

      // Idempotency — purged_at is the bright line per Q-E.
      if (existing.purged_at !== null) {
        return Result.ok({
          patientId,
          mutated: false,
          scrubberVersion: SCRUBBER_VERSION,
        });
      }

      const now = new Date();
      const scrubbed = buildScrubPatch(now);

      await ctx.runInTransaction(async (trx) => {
        await ctx.scrubAndUpdatePatient(trx, auth.clinicId, patientId, scrubbed);
        await ctx.writeAudit(trx, {
          action: 'ANONYMISE',
          tableName: 'patients',
          actorId: auth.staffId,
          clinicId: auth.clinicId,
          recordId: patientId,
          oldData: captureOldIdentity(existing),
          newData: {
            scrubber_version: SCRUBBER_VERSION,
            reason: reason.trim(),
            purged_at: now.toISOString(),
          },
        });
      });

      return Result.ok({
        patientId,
        mutated: true,
        scrubberVersion: SCRUBBER_VERSION,
      });
    } catch (err) {
      const e = err instanceof AppError
        ? err
        : new AppError(
            err instanceof Error ? err.message : 'Anonymisation failed',
            500,
            'INTERNAL_ERROR',
          );
      ctx.logger.error({ err, patientId, clinicId: auth.clinicId }, 'anonymisePatient failed');
      return Result.err(e);
    }
  },
};

// ── Live context (production binding) ──────────────────────────────────────

const PATIENT_IDENTITY_COLUMNS = [
  'id',
  'clinic_id',
  'given_name',
  'family_name',
  'preferred_name',
  'date_of_birth',
  'medicare_number',
  'medicare_number_lookup',
  'ihi_number_lookup',
  'dva_number_lookup',
  'purged_at',
] as const;

function liveContext(): AnonymisePatientContext {
  return {
    async fetchPatient(clinicId: string, patientId: string): Promise<PatientIdentityRow | null> {
      // @intentional Knex `.select()` accepts `(string | object)[]` — the
      // readonly tuple above is structurally compatible at runtime; the
      // double cast (`as unknown as string[]` + result `as PatientIdentityRow
      // | undefined`) bridges the loose typing without hiding column drift
      // (the schema-snapshot row-iface guard verifies PATIENT_IDENTITY_COLUMNS
      // exist on `patients`).
      const row = (await dbAdmin('patients')
        .where({ id: patientId, clinic_id: clinicId })
        .whereNull('deleted_at')
        .select(PATIENT_IDENTITY_COLUMNS as unknown as string[])
        .first()) as PatientIdentityRow | undefined;
      return row ?? null;
    },
    async scrubAndUpdatePatient(trx, clinicId, patientId, scrubbed) {
      // BUG-374b L3 absorb-1 F5 — clinic_id in WHERE per CLAUDE.md §1.3.
      // The prior fetchPatient proves tenancy, but `dbAdmin` bypasses RLS
      // so application-layer clinic_id is the only enforcement against
      // a mis-bound `patientId`. Defence-in-depth.
      await trx('patients')
        .where({ id: patientId, clinic_id: clinicId })
        .update({ ...scrubbed, updated_at: new Date() });
    },
    async writeAudit(trx, entry) {
      // writeAuditLog supports an optional trx via its third param in newer
      // signature; call without trx is fine as audit_log inserts use dbAdmin
      // internally per BUG-583. The trx parameter is reserved for future
      // when writeAuditLog supports transaction-scoped writes.
      void trx;
      await writeAuditLog({
        actorId: entry.actorId,
        clinicId: entry.clinicId,
        action: entry.action,
        tableName: entry.tableName,
        recordId: entry.recordId,
        oldData: entry.oldData,
        newData: entry.newData,
      });
    },
    async runInTransaction(fn) {
      return dbAdmin.transaction(fn);
    },
    // Pino logger (CLAUDE.md §3.1). The interface signature is the
    // narrowed `(obj, msg, ...extras)` shape; pino's bound methods
    // satisfy it directly without delegation glue.
    logger: pinoLogger,
  };
}
