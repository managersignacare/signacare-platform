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

const OLLAMA_URL = config.ollama?.baseUrl ?? 'http://localhost:11434'
const DEFAULT_MODEL = config.ollama?.model ?? 'qwen2.5:14b'

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

// Ollama /api/generate response shape (documented at
// https://github.com/ollama/ollama/blob/main/docs/api.md#response-2)
interface OllamaGenerateResponse {
  model?: string
  response?: string
  done?: boolean
  prompt_eval_count?: number
  eval_count?: number
  eval_duration?: number
}

// Ollama /api/tags response shape
interface OllamaTagsResponse {
  models?: Array<{ name?: string; modified_at?: string; size?: number }>
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

  try {
    if (modelConfig?.type === 'classifier') {
      // For BERT-style models, use the embedding/classify approach
      return await callClassifierModel(ollamaModel, request)
    }

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        prompt: request.prompt,
        system: request.system ?? SYSTEM_PROMPTS.clinical_summary,
        stream: false,
        options: {
          temperature: requestedTemperature,
          num_predict: request.maxTokens ?? modelConfig?.maxTokens ?? 2000,
        },
      }),
      signal: AbortSignal.timeout(150_000), // 2.5 min server-side timeout
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`Ollama error ${response.status}: ${errText || response.statusText}`)
    }

    const data = await response.json() as OllamaGenerateResponse
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
      return callLocalLlm({ ...request, model: DEFAULT_MODEL })
    }

    return {
      text: `[AI unavailable — model "${ollamaModel}" not running. Start Ollama and pull the model: ollama pull ${ollamaModel}]`,
      model: ollamaModel,
      tokensUsed: 0,
      // BUG-037 — degraded response still records the attempted model tag
      // + requested temperature so the audit row reflects intent.
      modelVersion: ollamaModel,
      requestedTemperature,
    }
  }
}

// For BERT-style models: use generate with a classification prompt
async function callClassifierModel(model: string, request: LlmRequest): Promise<LlmResponse> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `${SYSTEM_PROMPTS['mental-classify']}\n\nClinical text:\n${request.prompt}`,
        stream: false,
        options: { temperature: 0, num_predict: 512 },
      }),
    })
    if (!response.ok) throw new Error(`Ollama error: ${response.status}`)
    const data = await response.json() as OllamaGenerateResponse
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
    const resp = await fetch(`${OLLAMA_URL}/api/tags`)
    if (!resp.ok) return MODEL_REGISTRY.map(m => ({ ...m, available: false }))
    const data = await resp.json() as OllamaTagsResponse
    const installed = new Set((data.models ?? []).map((m) => m.name?.split(':')[0]))
    return MODEL_REGISTRY.map(m => ({ ...m, available: installed.has(m.ollamaModel) }))
  } catch {
    return MODEL_REGISTRY.map(m => ({ ...m, available: false }))
  }
}

// ============ Clinical AI Functions ============

// ============ Task → Model Routing ============
// All generative tasks → Qwen 2.5:14b (via Ollama)
// Classification tasks → HuggingFace classifiers (MentalBERT, GoEmotions, Suicide Detector, Clinical NER)
//
// Task-specific tuning is done via temperature and system prompt, NOT model selection.
// Low temp (0.0-0.1) = factual extraction, risk assessment, ambient notes
// Med temp (0.2-0.3) = clinical summaries, letters, formulations
// Higher temp (0.3-0.4) = creative tasks like therapeutic suggestions

const TASK_CONFIG: Record<string, { temperature: number; maxTokens: number }> = {
  // Factual / safety-critical → lowest temperature
  ambient:           { temperature: 0.0, maxTokens: 4096 },
  'risk-assessment': { temperature: 0.0, maxTokens: 2000 },
  '91day':           { temperature: 0.1, maxTokens: 3000 },
  discharge:         { temperature: 0.1, maxTokens: 3000 },
  'med-summary':     { temperature: 0.1, maxTokens: 2000 },
  // Structured clinical → low temperature
  isbar:             { temperature: 0.15, maxTokens: 2000 },
  maudsley:          { temperature: 0.2,  maxTokens: 3000 },
  formulation:       { temperature: 0.2,  maxTokens: 3000 },
  'mhrt-report':     { temperature: 0.15, maxTokens: 3000 },
  certificate:       { temperature: 0.1,  maxTokens: 1500 },
  // Creative / variable → slightly higher temperature
  letter:            { temperature: 0.3,  maxTokens: 2500 },
  'admin-report':    { temperature: 0.25, maxTokens: 3000 },
  'register-summary':{ temperature: 0.2,  maxTokens: 1500 },
  agent:             { temperature: 0.3,  maxTokens: 4096 },
}

function getTaskConfig(task: string) {
  return TASK_CONFIG[task] ?? { temperature: 0.2, maxTokens: 2000 }
}

export const clinicalAi = {
  async generateMaudsleySummary(data: string, _model?: string): Promise<string> {
    const cfg = getTaskConfig('maudsley')
    const r = await callLocalLlm({ system: SYSTEM_PROMPTS.clinical_summary, prompt: `Generate a Maudsley format longitudinal summary from the following patient data:\n\n${data}`, temperature: cfg.temperature, maxTokens: cfg.maxTokens })
    return r.text
  },
  async generateISBAR(data: string, _model?: string): Promise<string> {
    const cfg = getTaskConfig('isbar')
    const r = await callLocalLlm({ system: SYSTEM_PROMPTS.isbar, prompt: `Generate an ISBAR handover summary from these clinical notes:\n\n${data}`, temperature: cfg.temperature, maxTokens: cfg.maxTokens })
    return r.text
  },
  async generateFormulation(data: string, _model?: string): Promise<string> {
    const cfg = getTaskConfig('formulation')
    const r = await callLocalLlm({ system: SYSTEM_PROMPTS.formulation, prompt: `Generate a biopsychosocial clinical formulation from:\n\n${data}`, temperature: cfg.temperature, maxTokens: cfg.maxTokens })
    return r.text
  },
  async generate91DayReview(data: string, _model?: string): Promise<string> {
    const cfg = getTaskConfig('91day')
    const r = await callLocalLlm({ system: SYSTEM_PROMPTS.review_91day, prompt: `Generate a 91-day review summary from:\n\n${data}`, temperature: cfg.temperature, maxTokens: cfg.maxTokens })
    return r.text
  },
  async generateLetter(data: string, templateType: string, _model?: string): Promise<string> {
    const cfg = getTaskConfig('letter')
    const r = await callLocalLlm({ system: SYSTEM_PROMPTS.letter, prompt: `Generate a ${templateType} letter using this context:\n\n${data}`, temperature: cfg.temperature, maxTokens: cfg.maxTokens })
    return r.text
  },
  async processAmbientNotes(data: string, _model?: string): Promise<string> {
    const cfg = getTaskConfig('ambient')
    const r = await callLocalLlm({ system: SYSTEM_PROMPTS.ambient, prompt: `Convert these ambient clinical notes into structured SOAP documentation:\n\n${data}`, temperature: cfg.temperature, maxTokens: cfg.maxTokens })
    return r.text
  },
  async generateAdminReport(data: string, _model?: string): Promise<string> {
    const cfg = getTaskConfig('admin-report')
    const r = await callLocalLlm({ system: SYSTEM_PROMPTS['admin-report'], prompt: data, temperature: cfg.temperature, maxTokens: cfg.maxTokens })
    return r.text
  },
  async generateRegistrationSummary(data: string, _model?: string): Promise<string> {
    const cfg = getTaskConfig('register-summary')
    const r = await callLocalLlm({ system: SYSTEM_PROMPTS['register-summary'], prompt: `Summarise this referral/intake data for patient registration:\n\n${data}`, temperature: cfg.temperature, maxTokens: cfg.maxTokens })
    return r.text
  },
  async generateDischargeSummary(data: string, _model?: string): Promise<string> {
    const cfg = getTaskConfig('discharge')
    const r = await callLocalLlm({ system: SYSTEM_PROMPTS.discharge, prompt: `Generate a discharge summary from:\n\n${data}`, temperature: cfg.temperature, maxTokens: cfg.maxTokens })
    return r.text
  },
  async generateMedSummary(data: string, _model?: string): Promise<string> {
    const cfg = getTaskConfig('med-summary')
    const r = await callLocalLlm({ system: SYSTEM_PROMPTS['med-summary'], prompt: data, temperature: cfg.temperature, maxTokens: cfg.maxTokens })
    return r.text
  },
  async generateMHRTReport(data: string, _model?: string): Promise<string> {
    const cfg = getTaskConfig('mhrt-report')
    const r = await callLocalLlm({ system: SYSTEM_PROMPTS.mhrt_report ?? SYSTEM_PROMPTS.clinical_summary, prompt: `Generate an MHRT clinical report from:\n\n${data}`, temperature: cfg.temperature, maxTokens: cfg.maxTokens })
    return r.text
  },
  async generateCertificate(data: string, _model?: string): Promise<string> {
    const cfg = getTaskConfig('certificate')
    const r = await callLocalLlm({ system: SYSTEM_PROMPTS.certificate ?? SYSTEM_PROMPTS.letter, prompt: `Generate a medical certificate from:\n\n${data}`, temperature: cfg.temperature, maxTokens: cfg.maxTokens })
    return r.text
  },
  /** Classification via HuggingFace MentalBERT + Suicide Detector + GoEmotions */
  async classifyText(data: string): Promise<string> {
    // Use Qwen as fallback for classification (HF models are called separately in the pipeline)
    const r = await callLocalLlm({ prompt: data, system: SYSTEM_PROMPTS['mental-classify'], temperature: 0 })
    return r.text
  },
  /** Run the full HF classifier pipeline on clinical text */
  async runClassifierPipeline(text: string): Promise<{
    riskLevel: string;
    suicideRisk: string;
    emotions: string[];
    entities: string[];
  }> {
    const { classifyWithHF } = await import('./huggingfaceService')
    // classifyWithHF runs all classifiers internally and returns a combined result
    try {
      const result = await classifyWithHF(text, 'mentalbert')
      return {
        riskLevel: result.riskLevel ?? 'unknown',
        suicideRisk: result.suicideRisk?.label ?? 'unknown',
        emotions: result.emotions?.slice(0, 3).map((e: { label: string; score: number }) => e.label) ?? [],
        entities: [],
      }
    } catch {
      return { riskLevel: 'unavailable', suicideRisk: 'unavailable', emotions: [], entities: [] }
    }
  },
}
