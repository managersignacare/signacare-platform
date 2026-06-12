import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { __ambientProcessorTestInternals } from '../../src/mcp/ambientProcessor';

const AMBIENT_PROCESSOR_PATH = join(
  __dirname,
  '..',
  '..',
  'src',
  'mcp',
  'ambientProcessor.ts',
);
const AMBIENT_LONGFORM_PATH = join(
  __dirname,
  '..',
  '..',
  'src',
  'mcp',
  'ambientProcessorLongform.ts',
);

const originalTimeout = process.env.AMBIENT_OLLAMA_TIMEOUT_MS;
const originalNumPredict = process.env.AMBIENT_OLLAMA_NUM_PREDICT;
const originalChunkChars = process.env.AMBIENT_TRANSCRIPT_CHUNK_CHARS;
const originalWhisperTimeout = process.env.AMBIENT_WHISPER_TIMEOUT_MS;

afterEach(() => {
  if (originalTimeout === undefined) {
    delete process.env.AMBIENT_OLLAMA_TIMEOUT_MS;
  } else {
    process.env.AMBIENT_OLLAMA_TIMEOUT_MS = originalTimeout;
  }

  if (originalNumPredict === undefined) {
    delete process.env.AMBIENT_OLLAMA_NUM_PREDICT;
  } else {
    process.env.AMBIENT_OLLAMA_NUM_PREDICT = originalNumPredict;
  }

  if (originalChunkChars === undefined) {
    delete process.env.AMBIENT_TRANSCRIPT_CHUNK_CHARS;
  } else {
    process.env.AMBIENT_TRANSCRIPT_CHUNK_CHARS = originalChunkChars;
  }

  if (originalWhisperTimeout === undefined) {
    delete process.env.AMBIENT_WHISPER_TIMEOUT_MS;
  } else {
    process.env.AMBIENT_WHISPER_TIMEOUT_MS = originalWhisperTimeout;
  }
});

describe('ambient processor fallback contract', () => {
  it('keeps ambient routing on the shared model-router path instead of a stale direct Ollama helper', () => {
    const ambientProcessorSource = readFileSync(AMBIENT_PROCESSOR_PATH, 'utf8');
    const ambientLongformSource = readFileSync(AMBIENT_LONGFORM_PATH, 'utf8');

    expect(ambientProcessorSource).toContain('generateAmbientPass3Text');
    expect(ambientProcessorSource).not.toMatch(/callAmbientOllama/);
    expect(ambientLongformSource).not.toMatch(/export async function callAmbientOllama/);
  });

  it('creates clinician-review fallback facts from a transcript', () => {
    const facts = __ambientProcessorTestInternals.buildExtractionFallbackFacts(
      'Patient reports sleep has been poor. Plan discussed with clinician.',
      'timeout',
    );

    expect(facts.subjective[0]).toContain('Automated fact extraction was unavailable');
    expect(facts.plan[0]).toContain('Review transcript');
    expect(facts.quotes[0]).toContain('Patient reports sleep');
  });

  it('classifies Whisper ffmpeg decode failures from upstream response bodies', () => {
    const failure = __ambientProcessorTestInternals.extractWhisperFailure({
      message: 'Request failed with status code 500',
      code: 'ERR_BAD_RESPONSE',
      response: {
        data: {
          error: 'Failed to load audio: EBML header parsing failed. Invalid data found when processing input.',
        },
      },
    });

    expect(failure.message).toContain('Failed to load audio');
    expect(__ambientProcessorTestInternals.isWhisperAudioDecodeFailure(failure.message)).toBe(true);
  });

  it('allows long-form psychiatric scribe timeouts instead of the old 5-minute cap', () => {
    process.env.AMBIENT_OLLAMA_TIMEOUT_MS = '900000';
    process.env.AMBIENT_WHISPER_TIMEOUT_MS = '4500000';

    expect(__ambientProcessorTestInternals.ambientOllamaTimeoutMs()).toBe(900000);
    expect(__ambientProcessorTestInternals.ambientWhisperTimeoutMs()).toBe(4500000);
  });

  it('splits long psychiatric transcripts before Pass 1 Ollama extraction', () => {
    process.env.AMBIENT_TRANSCRIPT_CHUNK_CHARS = '120';
    const transcript = [
      'Patient describes a long history of depression, anxiety, sleep disruption, and occupational stress.',
      'Risk assessment discussed suicidal ideation, protective factors, safety planning, and family support.',
      'Medication history reviewed sertraline 100 mg daily, quetiapine 25 mg nocte, and prior lithium trial.',
    ].join('\n\n');

    const chunks = __ambientProcessorTestInternals.splitTranscriptForLlm(transcript);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('\n')).toContain('Medication history reviewed');
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(120);
  });
});
