import type { RoutedModelExecution } from '@signacare/shared';
import { logger } from '../utils/logger';
import {
  ambientTranscriptChunkChars,
} from '../shared/ambientScribeConfig';
import type { AmbientRuntimeLock } from './ambientModelRouting';
import { generateAmbientPass1Text } from './ambientModelRouting';
import { SCRIBE_PASS1_SYSTEM } from './medicalScribe';

export interface AmbientExtractedFacts {
  subjective: string[];
  objective: string[];
  assessment: string[];
  plan: string[];
  risk: string[];
  medications: string[];
  quotes: string[];
  mse: Record<string, string>;
}

export interface AmbientExtractionResult {
  facts: AmbientExtractedFacts;
  modelUsed: string;
  fallbackFrom?: string;
  executions: RoutedModelExecution[];
  promptTokens: number | null;
  completionTokens: number | null;
}

export function formatLlmFailure(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return String(err);
}

export function extractWhisperFailure(err: unknown): { message: string; code?: string } {
  const fallback = err instanceof Error ? err.message : String(err);
  if (err == null || typeof err !== 'object') return { message: fallback };

  const parsed = err as {
    code?: unknown;
    message?: unknown;
    response?: {
      data?: {
        code?: unknown;
        error?: unknown;
      };
    };
  };
  const upstreamError = parsed.response?.data?.error;
  const upstreamCode = parsed.response?.data?.code;
  const base = typeof parsed.message === 'string' ? parsed.message : fallback;
  const message = typeof upstreamError === 'string' && upstreamError.trim()
    ? `${base}: ${upstreamError.trim()}`
    : base;
  const code = typeof upstreamCode === 'string'
    ? upstreamCode
    : typeof parsed.code === 'string'
      ? parsed.code
      : undefined;

  return { message, code };
}

export function isWhisperAudioDecodeFailure(message: string): boolean {
  return /failed to load audio|invalid data found when processing input|ebml header parsing failed|error opening input file/i
    .test(message);
}

export function emptyExtractedFacts(): AmbientExtractedFacts {
  return {
    subjective: [],
    objective: [],
    assessment: [],
    plan: [],
    risk: [],
    medications: [],
    quotes: [],
    mse: {},
  };
}

export function buildExtractionFallbackFacts(transcript: string, reason: string): AmbientExtractedFacts {
  const facts = emptyExtractedFacts();
  const cleanedTranscript = transcript.trim().replace(/\s+/g, ' ');
  if (cleanedTranscript.length > 0) {
    facts.subjective.push(
      `Automated fact extraction was unavailable (${reason}). Clinician must review the transcript before signing.`,
    );
    facts.quotes.push(cleanedTranscript.slice(0, 1500));
  }
  facts.plan.push('Review transcript and complete clinical plan before signing.');
  return facts;
}

export function splitTranscriptForLlm(transcript: string, maxChars = ambientTranscriptChunkChars()): string[] {
  const cleaned = transcript.trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const chunks: string[] = [];
  let current = '';
  const paragraphs = cleaned.split(/\n{2,}/).flatMap((paragraph) => {
    if (paragraph.length <= maxChars) return [paragraph];
    return paragraph.split(/(?<=[.!?])\s+/);
  });

  for (const part of paragraphs) {
    const segment = part.trim();
    if (!segment) continue;

    if (segment.length > maxChars) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }
      for (let i = 0; i < segment.length; i += maxChars) {
        chunks.push(segment.slice(i, i + maxChars).trim());
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${segment}` : segment;
    if (candidate.length > maxChars && current.trim()) {
      chunks.push(current.trim());
      current = segment;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function mergeExtractedFacts(
  target: AmbientExtractedFacts,
  source: AmbientExtractedFacts,
): AmbientExtractedFacts {
  target.subjective.push(...source.subjective);
  target.objective.push(...source.objective);
  target.assessment.push(...source.assessment);
  target.plan.push(...source.plan);
  target.risk.push(...source.risk);
  target.medications.push(...source.medications);
  target.quotes.push(...source.quotes);
  for (const [domain, finding] of Object.entries(source.mse)) {
    if (!finding) continue;
    target.mse[domain] = target.mse[domain] ? `${target.mse[domain]}; ${finding}` : finding;
  }
  return target;
}

export async function runPass1Extraction(
  transcript: string,
  runtimeLock: AmbientRuntimeLock,
  specialtyAddendum: string,
): Promise<AmbientExtractionResult> {
  const chunks = splitTranscriptForLlm(transcript);
  if (chunks.length > 1) {
    const merged = emptyExtractedFacts();
    const modelUsed = new Set<string>();
    const fallbackFrom = new Set<string>();
    const executions: RoutedModelExecution[] = [];
    let promptTokens = 0;
    let completionTokens = 0;
    let sawPromptTokens = false;
    let sawCompletionTokens = false;
    logger.info(
      {
        transcriptLength: transcript.length,
        chunks: chunks.length,
        chunkChars: ambientTranscriptChunkChars(),
      },
      '[Ambient] Long transcript split for Pass 1 extraction',
    );

    for (let index = 0; index < chunks.length; index += 1) {
      const chunkResult = await runPass1ExtractionChunk(
        chunks[index],
        runtimeLock,
        specialtyAddendum,
        index + 1,
        chunks.length,
      );
      mergeExtractedFacts(merged, chunkResult.facts);
      modelUsed.add(chunkResult.modelUsed);
      if (chunkResult.fallbackFrom) fallbackFrom.add(chunkResult.fallbackFrom);
      executions.push(...chunkResult.executions);
      if (chunkResult.promptTokens != null) {
        promptTokens += chunkResult.promptTokens;
        sawPromptTokens = true;
      }
      if (chunkResult.completionTokens != null) {
        completionTokens += chunkResult.completionTokens;
        sawCompletionTokens = true;
      }
    }

    return {
      facts: merged,
      modelUsed: [...modelUsed].join('+') || 'unknown',
      fallbackFrom: [...fallbackFrom].join('+') || undefined,
      executions,
      promptTokens: sawPromptTokens ? promptTokens : null,
      completionTokens: sawCompletionTokens ? completionTokens : null,
    };
  }

  return runPass1ExtractionChunk(chunks[0] ?? transcript, runtimeLock, specialtyAddendum);
}

async function runPass1ExtractionChunk(
  transcript: string,
  runtimeLock: AmbientRuntimeLock,
  specialtyAddendum: string,
  chunkNumber?: number,
  chunkTotal?: number,
): Promise<AmbientExtractionResult> {
  const chunkContext = chunkNumber && chunkTotal
    ? `\nThis is transcript chunk ${chunkNumber} of ${chunkTotal}. Extract facts from this chunk only; do not infer missing context from other chunks.`
    : '';
  const userPrompt = `Extract all clinical facts from this transcript, one per line, tagged appropriately.
For MSE findings, use [MSE:domain] tags. For medications, include EXACT dose and frequency.
${specialtyAddendum}
${chunkContext}

TRANSCRIPT:
---
${transcript}
---

EXTRACTED FACTS:`;

  const response = await generateAmbientPass1Text({
    lock: runtimeLock,
    system: SCRIBE_PASS1_SYSTEM,
    prompt: userPrompt,
  });
  return {
    facts: parseExtractedFacts(response.text),
    modelUsed: response.execution.modelName,
    fallbackFrom: response.fallbackFromModelName ?? undefined,
    executions: [response.execution],
    promptTokens: response.promptTokens,
    completionTokens: response.completionTokens,
  };
}

function parseExtractedFacts(text: string): AmbientExtractedFacts {
  const facts = emptyExtractedFacts();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    const cleaned = line.replace(/^[-•*]\s*/, '').trim();

    const mseMatch = cleaned.match(/^\[MSE:(\w+)\]\s*(.*)/i);
    if (mseMatch) {
      const domain = mseMatch[1].toLowerCase();
      const finding = mseMatch[2].trim();
      const domainMap: Record<string, string> = {
        appearance: 'appearance', behaviour: 'behaviour', behavior: 'behaviour',
        speech: 'speech', mood: 'mood', affect: 'affect',
        thought_form: 'thoughtForm', thoughtform: 'thoughtForm', 'thought form': 'thoughtForm',
        thought_content: 'thoughtContent', thoughtcontent: 'thoughtContent', 'thought content': 'thoughtContent',
        perception: 'perception', cognition: 'cognition',
        insight: 'insight', judgement: 'judgement', judgment: 'judgement',
      };
      const key = domainMap[domain] || domain;
      facts.mse[key] = facts.mse[key] ? `${facts.mse[key]}; ${finding}` : finding;
      facts.objective.push(`[MSE ${domain}] ${finding}`);
      continue;
    }

    if (cleaned.startsWith('[S]')) facts.subjective.push(cleaned.replace(/^\[S\]\s*/, ''));
    else if (cleaned.startsWith('[O]')) facts.objective.push(cleaned.replace(/^\[O\]\s*/, ''));
    else if (cleaned.startsWith('[A]')) facts.assessment.push(cleaned.replace(/^\[A\]\s*/, ''));
    else if (cleaned.startsWith('[P]')) facts.plan.push(cleaned.replace(/^\[P\]\s*/, ''));
    else if (cleaned.startsWith('[R]')) facts.risk.push(cleaned.replace(/^\[R\]\s*/, ''));
    else if (cleaned.startsWith('[M]')) facts.medications.push(cleaned.replace(/^\[M\]\s*/, ''));
    else if (cleaned.startsWith('[Q]')) facts.quotes.push(cleaned.replace(/^\[Q\]\s*/, ''));
    else if (cleaned.startsWith('[?]')) facts.subjective.push(`[uncertain] ${cleaned.replace(/^\[\?]\s*/, '')}`);
    else {
      const lower = cleaned.toLowerCase();
      if (/suicid|self.?harm|violen|aggress|abscon|risk|homicid/i.test(lower)) facts.risk.push(cleaned);
      else if (/\d+\s*mg|\d+\s*mcg|tablet|capsule|injection|depot|patch/i.test(lower)) facts.medications.push(cleaned);
      else if (lower.includes('"') || lower.includes("'")) facts.quotes.push(cleaned);
      else facts.subjective.push(cleaned);
    }
  }

  return facts;
}
