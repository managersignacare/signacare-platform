/**
 * HuggingFace Transformers Integration
 *
 * Provides access to HF models that aren't available in Ollama.
 * Uses a local Python inference server for transformer models.
 *
 * Architecture:
 *   Browser → Express API → huggingfaceService.ts → Python HF Server (localhost:8100)
 *
 * The Python server handles:
 * - Model downloading from HuggingFace Hub
 * - GPU/CPU inference with transformers library
 * - Text generation, classification, embeddings, NER
 *
 * Setup:
 *   cd deploy/hf-server && pip install -r requirements.txt && python server.py
 */

import { logger } from '../utils/logger';

const HF_SERVER_URL = process.env.HF_SERVER_URL ?? 'http://localhost:8100';

// Raw response shapes from the Python HF inference server
// (deploy/hf-server/server.py). Distinct from the service-level
// HFInferenceResponse (exported below) which is the shape callers see.
interface HFServerInferenceResponse {
  text?: string;
  generated_text?: string;
  labels?: Array<{ label: string; score: number }>;
  entities?: Array<{ entity: string; word?: string; start: number; end: number; score: number; text?: string }>;
  embeddings?: number[];
  tokens_used?: number;
}
interface HFModelsListResponse {
  downloaded?: string[];
}
interface HFDownloadResponse {
  success?: boolean;
  message?: string;
}

// ── HuggingFace Model Registry ──

export interface HFModelConfig {
  id: string;
  name: string;
  hfRepo: string;              // HuggingFace repo ID
  type: 'text-generation' | 'text-classification' | 'token-classification' | 'text2text-generation' | 'feature-extraction';
  description: string;
  bestFor: string[];
  parameterSize: string;       // e.g. "110M", "7B"
  requiresGpu: boolean;
  defaultMaxLength: number;
}

export const HF_MODEL_REGISTRY: HFModelConfig[] = [
  // ── Classification & Safety (small, fast, CPU-friendly) ──
  {
    id: 'mentalbert',
    name: 'MentalBERT',
    hfRepo: 'mental/mental-bert-base-uncased',
    type: 'text-classification',
    description: 'BERT fine-tuned on mental health Reddit data. Fast risk screening and sentiment classification.',
    bestFor: ['classification', 'sentiment', 'risk-screening'],
    parameterSize: '110M',
    requiresGpu: false,
    defaultMaxLength: 512,
  },
  {
    id: 'suicide-detection',
    name: 'Suicide Risk Detector',
    hfRepo: 'sentinetyd/suicidality',
    type: 'text-classification',
    description: 'Detects suicidal ideation in clinical text. Critical safety screening layer.',
    bestFor: ['risk-screening', 'suicide-detection', 'safety-check'],
    parameterSize: '110M',
    requiresGpu: false,
    defaultMaxLength: 512,
  },
  {
    id: 'emotion-english',
    name: 'GoEmotions (Affect Detection)',
    hfRepo: 'SamLowe/roberta-base-go_emotions',
    type: 'text-classification',
    description: 'Fine-grained emotion detection (28 emotions). Used for MSE affect analysis from transcripts.',
    bestFor: ['emotion-detection', 'affect-analysis', 'mse'],
    parameterSize: '125M',
    requiresGpu: false,
    defaultMaxLength: 512,
  },
  // ── Entity Extraction ──
  {
    id: 'mental-health-ner',
    name: 'Clinical NER',
    hfRepo: 'raynardj/ner-disease-ncbi-bionlp-bc5cdr-pubmed',
    type: 'token-classification',
    description: 'Extracts medical entities (medications, symptoms, diagnoses) from clinical text.',
    bestFor: ['ner', 'entity-extraction', 'medication-extraction'],
    parameterSize: '110M',
    requiresGpu: false,
    defaultMaxLength: 512,
  },
];

// ── API Interface ──

export interface HFInferenceRequest {
  model: string;             // HF repo ID or registry ID
  text: string;
  task?: 'generate' | 'classify' | 'ner' | 'embed' | 'sentiment';
  maxLength?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface HFInferenceResponse {
  text: string;
  model: string;
  labels?: { label: string; score: number }[];
  entities?: { entity: string; word: string; score: number; start: number; end: number }[];
  embeddings?: number[];
  tokensUsed: number;
  inferenceTimeMs: number;
}

/**
 * Call the local HuggingFace inference server.
 */
export async function callHuggingFace(request: HFInferenceRequest): Promise<HFInferenceResponse> {
  const modelConfig = HF_MODEL_REGISTRY.find(m => m.id === request.model || m.hfRepo === request.model);
  const hfRepo = modelConfig?.hfRepo ?? request.model;
  const task = request.task ?? inferTask(modelConfig?.type);

  const startTime = Date.now();

  try {
    const resp = await fetch(`${HF_SERVER_URL}/inference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: hfRepo,
        text: request.text,
        task,
        max_length: request.maxLength ?? modelConfig?.defaultMaxLength ?? 512,
        temperature: request.temperature ?? 0.3,
        system_prompt: request.systemPrompt,
      }),
      signal: AbortSignal.timeout(300000), // 5 min timeout for large models
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`HF Server error ${resp.status}: ${errText}`);
    }

    const data = await resp.json() as HFServerInferenceResponse;
    // Map server entities to the exported HFInferenceResponse shape,
    // which requires a `word` field per entity.
    const entities = data.entities?.map(e => ({
      entity: e.entity,
      word: e.word ?? e.text ?? '',
      score: e.score,
      start: e.start,
      end: e.end,
    }));
    return {
      text: data.text ?? data.generated_text ?? '',
      model: hfRepo,
      labels: data.labels,
      entities,
      embeddings: data.embeddings,
      tokensUsed: data.tokens_used ?? 0,
      inferenceTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ model: hfRepo, err: errMsg }, '[HF] Inference failed');
    throw new Error(
      `HuggingFace inference failed for ${modelConfig?.name ?? hfRepo}: ${errMsg}. ` +
      `Ensure the HF server is running: cd deploy/hf-server && python server.py`
    );
  }
}

/**
 * Check which HF models are downloaded and available.
 */
export async function listHFModels(): Promise<(HFModelConfig & { downloaded: boolean; serverRunning: boolean })[]> {
  try {
    const resp = await fetch(`${HF_SERVER_URL}/models`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) {
      return HF_MODEL_REGISTRY.map(m => ({ ...m, downloaded: false, serverRunning: false }));
    }
    const data = await resp.json() as HFModelsListResponse;
    const downloadedSet = new Set<string>(data.downloaded ?? []);
    return HF_MODEL_REGISTRY.map(m => ({
      ...m,
      downloaded: downloadedSet.has(m.hfRepo),
      serverRunning: true,
    }));
  } catch {
    return HF_MODEL_REGISTRY.map(m => ({ ...m, downloaded: false, serverRunning: false }));
  }
}

/**
 * Download a model from HuggingFace Hub.
 */
export async function downloadHFModel(modelId: string): Promise<{ success: boolean; message: string }> {
  const modelConfig = HF_MODEL_REGISTRY.find(m => m.id === modelId || m.hfRepo === modelId);
  const hfRepo = modelConfig?.hfRepo ?? modelId;

  try {
    const resp = await fetch(`${HF_SERVER_URL}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: hfRepo }),
      signal: AbortSignal.timeout(600000), // 10 min for large model downloads
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(errText || `Download failed: ${resp.status}`);
    }

    const data = await resp.json() as HFDownloadResponse;
    return { success: true, message: data.message ?? `Downloaded ${modelConfig?.name ?? hfRepo}` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Classify clinical text using a HF classification model.
 */
export async function classifyWithHF(text: string, modelId = 'mentalbert'): Promise<{
  sentiment: string;
  riskLevel: string;
  emotions: { label: string; score: number }[];
  suicideRisk?: { label: string; score: number };
}> {
  // Run multiple models in parallel for comprehensive analysis
  const results = await Promise.allSettled([
    callHuggingFace({ model: modelId, text, task: 'classify' }),
    callHuggingFace({ model: 'emotion-english', text, task: 'sentiment' }).catch((err) => { logger.warn({ err }, 'huggingfaceService: op failed — returning null'); return null; }),
    callHuggingFace({ model: 'suicide-detection', text, task: 'classify' }).catch((err) => { logger.warn({ err }, 'huggingfaceService: op failed — returning null'); return null; }),
  ]);

  const mainResult = results[0].status === 'fulfilled' ? results[0].value : null;
  const emotionResult = results[1].status === 'fulfilled' ? results[1].value : null;
  const suicideResult = results[2].status === 'fulfilled' ? results[2].value : null;

  return {
    sentiment: mainResult?.labels?.[0]?.label ?? 'unknown',
    riskLevel: deriveRiskLevel(mainResult?.labels ?? []),
    emotions: emotionResult?.labels?.slice(0, 5) ?? [],
    suicideRisk: suicideResult?.labels?.[0] ? {
      label: suicideResult.labels[0].label,
      score: suicideResult.labels[0].score,
    } : undefined,
  };
}

/**
 * Extract medical entities from clinical text using NER.
 */
export async function extractEntities(text: string): Promise<{
  medications: string[];
  diagnoses: string[];
  symptoms: string[];
  procedures: string[];
}> {
  const result = await callHuggingFace({ model: 'mental-health-ner', text, task: 'ner' });
  const entities = result.entities ?? [];

  return {
    medications: entities.filter(e => e.entity.includes('Chemical') || e.entity.includes('Drug')).map(e => e.word),
    diagnoses: entities.filter(e => e.entity.includes('Disease') || e.entity.includes('Disorder')).map(e => e.word),
    symptoms: entities.filter(e => e.entity.includes('Symptom') || e.entity.includes('Sign')).map(e => e.word),
    procedures: entities.filter(e => e.entity.includes('Procedure') || e.entity.includes('Treatment')).map(e => e.word),
  };
}

// ── Helpers ──

function inferTask(modelType?: string): string {
  switch (modelType) {
    case 'text-generation':
    case 'text2text-generation': return 'generate';
    case 'text-classification': return 'classify';
    case 'token-classification': return 'ner';
    case 'feature-extraction': return 'embed';
    default: return 'generate';
  }
}

function deriveRiskLevel(labels: { label: string; score: number }[]): string {
  const riskLabel = labels.find(l =>
    /suicid|harm|danger|risk|crisis/i.test(l.label) && l.score > 0.5
  );
  if (riskLabel && riskLabel.score > 0.8) return 'high';
  if (riskLabel && riskLabel.score > 0.5) return 'moderate';
  return 'low';
}
