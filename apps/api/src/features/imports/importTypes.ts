/**
 * Shared types for the bulk-import pipeline.
 *
 * Every adapter implements the same two-phase contract:
 *   1. parseRow — pure validation. Returns a typed DTO OR a list of
 *      human-readable errors keyed to the row index + field. Never
 *      touches the database in this phase.
 *   2. commitOne — transactional write. Called in commit phase only,
 *      inside the caller's Knex transaction so a single failure rolls
 *      the whole batch back.
 *
 * The two phases let the frontend preview-then-confirm: upload the CSV,
 * show the error list, fix and re-upload, then commit when clean.
 *
 * ImportCtx carries clinic + uploader identity and the resolver cache
 * used by adapters that need to look up existing patients or staff
 * by email/name/emr_number inside the CSV row data.
 */
import type { Knex } from 'knex';

export type ImportKind =
  | 'patients'
  | 'lai'
  | 'clozapine'
  | 'clinical_notes';

export type ImportStatus =
  | 'pending'
  | 'validated'
  | 'committed'
  | 'rejected';

export interface RowError {
  rowIndex: number;   // 1-based, matches spreadsheet row numbering
  field?: string;
  message: string;
}

export interface ImportCtx {
  clinicId: string;
  uploadedByStaffId: string;
  // Populated lazily by the adapter via resolvers below.
  patientCache: Map<string, string>; // emr_number OR email → patient_id
  staffCache: Map<string, string>;   // email OR full-name → staff_id
}

export interface ImportAdapter<TDto> {
  readonly kind: ImportKind;
  readonly requiredColumns: readonly string[];
  /** Optional columns surfaced in the downloadable template. */
  readonly optionalColumns: readonly string[];
  parseRow(
    row: Record<string, string>,
    rowIndex: number,
    ctx: ImportCtx,
  ): Promise<{ ok: true; dto: TDto } | { ok: false; errors: RowError[] }>;
  commitOne(
    dto: TDto,
    ctx: ImportCtx,
    trx: Knex.Transaction,
  ): Promise<void>;
}

export interface ImportReport {
  errors: RowError[];
  warnings: RowError[];
  sampleRows: Array<Record<string, unknown>>;
}

export interface DryRunResult {
  jobId: string;
  rowCount: number;
  errorCount: number;
  report: ImportReport;
}

export interface CommitResult {
  jobId: string;
  committedCount: number;
  errorCount: number;
}
