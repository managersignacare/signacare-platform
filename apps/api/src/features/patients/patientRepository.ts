import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/db';
import { dbAdmin } from '../../db/db';
import { encryptPatientPhi, decryptPatientPhi } from '../../shared/phiEncryption';
import { escapeLike } from '../../shared/escapeLike';
import { extractCount } from '../../shared/extractCount';
import logger from '../../utils/logger';

// Lazily-cached column availability probe. The postgres_fts migration
// (20260411000004_postgres_fts.ts) adds a generated `search_tsv`
// tsvector column to `patients` for fast full-text search. In
// environments where that migration hasn't been applied yet (dev DBs
// restored from older dumps, staging mid-migration window), the
// column is absent and the tsvector query path throws at the Postgres
// parser. This probe detects column presence once and caches the
// result so the repository can transparently fall back to ILIKE when
// the fast path is unavailable. Zero overhead after first lookup.
let searchTsvAvailable: Promise<boolean> | null = null;
function hasSearchTsvColumn(): Promise<boolean> {
  if (searchTsvAvailable) return searchTsvAvailable;
  searchTsvAvailable = dbAdmin
    .raw<{ rows: Array<{ column_name: string }> }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'patients'
         AND column_name = 'search_tsv'`,
    )
    .then((r) => r.rows.length > 0)
    .catch((err) => {
      logger.warn(
        { err },
        'patientRepository.hasSearchTsvColumn probe failed — degrading to ILIKE search path',
      );
      return false;
    });
  return searchTsvAvailable;
}

/**
 * @schema-drift-exempt partial-shape
 * BUG-539 — Curated subset of the 63-col `patients` table; intentionally
 * excludes search_tsv (full-text index), sms_consent_*, viva_triage_number,
 * emergency_contact_*, country, email, address_line2, indigenous_status,
 * photo_url. The repository does not consume those columns; surfacing them
 * would expand response shape ahead of UI/feature design. BUG-539 tracks
 * the eventual decision to flatten or formalise this projection.
 */
export interface PatientRow {
  id: string;
  clinic_id: string;
  emr_number: string;
  given_name: string;
  family_name: string;
  preferred_name: string | null;
  date_of_birth: string;
  gender: string | null;
  pronouns: string | null;
  medicare_number: string | null;
  medicare_reference: string | null;
  medicare_expiry: string | null;
  ihi_number: string | null;
  ihi_record_status: string | null;
  ihi_number_status: string | null;
  dva_number: string | null;
  dva_card_type: string | null;
  phone_mobile: string | null;
  phone_home: string | null;
  email_primary: string | null;
  address_line1: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  gp_name: string | null;
  gp_practice: string | null;
  gp_phone: string | null;
  gp_fax: string | null;
  gp_email: string | null;
  gp_provider_number: string | null;
  gp_address_street: string | null;
  gp_address_suburb: string | null;
  gp_address_state: string | null;
  gp_address_postcode: string | null;
  nok_name: string | null;
  nok_relationship: string | null;
  nok_phone: string | null;
  atsi_status: string | null;
  interpreter_required: boolean;
  interpreter_language: string | null;
  consent_to_treatment: boolean;
  consent_for_research: boolean;
  consent_to_share_with_gp: boolean;
  consent_to_share_with_carer: boolean;
  health_fund_name: string | null;
  health_fund_number: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  // Blind-index columns (S7.1) — HMAC-SHA-256 of normalised identifier
  // plaintext for deterministic duplicate detection without decrypting the
  // encrypted column. See apps/api/src/shared/blindIndex.ts and
  // migrations/20260412000005_patient_duplicate_detection.ts.
  medicare_number_lookup?: string | null;
  ihi_number_lookup?: string | null;
  dva_number_lookup?: string | null;
  deleted_at: Date | null;
}

// Phase 0.7.5 c24 D9 — explicit .returning() column list matching the
// PatientRow interface above (which is a curated subset of the 63-col
// `patients` table — the interface excludes search_tsv, sms_consent_*,
// viva_triage_number, emergency_contact_*, country, email and other
// columns that the repository doesn't consume). Using the interface's
// column set in .returning preserves the pre-existing response shape
// while removing the silent blanket-select that was masking drift.
const PATIENT_COLUMNS = [
  'id', 'clinic_id', 'emr_number', 'given_name', 'family_name',
  'preferred_name', 'date_of_birth', 'gender', 'pronouns',
  'medicare_number', 'medicare_reference', 'medicare_expiry', 'ihi_number',
  'ihi_record_status', 'ihi_number_status',
  'dva_number', 'dva_card_type', 'phone_mobile', 'phone_home',
  'email_primary', 'address_line1', 'suburb', 'state', 'postcode',
  'gp_name', 'gp_practice', 'gp_phone', 'gp_fax', 'gp_email',
  'gp_provider_number', 'gp_address_street', 'gp_address_suburb',
  'gp_address_state', 'gp_address_postcode', 'nok_name',
  'nok_relationship', 'nok_phone', 'atsi_status', 'interpreter_required',
  'interpreter_language', 'consent_to_treatment', 'consent_for_research',
  'consent_to_share_with_gp', 'consent_to_share_with_carer',
  'health_fund_name', 'health_fund_number', 'status', 'created_at',
  'updated_at', 'medicare_number_lookup', 'ihi_number_lookup',
  'dva_number_lookup', 'deleted_at',
] as const;

type PatientQueryExecutor = Knex | Knex.Transaction;

export const patientRepository = {
  async findById(clinicId: string, id: string): Promise<PatientRow | null> {
    const row = await db<PatientRow>('patients')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .first();
    return row ? decryptPatientPhi(row as unknown as PatientRow & Record<string, unknown>) : null;
  },

  async create(
    data: Omit<PatientRow, 'created_at' | 'updated_at' | 'deleted_at'>,
    query: PatientQueryExecutor = db,
  ): Promise<PatientRow> {
    const encrypted = encryptPatientPhi(data as unknown as PatientRow & Record<string, unknown>);
    const rows = await query<PatientRow>('patients')
      .insert({ ...encrypted, id: data.id || uuidv4(), created_at: new Date(), updated_at: new Date(), deleted_at: null } as unknown as PatientRow)
      .returning(PATIENT_COLUMNS) as PatientRow[];
    return decryptPatientPhi(rows[0] as unknown as PatientRow & Record<string, unknown>);
  },

  async update(clinicId: string, id: string, patch: Partial<PatientRow>): Promise<PatientRow | null> {
    const encrypted = encryptPatientPhi(patch as unknown as Partial<PatientRow> & Record<string, unknown>);
    const rows = await db<PatientRow>('patients')
      .where({ id, clinic_id: clinicId })
      .update({ ...encrypted, updated_at: new Date() } as unknown as PatientRow)
      .returning(PATIENT_COLUMNS) as PatientRow[];
    return rows[0] ? decryptPatientPhi(rows[0] as unknown as PatientRow & Record<string, unknown>) : null;
  },

  async softDelete(clinicId: string, id: string): Promise<void> {
    await db<PatientRow>('patients')
      .where({ id, clinic_id: clinicId })
      .update({ deleted_at: new Date(), updated_at: new Date() });
  },

  async list(clinicId: string, opts: { search?: string; status?: string | null; page: number; limit: number; clinicianId?: string }): Promise<{ data: PatientRow[]; total: number; page: number; limit: number; totalPages: number }> {
    // Resolve whether the fast FTS path is available BEFORE building
    // the query, so both the count and page queries take the same
    // branch. Without this, the page query could use FTS while the
    // count uses ILIKE (or vice versa), producing inconsistent
    // totalPages / data counts.
    const useTsv = opts.search && opts.search.trim().length >= 3
      ? await hasSearchTsvColumn()
      : false;

    const baseQuery = () => {
      const q = db<PatientRow>('patients').where('patients.clinic_id', clinicId).whereNull('patients.deleted_at');
      if (opts.status && opts.status !== 'all') {
        q.where('patients.status', opts.status);
      }
      if (opts.clinicianId) {
        // BUG-430: outer patients query filters by clinic_id; assert the
        // same tenant inside the correlated whereExists so a foreign-clinic
        // episode can't satisfy the EXISTS clause under any RLS-disabled
        // path (Layer-1 per CLAUDE.md §1.3).
        q.whereExists(
          db('episodes')
            .whereRaw('episodes.patient_id = patients.id')
            .where('episodes.clinic_id', clinicId)
            .where('episodes.primary_clinician_id', opts.clinicianId)
            .whereNull('episodes.deleted_at')
        );
      }
      if (opts.search) {
        const trimmed = opts.search.trim();
        // S3.3: hybrid search.
        //   short queries (1-2 chars) -> ILIKE prefix on indexed name
        //                               columns. Stemmed FTS doesn't help
        //                               for "Da" or "Wo" (the stemmer
        //                               doesn't fire on prefixes).
        //   longer queries           -> Postgres tsvector FTS via the
        //                               generated search_tsv column +
        //                               GIN index added in migration
        //                               20260411000004_postgres_fts.ts.
        //                               websearch_to_tsquery handles
        //                               quoted phrases, OR, and -NOT
        //                               natively, so we pass user input
        //                               directly without parsing.
        //   ILIKE on phone_mobile is preserved for both branches because
        //   tsvector stemming would lose digit-by-digit matching.
        //
        // If the `search_tsv` column is absent (migration not applied
        // to this environment), the FTS branch degrades gracefully to
        // a multi-column ILIKE — correct but slower. Detection is
        // cached at module load via hasSearchTsvColumn().
        const term = escapeLike(trimmed);
        if (trimmed.length < 3 || !useTsv) {
          q.where(function (this: Knex.QueryBuilder) {
            this.whereRaw("patients.given_name ILIKE ?", [`%${term}%`])
              .orWhereRaw("patients.family_name ILIKE ?", [`%${term}%`])
              .orWhereRaw("patients.emr_number ILIKE ?", [`${term}%`])
              .orWhereRaw("patients.phone_mobile ILIKE ?", [`%${term}%`]);
          });
        } else {
          q.where(function (this: Knex.QueryBuilder) {
            this.whereRaw("patients.search_tsv @@ websearch_to_tsquery('english', ?)", [trimmed])
              .orWhereRaw("patients.phone_mobile ILIKE ?", [`%${term}%`]);
          });
        }
      }
      return q;
    };

    // Count total matching rows
    const countRows = await baseQuery().count('* as count');
    const total = extractCount(countRows as unknown as Array<Record<string, unknown>>);

    // Fetch the page
    const offset = (opts.page - 1) * opts.limit;
    const rows = await baseQuery().orderBy('patients.family_name').limit(opts.limit).offset(offset);
    const data = rows.map(r => decryptPatientPhi(r as unknown as PatientRow & Record<string, unknown>));
    const totalPages = Math.ceil(total / opts.limit);

    return { data, total, page: opts.page, limit: opts.limit, totalPages };
  },

  async findPotentialDuplicates(clinicId: string, opts: { givenName: string; familyName: string; dateOfBirth: string; medicareNumber?: string }): Promise<PatientRow[]> {
    return db<PatientRow>('patients')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .whereRaw('given_name ILIKE ? AND family_name ILIKE ? AND date_of_birth = ?', [opts.givenName, opts.familyName, opts.dateOfBirth]);
  },
};
