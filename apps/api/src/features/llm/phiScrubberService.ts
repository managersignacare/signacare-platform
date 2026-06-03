// apps/api/src/features/llm/phiScrubberService.ts
//
// Tier 19.1 — PHI scrubber.
//
// Loads active phi_scrubber_rules rows (vendor-global + current
// clinic's overrides) ordered by precedence, compiles each
// `pattern` as a RegExp, and applies them to the input text. Every
// match is replaced with the rule's `replacement` string and
// counted into a redaction_summary by category so the training
// corpus pipeline can reject any item whose redaction count looks
// implausibly low.
//
// The scrubber is NOT a guarantee. It's a defense-in-depth layer
// that MUST be paired with human review (training_corpus_items
// status=pending_review → reviewed_by). False negatives happen
// (paraphrased third-party names, coded slang, phonetic misspellings);
// a reviewer is the final safety net.
//
// Versioning: the SCRUBBER_VERSION constant is bumped whenever the
// rule set changes. training_corpus_items.scrubber_version captures
// which version produced each sanitised transcript so stale
// corpus items can be re-scrubbed when rules change.

import { db } from '../../db/db';
import { logger } from '../../utils/logger';

export const SCRUBBER_VERSION = 'v1.0.0-2026-04-19';

export interface ScrubRule {
  id: string;
  clinicId: string | null;
  category: string;
  name: string;
  pattern: string;
  replacement: string;
  precedence: number;
}

export interface ScrubResult {
  sanitised: string;
  scrubberVersion: string;
  redactionSummary: Record<string, number>;
  ruleIdsApplied: string[];
}

/**
 * Load active rules for a clinic (includes vendor-global rows).
 */
export async function loadScrubRules(clinicId: string): Promise<ScrubRule[]> {
  const rows = await db('phi_scrubber_rules')
    .where(function () {
      this.whereNull('clinic_id').orWhere({ clinic_id: clinicId });
    })
    .andWhere({ is_active: true })
    .select(
      'id', 'clinic_id as clinicId', 'category', 'name',
      'pattern', 'replacement', 'precedence',
    )
    .orderBy('precedence', 'asc');
  return rows;
}

/**
 * Apply rules to text. Returns the sanitised text + a per-category
 * redaction count + the rule ids that matched (for audit).
 */
export function scrubText(text: string, rules: ScrubRule[]): ScrubResult {
  let current = text;
  const summary: Record<string, number> = {};
  const applied: string[] = [];

  for (const rule of rules) {
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern, 'gi');
    } catch (err) {
      logger.warn({ ruleId: rule.id, pattern: rule.pattern, err: String(err) }, 'Invalid scrub rule regex — skipped');
      continue;
    }
    const matches = current.match(re);
    if (matches && matches.length > 0) {
      current = current.replace(re, rule.replacement);
      summary[rule.category] = (summary[rule.category] ?? 0) + matches.length;
      applied.push(rule.id);
    }
  }

  return {
    sanitised: current,
    scrubberVersion: SCRUBBER_VERSION,
    redactionSummary: summary,
    ruleIdsApplied: applied,
  };
}

/**
 * Full pipeline: load rules → scrub → persist a training_corpus_items
 * row (status=pending_review). Returns the created item id so the
 * reviewer can pick it up from the training dashboard.
 */
export async function ingestIntoTrainingCorpus(input: {
  clinicId: string;
  sessionId?: string;
  transcript: string;
}): Promise<{ itemId: string; redactionSummary: Record<string, number>; scrubberVersion: string }> {
  const rules = await loadScrubRules(input.clinicId);
  const scrubbed = scrubText(input.transcript, rules);

  const [row] = await db('training_corpus_items')
    .insert({
      source_clinic_id: input.clinicId,
      source_session_id: input.sessionId ?? null,
      scrubber_version: scrubbed.scrubberVersion,
      sanitised_transcript: scrubbed.sanitised,
      redaction_summary: JSON.stringify(scrubbed.redactionSummary),
      status: 'pending_review',
    })
    .returning(['id']);

  logger.info(
    {
      clinicId: input.clinicId,
      sessionId: input.sessionId,
      itemId: row.id,
      scrubberVersion: scrubbed.scrubberVersion,
      redactionSummary: scrubbed.redactionSummary,
    },
    'Training corpus ingest',
  );

  return {
    itemId: row.id,
    redactionSummary: scrubbed.redactionSummary,
    scrubberVersion: scrubbed.scrubberVersion,
  };
}
