/**
 * Ambient AI Processor — 3-pass clinical pipeline:
 * transcription/diarization -> fact extraction + safety verification -> structured clinical formatting.
 */

import axios from 'axios';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import type { AuthContext, ClinicalContextEnvelope, RoutedModelExecution } from '@signacare/shared';
import { logger } from '../utils/logger';
import { recordLlmInteraction } from '../shared/recordLlmInteraction';
import {
  parseWhisperVersionFromResponse,
  recordWhisperAsrInteractionSafely,
} from './whisperClient';
import { assessAllergiesForAmbientPipeline } from './scribeAllergyAssessor';
import { PIPELINE_STAGES, type PipelineStage } from '../shared/pipelineTracker';
import {
  SCRIBE_PASS3_SYSTEM,
  getFormatPrompt,
  verifyMedications,
  assessRisk,
  type MedicalScribeResult,
  type VerifiedMedication,
  type RiskAssessmentResult,
  type SafetyAlert,
} from './medicalScribe';
import {
  linkFactsToTranscript,
  autoCodeICD10,
  suggestMBSItems,
  extractOutcomeMeasures,
  extractScribeActions,
  getPriorNoteContext,
  buildPatientContext,
  getScribePreferences,
  buildStyleInstructions,
  buildKShotExamples,
  scoreQUEST,
  type CitedFact,
  type ICD10Suggestion,
  type MBSSuggestion,
  type ExtractedOutcomeMeasure,
  type ScribeAction,
  type QUESTScore,
} from './scribeEnhancements';
import { getSpecialtyExtractionPrompt, getSpecialtyFormattingPrompt } from './scribeSpecialties';
import {
  buildAmbientGovernedClinicalContext,
  buildAmbientGovernedContextAuditMetadata,
  shouldFailClosedForAmbientContext,
} from '../features/llm/context/ambientClinicalContext';
import { AppError } from '../shared/errors';
import {
  AMBIENT_LONG_RECORDING_TARGET_MINUTES,
  ambientAudioMaxBytes,
  ambientOllamaNumPredict,
  ambientOllamaTimeoutMs,
  ambientTranscriptChunkChars,
  ambientWhisperTimeoutMs,
} from '../shared/ambientScribeConfig';
import {
  buildExtractionFallbackFacts,
  extractWhisperFailure,
  formatLlmFailure,
  isWhisperAudioDecodeFailure,
  mergeExtractedFacts,
  runPass1Extraction,
  splitTranscriptForLlm,
  type AmbientExtractedFacts,
} from './ambientProcessorLongform';
import {
  ambientModelProvider,
  buildAmbientFallbackExecution,
  generateAmbientPass3Text,
  lockAmbientRuntime,
  summarizeAmbientExecutions,
  type AmbientRuntimeLock,
} from './ambientModelRouting';
import {
  buildMSEFromExtraction,
  extractDiagnosis,
  extractRiskFlags,
  parseSOAP,
  type AmbientMentalStateExam,
  type AmbientStructuredSections,
} from './ambientProcessorParsing';

const WHISPER_API_URL = process.env.WHISPER_API_URL ?? 'http://localhost:8080';

export interface AmbientResult {
  transcript: string;
  diarizedTranscript: string;
  extractedFacts: ExtractedFacts;
  structured: AmbientStructuredSections;
  mentalStateExam?: AmbientMentalStateExam;
  riskFlags: string[];
  suggestedDiagnosis: string[];
  medications: MedicationMention[];
  summary: string;
  durationSeconds: number;
  model: string;
  requestedModel: string;
  modelUsed: string;
  requiresClinicianReview?: boolean;
  format: string;
  pipeline: 'medical-grade';
  pass1DurationMs: number;
  pass2DurationMs: number;
  pass3DurationMs: number;
  transcriptionDurationMs: number;

  // Medical-grade additions
  verifiedMedications: VerifiedMedication[];
  riskAssessment: RiskAssessmentResult;
  safetyAlerts: SafetyAlert[];
  quality: MedicalScribeResult['quality'];

  // Enhanced scribe features
  citedFacts: CitedFact[];
  icd10Suggestions: ICD10Suggestion[];
  mbsSuggestions: MBSSuggestion[];
  outcomeMeasures: ExtractedOutcomeMeasure[];
  scribeActions: ScribeAction[];
  questScore: QUESTScore;
  specialty: string;

  // Interpreter/multilingual support
  interpreterUsed: boolean;
  interpreterLanguage?: string;
  bilingualTranscript?: string;
  llmFallbacks?: {
    pass1?: string;
    pass3?: string;
  };
}

type ExtractedFacts = AmbientExtractedFacts;

interface MedicationMention {
  name: string;
  dose?: string;
  frequency?: string;
  change?: 'started' | 'increased' | 'decreased' | 'ceased' | 'continued' | 'mentioned';
}

export type AmbientOutputFormat =
  | 'soap'
  | 'mse'
  | 'progress'
  | 'intake'
  | 'ward_round'
  | 'review'
  | 'collateral'
  | 'phone'
  | 'home_visit'
  | 'case_conference'
  | 'group'
  | 'incident'
  | 'physical_health'
  | 'lai'
  | 'clozapine'
  | 'all';

interface ProcessOptions {
  clinicId: string;
  staffId: string;
  patientId?: string;
  auth?: AuthContext;
  model?: string;
  outputFormat?: AmbientOutputFormat;
  interpreterUsed?: boolean;
  interpreterLanguage?: string;  // e.g. 'vi', 'zh', 'ar', 'el', 'it'
  // BUG-342: consent id is propagated for audit/training-export filtering.
  consentId?: string | null;
}

export async function processAmbientAudio(
  audioBuffer: Buffer,
  mimeType: string,
  opts: ProcessOptions,
): Promise<AmbientResult> {
  const startTime = Date.now();
  const format = opts.outputFormat ?? 'soap';
  const runtimeLock = await lockAmbientRuntime(opts.clinicId, opts.model);
  const requestedModel =
    opts.model?.trim()
    || (
      runtimeLock.runtimeSelection.backend === 'azure_openai'
        ? 'azure_openai:auto'
        : (process.env.OLLAMA_MODEL || 'qwen2.5:14b')
    );

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 1: TRANSCRIPTION (Whisper + clinical vocab + diarization)
  // ═══════════════════════════════════════════════════════════════════════════

  let transcript = '';
  let diarizedTranscript = '';
  let bilingualTranscript: string | undefined;
  // BUG-424 — Whisper forensic-identity carriers for the downstream ASR audit row.
  let whisperModelTag = '', whisperModelVersion = '', whisperTranscriptionSeconds = 0;
  const interpreterUsed = opts.interpreterUsed ?? false;
  const interpreterLanguage = opts.interpreterLanguage;
  const transcribeStart = Date.now();

  try {
    const result = await transcribeWithWhisper(audioBuffer, mimeType, interpreterUsed, interpreterLanguage);
    transcript = result.text;
    diarizedTranscript = result.diarizedText || transcript;
    bilingualTranscript = result.bilingualText ?? undefined;
    whisperModelTag = result.whisperModel;
    whisperModelVersion = result.whisperModelVersion;
    whisperTranscriptionSeconds = result.transcriptionTime;
    logger.info({
      step: 'whisper',
      length: transcript.length,
      diarized: !!result.diarizedText,
      transcriptionTime: result.transcriptionTime,
      interpreterUsed,
      interpreterLanguage,
      bilingual: !!bilingualTranscript,
      detectedLanguages: result.detectedLanguages,
      whisperModel: whisperModelTag,
      whisperModelVersion,
    }, 'Audio transcribed with clinical vocab + diarization');
  } catch (err) {
    const { message: msg, code } = extractWhisperFailure(err);
    logger.error({ err: msg, code }, '[Ambient] Whisper transcription failed');

    if (msg.includes('ECONNREFUSED') || code === 'ECONNREFUSED') {
      throw new Error('Whisper server is not running. Start it with: cd deploy/whisper-server && python server.py');
    } else if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || code === 'ECONNABORTED') {
      throw new Error(
        `Whisper transcription timed out. The synchronous path is capped below Azure App Service request limits; ${AMBIENT_LONG_RECORDING_TARGET_MINUTES}-minute psychiatric interviews require the async scribe job workflow.`,
      );
    } else if (isWhisperAudioDecodeFailure(msg)) {
      throw new AppError(
        'Recording audio could not be decoded. Please retry the recording; if this repeats, disable live transcript and use a shorter test clip.',
        422,
        'AUDIO_DECODE_FAILED',
        {
          audioBytes: audioBuffer.length,
          mimeType,
          upstream: 'whisper',
        },
      );
    } else {
      throw new Error(`Transcription failed: ${msg}`);
    }
  }

  const transcriptionDurationMs = Date.now() - transcribeStart;

  if (!transcript.trim()) {
    logger.warn({
      bufferSize: audioBuffer.length,
      mimeType,
      transcriptionDurationMs,
    }, '[Ambient] No speech detected — throwing error');
    throw new Error(
      'No speech detected in the audio recording. ' +
      'Check that your microphone is working and that you are speaking clearly. ' +
      `Audio size: ${(audioBuffer.length / 1024).toFixed(0)}KB, format: ${mimeType}`
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD CLINICIAN PREFERENCES & PRIOR CONTEXT
  // ═══════════════════════════════════════════════════════════════════════════

  const prefs = await getScribePreferences(opts.staffId).catch((err) => { logger.warn({ err }, 'ambientProcessor: op failed — returning null'); return null; });
  const specialty = prefs?.specialty ?? 'psychiatry';
  let priorContext = '';
  let governedContextEnvelope: ClinicalContextEnvelope | null = null;
  let contextMode: 'governed' | 'legacy_fallback' | 'none' = 'none';
  let contextFallbackReason: string | null = null;

  if (opts.patientId) {
    try {
      const governedContext = await buildAmbientGovernedClinicalContext({
        clinicId: opts.clinicId,
        staffId: opts.staffId,
        patientId: opts.patientId,
        auth: opts.auth,
      });
      priorContext = governedContext?.renderedPrompt ?? '';
      governedContextEnvelope = governedContext?.envelope ?? null;
      contextMode = priorContext ? 'governed' : 'none';
    } catch (err) {
      if (shouldFailClosedForAmbientContext(err)) throw err;

      contextFallbackReason = err instanceof Error ? err.message : String(err);
      logger.warn(
        {
          err: contextFallbackReason,
          clinicId: opts.clinicId,
          patientId: opts.patientId,
        },
        '[Ambient] governed clinical context failed — falling back to legacy prior-context builder',
      );
      priorContext = await buildPatientContext(opts.patientId, opts.clinicId).catch(async () => (
        getPriorNoteContext(opts.patientId!).catch(() => '')
      ));
      contextMode = priorContext ? 'legacy_fallback' : 'none';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 1.5 — PROMPT INJECTION GUARD
  // Sanitize the transcript before it enters any LLM pass. Detects 14
  // injection patterns (instruction override, role switching, jailbreaks,
  // data exfiltration). Flagged lines are neutralized; the sanitized
  // transcript is used for all subsequent passes.
  // ═══════════════════════════════════════════════════════════════════════════

  const { sanitizeLlmInput } = await import('../integrations/scribe/promptGuard');
  const guardedLines = diarizedTranscript.split('\n').map((line) => {
    const result = sanitizeLlmInput(line);
    if (!result.safe) {
      logger.warn(
        { reason: result.reason, linePreview: line.slice(0, 80) },
        '[Ambient] Prompt injection detected — line sanitized',
      );
    }
    return result.sanitised;
  });
  diarizedTranscript = guardedLines.join('\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 1.6 — PHI REDACTION (Audit Tier 5.11)
  // Strip AU-format PHI (Medicare, IHI, DVA, phone, email, URL) from
  // the transcript BEFORE it reaches any LLM prompt. This is a
  // regex-based safety net that runs in addition to the Whisper-
  // level transcript. The entries array (what was redacted + where)
  // is recorded on llm_interactions.metadata.redactions so the
  // audit trail shows exactly what PHI was protected.
  // ═══════════════════════════════════════════════════════════════════════════

  const { redactTranscript, summariseRedactions } = await import('./pii_redactor');
  // BUG-037 — capture PII_REDACT stage timing for the pipeline audit.
  const redactStart = Date.now();
  const redacted = redactTranscript(diarizedTranscript);
  const redactDurationMs = Date.now() - redactStart;
  const redactionSummary = summariseRedactions(redacted.entries);
  if (redacted.entries.length > 0) {
    logger.info(
      {
        count: redacted.entries.length,
        byCategory: redactionSummary,
      },
      '[Ambient] PHI redacted from transcript before LLM',
    );
  }
  diarizedTranscript = redacted.text;
  // Hold on to redactionSummary for metadata stamping downstream —
  // ambientProcessor already accumulates metadata before the LLM call.
  (opts as { __redactions?: unknown }).__redactions = redactionSummary;

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 2 — PASS 1: VERBATIM EXTRACTION (Medical-Grade + Specialty)
  // Extract structured facts with MSE domain tagging, zero fabrication
  // ═══════════════════════════════════════════════════════════════════════════

  const pass1Start = Date.now();
  const specialtyExtraction = getSpecialtyExtractionPrompt(specialty);
  let pass1FallbackReason: string | undefined;
  let pass3FallbackReason: string | undefined;
  let pass1ModelUsed = requestedModel;
  let pass1ModelFallbackFrom: string | undefined;
  let pass3ModelUsed: string | undefined;
  let pass3ModelFallbackFrom: string | undefined;
  let pass1Executions: RoutedModelExecution[] = [];
  let pass1PromptTokens: number | null = null;
  let pass1CompletionTokens: number | null = null;
  let pass3Execution: RoutedModelExecution | null = null;
  let pass3PromptTokens: number | null = null;
  let pass3CompletionTokens: number | null = null;
  let extractedFacts: ExtractedFacts;
  try {
    const pass1 = await runPass1Extraction(diarizedTranscript, runtimeLock, specialtyExtraction);
    extractedFacts = pass1.facts;
    pass1ModelUsed = pass1.modelUsed;
    pass1ModelFallbackFrom = pass1.fallbackFrom;
    pass1Executions = pass1.executions;
    pass1PromptTokens = pass1.promptTokens;
    pass1CompletionTokens = pass1.completionTokens;
  } catch (err) {
    pass1FallbackReason = formatLlmFailure(err);
    extractedFacts = buildExtractionFallbackFacts(diarizedTranscript || transcript, pass1FallbackReason);
    logger.warn(
      { err: pass1FallbackReason, requestedModel, transcriptLength: diarizedTranscript.length },
      '[Ambient] Pass 1 LLM extraction failed — using transcript-grounded fallback facts',
    );
  }
  const pass1DurationMs = Date.now() - pass1Start;

  logger.info({
    step: 'pass1_medical',
    subjective: extractedFacts.subjective.length,
    objective: extractedFacts.objective.length,
    assessment: extractedFacts.assessment.length,
    plan: extractedFacts.plan.length,
    risk: extractedFacts.risk.length,
    medications: extractedFacts.medications.length,
    mse: Object.keys(extractedFacts.mse).length,
    durationMs: pass1DurationMs,
  }, 'Pass 1: Medical-grade verbatim extraction complete');

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 3 — PASS 2: SAFETY VERIFICATION
  // Cross-check medications, detect risk patterns, generate safety alerts
  // ═══════════════════════════════════════════════════════════════════════════

  const pass2Start = Date.now();

  // Verify medications against safety database
  const { medications: verifiedMedications, alerts: medAlerts } =
    verifyMedications(extractedFacts.medications);

  // Assess risk from transcript and extracted risk facts
  const riskAssessment = assessRisk(transcript, extractedFacts.risk);

  const safetyAlerts: SafetyAlert[] = [...medAlerts, ...(await assessAllergiesForAmbientPipeline(opts.clinicId, opts.patientId, verifiedMedications))]; // BUG-394 SSoT cross-check

  // Add risk-based safety alerts
  for (const flag of riskAssessment.flags) {
    if (flag.severity === 'critical') {
      safetyAlerts.push({
        type: 'risk',
        severity: 'critical',
        message: `${flag.flag}: ${flag.action}`,
      });
    }
  }

  // Add monitoring alerts for medications that need it
  for (const med of verifiedMedications) {
    if (med.monitoringRequired) {
      safetyAlerts.push({
        type: 'monitoring',
        severity: 'info',
        message: `${med.name}: Requires ${med.monitoringRequired}`,
      });
    }
    if (med.isS8) {
      safetyAlerts.push({
        type: 'monitoring',
        severity: 'warning',
        message: `${med.name}: Schedule 8 — SafeScript check required`,
      });
    }
  }

  const pass2DurationMs = Date.now() - pass2Start;

  logger.info({
    step: 'pass2_safety',
    verifiedMeds: verifiedMedications.length,
    alerts: safetyAlerts.length,
    riskLevel: riskAssessment.overallLevel,
    riskFlags: riskAssessment.flags.length,
    durationMs: pass2DurationMs,
  }, 'Pass 2: Safety verification complete');

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 4 — PASS 3: CLINICAL FORMATTING (Medical-Grade)
  // Format into structured clinical note with confidence scores
  // ═══════════════════════════════════════════════════════════════════════════

  const pass3Start = Date.now();
  // S5.8: per-clinician tone adaptation. The K-shot examples are
  // appended to the explicit style instructions so the LLM has both
  // a rule list and concrete exemplars to imitate. The K-shot
  // function returns '' for new clinicians who have no signed
  // notes for this format yet, so the prompt size is bounded.
  const baseStyleInstructions = prefs ? buildStyleInstructions(prefs) : '';
  const kShotBlock = await buildKShotExamples(opts.staffId, format).catch(() => '');
  const styleInstructions = baseStyleInstructions + kShotBlock;
  const specialtyFormatting = getSpecialtyFormattingPrompt(specialty);
  let formattedNote = '';
  if (pass1FallbackReason) {
    pass3FallbackReason = 'Skipped LLM formatting because Pass 1 extraction used deterministic fallback facts.';
    pass1ModelUsed = 'deterministic-fallback';
    pass3ModelUsed = 'deterministic-fallback';
    formattedNote = buildFallbackNote(extractedFacts, verifiedMedications, riskAssessment);
  } else {
    try {
      const pass3 = await runPass3Formatting(
        extractedFacts, verifiedMedications, riskAssessment, safetyAlerts,
        format, runtimeLock, priorContext, styleInstructions, specialtyFormatting,
      );
      formattedNote = pass3.text;
      pass3ModelUsed = pass3.execution.modelName;
      pass3ModelFallbackFrom = pass3.fallbackFromModelName ?? undefined;
      pass3Execution = pass3.execution;
      pass3PromptTokens = pass3.promptTokens;
      pass3CompletionTokens = pass3.completionTokens;
    } catch (err) {
      pass3FallbackReason = formatLlmFailure(err);
      pass3ModelUsed = 'deterministic-fallback';
      formattedNote = buildFallbackNote(extractedFacts, verifiedMedications, riskAssessment);
      logger.warn(
        { err: pass3FallbackReason, requestedModel, format },
        '[Ambient] Pass 3 LLM formatting failed — using deterministic clinical-note fallback',
      );
    }
  }
  const pass3DurationMs = Date.now() - pass3Start;

  // Fallback: if LLM returned empty note but we have a transcript, build a plain note
  if (!formattedNote.trim() && transcript.trim()) {
    pass3FallbackReason = 'Pass 3 returned empty output; deterministic fallback note was generated.';
    pass3ModelUsed = 'deterministic-fallback';
    const hasAnyFacts = Object.values(extractedFacts).some(arr =>
      Array.isArray(arr) ? arr.length > 0 : Object.keys(arr).length > 0
    );
    if (hasAnyFacts) {
      formattedNote = buildFallbackNote(extractedFacts, verifiedMedications, riskAssessment);
    } else {
      formattedNote = `SUBJECTIVE\n${transcript.trim()}\n\nOBJECTIVE\nNot assessed\n\nASSESSMENT\nNot assessed\n\nRISK ASSESSMENT\nNot assessed — no structured data extracted\n\nPLAN\nPending review`;
    }
    logger.warn({ reason: 'llm_empty_output', fallback: 'structured_facts' }, 'Pass 3 returned empty — using fallback note');
  }

  logger.info({
    step: 'pass3_medical',
    format,
    outputLength: formattedNote.length,
    durationMs: pass3DurationMs,
  }, 'Pass 3: Medical-grade clinical formatting complete');

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 5: POST-PROCESSING & QUALITY SCORING
  // ═══════════════════════════════════════════════════════════════════════════

  const structured = parseSOAP(formattedNote);
  const mse = buildMSEFromExtraction(formattedNote, extractedFacts.mse);
  const riskFlags = extractRiskFlags(formattedNote, transcript, extractedFacts.risk);
  const suggestedDiagnosis = extractDiagnosis(formattedNote);
  const medications = verifiedMedications.map(vm => ({
    name: vm.name,
    dose: vm.dose,
    frequency: vm.frequency,
    change: vm.change,
  }));

  // Calculate quality metrics
  // mseDomains is typed as-const so `d` narrows to a union of the
  // MSE key literals, which are all valid keys of mentalStateExam.
  const mseDomains = ['appearance', 'behaviour', 'speech', 'mood', 'affect', 'thoughtForm', 'thoughtContent', 'perception', 'cognition', 'insight', 'judgement'] as const;
  type MseKey = typeof mseDomains[number];
  const mseWithEvidence = mse ? mseDomains.filter((d: MseKey) => {
    const val = mse[d];
    return val && val !== 'Not assessed' && val !== '—' && val.length > 0;
  }).length : 0;

  const soapSections = ['subjective', 'objective', 'assessment', 'plan'];
  const soapWithEvidence = soapSections.filter(s => {
    const val = structured[s as keyof typeof structured];
    return val && val !== 'Not assessed' && val !== 'Not discussed' && val.length > 10;
  }).length;

  const sectionsWithEvidence = soapWithEvidence + mseWithEvidence;
  const sectionsTotal = soapSections.length + mseDomains.length;
  const notAssessedDomains = mseDomains.filter((d: MseKey) => {
    const val = mse ? mse[d] : '';
    return !val || val === 'Not assessed' || val === '—' || val.length === 0;
  });

  const transcriptWordCount = transcript.split(/\s+/).length;
  const directQuotesCount = extractedFacts.quotes.length;

  // Confidence: weighted by sections with evidence, transcript length, quotes
  const evidenceRatio = sectionsTotal > 0 ? sectionsWithEvidence / sectionsTotal : 0;
  const lengthBonus = Math.min(20, transcriptWordCount / 50);
  const quoteBonus = Math.min(10, directQuotesCount * 3);
  const overallConfidence = Math.min(100, Math.round(evidenceRatio * 70 + lengthBonus + quoteBonus));

  const quality: MedicalScribeResult['quality'] = {
    overallConfidence,
    sectionsWithEvidence,
    sectionsTotal,
    transcriptWordCount,
    directQuotesCount,
    notAssessedDomains,
  };

  const durationSeconds = Math.round((Date.now() - startTime) / 1000);

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 6: ENHANCEMENT FEATURES
  // Evidence citations, ICD-10, MBS, outcome measures, actions, QUEST
  // ═══════════════════════════════════════════════════════════════════════════

  // Evidence-linked citations — link each extracted fact to transcript offset
  const allRawFacts = [
    ...extractedFacts.subjective.map(f => `[S] ${f}`),
    ...extractedFacts.objective.map(f => `[O] ${f}`),
    ...extractedFacts.assessment.map(f => `[A] ${f}`),
    ...extractedFacts.plan.map(f => `[P] ${f}`),
    ...extractedFacts.risk.map(f => `[R] ${f}`),
    ...extractedFacts.medications.map(f => `[M] ${f}`),
    ...extractedFacts.quotes.map(f => `[Q] ${f}`),
  ];
  const citedFacts = linkFactsToTranscript(allRawFacts, transcript);

  // ICD-10-AM auto-coding
  const icd10Suggestions = autoCodeICD10(extractedFacts.assessment, formattedNote);

  // MBS item number suggestions (estimate duration from recording length)
  const estimatedMinutes = Math.round(durationSeconds / 60) || 30;
  const mbsSuggestions = suggestMBSItems(
    'consultation', estimatedMinutes, 'psychiatrist', false, false,
  );

  // Outcome measure auto-scoring
  const allFacts = Object.values(extractedFacts).flat().filter(f => typeof f === 'string') as string[];
  const outcomeMeasures = extractOutcomeMeasures(transcript, allFacts);

  // Agentic scribe — extract actionable items
  const scribeActions = extractScribeActions(
    extractedFacts.plan, extractedFacts.medications, formattedNote,
  );

  // QUEST quality scoring
  const questScore = scoreQUEST(
    formattedNote,
    extractedFacts,
    citedFacts,
    riskAssessment.flags.length > 0 || riskAssessment.overallLevel !== 'low',
    verifiedMedications.length > 0,
  );

  // BUG-037 — forensic audit via recordLlmInteraction. The ordered
  // pipeline captures each stage's startedAt + durationMs so a reviewer
  // can reconstruct the execution path of an AI-assisted clinical note.
  // model_version uses tag-fallback (Ollama /api/generate doesn't echo
  // the manifest digest — BUG-282 tracks /api/show integration).
  const pipelineStages: PipelineStage[] = [
    {
      stage: PIPELINE_STAGES.WHISPER,
      startedAt: new Date(transcribeStart).toISOString(),
      durationMs: transcriptionDurationMs,
      success: true,
      meta: { interpreterUsed, transcriptLen: transcript.length },
    },
    {
      stage: PIPELINE_STAGES.PII_REDACT,
      startedAt: new Date(redactStart).toISOString(),
      durationMs: redactDurationMs,
      success: true,
      meta: { redactionCount: redacted.entries.length },
    },
    {
      stage: PIPELINE_STAGES.PASS1_EXTRACT,
      startedAt: new Date(pass1Start).toISOString(),
      durationMs: pass1DurationMs,
      success: !pass1FallbackReason,
      meta: {
        subjective: extractedFacts.subjective.length,
        objective: extractedFacts.objective.length,
        assessment: extractedFacts.assessment.length,
        plan: extractedFacts.plan.length,
        risk: extractedFacts.risk.length,
        medications: extractedFacts.medications.length,
        ...(pass1FallbackReason ? { fallbackReason: pass1FallbackReason } : {}),
      },
    },
    {
      stage: PIPELINE_STAGES.PASS2_SAFETY,
      startedAt: new Date(pass2Start).toISOString(),
      durationMs: pass2DurationMs,
      success: true,
      meta: {
        verifiedMeds: verifiedMedications.length,
        alerts: safetyAlerts.length,
        riskLevel: riskAssessment.overallLevel,
      },
    },
    {
      stage: PIPELINE_STAGES.PASS3_FORMAT,
      startedAt: new Date(pass3Start).toISOString(),
      durationMs: pass3DurationMs,
      success: !pass3FallbackReason,
      meta: {
        format,
        outputLength: formattedNote.length,
        ...(pass3FallbackReason ? { fallbackReason: pass3FallbackReason } : {}),
      },
    },
  ];

  const llmExecutions = [
    ...pass1Executions,
    ...(pass3Execution ? [pass3Execution] : []),
  ];
  const executionIdentity = summarizeAmbientExecutions(llmExecutions);
  const modelUsed = executionIdentity.modelName || [pass1ModelUsed, pass3ModelUsed]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join('+') || requestedModel;
  const pass1ReviewReason = pass1FallbackReason
    ?? (pass1ModelFallbackFrom ? `Model fallback used for Pass 1: requested ${pass1ModelFallbackFrom}, used ${pass1ModelUsed}` : undefined);
  const pass3ReviewReason = pass3FallbackReason
    ?? (pass3ModelFallbackFrom ? `Model fallback used for Pass 3: requested ${pass3ModelFallbackFrom}, used ${pass3ModelUsed}` : undefined);
  const requiresClinicianReview = Boolean(pass1ReviewReason || pass3ReviewReason);
  const ambientModelVersion = executionIdentity.modelVersion;
  const auditExecution =
    pass3Execution
    ?? buildAmbientFallbackExecution(runtimeLock, 'best_clinical');
  const contextAuditMetadata = buildAmbientGovernedContextAuditMetadata({
    execution: auditExecution,
    contextEnvelope: governedContextEnvelope,
  });
  const promptTokens =
    (pass1PromptTokens ?? 0)
    + (pass3PromptTokens ?? 0)
    || null;
  const completionTokens =
    (pass1CompletionTokens ?? 0)
    + (pass3CompletionTokens ?? 0)
    || null;
  const totalTokens =
    (pass1PromptTokens ?? 0)
    + (pass1CompletionTokens ?? 0)
    + (pass3PromptTokens ?? 0)
    + (pass3CompletionTokens ?? 0)
    || null;

  await recordLlmInteraction({
    clinicId: opts.clinicId,
    userId: opts.staffId,
    patientId: opts.patientId ?? null,
    feature: 'ambient',
    modelName: modelUsed,
    modelVersion: ambientModelVersion,
    modelProvider: ambientModelProvider(runtimeLock.runtimeSelection.backend),
    // Pass 1 and Pass 3 run at distinct temperatures; record the
    // dominant extraction temperature (Pass 1) since it's the
    // fact-extraction call and most forensically consequential.
    temperature: 0.0,
    pipeline: pipelineStages,
    promptTokens: promptTokens ?? Math.ceil((transcript.length + diarizedTranscript.length) / 4),
    completionTokens: completionTokens ?? Math.ceil(formattedNote.length / 4),
    totalTokens:
      totalTokens
      ?? (
        Math.ceil((transcript.length + diarizedTranscript.length) / 4) +
        Math.ceil(formattedNote.length / 4)
      ),
    latencyMs: Date.now() - startTime,
    success: !requiresClinicianReview,
    errorCode: requiresClinicianReview ? 'AMBIENT_REVIEW_REQUIRED_FALLBACK' : undefined,
    // BUG-342 — raw PHI text moves from metadata JSONB into the new
    // encrypted llm_prompts_outputs table (BUG-282). Prompt = the
    // diarized transcript fed into Ollama; output = the formatted
    // clinical note. consentId threads through from the caller (the
    // /ambient-note handler + WS scribe stop handler both have it).
    // Redacted variant used for prompt when PII-redactor ran — the
    // redacted text is what actually went to Ollama.
    promptText: diarizedTranscript || transcript,
    outputText: formattedNote,
    consentId: opts.consentId ?? null,
    metadata: {
      ...contextAuditMetadata,
      versionSource:
        requiresClinicianReview
          ? 'degraded-or-fallback'
          : (runtimeLock.runtimeSelection.backend === 'azure_openai' ? 'provider' : 'tag'),
      format,
      specialty,
      overallConfidence,
      redactionCount: redacted.entries.length,
      runtimeBackendLocked: runtimeLock.runtimeSelection.backend,
      runtimeLocalStyleAdapterModelName: runtimeLock.runtimeSelection.localStyleAdapterModelName,
      requestedLocalModelApplied: runtimeLock.requestedLocalModel ?? null,
      contextMode,
      contextFallbackReason,
      contextAppliedStages: ['pass3_format'],
      requestedModel,
      modelUsed,
      modelVersion: ambientModelVersion,
      llmExecutionCount: llmExecutions.length,
      pass1Executions: pass1Executions.map((execution) => ({
        alias: execution.alias,
        backend: execution.backend,
        modelName: execution.modelName,
        modelVersion: execution.modelVersion,
        deployment: execution.deployment,
        localStyleAdapterModelName: execution.localStyleAdapterModelName ?? null,
      })),
      pass3Execution: pass3Execution ? {
        alias: pass3Execution.alias,
        backend: pass3Execution.backend,
        modelName: pass3Execution.modelName,
        modelVersion: pass3Execution.modelVersion,
        deployment: pass3Execution.deployment,
        localStyleAdapterModelName: pass3Execution.localStyleAdapterModelName ?? null,
      } : null,
      pass1ModelUsed,
      pass1ModelFallbackFrom: pass1ModelFallbackFrom ?? null,
      pass3ModelUsed,
      pass3ModelFallbackFrom: pass3ModelFallbackFrom ?? null,
      pass1Fallback: pass1FallbackReason ?? null,
      pass3Fallback: pass3FallbackReason ?? null,
    },
  });

  // BUG-424 — separate `feature='ambient.asr'` row for the Whisper
  // inference (the Ollama `feature='ambient'` row already landed above).
  // recordWhisperAsrInteractionSafely is the SSoT wrapper that does the
  // fail-CLOSED validation + try/catch + structured-log fallback so
  // ambient flow continues even if the audit-write failed.
  await recordWhisperAsrInteractionSafely({
    clinicId: opts.clinicId,
    userId: opts.staffId,
    patientId: opts.patientId ?? null,
    modelName: whisperModelTag,
    modelVersion: whisperModelVersion,
    durationSeconds: whisperTranscriptionSeconds,
    latencyMs: transcriptionDurationMs,
    success: true,
    pipeline: pipelineStages.filter((s) => s.stage === PIPELINE_STAGES.WHISPER),
    metadata: {
      interpreterUsed,
      interpreterLanguage: opts.interpreterLanguage ?? null,
      diarized: true,
      transcriptionTimeSeconds: whisperTranscriptionSeconds,
    },
  });

  return {
    transcript,
    diarizedTranscript,
    extractedFacts,
    structured,
    mentalStateExam: mse,
    riskFlags,
    suggestedDiagnosis,
    medications,
    summary: formattedNote,
    durationSeconds,
    model: modelUsed,
    requestedModel,
    modelUsed,
    requiresClinicianReview,
    format,
    pipeline: 'medical-grade',
    pass1DurationMs,
    pass2DurationMs,
    pass3DurationMs,
    transcriptionDurationMs,
    verifiedMedications,
    riskAssessment,
    safetyAlerts,
    quality,
    citedFacts,
    icd10Suggestions,
    mbsSuggestions,
    outcomeMeasures,
    scribeActions,
    questScore,
    specialty,
    interpreterUsed,
    interpreterLanguage,
    bilingualTranscript,
    llmFallbacks: pass1ReviewReason || pass3ReviewReason
      ? {
          pass1: pass1ReviewReason,
          pass3: pass3ReviewReason,
        }
      : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WHISPER TRANSCRIPTION (with clinical vocab + diarization)
// ═══════════════════════════════════════════════════════════════════════════════

interface WhisperResult {
  text: string;
  diarizedText: string | null;
  bilingualText: string | null;       // Original + English side-by-side
  transcriptionTime: number;
  detectedLanguages: string[];         // e.g. ['en', 'vi']
  segments: Array<{
    start: number;
    end: number;
    text: string;
    speaker?: string;
    language?: string;                 // Detected language for this segment
    translatedText?: string;           // English translation if non-English
  }>;
  // BUG-424 — forensic identity surfaced from the Whisper server's
  // /inference response. `whisperModel` is the tag (e.g. `large-v3-turbo`);
  // `whisperModelVersion` is `<name>@sha256:<digest>` when the running
  // server reports a digest, or `<name>@unknown` when /inference response
  // omitted the field (older server build) or whisperClient could not
  // probe /health. The audit helper validates the shape fail-CLOSED.
  whisperModel: string;
  whisperModelVersion: string;
}

import { whisperSemaphore } from '../utils/semaphore';

async function transcribeWithWhisper(
  audioBuffer: Buffer,
  mimeType: string,
  interpreterUsed = false,
  interpreterLanguage?: string,
): Promise<WhisperResult> {
  return whisperSemaphore.run(() => _transcribeWithWhisper(audioBuffer, mimeType, interpreterUsed, interpreterLanguage));
}

async function _transcribeWithWhisper(
  audioBuffer: Buffer,
  mimeType: string,
  interpreterUsed = false,
  interpreterLanguage?: string,
): Promise<WhisperResult> {
  const tempDir = join(tmpdir(), 'signacare-ambient');
  await mkdir(tempDir, { recursive: true });
  const ext = mimeType.includes('webm') ? 'webm'
    : mimeType.includes('wav') ? 'wav'
    : mimeType.includes('mp4') ? 'm4a'
    : mimeType.includes('m4a') ? 'm4a'
    : mimeType.includes('aac') ? 'aac'
    : mimeType.includes('ogg') ? 'ogg'
    : mimeType.includes('flac') ? 'flac'
    : mimeType.includes('mpeg') ? 'mp3'
    : 'webm';
  const tempFile = join(tempDir, `recording-${randomUUID()}.${ext}`);
  logger.info({ mimeType, ext, bufferSize: audioBuffer.length, interpreterUsed, interpreterLanguage }, '[Ambient] Preparing audio for Whisper');

  try {
    await writeFile(tempFile, audioBuffer);

    const FormData = (await import('form-data')).default;
    const fs = await import('fs');

    // ── Step 1: Initial transcription with diarization ──
    // When interpreter is used, we do NOT pin language to 'en' so Whisper
    // can auto-detect per-segment. We also request task=transcribe first
    // to get the original-language text, then run task=translate for English.
    const form = new FormData();
    const readStream1 = fs.createReadStream(tempFile);
    readStream1.on('error', (err) => logger.error({ err }, 'Stream error'));
    form.append('file', readStream1);
    form.append('response_format', 'verbose_json');
    form.append('diarize', 'true');
    form.append('clinical_vocab', 'true');

    if (interpreterUsed) {
      // Let Whisper auto-detect language per segment
      form.append('detect_language', 'true');
      if (interpreterLanguage) {
        // Hint the expected non-English language
        form.append('language_hint', interpreterLanguage);
      }
    } else {
      form.append('language', 'en');
    }

    const resp = await axios.post(`${WHISPER_API_URL}/inference`, form, {
      headers: form.getHeaders(),
      timeout: ambientWhisperTimeoutMs(),
      maxBodyLength: ambientAudioMaxBytes(),
      maxContentLength: ambientAudioMaxBytes(),
    });

    const data = resp.data;
    const rawSegments: Array<{
      start: number; end: number; text: string;
      speaker?: string; language?: string;
    }> = data.segments ?? [];

    // Parse text — handle both flat text and segments
    let text = data.text?.trim() ?? '';
    if (!text && rawSegments.length > 0) {
      text = rawSegments.map(s => s.text).join(' ').trim();
    }
    const diarizedText = data.diarized_text?.trim() ?? null;

    // Detect which languages are present
    const detectedLanguages: string[] = [];
    if (data.language) detectedLanguages.push(data.language);
    for (const seg of rawSegments) {
      if (seg.language && !detectedLanguages.includes(seg.language)) {
        detectedLanguages.push(seg.language);
      }
    }

    logger.info({
      textLength: text.length,
      diarizedLength: diarizedText?.length ?? 0,
      segmentCount: rawSegments.length,
      transcriptionTime: data.transcription_time_seconds,
      whisperModel: data.model,
      detectedLanguages,
      interpreterUsed,
    }, '[Ambient] Whisper transcription result');

    // ── Step 2: If interpreter is used, translate non-English segments ──
    let bilingualText: string | null = null;
    const enrichedSegments = rawSegments.map(s => ({
      start: s.start,
      end: s.end,
      text: s.text?.trim() ?? '',
      speaker: s.speaker,
      language: s.language,
      translatedText: undefined as string | undefined,
    }));

    if (interpreterUsed && detectedLanguages.some(l => l !== 'en')) {
      // Run a second pass with task=translate to get English for everything
      const translateForm = new FormData();
      const readStream2 = fs.createReadStream(tempFile);
      readStream2.on('error', (err) => logger.error({ err }, 'Stream error'));
      translateForm.append('file', readStream2);
      translateForm.append('task', 'translate');  // Whisper translates all speech → English
      translateForm.append('response_format', 'verbose_json');
      translateForm.append('diarize', 'true');

      try {
        const transResp = await axios.post(`${WHISPER_API_URL}/inference`, translateForm, {
          headers: translateForm.getHeaders(),
          timeout: ambientWhisperTimeoutMs(),
          maxBodyLength: ambientAudioMaxBytes(),
          maxContentLength: ambientAudioMaxBytes(),
        });

        const transData = transResp.data;
        const transSegments: Array<{ start: number; end: number; text: string }> = transData.segments ?? [];
        const translatedFullText = transData.text?.trim() ?? '';

        // Match translated segments to original by timestamp proximity
        for (const orig of enrichedSegments) {
          if (orig.language && orig.language !== 'en') {
            // Find the closest translated segment by start time
            const match = transSegments.find(ts =>
              Math.abs(ts.start - orig.start) < 2.0 // within 2 seconds
            );
            if (match) {
              orig.translatedText = match.text?.trim();
            }
          }
        }

        // Build bilingual transcript: each line shows original + translation
        const bilingualLines: string[] = [];
        for (const seg of enrichedSegments) {
          const speaker = seg.speaker ? `[${seg.speaker}]` : '';
          const lang = seg.language ? `(${seg.language})` : '';
          if (seg.translatedText && seg.language !== 'en') {
            bilingualLines.push(`${speaker} ${lang}: ${seg.text}`);
            bilingualLines.push(`  → [EN]: ${seg.translatedText}`);
          } else {
            bilingualLines.push(`${speaker} ${seg.text}`);
          }
        }
        bilingualText = bilingualLines.join('\n');

        // Override the main transcript with the fully-translated English version
        // so the LLM pipeline always works with English
        if (translatedFullText) {
          text = translatedFullText;
        }

        logger.info({
          translatedSegments: transSegments.length,
          bilingualLength: bilingualText.length,
        }, '[Ambient] Interpreter mode: bilingual transcript built');

      } catch (transErr: unknown) {
        logger.warn({ err: transErr instanceof Error ? transErr.message : String(transErr) }, '[Ambient] Translation pass failed — using original transcript');
        // Fall through with original text — note generation will still work
      }
    }

    if (!text) {
      logger.warn({
        mimeType,
        bufferSize: audioBuffer.length,
        whisperResponse: JSON.stringify(data).substring(0, 500),
      }, '[Ambient] Whisper returned empty transcript');
    }

    // BUG-424 — capture forensic identity from the Whisper server response
    // (or fall back to the cached /health probe). SSoT lives in
    // whisperClient.parseWhisperVersionFromResponse so direct /inference
    // callers and ambient pipelines share one parse contract.
    const { whisperModel, whisperModelVersion } = await parseWhisperVersionFromResponse(data);

    return {
      text,
      diarizedText: bilingualText ?? diarizedText,
      bilingualText,
      transcriptionTime: data.transcription_time_seconds ?? 0,
      detectedLanguages,
      segments: enrichedSegments,
      whisperModel,
      whisperModelVersion,
    };
  } finally {
    // BUG-391 — observable best-effort cleanup; errors are not blocking but surface for ops diagnosis.
    await unlink(tempFile).catch(err => { logger.debug({ err, tempFile }, 'ambient temp audio cleanup failed'); });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASS 1: VERBATIM EXTRACTION (Medical-Grade)
// Uses SCRIBE_PASS1_SYSTEM — zero fabrication, MSE domain tags
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// PASS 3: CLINICAL FORMATTING (Medical-Grade)
// Uses SCRIBE_PASS3_SYSTEM — RANZCP standards, confidence scores
// ═══════════════════════════════════════════════════════════════════════════════

async function runPass3Formatting(
  facts: ExtractedFacts,
  verifiedMeds: VerifiedMedication[],
  riskResult: RiskAssessmentResult,
  alerts: SafetyAlert[],
  format: string,
  runtimeLock: AmbientRuntimeLock,
  priorContext: string = '',
  styleInstructions: string = '',
  specialtyFormatting: string = '',
) {
  const factsText = formatFactsForPrompt(facts);
  const formatPrompt = getFormatPrompt(format);

  // Build medication verification summary for the formatter
  const medSummary = verifiedMeds.length > 0
    ? 'VERIFIED MEDICATIONS:\n' + verifiedMeds.map(m => {
        let line = `- ${m.name}`;
        if (m.dose) line += ` ${m.dose}`;
        if (m.frequency) line += ` ${m.frequency}`;
        if (m.change !== 'mentioned') line += ` (${m.change})`;
        if (m.doseInRange === false) line += ' [DOSE OUT OF RANGE]';
        if (m.isS8) line += ' [S8]';
        if (m.monitoringRequired) line += ` [Monitor: ${m.monitoringRequired}]`;
        return line;
      }).join('\n')
    : '';

  // Build risk summary
  const riskSummary = `RISK ASSESSMENT SUMMARY:\nOverall level: ${riskResult.overallLevel.toUpperCase()}\n` +
    (riskResult.flags.length > 0
      ? 'Flags:\n' + riskResult.flags.map(f => `- [${f.severity}] ${f.flag}: ${f.evidence}`).join('\n')
      : 'No specific risk flags identified.') +
    (riskResult.protectiveFactors.length > 0
      ? '\nProtective factors: ' + riskResult.protectiveFactors.join(', ')
      : '');

  // Build safety alerts
  const alertsSummary = alerts.length > 0
    ? 'SAFETY ALERTS:\n' + alerts.map(a => `- [${a.severity.toUpperCase()}] ${a.message}`).join('\n')
    : '';

  const userPrompt = `${formatPrompt}
${specialtyFormatting}
${styleInstructions}

EXTRACTED CLINICAL FACTS:
---
${factsText}

${medSummary}

${riskSummary}

${alertsSummary}
${priorContext ? `\n${priorContext}` : ''}
---

Write the clinical note now using ONLY the facts above. Include confidence indicators. Use plain text headings (no markdown).

MEDICATION GROUNDING RULES:
- If you mention a medication, copy the VERIFIED MEDICATIONS entry exactly for drug name, dose, and frequency.
- Never upgrade, round, infer, or substitute a medication dose from historical context.
- Historical context may explain continuity, but it must NOT override today's extracted facts.
- If today's extracted facts do not contain a medication dose, do not invent one.`;

  return generateAmbientPass3Text({
    lock: runtimeLock,
    system: SCRIBE_PASS3_SYSTEM,
    prompt: userPrompt,
  });
}

function formatFactsForPrompt(facts: ExtractedFacts): string {
  const sections: string[] = [];

  if (facts.subjective.length) {
    sections.push('PATIENT REPORTED (Subjective):\n' + facts.subjective.map(f => `- ${f}`).join('\n'));
  }
  if (facts.objective.length) {
    sections.push('CLINICIAN OBSERVATIONS (Objective):\n' + facts.objective.map(f => `- ${f}`).join('\n'));
  }
  if (facts.assessment.length) {
    sections.push('ASSESSMENT/DIAGNOSIS:\n' + facts.assessment.map(f => `- ${f}`).join('\n'));
  }
  if (facts.plan.length) {
    sections.push('PLAN/ACTIONS:\n' + facts.plan.map(f => `- ${f}`).join('\n'));
  }
  if (facts.risk.length) {
    sections.push('RISK FACTORS:\n' + facts.risk.map(f => `- ${f}`).join('\n'));
  }
  if (facts.medications.length) {
    sections.push('MEDICATIONS MENTIONED:\n' + facts.medications.map(f => `- ${f}`).join('\n'));
  }
  if (facts.quotes.length) {
    sections.push('DIRECT PATIENT QUOTES:\n' + facts.quotes.map(f => `- ${f}`).join('\n'));
  }
  if (Object.keys(facts.mse).length > 0) {
    sections.push('MSE DOMAIN FINDINGS:\n' + Object.entries(facts.mse).map(([k, v]) => `- ${k}: ${v}`).join('\n'));
  }

  return sections.join('\n\n');
}

function buildFallbackNote(facts: ExtractedFacts, meds: VerifiedMedication[], risk: RiskAssessmentResult): string {
  const parts: string[] = [];

  parts.push('SUBJECTIVE');
  parts.push(facts.subjective.length > 0 ? facts.subjective.join('\n') : 'Not assessed');
  parts.push('');
  parts.push('OBJECTIVE');
  parts.push(facts.objective.length > 0 ? facts.objective.join('\n') : 'Not assessed');
  parts.push('');
  parts.push('ASSESSMENT');
  parts.push(facts.assessment.length > 0 ? facts.assessment.join('\n') : 'Not assessed');
  parts.push('');

  parts.push('RISK ASSESSMENT');
  parts.push(`Overall risk level: ${risk.overallLevel.toUpperCase()}`);
  if (risk.flags.length > 0) {
    risk.flags.forEach(f => parts.push(`- [${f.severity}] ${f.flag}`));
  } else {
    parts.push('No specific risk flags identified');
  }
  parts.push('');

  parts.push('PLAN');
  parts.push(facts.plan.length > 0 ? facts.plan.map((p, i) => `${i + 1}. ${p}`).join('\n') : 'Pending review');

  if (meds.length > 0) {
    parts.push('');
    parts.push('MEDICATIONS');
    meds.forEach(m => {
      let line = `- ${m.name}`;
      if (m.dose) line += ` ${m.dose}`;
      if (m.frequency) line += ` ${m.frequency}`;
      if (m.change !== 'mentioned') line += ` (${m.change})`;
      if (m.doseInRange === false) line += ' [DOSE OUT OF RANGE - VERIFY]';
      parts.push(line);
    });
  }

  return parts.filter(l => l !== undefined).join('\n').trim();
}

export const __ambientProcessorTestInternals = {
  ambientOllamaNumPredict,
  ambientOllamaTimeoutMs,
  ambientTranscriptChunkChars,
  ambientWhisperTimeoutMs,
  buildExtractionFallbackFacts,
  extractWhisperFailure,
  isWhisperAudioDecodeFailure,
  mergeExtractedFacts,
  splitTranscriptForLlm,
};
