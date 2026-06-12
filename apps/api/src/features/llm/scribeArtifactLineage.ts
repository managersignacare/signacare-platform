import { createHash } from 'crypto';
import {
  ScribeArtifactLineageSchema,
  type AuScribeDocumentKind,
  type ScribeArtifactLineage,
} from '@signacare/shared';

export interface ScribeArtifactLineageInput {
  sourceKind: ScribeArtifactLineage['sourceKind'];
  patientId: string;
  sessionId?: string | null;
  jobId?: string | null;
  sourceNoteId?: string | null;
  documentKind?: AuScribeDocumentKind | null;
  canonicalText?: string | null;
}

function normalizeClinicalText(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function hashHex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Stable lineage key for scribe artefacts that can be materialised through
 * multiple paths: in-visit draft, async job completion, letter generation,
 * and post-sign updates. The key stores only hashes/ids, never raw clinical
 * text, so it is safe for telemetry and deployment smoke proofs.
 */
export function buildScribeArtifactLineageKey(input: ScribeArtifactLineageInput): ScribeArtifactLineage {
  const canonicalTextHash = hashHex(normalizeClinicalText(input.canonicalText));
  const canonical = [
    input.sourceKind,
    input.patientId,
    input.sessionId ?? '',
    input.jobId ?? '',
    input.sourceNoteId ?? '',
    input.documentKind ?? '',
    canonicalTextHash,
  ].join('|');

  return ScribeArtifactLineageSchema.parse({
    schemaVersion: '1.0',
    sourceKind: input.sourceKind,
    patientId: input.patientId,
    sessionId: input.sessionId ?? null,
    jobId: input.jobId ?? null,
    sourceNoteId: input.sourceNoteId ?? null,
    documentKind: input.documentKind ?? null,
    canonicalTextHash,
    lineageKey: hashHex(canonical).slice(0, 48),
  });
}
