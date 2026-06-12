import type { AmbientNoteResult } from '../../../../shared/types/llmTypes';

export function isDegradedAmbientResult(result: AmbientNoteResult): boolean {
  return Boolean(result.requiresClinicianReview || result.llmFallbacks?.pass1 || result.llmFallbacks?.pass3);
}
