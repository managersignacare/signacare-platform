#!/usr/bin/env tsx
/**
 * A2-2 Phase C / BUG-315 backfill executor.
 *
 * Objective:
 * - eliminate remaining NULL clinical_notes.consent_id rows safely.
 * - preserve best-available provenance:
 *   1) first link AI drafts to exactly-one matching ambient-note audit consent,
 *   2) then create legacy synthetic consent anchors for any unresolved notes.
 *
 * Why synthetic anchors exist:
 * - historical/manual notes predate strict consent linkage,
 * - Phase C NOT NULL requires every row to reference a consent_id,
 * - we create explicit, backfill-tagged, REVOKED clinician_attestation rows
 *   so they remain valid FK anchors but are never reused for future recording.
 */

import { dbAdmin } from '../src/db/db';

const WINDOW_MINUTES = parseInt(process.env.A2_PHASE_C_WINDOW_MINUTES ?? '10', 10);
const CHUNK_SIZE = parseInt(process.env.A2_PHASE_C_CHUNK_SIZE ?? '500', 10);
const DRY_RUN = process.env.A2_PHASE_C_DRY_RUN === 'true';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface NullCounts {
  total: number;
  aiDraft: number;
  nonAi: number;
}

function toInt(value: unknown): number {
  return Number.parseInt(String(value ?? '0'), 10);
}

async function countNulls(): Promise<NullCounts> {
  const row = await dbAdmin.raw<{
    rows: Array<{ total: string; ai_draft: string; non_ai: string }>;
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE consent_id IS NULL AND deleted_at IS NULL)::text AS total,
      COUNT(*) FILTER (WHERE consent_id IS NULL AND deleted_at IS NULL AND is_ai_draft = true)::text AS ai_draft,
      COUNT(*) FILTER (WHERE consent_id IS NULL AND deleted_at IS NULL AND is_ai_draft = false)::text AS non_ai
    FROM clinical_notes
  `);

  const current = row.rows[0]!;
  return {
    total: toInt(current.total),
    aiDraft: toInt(current.ai_draft),
    nonAi: toInt(current.non_ai),
  };
}

async function countAmbiguousAiNotes(): Promise<number> {
  const result = await dbAdmin.raw<{ rows: Array<{ count: string }> }>(
    `
    SELECT COUNT(*)::text AS count
    FROM (
      SELECT cn.id
      FROM clinical_notes cn
      JOIN audit_log al
        ON al.operation = 'AMBIENT_NOTE_RECORDING_STARTED'
       AND al.clinic_id = cn.clinic_id
       AND (al.new_data->>'patientId')::uuid = cn.patient_id
       AND al.created_at <= cn.created_at
       AND al.created_at >= cn.created_at - (? * INTERVAL '1 minute')
      WHERE cn.deleted_at IS NULL
        AND cn.consent_id IS NULL
        AND cn.is_ai_draft = true
        AND al.record_id ~* '^[0-9a-f-]{36}$'
      GROUP BY cn.id
      HAVING COUNT(al.id) > 1
    ) x
  `,
    [WINDOW_MINUTES],
  );
  return toInt(result.rows[0]?.count);
}

async function backfillAuditLinkedChunk(): Promise<number> {
  const result = await dbAdmin.raw<{ rowCount: number }>(
    `
    WITH target_notes AS (
      SELECT id, clinic_id, patient_id, created_at
      FROM clinical_notes
      WHERE deleted_at IS NULL
        AND consent_id IS NULL
        AND is_ai_draft = true
      ORDER BY created_at, id
      LIMIT ?
    ),
    candidate_rows AS (
      SELECT
        tn.id AS note_id,
        sc.id::text AS consent_id_text,
        COUNT(*) OVER (PARTITION BY tn.id) AS candidate_count
      FROM target_notes tn
      JOIN audit_log al
        ON al.operation = 'AMBIENT_NOTE_RECORDING_STARTED'
       AND al.clinic_id = tn.clinic_id
       AND (al.new_data->>'patientId')::uuid = tn.patient_id
       AND al.created_at <= tn.created_at
       AND al.created_at >= tn.created_at - (? * INTERVAL '1 minute')
      JOIN scribe_consents sc
        ON sc.id = al.record_id::uuid
      WHERE al.record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ),
    exact_one AS (
      SELECT note_id, MAX(consent_id_text)::uuid AS consent_id
      FROM candidate_rows
      WHERE candidate_count = 1
      GROUP BY note_id
    )
    UPDATE clinical_notes cn
       SET consent_id = eo.consent_id
      FROM exact_one eo
     WHERE cn.id = eo.note_id
       AND cn.consent_id IS NULL
  `,
    [CHUNK_SIZE, WINDOW_MINUTES],
  );
  return result.rowCount ?? 0;
}

async function backfillSyntheticChunk(): Promise<number> {
  const result = await dbAdmin.raw<{ rowCount: number }>(
    `
    WITH target_notes AS (
      SELECT
        cn.id AS note_id,
        cn.clinic_id,
        cn.patient_id,
        COALESCE(cn.author_id, cn.signed_by_id, cn.signed_by) AS clinician_id,
        COALESCE(cn.note_date_time, cn.created_at) AS attested_at
      FROM clinical_notes cn
      WHERE cn.deleted_at IS NULL
        AND cn.consent_id IS NULL
      ORDER BY cn.created_at, cn.id
      LIMIT ?
    ),
    inserted AS (
      INSERT INTO scribe_consents (
        id,
        clinic_id,
        patient_id,
        session_id,
        mode,
        patient_signature_png,
        clinician_attested_by_id,
        clinician_attestation_text,
        attested_at,
        created_at,
        revoked_at,
        revoked_by,
        revoke_reason
      )
      SELECT
        gen_random_uuid(),
        tn.clinic_id,
        tn.patient_id,
        'legacy_note_backfill:' || tn.note_id::text,
        'clinician_attestation',
        NULL,
        tn.clinician_id,
        'Legacy clinical note consent anchor (BUG-315 A2-2 Phase C backfill).',
        tn.attested_at,
        NOW(),
        tn.attested_at,
        tn.clinician_id,
        'legacy_note_backfill_anchor'
      FROM target_notes tn
      RETURNING id, session_id
    ),
    mapped AS (
      SELECT
        tn.note_id,
        i.id AS consent_id
      FROM target_notes tn
      JOIN inserted i
        ON i.session_id = 'legacy_note_backfill:' || tn.note_id::text
    )
    UPDATE clinical_notes cn
       SET consent_id = m.consent_id
      FROM mapped m
     WHERE cn.id = m.note_id
       AND cn.consent_id IS NULL
  `,
    [CHUNK_SIZE],
  );
  return result.rowCount ?? 0;
}

async function runChunked(
  label: string,
  worker: () => Promise<number>,
): Promise<number> {
  let total = 0;
  for (;;) {
    const changed = await worker();
    total += changed;
    if (changed === 0) break;
    if (changed < CHUNK_SIZE) break;
  }
  // eslint-disable-next-line no-console
  console.log(`  ${label}: updated=${total}`);
  return total;
}

async function main(): Promise<number> {
  if (!Number.isFinite(WINDOW_MINUTES) || WINDOW_MINUTES <= 0) {
    throw new Error(`A2_PHASE_C_WINDOW_MINUTES must be a positive integer (got: ${WINDOW_MINUTES})`);
  }
  if (!Number.isFinite(CHUNK_SIZE) || CHUNK_SIZE <= 0) {
    throw new Error(`A2_PHASE_C_CHUNK_SIZE must be a positive integer (got: ${CHUNK_SIZE})`);
  }

  // eslint-disable-next-line no-console
  console.log('A2 Phase C backfill — clinical_notes.consent_id');
  // eslint-disable-next-line no-console
  console.log(`  window_minutes=${WINDOW_MINUTES}`);
  // eslint-disable-next-line no-console
  console.log(`  chunk_size=${CHUNK_SIZE}`);
  // eslint-disable-next-line no-console
  console.log(`  dry_run=${DRY_RUN}`);

  const before = await countNulls();
  const ambiguousBefore = await countAmbiguousAiNotes();
  // eslint-disable-next-line no-console
  console.log(
    `  before: total=${before.total} ai_draft=${before.aiDraft} non_ai=${before.nonAi} ambiguous_ai=${ambiguousBefore}`,
  );

  if (DRY_RUN) {
    return 0;
  }

  await runChunked('audit-linked-ai', backfillAuditLinkedChunk);
  await runChunked('synthetic-legacy', backfillSyntheticChunk);

  const after = await countNulls();
  const ambiguousAfter = await countAmbiguousAiNotes();
  // eslint-disable-next-line no-console
  console.log(
    `  after: total=${after.total} ai_draft=${after.aiDraft} non_ai=${after.nonAi} ambiguous_ai=${ambiguousAfter}`,
  );

  if (after.total !== 0) {
    // eslint-disable-next-line no-console
    console.error(
      `✗ A2 Phase C consent backfill incomplete: ${after.total} rows still NULL`,
    );
    return 1;
  }

  // defensive invariant: all newly linked rows should carry UUID-shaped consent IDs
  const sample = await dbAdmin('clinical_notes')
    .whereNull('deleted_at')
    .whereNotNull('consent_id')
    .limit(20)
    .select('consent_id');
  for (const row of sample) {
    const value = String(row.consent_id ?? '');
    if (!UUID_RE.test(value)) {
      throw new Error(`Unexpected non-UUID consent_id observed after backfill: ${value}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log('✓ A2 Phase C consent backfill complete');
  return 0;
}

main()
  .then((exitCode) => dbAdmin.destroy().then(() => process.exit(exitCode)))
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    dbAdmin.destroy().finally(() => process.exit(1));
  });
