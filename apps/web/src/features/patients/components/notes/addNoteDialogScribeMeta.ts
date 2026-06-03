import type { AmbientNoteResult } from '../../../../shared/types/llmTypes';

export function buildAddNoteScribeMeta(scribeResult: AmbientNoteResult | null) {
  if (!scribeResult) return undefined;
  return {
    pipeline: scribeResult.pipeline,
    model: scribeResult.model,
    specialty: scribeResult.specialty,
    durationSeconds: scribeResult.durationSeconds,
    interpreterUsed: scribeResult.interpreterUsed,
    interpreterLanguage: scribeResult.interpreterLanguage,
    transcript: scribeResult.transcript,
    bilingualTranscript: scribeResult.bilingualTranscript,
    verifiedMedications: scribeResult.verifiedMedications,
    riskAssessment: scribeResult.riskAssessment,
    safetyAlerts: scribeResult.safetyAlerts,
    icd10Suggestions: scribeResult.icd10Suggestions,
    mbsSuggestions: scribeResult.mbsSuggestions,
    outcomeMeasures: scribeResult.outcomeMeasures,
    scribeActions: scribeResult.scribeActions,
    questScore: scribeResult.questScore,
    quality: scribeResult.quality,
  };
}
