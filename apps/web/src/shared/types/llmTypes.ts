import { z } from 'zod';

export const LLMSoapResponseSchema = z.object({
  subjective: z.string(),
  objective: z.string(),
  assessment: z.string(),
  plan: z.string(),
  aiGenerated: z.literal(true),
  requiresReview: z.literal(true),
});
export type LLMSoapResponse = z.infer<typeof LLMSoapResponseSchema>;

// Medical-grade ambient note response (3-pass pipeline + enhancements)
export interface AmbientNoteResult {
  transcript: string;
  diarizedTranscript?: string;
  extractedFacts?: {
    subjective: string[];
    objective: string[];
    assessment: string[];
    plan: string[];
    risk: string[];
    medications: string[];
    quotes: string[];
    mse?: Record<string, string>;
  };
  structured: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
  };
  mentalStateExam?: {
    appearance: string;
    behaviour: string;
    speech: string;
    mood: string;
    affect: string;
    thoughtForm: string;
    thoughtContent: string;
    perception: string;
    cognition: string;
    insight: string;
    judgement: string;
  };
  riskFlags: string[];
  suggestedDiagnosis: string[];
  medications?: Array<{
    name: string;
    dose?: string;
    frequency?: string;
    change?: 'started' | 'increased' | 'decreased' | 'ceased' | 'continued' | 'mentioned';
  }>;
  summary: string;
  durationSeconds: number;
  model: string;
  format: string;
  pipeline?: 'medical-grade' | 'two-pass';
  pass1DurationMs?: number;
  pass2DurationMs?: number;
  pass3DurationMs?: number;
  transcriptionDurationMs?: number;

  // Medical-grade additions
  verifiedMedications?: VerifiedMedication[];
  riskAssessment?: RiskAssessmentResult;
  safetyAlerts?: SafetyAlert[];
  quality?: QualityMetrics;

  // Enhanced scribe features
  citedFacts?: CitedFact[];
  icd10Suggestions?: ICD10Suggestion[];
  mbsSuggestions?: MBSSuggestion[];
  outcomeMeasures?: ExtractedOutcomeMeasure[];
  scribeActions?: ScribeAction[];
  questScore?: QUESTScore;
  specialty?: string;

  // Interpreter/multilingual support
  interpreterUsed?: boolean;
  interpreterLanguage?: string;
  bilingualTranscript?: string;
}

export interface VerifiedMedication {
  name: string;
  dose?: string;
  doseValue?: number;
  frequency?: string;
  route?: string;
  change: 'continued' | 'started' | 'increased' | 'decreased' | 'ceased' | 'mentioned';
  isS8: boolean;
  doseInRange: boolean | null;
  monitoringRequired?: string;
  safetyNote?: string;
}

export interface RiskAssessmentResult {
  overallLevel: 'low' | 'medium' | 'high' | 'critical';
  flags: Array<{ flag: string; severity: string; evidence: string; action: string }>;
  protectiveFactors: string[];
}

export interface SafetyAlert {
  type: 'dose_range' | 'interaction' | 'allergy' | 'risk' | 'monitoring';
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface QualityMetrics {
  overallConfidence: number;
  sectionsWithEvidence: number;
  sectionsTotal: number;
  transcriptWordCount: number;
  directQuotesCount: number;
  notAssessedDomains: string[];
}

export interface CitedFact {
  tag: string;
  text: string;
  transcriptOffset: number;
  transcriptSnippet: string;
  confidence: number;
}

export interface ICD10Suggestion {
  code: string;
  description: string;
  confidence: 'high' | 'moderate' | 'low';
  source: string;
}

export interface MBSSuggestion {
  itemNumber: string;
  description: string;
  fee: string;
  criteria: string;
}

export interface ExtractedOutcomeMeasure {
  instrument: string;
  score: number;
  maxScore: number;
  severity: string;
  evidence: string;
}

export interface ScribeAction {
  type: 'referral' | 'appointment' | 'prescription' | 'pathology' | 'task' | 'alert';
  description: string;
  details: Record<string, string>;
  autoCreateable: boolean;
}

export interface QUESTScore {
  overall: number;
  dimensions: {
    completeness: number;
    accuracy: number;
    safety: number;
    clarity: number;
    actionability: number;
  };
  issues: string[];
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface ScribePreferences {
  noteFormat: 'soap' | 'mse' | 'progress' | 'intake' | 'all';
  pronouns: 'third_person' | 'first_person';
  bulletPoints: boolean;
  includeTimestamps: boolean;
  includeDirectQuotes: boolean;
  verbosity: 'concise' | 'standard' | 'detailed';
  specialty: string;
  customInstructions: string;
  macros: Record<string, string>;
}
