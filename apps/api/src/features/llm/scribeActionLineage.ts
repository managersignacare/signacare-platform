import { createHash } from 'crypto';

export interface ScribeActionLineageInput {
  itemType: string;
  description: string;
  assigneeRole?: string | null;
  dueDate?: string | null;
}

function normalizeChunk(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * BUG-SCRIBE25-003
 *
 * Stable lineage key used to dedupe clinically equivalent action-item
 * proposals across in-visit and post-sign materialisation paths.
 */
export function buildScribeActionLineageKey(input: ScribeActionLineageInput): string {
  const canonical = [
    normalizeChunk(input.itemType),
    normalizeChunk(input.description),
    normalizeChunk(input.assigneeRole ?? ''),
    normalizeChunk(input.dueDate ?? ''),
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 48);
}
