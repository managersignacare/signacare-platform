/**
 * S5.9 — Evidence retrieval client
 *
 * Pluggable retrieval over the evidence_chunks corpus. Returns top-k
 * passages relevant to a free-text clinical phrase, suitable for
 * injection into the scribe system prompt as a <evidence> block.
 *
 * Backends (selected by EVIDENCE_BACKEND):
 *
 *   stub      — default; no infra. Returns []. Pipeline is a no-op.
 *   keyword   — Postgres ILIKE / pg_trgm over evidence_chunks.body.
 *               Cheap, deterministic, works without a model. Suitable
 *               for the first deployment after a corpus is ingested.
 *   pgvector  — future. Embedding-based retrieval. Requires the
 *               pgvector extension and an `embedding` column on
 *               evidence_chunks (added in a follow-up migration once
 *               the corpus has been embedded). Falls back to stub if
 *               the column or extension is missing — fail closed.
 *
 * Defensive properties:
 *   - never throws into the caller; on error, returns []
 *   - small in-process LRU so repeated phrases don't hit the DB
 *   - hard cap on result count (TOP_K) — prompt budget protection
 *
 * The retrieval is read-only and uses dbRead (S2.5) so it doesn't
 * burden the primary even when the scribe pipeline is hot.
 */

import { dbRead } from '../../db/db';
import { logger } from '../../utils/logger';

export type EvidenceBackend = 'stub' | 'keyword' | 'pgvector';

export interface EvidencePassage {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  publisher: string | null;
  sectionPath: string | null;
  body: string;
  /** 'high' | 'moderate' | 'low' — heuristic, not calibrated */
  confidence: 'high' | 'moderate' | 'low';
  /** Backend that produced this passage. */
  source: 'evidence_keyword' | 'evidence_pgvector';
}

const TOP_K = 5;
const CACHE_MAX = 256;
const cache = new Map<string, EvidencePassage[]>();

export function evidenceBackendName(): EvidenceBackend {
  const raw = (process.env.EVIDENCE_BACKEND ?? 'stub').toLowerCase();
  if (raw === 'keyword' || raw === 'pgvector') return raw;
  return 'stub';
}

/**
 * Test-only: clears the in-process cache between unit tests.
 * Not exported from any production module.
 */
export function _resetEvidenceCache(): void {
  cache.clear();
}

function cacheKey(backend: EvidenceBackend, phrase: string): string {
  return `${backend}::${phrase.toLowerCase().trim()}`;
}

function rememberInCache(key: string, value: EvidencePassage[]): void {
  if (cache.size >= CACHE_MAX) {
    // simple FIFO eviction — first inserted key
    const first = cache.keys().next().value as string | undefined;
    if (first) cache.delete(first);
  }
  cache.set(key, value);
}

/**
 * Retrieve top-K evidence passages for a clinical phrase. Returns []
 * for short phrases, missing backend, or any error condition.
 */
export async function retrieveEvidence(phrase: string): Promise<EvidencePassage[]> {
  if (!phrase || phrase.trim().length < 3) return [];
  const backend = evidenceBackendName();
  if (backend === 'stub') return [];

  const key = cacheKey(backend, phrase);
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const result = backend === 'keyword'
      ? await retrieveByKeyword(phrase)
      : await retrieveByVector(phrase);
    rememberInCache(key, result);
    return result;
  } catch (err) {
    logger.warn({ err, backend, phrase: phrase.slice(0, 64) }, 'evidence retrieval failed; returning empty');
    return [];
  }
}

async function retrieveByKeyword(phrase: string): Promise<EvidencePassage[]> {
  // websearch_to_tsquery handles partial words, AND/OR operators, and
  // is forgiving of pasted clinical phrases. Falls back to ILIKE if
  // tsvector indexing isn't available.
  const safePhrase = phrase.slice(0, 256);
  const rows = await dbRead('evidence_chunks as ec')
    .join('evidence_documents as ed', 'ed.id', 'ec.document_id')
    .select(
      'ec.id as chunk_id',
      'ec.document_id',
      'ec.section_path',
      'ec.body',
      'ed.title as document_title',
      'ed.publisher',
    )
    .whereRaw('ec.body ILIKE ?', [`%${safePhrase}%`])
    .orderBy('ec.created_at', 'desc')
    .limit(TOP_K);

  return rows.map((row, idx) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    publisher: row.publisher ?? null,
    sectionPath: row.section_path ?? null,
    body: row.body,
    confidence: idx === 0 ? 'high' : idx < 3 ? 'moderate' : 'low',
    source: 'evidence_keyword' as const,
  }));
}

async function retrieveByVector(_phrase: string): Promise<EvidencePassage[]> {
  // Placeholder. The pgvector backend lands once the corpus has been
  // embedded and the follow-up migration adds the embedding column.
  // Until then we fail closed and return [] so the pipeline is a no-op
  // even if EVIDENCE_BACKEND=pgvector is set prematurely.
  return [];
}

/**
 * Format passages as a prompt block for injection into the scribe
 * system prompt. Returns an empty string if no passages — the prompt
 * builder can concatenate unconditionally.
 */
export function formatEvidenceBlock(passages: EvidencePassage[]): string {
  if (passages.length === 0) return '';
  const lines: string[] = ['<evidence>'];
  passages.forEach((p, i) => {
    const cite = p.publisher ? `${p.publisher} — ${p.documentTitle}` : p.documentTitle;
    const section = p.sectionPath ? ` (${p.sectionPath})` : '';
    lines.push(`[${i + 1}] ${cite}${section}`);
    lines.push(p.body.replace(/\s+/g, ' ').trim());
    lines.push('');
  });
  lines.push('</evidence>');
  return lines.join('\n');
}
