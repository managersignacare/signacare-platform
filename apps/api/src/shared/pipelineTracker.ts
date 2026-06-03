// apps/api/src/shared/pipelineTracker.ts
//
// BUG-037 — pipeline-stage tracker for AI processing flows. Captures an
// ordered, timed record of which stages ran (and which failed) so a
// forensic auditor can reconstruct the execution path of an AI-assisted
// clinical output. Serialised into llm_interactions.pipeline (JSONB).
//
// Design constraints from 3-review cycle:
//   - Stage names from a shared constant set to prevent free-string drift
//     across teams (Review 2.5). Custom strings still accepted but linted.
//   - 50-stage hard cap with a truncation marker to bound JSONB size
//     (Reviews 1.3 + 2.3 — unbounded growth would hurt retention /
//     query-plan performance).
//   - `meta` is strictly bounded to non-PHI primitive types (Review 3.4).
//     Values matching PHI field-name patterns (names, addresses, MRN,
//     Medicare/IHI numbers, phone/email) are REJECTED at track-time so
//     the audit table never becomes a second unredacted PHI store.

import { PHI_FIELDS } from '../utils/phiFields';

/**
 * Canonical stage names. Extending this list requires a plan-doc update
 * so stage semantics stay reviewable. Free-string stage names are still
 * accepted for forward-compatibility but BUG-037 tests assert these
 * constants are used in the main ambient flow.
 */
export const PIPELINE_STAGES = {
  WHISPER: 'whisper',
  PII_REDACT: 'pii_redact',
  PASS1_EXTRACT: 'pass1_extract',
  PASS2_SAFETY: 'pass2_safety',
  PASS3_FORMAT: 'pass3_format',
  HALLUCINATION_CHECK: 'hallucination_check',
  SAVE: 'save',
  RAG_LOAD_CONTEXT: 'rag_load_context',
  EMBED: 'embed',
  CLASSIFY: 'classify',
  DOCUMENT_GENERATE: 'document_generate',
  AGENT_RUN: 'agent_run',
  TRUNCATED: 'truncated',
} as const;
export type PipelineStageName = typeof PIPELINE_STAGES[keyof typeof PIPELINE_STAGES] | string;

export interface PipelineStage {
  stage: PipelineStageName;
  startedAt: string; // ISO 8601
  durationMs: number;
  success: boolean;
  meta?: Record<string, string | number | boolean | Array<string | number | boolean>>;
}

const MAX_STAGES = 50;
const MAX_META_STRING_LEN = 64;

function describeType(v: unknown): string { return v === null ? 'null' : typeof v; }

/**
 * Validator that a meta value is SAFE for audit storage: primitive, short,
 * non-PHI. Rejects:
 *   - Keys whose names match PHI_FIELDS (names, addresses, medicare, etc.)
 *   - Unbounded strings (>64 chars) — could carry transcripts / prompt text
 *   - Nested objects (opaque serialization surface)
 */
function assertMetaIsSafe(meta: unknown): asserts meta is Record<string, string | number | boolean | Array<string | number | boolean>> {
  if (meta === undefined || meta === null) return;
  if (typeof meta !== 'object' || Array.isArray(meta)) {
    throw new Error('[BUG-037] PipelineTracker meta must be a plain object or undefined');
  }
  const obj = meta as Record<string, unknown>;
  for (const [key, val] of Object.entries(obj)) {
    if (PHI_FIELDS.has(key)) {
      throw new Error(
        `[BUG-037] PipelineTracker meta key '${key}' matches a PHI field name. ` +
          'Audit metadata MUST NOT carry PHI. Use aggregated/derived values ' +
          "(e.g. meta: { flaggedTerms: 3 } not meta: { given_name: 'Jane' }).",
      );
    }
    if (typeof val === 'string') {
      if (val.length > MAX_META_STRING_LEN) {
        throw new Error(
          `[BUG-037] PipelineTracker meta string '${key}' length ${val.length} > ${MAX_META_STRING_LEN}. ` +
            'Audit metadata must be short-bounded; long strings risk transcript / prompt ' +
            'text leakage. Use hashes or aggregate counts instead.',
        );
      }
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      // OK
    } else if (Array.isArray(val)) {
      for (const item of val) {
        const t = typeof item;
        if (t !== 'string' && t !== 'number' && t !== 'boolean') {
          throw new Error(
            `[BUG-037] PipelineTracker meta array '${key}' contains non-primitive. Arrays allow string|number|boolean only.`,
          );
        }
        if (t === 'string' && (item as string).length > MAX_META_STRING_LEN) {
          throw new Error(
            `[BUG-037] PipelineTracker meta array '${key}' contains a string > ${MAX_META_STRING_LEN} chars.`,
          );
        }
      }
    } else {
      throw new Error(
        `[BUG-037] PipelineTracker meta '${key}' has type '${describeType(val)}'. ` +
          'Allowed: string (≤64), number, boolean, or array thereof.',
      );
    }
  }
}

/**
 * Composable stage-timing utility. Wrap each processing step in
 * `tracker.track(stage, () => ...)` to collect an ordered timeline.
 *
 * Thread-safety: single async request; not shared across workers.
 */
export class PipelineTracker {
  private stages: PipelineStage[] = [];
  private truncated = false;

  async track<T>(
    stage: PipelineStageName,
    fn: () => Promise<T>,
    meta?: Record<string, unknown>,
  ): Promise<T> {
    assertMetaIsSafe(meta);
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    try {
      const out = await fn();
      this.push({
        stage,
        startedAt,
        durationMs: Date.now() - t0,
        success: true,
        meta: meta as PipelineStage['meta'],
      });
      return out;
    } catch (err) {
      this.push({
        stage,
        startedAt,
        durationMs: Date.now() - t0,
        success: false,
        meta: meta as PipelineStage['meta'],
      });
      throw err;
    }
  }

  /** Record a stage without running a function (e.g. synchronous hooks). */
  record(stage: PipelineStageName, success: boolean, durationMs = 0, meta?: Record<string, unknown>): void {
    assertMetaIsSafe(meta);
    this.push({
      stage,
      startedAt: new Date().toISOString(),
      durationMs,
      success,
      meta: meta as PipelineStage['meta'],
    });
  }

  private push(stage: PipelineStage): void {
    if (this.stages.length >= MAX_STAGES) {
      if (!this.truncated) {
        this.stages.push({
          stage: PIPELINE_STAGES.TRUNCATED,
          startedAt: new Date().toISOString(),
          durationMs: 0,
          success: true,
        });
        this.truncated = true;
      }
      return;
    }
    this.stages.push(stage);
  }

  toJSON(): PipelineStage[] {
    return [...this.stages];
  }
}
