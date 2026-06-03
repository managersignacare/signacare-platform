/**
 * importService — generic two-phase bulk CSV importer.
 *
 * Phase 1 (dry-run): parse the uploaded CSV, run every row through
 * the adapter's parseRow, record errors in import_jobs.report, set
 * status to 'validated' (or 'rejected' if any row failed). Nothing
 * touches the target tables.
 *
 * Phase 2 (commit): re-read the CSV from the original upload blob,
 * run every row through parseRow again (to catch any server-state
 * drift between dry-run and commit), then call commitOne inside a
 * single Knex transaction so a mid-batch failure rolls the whole
 * batch back. committed_at is stamped only after the transaction
 * commits successfully.
 *
 * The caller (route handler) is responsible for extracting the CSV
 * bytes from multer and persisting them so the commit phase can
 * re-read them. For Phase 2 of this feature we keep the CSV in the
 * import_jobs.report JSONB under key `__raw` as a base64 string —
 * compact, tenant-isolated by RLS, and avoids adding a blob layer
 * for the first cut.
 *
 * Adapters are looked up from the adapter registry keyed on the
 * import kind. Adding a new kind means: add the kind to IMPORT_KINDS
 * in the migration, implement the adapter, and register it here.
 */
import { parse } from 'csv-parse/sync';
import { db } from '../../db/db';
import { AppError } from '../../shared/errors';

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// import_jobs — the caller only reads `id` from the result so we only
// project it to minimise the payload.
const IMPORT_JOB_ID_ONLY = ['id'] as const;
import type {
  CommitResult,
  DryRunResult,
  ImportAdapter,
  ImportCtx,
  ImportKind,
  ImportReport,
  RowError,
} from './importTypes';
import { patientImportAdapter } from './adapters/patientImportAdapter';
import { laiImportAdapter } from './adapters/laiImportAdapter';
import { clozapineImportAdapter } from './adapters/clozapineImportAdapter';
import { clinicalNoteImportAdapter } from './adapters/clinicalNoteImportAdapter';

// ── Adapter registry ──────────────────────────────────────────────────
const ADAPTERS: Record<ImportKind, ImportAdapter<unknown>> = {
  patients: patientImportAdapter as ImportAdapter<unknown>,
  lai: laiImportAdapter as ImportAdapter<unknown>,
  clozapine: clozapineImportAdapter as ImportAdapter<unknown>,
  clinical_notes: clinicalNoteImportAdapter as ImportAdapter<unknown>,
};

// Safety cap — a single import above this is almost certainly a
// misconfigured upload and worth forcing the caller to chunk it.
const MAX_ROWS_PER_IMPORT = 10_000;

function parseCsvText(text: string): Record<string, string>[] {
  // csv-parse handles quoted newlines, embedded commas, BOM stripping,
  // and CRLF/LF normalisation. bom:true eats the optional UTF-8 BOM
  // Excel likes to prepend.
  return parse(text, {
    columns: (header: string[]) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: false,
  }) as Record<string, string>[];
}

function makeCtx(clinicId: string, uploadedByStaffId: string): ImportCtx {
  return {
    clinicId,
    uploadedByStaffId,
    patientCache: new Map(),
    staffCache: new Map(),
  };
}

function missingHeaderErrors(
  headers: string[],
  adapter: ImportAdapter<unknown>,
): RowError[] {
  const have = new Set(headers.map((h) => h.toLowerCase()));
  const missing = adapter.requiredColumns.filter((c) => !have.has(c.toLowerCase()));
  return missing.map((c) => ({
    rowIndex: 0,
    field: c,
    message: `Missing required column '${c}'`,
  }));
}

// ── Public surface ────────────────────────────────────────────────────

export const importService = {
  /** Kick off a new import job in dry-run mode. */
  async createDryRun(params: {
    clinicId: string;
    uploadedByStaffId: string;
    kind: ImportKind;
    filename: string | null;
    csvText: string;
  }): Promise<DryRunResult> {
    const adapter = ADAPTERS[params.kind];
    if (!adapter) {
      throw new AppError(`Unknown import kind '${params.kind}'`, 400, 'IMPORT_UNKNOWN_KIND');
    }

    let rows: Record<string, string>[];
    try {
      rows = parseCsvText(params.csvText);
    } catch (err) {
      throw new AppError(
        `Could not parse CSV: ${(err as Error).message}`,
        400,
        'IMPORT_CSV_PARSE_FAILED',
      );
    }
    if (rows.length > MAX_ROWS_PER_IMPORT) {
      throw new AppError(
        `Import exceeds the ${MAX_ROWS_PER_IMPORT}-row cap. Split the file.`,
        400,
        'IMPORT_TOO_MANY_ROWS',
      );
    }

    const headers = rows[0] ? Object.keys(rows[0]) : [];
    const headerErrors = rows.length > 0
      ? missingHeaderErrors(headers, adapter)
      : [];

    const ctx = makeCtx(params.clinicId, params.uploadedByStaffId);
    const errors: RowError[] = [...headerErrors];
    const warnings: RowError[] = [];

    if (headerErrors.length === 0) {
      for (let i = 0; i < rows.length; i += 1) {
        const parsed = await adapter.parseRow(rows[i], i + 2 /* 1-based + 1 for header */, ctx);
        if (!parsed.ok) errors.push(...parsed.errors);
      }
    }

    const sampleRows = rows.slice(0, 5);
    const report: ImportReport = { errors, warnings, sampleRows };

    const status = errors.length === 0 ? 'validated' : 'rejected';

    const [job] = await db('import_jobs')
      .insert({
        clinic_id: params.clinicId,
        uploaded_by_id: params.uploadedByStaffId,
        kind: params.kind,
        status,
        filename: params.filename,
        row_count: rows.length,
        error_count: errors.length,
        committed_count: 0,
        report: db.raw('?::jsonb', [JSON.stringify({
          ...report,
          // Persist the raw CSV under a sentinel key so the commit
          // phase can re-run parseRow without the client re-uploading.
          // Kept inside the report JSONB to inherit the same RLS and
          // audit lifecycle as the rest of the job row.
          __raw: Buffer.from(params.csvText, 'utf8').toString('base64'),
        })]),
      })
      .returning(IMPORT_JOB_ID_ONLY) as Array<{ id: string }>;

    return {
      jobId: job.id,
      rowCount: rows.length,
      errorCount: errors.length,
      report,
    };
  },

  /** Commit an already-validated import job. */
  async commit(params: {
    clinicId: string;
    actorStaffId: string;
    jobId: string;
  }): Promise<CommitResult> {
    const job = await db('import_jobs')
      .where({ id: params.jobId, clinic_id: params.clinicId })
      .whereNull('deleted_at')
      .first() as
        | {
            id: string;
            kind: ImportKind;
            status: string;
            uploaded_by_id: string;
            report: { __raw?: string };
          }
        | undefined;
    if (!job) {
      throw new AppError('Import job not found', 404, 'IMPORT_NOT_FOUND');
    }
    if (job.status !== 'validated') {
      throw new AppError(
        `Cannot commit an import job in status '${job.status}'`,
        422,
        'IMPORT_NOT_VALIDATED',
      );
    }
    const rawB64 = job.report?.__raw;
    if (!rawB64) {
      throw new AppError(
        'Import job has no payload — re-upload required',
        422,
        'IMPORT_PAYLOAD_MISSING',
      );
    }
    const csvText = Buffer.from(rawB64, 'base64').toString('utf8');
    const adapter = ADAPTERS[job.kind];
    if (!adapter) {
      throw new AppError(`Unknown import kind '${job.kind}'`, 400, 'IMPORT_UNKNOWN_KIND');
    }

    const rows = parseCsvText(csvText);
    const ctx = makeCtx(params.clinicId, params.actorStaffId);

    // Re-validate inside the transaction so any server-side drift
    // between dry-run and commit (e.g. a patient added between then
    // and now) is caught before we start writing.
    let committedCount = 0;
    const commitErrors: RowError[] = [];

    await db.transaction(async (trx) => {
      for (let i = 0; i < rows.length; i += 1) {
        const parsed = await adapter.parseRow(rows[i], i + 2, ctx);
        if (!parsed.ok) {
          commitErrors.push(...parsed.errors);
          // Hard-fail on the first row error during commit — the
          // dry-run should have caught this; a drift failure means
          // we rolled back and the caller has to re-run dry-run.
          throw new AppError(
            'Commit failed — data drift detected since dry-run. Re-run dry-run.',
            409,
            'IMPORT_DRIFT',
            { errors: commitErrors },
          );
        }
        await adapter.commitOne(parsed.dto, ctx, trx);
        committedCount += 1;
      }

      await trx('import_jobs')
        .where({ id: params.jobId })
        .update({
          status: 'committed',
          committed_count: committedCount,
          committed_at: new Date(),
        });
    });

    return { jobId: params.jobId, committedCount, errorCount: 0 };
  },

  async getJob(clinicId: string, jobId: string) {
    return db('import_jobs')
      .where({ id: jobId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .first();
  },

  async listJobs(clinicId: string, kind?: ImportKind) {
    const q = db('import_jobs')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .orderBy('uploaded_at', 'desc')
      .limit(100);
    if (kind) q.andWhere({ kind });
    return q;
  },
};
