import type { Knex } from 'knex';

/**
 * S5.9 — Evidence corpus scaffolding
 *
 * Stores reference literature passages (NICE / RANZCP / NHMRC
 * guidelines, drug monographs, locally-curated SOPs) so the scribe
 * pipeline can cite them inline. The retrieval pipeline is pluggable
 * via EVIDENCE_BACKEND:
 *
 *   stub          — default; returns []. Zero infra.
 *   keyword       — Postgres ILIKE / FTS over evidence_chunks.body.
 *                   Requires data ingestion but no embedding model.
 *   pgvector      — future. Adds an `embedding` column + ivfflat
 *                   index in a follow-up migration once the corpus
 *                   has been embedded with a chosen model. Kept out
 *                   of this migration so the table can land without
 *                   the pgvector extension being available.
 *
 * Tables
 *   evidence_documents — top-level source (e.g. "RANZCP CPG Bipolar
 *                        Disorder 2020")
 *   evidence_chunks    — paragraph-sized chunks with section path,
 *                        joined to the parent document
 *   clinical_note_evidence — links a clinical_note row to a chunk it
 *                            cited; mirrors the clinical_note_codes
 *                            accept/reject lifecycle so clinicians
 *                            can endorse or strip a citation
 *
 * Multi-tenancy: evidence_documents and evidence_chunks are GLOBAL
 * (no clinic_id) — guidelines apply across the deployment. The link
 * table clinical_note_evidence carries clinic_id (denormalised from
 * the parent note) so RLS still isolates citation history per clinic.
 *
 * Append-only with hasTable guards. Down is a no-op.
 */

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('evidence_documents'))) {
    await knex.schema.createTable('evidence_documents', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      // Stable external id (DOI, ISBN, internal SOP code) — used to
      // dedupe re-ingests of the same source.
      t.string('source_id', 128).notNullable();
      t.text('title').notNullable();
      t.string('publisher', 128).nullable();   // 'RANZCP', 'NICE', 'NHMRC', 'local'
      t.string('jurisdiction', 16).nullable(); // 'AU', 'UK', 'US', 'global'
      t.date('published_on').nullable();
      t.text('url').nullable();
      // 'guideline' | 'monograph' | 'sop' | 'review' | 'trial'
      t.string('document_type', 32).notNullable().defaultTo('guideline');
      t.text('license').nullable(); // 'CC-BY', 'NHMRC-public', 'internal'
      t.timestamp('ingested_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['source_id']);
      t.index(['publisher']);
      t.index(['document_type']);
    });
  }

  if (!(await knex.schema.hasTable('evidence_chunks'))) {
    await knex.schema.createTable('evidence_chunks', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('document_id').notNullable().references('id').inTable('evidence_documents').onDelete('CASCADE');
      // Heading path through the source document, e.g.
      // "Treatment > Pharmacotherapy > Lithium". Helps the LLM
      // produce more useful citations.
      t.text('section_path').nullable();
      t.integer('chunk_index').notNullable();
      t.text('body').notNullable();
      // Token estimate so the prompt builder can budget context.
      t.integer('token_estimate').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['document_id', 'chunk_index']);
      t.index(['document_id']);
    });
    // GIN index for the keyword backend. Generated tsvector kept in a
    // follow-up migration if the corpus volume justifies it.
    const hasTrgm = await knex.raw(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`);
    if ((hasTrgm.rows ?? []).length > 0) {
      await knex.raw(
        "CREATE INDEX IF NOT EXISTS evidence_chunks_body_trgm ON evidence_chunks USING gin (body gin_trgm_ops)"
      );
    }
  }

  if (!(await knex.schema.hasTable('clinical_note_evidence'))) {
    await knex.schema.createTable('clinical_note_evidence', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('note_id').notNullable();
      t.uuid('chunk_id').notNullable().references('id').inTable('evidence_chunks').onDelete('RESTRICT');
      t.uuid('clinic_id').notNullable(); // denormalised from parent note
      // Snippet that the note actually quoted, for audit + UI tooltip.
      t.text('quoted_excerpt').nullable();
      // Where in the generated note the citation lives.
      t.string('section', 32).nullable(); // 'assessment' | 'plan' | etc
      // 'suggested' | 'accepted' | 'rejected'
      t.string('status', 16).notNullable().defaultTo('suggested');
      // 'retrieval_v1' | 'llm_v1' | 'manual'
      t.string('source', 32).notNullable().defaultTo('retrieval_v1');
      t.uuid('accepted_by_staff_id').nullable();
      t.timestamp('accepted_at', { useTz: true }).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['note_id', 'chunk_id']);
      t.index(['clinic_id']);
      t.index(['note_id', 'status']);
    });
  }
}

export async function down(): Promise<void> {
  // No-op. Citation history is medico-legal evidence.
}
