/**
 * Multi-Model Local LLM Agent
 *
 * Supports multiple local LLMs via Ollama for different clinical tasks:
 *
 * GENERATIVE MODELS (via Ollama /api/generate):
 * - llama3.2          — General clinical documentation (default)
 * - mentallama        — MentalLLaMA: fine-tuned for mental health text
 * - emollm            — EmoLLM: emotion-aware clinical responses
 *
 * CLASSIFICATION / EMBEDDING MODEL (via Ollama /api/embeddings or custom endpoint):
 * - mentalbert        — MentalBERT: BERT-based mental health NLP (sentiment, PHQ classification)
 *
 * All data stays local — no PHI leaves the network.
 */

import { config } from '../config'
import { stripMarkdown } from '../utils/stripMarkdown'
import { logger } from '../utils/logger'
import { resolvePositiveIntEnv } from '../shared/positiveIntEnv'
import { generateOllamaText, listOllamaTags, type OllamaTag } from '../shared/ollamaHttpClient'
import { AppError } from '../shared/errors'

const DEFAULT_MODEL = config.ollama?.model ?? 'qwen2.5:14b'
const DEFAULT_LOCAL_LLM_GENERATE_TIMEOUT_MS = 10 * 60 * 1000
const MAX_LOCAL_LLM_GENERATE_TIMEOUT_MS = 30 * 60 * 1000

export function resolveLocalLlmGenerateTimeoutMs(action?: string): number {
  if (action === 'ambient') {
    return resolvePositiveIntEnv(
      'AMBIENT_OLLAMA_TIMEOUT_MS',
      {
        fallback: DEFAULT_LOCAL_LLM_GENERATE_TIMEOUT_MS,
        max: MAX_LOCAL_LLM_GENERATE_TIMEOUT_MS,
        loggerContext: { configSurface: 'local_llm_agent', action: 'ambient' },
      },
    )
  }

  return resolvePositiveIntEnv(
    'LOCAL_LLM_GENERATE_TIMEOUT_MS',
    {
      fallback: DEFAULT_LOCAL_LLM_GENERATE_TIMEOUT_MS,
      max: MAX_LOCAL_LLM_GENERATE_TIMEOUT_MS,
      loggerContext: { configSurface: 'local_llm_agent', action: action ?? 'general' },
    },
  )
}

// ============ Model Registry ============

export interface ModelConfig {
  id: string
  name: string
  ollamaModel: string           // name in Ollama (after ollama pull or create)
  type: 'generative' | 'embedding' | 'classifier'
  description: string
  bestFor: string[]
  defaultTemperature: number
  maxTokens: number
  available?: boolean           // set at runtime after checking Ollama
}

export const MODEL_REGISTRY: ModelConfig[] = [
  {
    id: 'llama3',
    name: 'Llama 3.2',
    ollamaModel: 'llama3.2',
    type: 'generative',
    description: 'Meta Llama 3.2 — fast, reliable clinical documentation model. Used for all generative tasks when Qwen 2.5 is not installed.',
    bestFor: ['maudsley', 'isbar', 'formulation', '91day', 'letter', 'ambient', 'admin-report', 'agent', 'discharge', 'med-summary', 'mhrt-report', 'certificate'],
    defaultTemperature: 0.2,
    maxTokens: 2048,
  },
  {
    id: 'qwen2.5',
    name: 'Qwen 2.5 (14B)',
    ollamaModel: 'qwen2.5:14b',
    type: 'generative',
    description: 'Qwen 2.5 14B — premium clinical AI model. Superior reasoning, instruction following, and clinical accuracy. Install with: ollama pull qwen2.5:14b',
    bestFor: ['maudsley', 'isbar', 'formulation', '91day', 'letter', 'ambient', 'admin-report', 'agent', 'discharge', 'med-summary', 'mhrt-report', 'certificate'],
    defaultTemperature: 0.2,
    maxTokens: 4096,
  },
]

// ============ System Prompts ============

// Formatting instruction appended to ALL clinical prompts
const NO_MARKDOWN = `

FORMATTING RULES (CRITICAL — follow exactly):
- Do NOT use markdown: no **, no ##, no *, no \`, no ---, no > quotes
- Use UPPERCASE for section headings (e.g. SUBJECTIVE:, PLAN:)
- Use plain text dashes for bullet lists (- item)
- Use numbered lists (1. 2. 3.) for ordered items
- Separate sections with a blank line
- Write as if this will be printed on a clinical form, not rendered in a browser`

const SYSTEM_PROMPTS: Record<string, string> = {
  clinical_summary: `You are a clinical documentation assistant for an Australian public mental health service.
Generate concise, professional clinical summaries in the Maudsley format.
Use Australian mental health terminology and reference the Mental Health Act 2014 (Vic) where relevant.
Do not fabricate clinical information — only summarize what is provided.${NO_MARKDOWN}`,

  isbar: `You are a clinical handover assistant. Generate ISBAR (Identify, Situation, Background, Assessment, Recommendation)
summaries from clinical notes. Be concise and focus on clinically relevant information for safe handover.${NO_MARKDOWN}`,

  formulation: `You are a clinical formulation assistant. Generate biopsychosocial formulations using the 4P framework
(Predisposing, Precipitating, Perpetuating, Protective factors) across biological, psychological, and social domains.${NO_MARKDOWN}`,

  review_91day: `You are a 91-day review assistant for Australian public mental health services.
Summarize the past 91 days of clinical engagement, identify challenges, and suggest plan items for the next review period.${NO_MARKDOWN}`,

  letter: `You are a clinical correspondence assistant for Australian public mental health services (Good Health Mental Health).

Generate professional clinical letters following Australian medical correspondence conventions.
Letter types you handle: GP letters, pharmacy letters, NDIS support letters, NDIS review letters, referral letters, discharge letters.

FORMAT RULES:
- Use the service letterhead format: Service Name, Address, Date, Recipient, Dear [title], Re: [Patient] (URNO, Sex, DOB)
- List medications with: drug name, dose, route (if not oral), frequency (use nocte, mane, midi, PO, IM, PRN)
- Bold or clearly mark CEASED medications
- Be concise for GP/pharmacy letters (1 page)
- Be comprehensive for NDIS letters (address all functional domains)
- Use Australian English spelling (behaviour, colour, organised)
- Sign off with clinician name and title
- Only use clinical information from the provided data — never fabricate${NO_MARKDOWN}`,

  ambient: `You are an ambient clinical documentation assistant. Convert clinical conversation notes into structured
clinical documentation in SOAP format. Maintain clinical accuracy and professional tone.${NO_MARKDOWN}`,

  'admin-report': `You are a health service administration assistant for an Australian public mental health service.
Generate administrative reports, caseload summaries, and service statistics. Use formal professional language.${NO_MARKDOWN}`,

  'register-summary': `You are an intake assessment assistant. Summarise referral information into a structured patient registration summary.
Extract key demographics, presenting issues, risk factors, and recommended service stream.${NO_MARKDOWN}`,

  discharge: `You are a discharge summary assistant for Australian mental health services.
Generate comprehensive discharge summaries including diagnosis, treatment provided, medications at discharge,
follow-up plan, and GP recommendations. Follow Australian clinical documentation standards.${NO_MARKDOWN}`,

  'med-summary': `You are a medication review assistant. Summarise medication history including current medications,
recent changes, ceased medications, side effects noted, and adherence patterns. Use Australian PBS/TGA terminology.${NO_MARKDOWN}`,

  // MentalBERT classification prompt (used differently — JSON output is fine)
  'mental-classify': `Analyse the following clinical text and provide structured classification:
1. Sentiment: positive / negative / neutral / mixed
2. Risk indicators: none / low / moderate / high
3. Key themes: list 3-5 clinical themes
4. Emotional state: primary emotion detected
Return as structured JSON.`,
}

// ============ Core LLM Call ============

interface LlmRequest {
  prompt: string
  system?: string
  temperature?: number
  maxTokens?: number
  model?: string   // override model
  // Optional context for loadCustomConfig — when set, the agent looks
  // up a per-clinic+action config row in llm_action_configs to override
  // the default system prompt / model / temperature / max_tokens.
  clinicId?: string
  action?: string
}

interface LlmResponse {
  text: string
  /** Tag / model identifier as configured (e.g. 'llama3:70b'). */
  model: string
  tokensUsed: number
  /**
   * BUG-037 — immutable model version when available. Ollama's
   * `/api/generate` response doesn't include the manifest digest, so
   * we currently fall back to the tag as the version. When a future
   * integration uses `/api/show` to fetch the digest, populate this
   * with the SHA-256. Callers MAY annotate "tag-fallback" in audit meta.
   */
  modelVersion?: string
  /**
   * When the requested local model failed and the agent retried on the
   * default local model, capture the original requested model here so
   * callers can audit the degraded path explicitly.
   */
  fallbackFromModel?: string
  /**
   * BUG-037 — the REQUESTED temperature passed to the model. Ollama does
   * NOT echo the runtime temperature, so this is the atomic field we can
   * defensibly record. Callers log this into llm_interactions.temperature.
   */
  requestedTemperature?: number
}

import { llmSemaphore } from '../utils/semaphore'

/**
 * Load custom system prompt and model config from ai_modelfiles table.
 * Falls back to hardcoded defaults if no custom config exists.
 */
async function loadCustomConfig(clinicId: string | undefined, action: string | undefined): Promise<{ systemPrompt?: string; model?: string; temperature?: number; maxTokens?: number } | null> {
  if (!clinicId || !action) return null;
  try {
    const { db } = await import('../db/db');
    const row = await db('ai_modelfiles')
      .where({ clinic_id: clinicId, action_type: action, is_active: true })
      .first();
    if (!row) return null;
    return {
      systemPrompt: row.system_prompt ?? undefined,
      model: row.model_name ?? undefined,
      temperature: row.temperature ? parseFloat(row.temperature) : undefined,
      maxTokens: row.max_tokens ?? undefined,
    };
  } catch { return null; /* table may not exist yet */ }
}

export async function callLocalLlm(request: LlmRequest): Promise<LlmResponse> {
  // Load custom config from DB if clinicId and action are available
  const custom = await loadCustomConfig(
    request.clinicId,
    request.action,
  );
  if (custom) {
    if (custom.systemPrompt && !request.system) request.system = custom.systemPrompt;
    if (custom.model && !request.model) request.model = custom.model;
    if (custom.temperature != null && request.temperature == null) request.temperature = custom.temperature;
    if (custom.maxTokens != null && request.maxTokens == null) request.maxTokens = custom.maxTokens;
  }
  // Limit concurrent Ollama requests to prevent overload under high traffic
  return llmSemaphore.run(() => _callLocalLlm(request))
}

async function _callLocalLlm(request: LlmRequest): Promise<LlmResponse> {
  const modelId = request.model ?? DEFAULT_MODEL
  const modelConfig = MODEL_REGISTRY.find(m => m.ollamaModel === modelId || m.id === modelId)
  const ollamaModel = modelConfig?.ollamaModel ?? modelId
  // BUG-037 — resolve requested temperature once; record this value (not
  // runtime actual, which Ollama doesn't echo) into llm_interactions.
  const requestedTemperature = request.temperature ?? modelConfig?.defaultTemperature ?? 0.3
  const timeoutMs = resolveLocalLlmGenerateTimeoutMs(request.action)

  try {
    if (modelConfig?.type === 'classifier') {
      // For BERT-style models, use the embedding/classify approach
      return await callClassifierModel(ollamaModel, request)
    }

    const data = await generateOllamaText({
      model: ollamaModel,
      prompt: request.prompt,
      system: request.system ?? SYSTEM_PROMPTS.clinical_summary,
      temperature: requestedTemperature,
      maxTokens: request.maxTokens ?? modelConfig?.maxTokens ?? 2000,
      timeoutMs,
    })
    return {
      text: stripMarkdown(data.response ?? ''),
      model: data.model ?? ollamaModel,
      tokensUsed: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      // BUG-037 — tag-fallback: Ollama /api/generate doesn't return the
      // manifest digest. Callers annotate audit meta { versionSource: 'tag' }.
      // BUG-282 tracks /api/show digest integration.
      modelVersion: data.model ?? ollamaModel,
      requestedTemperature,
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logger.error(
      {
        kind: 'local_llm_generate_failed',
        model: ollamaModel,
        timeoutMs,
        error: errMsg,
      },
      '[LocalLLM] model invocation failed',
    )

    // Fallback: if requested model fails, try default model
    if (ollamaModel !== DEFAULT_MODEL) {
      logger.warn(
        {
          kind: 'local_llm_generate_fallback',
          fromModel: ollamaModel,
          toModel: DEFAULT_MODEL,
        },
        '[LocalLLM] falling back to default model',
      )
      const fallback = await callLocalLlm({ ...request, model: DEFAULT_MODEL })
      return {
        ...fallback,
        fallbackFromModel: fallback.fallbackFromModel ?? ollamaModel,
      }
    }

    throw new AppError(
      'AI generation is unavailable because the configured local model service is not reachable or the model is not loaded.',
      503,
      'AI_MODEL_UNAVAILABLE',
      {
        model: ollamaModel,
        timeoutMs,
        action: request.action ?? 'general',
        remediation: 'Verify the AI runtime service is deployed by immutable digest and the baked model manifest is present.',
      },
    )
  }
}

// For BERT-style models: use generate with a classification prompt
async function callClassifierModel(model: string, request: LlmRequest): Promise<LlmResponse> {
  try {
    const data = await generateOllamaText({
      model,
      prompt: `${SYSTEM_PROMPTS['mental-classify']}\n\nClinical text:\n${request.prompt}`,
      temperature: 0,
      maxTokens: 512,
      timeoutMs: resolveLocalLlmGenerateTimeoutMs(request.action),
    })
    return {
      text: data.response ?? '',
      model,
      tokensUsed: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      // BUG-037 — classifier runs at temperature 0 (deterministic); tag-fallback.
      modelVersion: data.model ?? model,
      requestedTemperature: 0,
    }
  } catch {
    // Fallback to default generative model with classification prompt
    return callLocalLlm({ ...request, model: DEFAULT_MODEL, system: SYSTEM_PROMPTS['mental-classify'] })
  }
}

// ============ Check Available Models ============

export async function listAvailableModels(): Promise<ModelConfig[]> {
  try {
    const data = await listOllamaTags()
    const installedNames = new Set((data.models ?? []).flatMap((model) => {
      const name = normalizeModelName(model)
      if (!name) return []
      const base = baseModelName(name)
      return base === name ? [name] : [name, base]
    }))
    return MODEL_REGISTRY.map((model) => ({
      ...model,
      available: installedNames.has(model.ollamaModel) || installedNames.has(baseModelName(model.ollamaModel)),
    }))
  } catch {
    return MODEL_REGISTRY.map(m => ({ ...m, available: false }))
  }
}

function normalizeModelName(model: OllamaTag): string | null {
  return typeof model.name === 'string' && model.name.trim().length > 0
    ? model.name.trim()
    : null
}

function baseModelName(name: string): string {
  const separatorIndex = name.indexOf(':')
  return separatorIndex >= 0 ? name.slice(0, separatorIndex) : name
}
