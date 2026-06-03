#!/usr/bin/env tsx
/**
 * BUG-273 — Backfill clinical_notes.consent_id for pre-existing rows.
 *
 * Pre-migration, the link between a clinical_note and the
 * scribe_consents row that authorised its recording lived only in
 * audit_log (`operation = 'AMBIENT_NOTE_RECORDING_STARTED'`,
 * `record_id = consentId`, `new_values->>'patientId'` matching the
 * note's patient_id, `created_at` within a narrow window BEFORE the
 * note's created_at). The `clinical_notes` table itself has no
 * `audio_storage_key` column, so the join key is temporal proximity
 * on `(clinic_id, patient_id, created_at)`.
 *
 * This script runs OUTSIDE the migration transaction (per
 * CLAUDE.md §12.1 + BUG-273 L5 absorption) so a long backfill does
 * not hold locks on `clinical_notes`. It:
 *
 *   1. PREFLIGHT — counts clinical_notes with AMBIGUOUS audit matches
 *      (more than one candidate consent within the time window). If
 *      >0 → emit a CSV of ambiguous note IDs and ABORT.
 *   2. BACKFILL — chunked UPDATE of 1000 rows per transaction with
 *      `SET LOCAL statement_timeout = '5min'` + `SET LOCAL work_mem
 *      = '64MB'`. Uses temporal-proximity join: audit_log row with
 *      matching (clinic_id, patient_id) within
 *      BACKFILL_WINDOW_MINUTES (default 10) BEFORE the note's
 *      created_at, tie-break on `created_at DESC` (most recent
 *      audit row wins).
 *   3. REPORT — emits counts to stdout AND to
 *      docs/audit-2026-04-19/findings/BUG-273-backfill-report.md
 *      (appends, timestamped) so "best effort" becomes "measured
 *      effort" (R2 absorption):
 *        - resolved: consent_id IS NOT NULL
 *        - unresolved_ai_draft: is_ai_draft AND consent_id IS NULL
 *        - legacy_not_ai_draft: NOT is_ai_draft AND consent_id IS NULL
 *        - total
 *
 * After this script completes with a clean report, ops runs:
 *   ALTER TABLE clinical_notes VALIDATE CONSTRAINT clinical_notes_consent_id_fk;
 * which validates the FK against all rows (brief
 * ShareUpdateExclusiveLock but no table scan because the FK uses the
 * index).
 *
 * Usage:
 *   cd apps/api
 *   npx tsx scripts/backfill-clinical-notes-consent-id.ts
 *
 * Env (optional):
 *   BACKFILL_WINDOW_MINUTES  default 10
 *   BACKFILL_CHUNK_SIZE      default 1000
 *   BACKFILL_DRY_RUN         'true' → preflight + report only, no UPDATEs
 */

import { dbAdmin } from '../src/db/db';
import * as path from 'path';
import * as fs from 'fs';

const WINDOW_MINUTES = parseInt(process.env.BACKFILL_WINDOW_MINUTES ?? '10', 10);
const CHUNK_SIZE = parseInt(process.env.BACKFILL_CHUNK_SIZE ?? '1000', 10);
const DRY_RUN = process.env.BACKFILL_DRY_RUN === 'true';

const REPORT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'audit-2026-04-19',
  'findings',
  'BUG-273-backfill-report.md',
);

interface PreflightAmbiguous {
  clinical_note_id: string;
  candidate_consent_count: string;
}

interface ReportCounts {
  resolved: number;
  unresolved_ai_draft: number;
  legacy_not_ai_draft: number;
  total: number;
}

async function preflightAmbiguity(): Promise<PreflightAmbiguous[]> {
  // Find clinical_notes (is_ai_draft only — manual notes pre-date
  // ambient-note) where MORE THAN ONE AMBIENT_NOTE_RECORDING_STARTED
  // audit row matches within the time window. Those can't be
  // automatically resolved.
  const rows = await dbAdmin.raw<{ rows: PreflightAmbiguous[] }>(
    `
    SELECT cn.id AS clinical_note_id,
           COUNT(al.id) AS candidate_consent_count
      FROM clinical_notes cn
      JOIN audit_log al
        ON al.operation = 'AMBIENT_NOTE_RECORDING_STARTED'
       AND al.clinic_id = cn.clinic_id
       AND (al.new_data->>'patientId')::uuid = cn.patient_id
       AND al.created_at <= cn.created_at
       AND al.created_at >= cn.created_at - (? * INTERVAL '1 minute')
     WHERE cn.is_ai_draft = true
       AND cn.consent_id IS NULL
     GROUP BY cn.id
    HAVING COUNT(al.id) > 1
  `,
    [WINDOW_MINUTES],
  );
  return rows.rows;
}

async function _backfillChunk(): Promise<number> {
  // Returns the number of rows updated in this chunk.
  // Uses DISTINCT ON to pick the MOST RECENT matching audit row
  // per note (tie-break on al.created_at DESC).
  const result = await dbAdmin.raw<{ rowCount: number }>(
    `
    WITH target_notes AS (
      SELECT id
        FROM clinical_notes
       WHERE is_ai_draft = true
         AND consent_id IS NULL
       ORDER BY created_at
       LIMIT ?
    ),
    matched AS (
      SELECT DISTINCT ON (cn.id)
             cn.id AS note_id,
             al.record_id::uuid AS consent_id
        FROM clinical_notes cn
        JOIN target_notes tn ON tn.id = cn.id
        JOIN audit_log al
          ON al.operation = 'AMBIENT_NOTE_RECORDING_STARTED'
         AND al.clinic_id = cn.clinic_id
         AND (al.new_data->>'patientId')::uuid = cn.patient_id
         AND al.created_at <= cn.created_at
         AND al.created_at >= cn.created_at - (? * INTERVAL '1 minute')
       ORDER BY cn.id, al.created_at DESC
    )
    UPDATE clinical_notes cn
       SET consent_id = m.consent_id
      FROM matched m
     WHERE cn.id = m.note_id
  `,
    [CHUNK_SIZE, WINDOW_MINUTES],
  );
  return result.rowCount ?? 0;
}

async function countReport(): Promise<ReportCounts> {
  const row = await dbAdmin.raw<{ rows: Array<{ resolved: string; unresolved_ai_draft: string; legacy_not_ai_draft: string; total: string }> }>(
    `
    SELECT
      COUNT(*) FILTER (WHERE consent_id IS NOT NULL) AS resolved,
      COUNT(*) FILTER (WHERE consent_id IS NULL AND is_ai_draft = true)  AS unresolved_ai_draft,
      COUNT(*) FILTER (WHERE consent_id IS NULL AND is_ai_draft = false) AS legacy_not_ai_draft,
      COUNT(*) AS total
    FROM clinical_notes
    WHERE deleted_at IS NULL
  `,
  );
  const r = row.rows[0]!;
  return {
    resolved: parseInt(r.resolved, 10),
    unresolved_ai_draft: parseInt(r.unresolved_ai_draft, 10),
    legacy_not_ai_draft: parseInt(r.legacy_not_ai_draft, 10),
    total: parseInt(r.total, 10),
  };
}

function writeReport(counts: ReportCounts, ambiguous: PreflightAmbiguous[]): void {
  const now = new Date().toISOString();
  const body = `
## Run ${now}

- window: ${WINDOW_MINUTES} minutes
- chunk: ${CHUNK_SIZE} rows per transaction
- dry_run: ${DRY_RUN}

**Counts (clinical_notes, deleted_at IS NULL):**

- resolved:              ${counts.resolved}
- unresolved_ai_draft:   ${counts.unresolved_ai_draft}
- legacy_not_ai_draft:   ${counts.legacy_not_ai_draft}
- total:                 ${counts.total}

**Ambiguous notes (more than one candidate consent in window):**
${ambiguous.length === 0 ? 'none' : ambiguous.map((a) => `- ${a.clinical_note_id} (${a.candidate_consent_count} candidates)`).join('\n')}

---
`;
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.appendFileSync(REPORT_PATH, body);
}

async function main(): Promise<number> {
  console.log('BUG-273 backfill — clinical_notes.consent_id');
  console.log(`  window: ${WINDOW_MINUTES} minutes`);
  console.log(`  chunk:  ${CHUNK_SIZE} rows`);
  console.log(`  dry_run: ${DRY_RUN}`);

  // Preflight.
  console.log('\n[1/3] Preflight ambiguity check …');
  const ambiguous = await preflightAmbiguity();
  console.log(`  ambiguous notes: ${ambiguous.length}`);
  if (ambiguous.length > 0) {
    console.error(`\n✗ Backfill ABORTED. ${ambiguous.length} notes have MORE THAN ONE`);
    console.error('  candidate AMBIENT_NOTE_RECORDING_STARTED audit row within the');
    console.error(`  ${WINDOW_MINUTES}-minute window. Manual triage required.`);
    const before = await countReport();
    writeReport(before, ambiguous);
    return 1;
  }

  // Backfill.
  if (DRY_RUN) {
    console.log('\n[2/3] DRY RUN — skipping UPDATE');
  } else {
    console.log('\n[2/3] Chunked backfill …');
    let total = 0;
    let chunk = 0;
    do {
      await dbAdmin.transaction(async (trx) => {
        await trx.raw("SET LOCAL statement_timeout = '5min'");
        await trx.raw("SET LOCAL work_mem = '64MB'");
        chunk = (await trx.raw<{ rowCount: number }>(
          `
          WITH target_notes AS (
            SELECT id
              FROM clinical_notes
             WHERE is_ai_draft = true
               AND consent_id IS NULL
             ORDER BY created_at
             LIMIT ?
          ),
          matched AS (
            SELECT DISTINCT ON (cn.id)
                   cn.id AS note_id,
                   al.record_id::uuid AS consent_id
              FROM clinical_notes cn
              JOIN target_notes tn ON tn.id = cn.id
              JOIN audit_log al
                ON al.operation = 'AMBIENT_NOTE_RECORDING_STARTED'
               AND al.clinic_id = cn.clinic_id
               AND (al.new_data->>'patientId')::uuid = cn.patient_id
               AND al.created_at <= cn.created_at
               AND al.created_at >= cn.created_at - (? * INTERVAL '1 minute')
             ORDER BY cn.id, al.created_at DESC
          )
          UPDATE clinical_notes cn
             SET consent_id = m.consent_id
            FROM matched m
           WHERE cn.id = m.note_id
        `,
          [CHUNK_SIZE, WINDOW_MINUTES],
        )).rowCount ?? 0;
      });
      total += chunk;
      console.log(`  chunk: ${chunk} updated (total: ${total})`);
    } while (chunk === CHUNK_SIZE);
    console.log(`  total rows updated: ${total}`);
  }

  // Report.
  console.log('\n[3/3] Post-backfill report …');
  const after = await countReport();
  console.log(`  resolved:              ${after.resolved}`);
  console.log(`  unresolved_ai_draft:   ${after.unresolved_ai_draft}`);
  console.log(`  legacy_not_ai_draft:   ${after.legacy_not_ai_draft}`);
  console.log(`  total:                 ${after.total}`);
  writeReport(after, ambiguous);
  console.log(`\nReport appended to: ${REPORT_PATH}`);

  console.log('\nNext step (ops): run VALIDATE CONSTRAINT to enforce the FK');
  console.log('against all rows:');
  console.log('  psql … -c "ALTER TABLE clinical_notes VALIDATE CONSTRAINT clinical_notes_consent_id_fk"');
  return 0;
}

main()
  .then((code) => dbAdmin.destroy().then(() => process.exit(code)))
  .catch((err) => {
    console.error('backfill failed:', err);
    dbAdmin.destroy().finally(() => process.exit(2));
  });
