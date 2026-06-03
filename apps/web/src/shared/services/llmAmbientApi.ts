import { apiClient } from './apiClient';
import type { LLMSoapResponse, AmbientNoteResult } from '../types/llmTypes';

export type AmbientFormat = 'soap' | 'mse' | 'progress' | 'intake' | 'all'
  | 'ward_round' | 'review' | 'collateral' | 'phone' | 'home_visit'
  | 'case_conference' | 'group' | 'incident' | 'physical_health'
  | 'lai' | 'clozapine';

export interface AmbientNoteOptions {
  format?: AmbientFormat;
  model?: string;
  interpreterUsed?: boolean;
  interpreterLanguage?: string;
  patientId?: string;
  consentId?: string;
}

export const llmAmbientApi = {
  /** Legacy: returns SOAP-only */
  generateAmbientNoteDraft: async (
    audioBlob: Blob,
    opts: Pick<AmbientNoteOptions, 'patientId' | 'consentId'>,
  ): Promise<LLMSoapResponse> => {
    const result = await llmAmbientApi.generateAmbientNote(audioBlob, {
      format: 'soap',
      patientId: opts.patientId,
      consentId: opts.consentId,
    });
    return {
      subjective: result.structured.subjective,
      objective: result.structured.objective,
      assessment: result.structured.assessment,
      plan: result.structured.plan,
      aiGenerated: true as const,
      requiresReview: true as const,
    };
  },

  /** Enhanced: returns full ambient result with MSE, risk flags, diagnosis, interpreter support */
  generateAmbientNote: async (
    audioBlob: Blob,
    opts: AmbientNoteOptions | AmbientFormat = 'soap',
  ): Promise<AmbientNoteResult> => {
    // Support both old signature (string format) and new (options object)
    const options: AmbientNoteOptions = typeof opts === 'string' ? { format: opts } : opts;

    const form = new FormData();
    // Use correct file extension based on actual MIME type
    const ext = audioBlob.type.includes('mp4') ? 'm4a'
      : audioBlob.type.includes('aac') ? 'aac'
      : audioBlob.type.includes('wav') ? 'wav'
      : audioBlob.type.includes('ogg') ? 'ogg'
      : 'webm';
    form.append('audio', audioBlob, `recording.${ext}`);
    if (options.format) form.append('format', options.format);
    if (options.model) form.append('model', options.model);
    if (options.interpreterUsed) form.append('interpreterUsed', 'true');
    if (options.interpreterLanguage) form.append('interpreterLanguage', options.interpreterLanguage);
    if (options.patientId) form.append('patientId', options.patientId);
    if (options.consentId) form.append('consentId', options.consentId);

    if (!options.patientId || !options.consentId) {
      throw new Error('Ambient recording requires patient context and recording consent. Please confirm consent first.');
    }

    return apiClient.instance.post<AmbientNoteResult>('llm/ambient-note', form, {
      timeout: 300_000,
    }).then((r) => r.data);
  },
};
