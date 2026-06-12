import type { AiTextGenerationModelAlias } from '@signacare/shared';

type ClinicalAction =
  | 'maudsley'
  | 'isbar'
  | 'formulation'
  | '5p-formulation'
  | '91day'
  | 'letter'
  | 'ambient'
  | 'admin-report'
  | 'register-summary'
  | 'discharge'
  | 'med-summary'
  | 'mhrt-report'
  | 'risk-summary'
  | 'report-insight'
  | 'handover-summary'
  | 'medication-adherence'
  | 'ect-summary'
  | 'linkages'
  | 'lifechart-schema'
  | 'certificate'
  | 'classify';

export interface ClinicalPromptBuildOptions {
  action: ClinicalAction;
  data: string;
  templateType?: string;
}

export interface ClinicalPromptSpec {
  action: ClinicalAction;
  alias: AiTextGenerationModelAlias;
  system: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
  localAction?: string;
}

const NO_MARKDOWN = `

FORMATTING RULES (CRITICAL — follow exactly):
- Do NOT use markdown: no **, no ##, no *, no \`, no ---, no > quotes
- Use UPPERCASE for section headings (e.g. SUBJECTIVE:, PLAN:)
- Use plain text dashes for bullet lists (- item)
- Use numbered lists (1. 2. 3.) for ordered items
- Separate sections with a blank line
- Write as if this will be printed on a clinical form, not rendered in a browser`;

export const CLINICAL_SYSTEM_PROMPTS = {
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

  'mhrt-report': `You are generating a Mental Health Review Tribunal report for Australian mental health services.
This is a formal medico-legal document under the Mental Health Act 2014 (Vic). Include clinical detail,
current legal status, treatment rationale, risk, and least restrictive alternative analysis.${NO_MARKDOWN}`,

  certificate: `You are a clinical documentation assistant generating Australian medical certificates.
Use precise functional language, clear dates, and professional certification wording. Never overstate certainty.${NO_MARKDOWN}`,

  'mental-classify': `Analyse the following clinical text and provide structured classification:
1. Sentiment: positive / negative / neutral / mixed
2. Risk indicators: none / low / moderate / high
3. Key themes: list 3-5 clinical themes
4. Emotional state: primary emotion detected
Return as structured JSON.`,
} as const;

type PromptConfig = {
  alias: AiTextGenerationModelAlias;
  system: string;
  temperature: number;
  maxTokens: number;
  buildPrompt: (data: string, options: ClinicalPromptBuildOptions) => string;
  localAction?: string;
};

const ACTION_CONFIG: Record<ClinicalAction, PromptConfig> = {
  maudsley: {
    alias: 'best_clinical',
    system: CLINICAL_SYSTEM_PROMPTS.clinical_summary,
    temperature: 0.2,
    maxTokens: 3000,
    buildPrompt: (data) => `Generate a Maudsley format longitudinal summary from the following patient data:\n\n${data}`,
  },
  isbar: {
    alias: 'fast_clinical',
    system: CLINICAL_SYSTEM_PROMPTS.isbar,
    temperature: 0.15,
    maxTokens: 2000,
    buildPrompt: (data) => `Generate an ISBAR handover summary from these clinical notes:\n\n${data}`,
  },
  formulation: {
    alias: 'best_clinical',
    system: CLINICAL_SYSTEM_PROMPTS.formulation,
    temperature: 0.2,
    maxTokens: 3000,
    buildPrompt: (data) => `Generate a biopsychosocial clinical formulation from:\n\n${data}`,
  },
  '5p-formulation': {
    alias: 'best_clinical',
    system: CLINICAL_SYSTEM_PROMPTS.formulation,
    temperature: 0.2,
    maxTokens: 3000,
    buildPrompt: (data) => `Generate a biopsychosocial clinical formulation from:\n\n${data}`,
    localAction: 'formulation',
  },
  '91day': {
    alias: 'best_clinical',
    system: CLINICAL_SYSTEM_PROMPTS.review_91day,
    temperature: 0.1,
    maxTokens: 3000,
    buildPrompt: (data) => `Generate a 91-day review summary from:\n\n${data}`,
  },
  letter: {
    alias: 'best_clinical',
    system: CLINICAL_SYSTEM_PROMPTS.letter,
    temperature: 0.3,
    maxTokens: 2500,
    buildPrompt: (data, options) => `Generate a ${options.templateType ?? 'GP letter'} letter using this context:\n\n${data}`,
  },
  ambient: {
    alias: 'best_clinical',
    system: CLINICAL_SYSTEM_PROMPTS.ambient,
    temperature: 0.0,
    maxTokens: 4096,
    buildPrompt: (data) => `Convert these ambient clinical notes into structured SOAP documentation:\n\n${data}`,
  },
  'admin-report': {
    alias: 'fast_clinical',
    system: CLINICAL_SYSTEM_PROMPTS['admin-report'],
    temperature: 0.25,
    maxTokens: 3000,
    buildPrompt: (data) => data,
  },
  'register-summary': {
    alias: 'fast_clinical',
    system: CLINICAL_SYSTEM_PROMPTS['register-summary'],
    temperature: 0.2,
    maxTokens: 1500,
    buildPrompt: (data) => `Summarise this referral/intake data for patient registration:\n\n${data}`,
  },
  discharge: {
    alias: 'best_clinical',
    system: CLINICAL_SYSTEM_PROMPTS.discharge,
    temperature: 0.1,
    maxTokens: 3000,
    buildPrompt: (data) => `Generate a discharge summary from:\n\n${data}`,
  },
  'med-summary': {
    alias: 'fast_clinical',
    system: CLINICAL_SYSTEM_PROMPTS['med-summary'],
    temperature: 0.1,
    maxTokens: 2000,
    buildPrompt: (data) => data,
  },
  'mhrt-report': {
    alias: 'court_report_reasoning',
    system: CLINICAL_SYSTEM_PROMPTS['mhrt-report'],
    temperature: 0.15,
    maxTokens: 3000,
    buildPrompt: (data) => `Generate an MHRT clinical report from:\n\n${data}`,
  },
  'risk-summary': {
    alias: 'best_clinical',
    system: CLINICAL_SYSTEM_PROMPTS.formulation,
    temperature: 0.1,
    maxTokens: 2500,
    buildPrompt: (data) => `Generate a structured risk assessment from:\n\n${data}`,
    localAction: 'formulation',
  },
  'report-insight': {
    alias: 'fast_clinical',
    system: CLINICAL_SYSTEM_PROMPTS['admin-report'],
    temperature: 0.2,
    maxTokens: 2500,
    buildPrompt: (data, options) =>
      `Context: ${options.action}\n\nAnalyse the following data and provide actionable clinical insights:\n\n${data}`,
    localAction: 'admin-report',
  },
  'handover-summary': {
    alias: 'fast_clinical',
    system: CLINICAL_SYSTEM_PROMPTS['admin-report'],
    temperature: 0.2,
    maxTokens: 2500,
    buildPrompt: (data, options) =>
      `Context: ${options.action}\n\nAnalyse the following data and provide actionable clinical insights:\n\n${data}`,
    localAction: 'admin-report',
  },
  'medication-adherence': {
    alias: 'fast_clinical',
    system: CLINICAL_SYSTEM_PROMPTS['admin-report'],
    temperature: 0.2,
    maxTokens: 2500,
    buildPrompt: (data, options) =>
      `Context: ${options.action}\n\nAnalyse the following data and provide actionable clinical insights:\n\n${data}`,
    localAction: 'admin-report',
  },
  'ect-summary': {
    alias: 'fast_clinical',
    system: CLINICAL_SYSTEM_PROMPTS['admin-report'],
    temperature: 0.2,
    maxTokens: 2500,
    buildPrompt: (data, options) =>
      `Context: ${options.action}\n\nAnalyse the following data and provide actionable clinical insights:\n\n${data}`,
    localAction: 'admin-report',
  },
  'linkages': {
    alias: 'fast_clinical',
    system: CLINICAL_SYSTEM_PROMPTS['admin-report'],
    temperature: 0.2,
    maxTokens: 2500,
    buildPrompt: (data, options) =>
      `Context: ${options.action}\n\nAnalyse the following data and provide actionable clinical linkage insights:\n\n${data}`,
    localAction: 'admin-report',
  },
  'lifechart-schema': {
    alias: 'fast_clinical',
    system: CLINICAL_SYSTEM_PROMPTS['admin-report'],
    temperature: 0.2,
    maxTokens: 3500,
    buildPrompt: (data, options) =>
      `Context: ${options.action}\n\nBuild a lifechart schema payload based on this clinical context:\n\n${data}`,
    localAction: 'med-summary',
  },
  certificate: {
    alias: 'best_clinical',
    system: CLINICAL_SYSTEM_PROMPTS.certificate,
    temperature: 0.1,
    maxTokens: 1500,
    buildPrompt: (data) => `Generate a medical certificate from:\n\n${data}`,
  },
  classify: {
    alias: 'fast_clinical',
    system: CLINICAL_SYSTEM_PROMPTS['mental-classify'],
    temperature: 0,
    maxTokens: 800,
    buildPrompt: (data) => data,
  },
};

export function resolveClinicalActionAlias(action: ClinicalAction): AiTextGenerationModelAlias {
  return ACTION_CONFIG[action].alias;
}

export function buildClinicalPromptForAction(options: ClinicalPromptBuildOptions): ClinicalPromptSpec {
  const config = ACTION_CONFIG[options.action];
  return {
    action: options.action,
    alias: config.alias,
    system: config.system,
    prompt: config.buildPrompt(options.data, options),
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    localAction: config.localAction,
  };
}
