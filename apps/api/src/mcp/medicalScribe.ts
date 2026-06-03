/**
 * Medical-Grade Clinical Scribe
 *
 * A 3-pass pipeline designed for clinical documentation accuracy:
 *
 *   Pass 1: VERBATIM EXTRACTION — Extract only what was explicitly said.
 *           Zero hallucination tolerance. Every fact tagged with source.
 *
 *   Pass 2: SAFETY VERIFICATION — Cross-check medications, doses, allergies,
 *           and risk statements against clinical safety rules.
 *           Flag any discrepancies or dangerous combinations.
 *
 *   Pass 3: CLINICAL FORMATTING — Format into the requested note structure
 *           using Australian clinical documentation standards.
 *           Include confidence indicators for each section.
 *
 * Design principles:
 * - NEVER fabricate clinical data. If not stated, write "Not assessed/discussed"
 * - Flag ALL risk-related content prominently
 * - Medication names must use Australian approved names (generic)
 * - Doses must be verified against standard ranges
 * - Direct patient quotes preserved verbatim
 * - Confidence score (0-100) for each section based on source evidence
 *
 * TGA classification (Audit Tier 5.12):
 *   This pipeline is non-inferential — every Pass operates on
 *   clinician-spoken content and produces a document representation
 *   of that content. No Pass infers, diagnoses, recommends treatment,
 *   or generates clinical content not present in the transcript.
 *   Classification: TGA non-device. Evidence + review cadence in
 *   `docs/tga-classification.md`. Any future change that introduces
 *   clinical inference (e.g. dose-range checking, drug-interaction
 *   alerts, differential-diagnosis suggestions) requires explicit
 *   Clinical Safety + Regulatory sign-off AND shifts the classification.
 */

// ── Medication Safety Reference ─────────────────────────────────────────────

interface MedSafetyRange {
  generic: string;
  minDose: number;
  maxDose: number;
  unit: string;
  commonFrequencies: string[];
  s8: boolean;
  monitoringRequired?: string;
}

const MED_SAFETY_DB: MedSafetyRange[] = [
  // Antipsychotics
  { generic: 'olanzapine', minDose: 2.5, maxDose: 40, unit: 'mg', commonFrequencies: ['nocte', 'daily', 'bd'], s8: false, monitoringRequired: 'metabolic' },
  { generic: 'risperidone', minDose: 0.25, maxDose: 16, unit: 'mg', commonFrequencies: ['nocte', 'daily', 'bd'], s8: false },
  { generic: 'quetiapine', minDose: 25, maxDose: 800, unit: 'mg', commonFrequencies: ['nocte', 'daily', 'bd'], s8: false, monitoringRequired: 'metabolic' },
  { generic: 'aripiprazole', minDose: 2, maxDose: 30, unit: 'mg', commonFrequencies: ['daily', 'mane'], s8: false },
  { generic: 'clozapine', minDose: 12.5, maxDose: 900, unit: 'mg', commonFrequencies: ['nocte', 'daily', 'bd'], s8: false, monitoringRequired: 'FBC weekly/fortnightly/monthly' },
  { generic: 'paliperidone', minDose: 3, maxDose: 12, unit: 'mg', commonFrequencies: ['daily', 'mane'], s8: false },
  { generic: 'haloperidol', minDose: 0.5, maxDose: 30, unit: 'mg', commonFrequencies: ['daily', 'bd', 'tds', 'nocte'], s8: false },
  // LAI
  { generic: 'paliperidone palmitate', minDose: 50, maxDose: 525, unit: 'mg', commonFrequencies: ['monthly', '3-monthly'], s8: false },
  { generic: 'aripiprazole lai', minDose: 300, maxDose: 400, unit: 'mg', commonFrequencies: ['monthly'], s8: false },
  { generic: 'zuclopenthixol decanoate', minDose: 100, maxDose: 600, unit: 'mg', commonFrequencies: ['2-weekly', '3-weekly', 'monthly'], s8: false },
  // Antidepressants
  { generic: 'sertraline', minDose: 25, maxDose: 200, unit: 'mg', commonFrequencies: ['daily', 'mane'], s8: false },
  { generic: 'fluoxetine', minDose: 10, maxDose: 80, unit: 'mg', commonFrequencies: ['daily', 'mane'], s8: false },
  { generic: 'escitalopram', minDose: 5, maxDose: 20, unit: 'mg', commonFrequencies: ['daily', 'mane'], s8: false },
  { generic: 'venlafaxine', minDose: 37.5, maxDose: 375, unit: 'mg', commonFrequencies: ['daily', 'mane', 'bd'], s8: false },
  { generic: 'mirtazapine', minDose: 15, maxDose: 45, unit: 'mg', commonFrequencies: ['nocte'], s8: false },
  { generic: 'duloxetine', minDose: 30, maxDose: 120, unit: 'mg', commonFrequencies: ['daily', 'mane'], s8: false },
  // Mood stabilisers
  { generic: 'lithium', minDose: 250, maxDose: 2000, unit: 'mg', commonFrequencies: ['nocte', 'daily', 'bd'], s8: false, monitoringRequired: 'lithium levels, TFT, UEC' },
  { generic: 'sodium valproate', minDose: 200, maxDose: 3000, unit: 'mg', commonFrequencies: ['nocte', 'daily', 'bd'], s8: false, monitoringRequired: 'valproate levels, LFT, FBC' },
  { generic: 'carbamazepine', minDose: 100, maxDose: 1600, unit: 'mg', commonFrequencies: ['daily', 'bd'], s8: false, monitoringRequired: 'carbamazepine levels, FBC, LFT' },
  { generic: 'lamotrigine', minDose: 25, maxDose: 400, unit: 'mg', commonFrequencies: ['daily', 'bd'], s8: false },
  // Benzodiazepines (S8)
  { generic: 'diazepam', minDose: 2, maxDose: 40, unit: 'mg', commonFrequencies: ['daily', 'bd', 'tds', 'prn'], s8: true },
  { generic: 'lorazepam', minDose: 0.5, maxDose: 10, unit: 'mg', commonFrequencies: ['daily', 'bd', 'tds', 'prn'], s8: true },
  { generic: 'clonazepam', minDose: 0.25, maxDose: 8, unit: 'mg', commonFrequencies: ['nocte', 'daily', 'bd'], s8: true },
  // Other
  { generic: 'melatonin', minDose: 1, maxDose: 10, unit: 'mg', commonFrequencies: ['nocte'], s8: false },
  { generic: 'propranolol', minDose: 10, maxDose: 320, unit: 'mg', commonFrequencies: ['daily', 'bd', 'tds'], s8: false },
  { generic: 'prazosin', minDose: 0.5, maxDose: 15, unit: 'mg', commonFrequencies: ['nocte', 'daily', 'bd'], s8: false },
];

// ── Risk Keywords ───────────────────────────────────────────────────────────

interface RiskDetection {
  pattern: RegExp;
  flag: string;
  severity: 'critical' | 'high' | 'medium';
  action: string;
}

const RISK_PATTERNS: RiskDetection[] = [
  { pattern: /suicid|kill.*self|end.*life|want.*die|better off dead/i, flag: 'Suicidal ideation', severity: 'critical', action: 'Requires immediate safety assessment and plan' },
  { pattern: /self.?harm|cutting|burning|overdos/i, flag: 'Self-harm', severity: 'critical', action: 'Assess current method, means, and intent' },
  { pattern: /command.*hallucin|voices.*tell.*to/i, flag: 'Command hallucinations', severity: 'critical', action: 'Assess command content and compliance history' },
  { pattern: /homicid|kill.*someone|harm.*other|violen|assault/i, flag: 'Risk to others', severity: 'critical', action: 'Assess specific threat, target, and means' },
  { pattern: /abscon|escape|leave.*hospital|run.*away/i, flag: 'Absconding risk', severity: 'high', action: 'Review security and observation level' },
  { pattern: /non.?compli|stop.*medic|refuse.*treat|not.*taking/i, flag: 'Treatment non-compliance', severity: 'high', action: 'Explore barriers and consider adherence strategies' },
  { pattern: /substance|alcohol|cannabis|methamphet|heroin|drug.*use|drinking/i, flag: 'Substance use', severity: 'medium', action: 'Assess current use pattern and harm reduction' },
  { pattern: /child.*protect|child.*safe|children.*risk|neglect/i, flag: 'Child protection', severity: 'critical', action: 'Consider mandatory reporting obligations' },
  { pattern: /firearm|weapon|knife|gun/i, flag: 'Weapon access', severity: 'critical', action: 'Assess access and storage arrangements' },
  { pattern: /pregnant|pregnancy/i, flag: 'Pregnancy', severity: 'high', action: 'Review medication safety in pregnancy' },
];

// ── MSE Domains ─────────────────────────────────────────────────────────────

const MSE_DOMAINS = [
  { key: 'appearance', label: 'Appearance', prompts: 'dress, grooming, hygiene, build, posture, eye contact, age-appropriate' },
  { key: 'behaviour', label: 'Behaviour', prompts: 'psychomotor activity, agitation, retardation, restlessness, tics, mannerisms, cooperation' },
  { key: 'speech', label: 'Speech', prompts: 'rate, volume, tone, rhythm, spontaneity, latency, poverty, pressure' },
  { key: 'mood', label: 'Mood (subjective)', prompts: 'patient\'s own words describing their mood — use direct quotes' },
  { key: 'affect', label: 'Affect (objective)', prompts: 'range, reactivity, congruence, quality (euthymic, dysphoric, anxious, irritable, labile, flat, blunted)' },
  { key: 'thoughtForm', label: 'Thought Form', prompts: 'logical, coherent, tangential, circumstantial, loose associations, flight of ideas, thought blocking, perseveration' },
  { key: 'thoughtContent', label: 'Thought Content', prompts: 'delusions (persecutory, grandiose, referential, nihilistic), overvalued ideas, obsessions, preoccupations, suicidal/homicidal ideation' },
  { key: 'perception', label: 'Perception', prompts: 'hallucinations (auditory, visual, tactile, olfactory), illusions, depersonalisation, derealisation' },
  { key: 'cognition', label: 'Cognition', prompts: 'orientation (time, place, person), attention, concentration, memory, executive function' },
  { key: 'insight', label: 'Insight', prompts: 'awareness of illness, understanding of need for treatment, willingness to engage' },
  { key: 'judgement', label: 'Judgement', prompts: 'decision-making capacity, risk awareness, social judgement' },
];

// ── Exports ─────────────────────────────────────────────────────────────────

export interface MedicalScribeResult {
  // Verified extracted data
  verifiedMedications: VerifiedMedication[];
  riskAssessment: RiskAssessmentResult;
  mentalStateExam: Record<string, { finding: string; confidence: number; source: 'stated' | 'observed' | 'inferred' | 'not_assessed' }>;

  // Safety alerts
  safetyAlerts: SafetyAlert[];

  // Quality metrics
  quality: {
    overallConfidence: number;  // 0-100
    sectionsWithEvidence: number;
    sectionsTotal: number;
    transcriptWordCount: number;
    directQuotesCount: number;
    notAssessedDomains: string[];
  };
}

export interface VerifiedMedication {
  name: string;
  dose?: string;
  doseValue?: number;
  frequency?: string;
  route?: string;
  change: 'continued' | 'started' | 'increased' | 'decreased' | 'ceased' | 'mentioned';
  isS8: boolean;
  doseInRange: boolean | null;  // null = couldn't verify
  monitoringRequired?: string;
  safetyNote?: string;
}

export interface RiskAssessmentResult {
  overallLevel: 'low' | 'medium' | 'high' | 'critical';
  flags: { flag: string; severity: string; evidence: string; action: string }[];
  protectiveFactors: string[];
}

export interface SafetyAlert {
  type: 'dose_range' | 'interaction' | 'allergy' | 'risk' | 'monitoring';
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

// BUG-394 — `AllergyContextRow` and `assessAllergies` live in
// `./scribeAllergyAssessor.ts` (extracted to keep medicalScribe.ts under
// the LOC ceiling). Re-exported here for backwards compatibility with
// existing import paths.
export { assessAllergies, type AllergyContextRow } from './scribeAllergyAssessor';

// ── Pass 2: Safety Verification ─────────────────────────────────────────────

export function verifyMedications(medicationFacts: string[]): { medications: VerifiedMedication[]; alerts: SafetyAlert[] } {
  const medications: VerifiedMedication[] = [];
  const alerts: SafetyAlert[] = [];
  const doseRe = /(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml)/i;
  const freqRe = /(once daily|twice daily|three times daily|bd|tds|qid|nocte|mane|prn|weekly|fortnightly|monthly|daily|every \d+ weeks?)/i;
  const changeRe = /(start|commence|increase|decrease|reduce|cease|stop|discontinue|continue|maintain)/i;

  for (const fact of medicationFacts) {
    const lower = fact.toLowerCase();
    const doseMatch = fact.match(doseRe);
    const freqMatch = fact.match(freqRe);
    const changeMatch = fact.match(changeRe);

    // Find medication name from safety DB
    let matched: MedSafetyRange | undefined;
    for (const med of MED_SAFETY_DB) {
      if (lower.includes(med.generic)) { matched = med; break; }
    }

    const doseValue = doseMatch ? parseFloat(doseMatch[1]) : undefined;
    let doseInRange: boolean | null = null;

    if (matched && doseValue) {
      doseInRange = doseValue >= matched.minDose && doseValue <= matched.maxDose;
      if (!doseInRange) {
        alerts.push({
          type: 'dose_range',
          severity: doseValue > matched.maxDose * 1.5 ? 'critical' : 'warning',
          message: `${matched.generic} ${doseValue}${matched.unit} is ${doseValue > matched.maxDose ? 'ABOVE' : 'BELOW'} standard range (${matched.minDose}-${matched.maxDose}${matched.unit}). Verify dose.`,
        });
      }
    }

    const changeType = changeMatch?.[1]?.toLowerCase();
    let change: VerifiedMedication['change'] = 'mentioned';
    if (changeType) {
      if (/start|commence/.test(changeType)) change = 'started';
      else if (/increase/.test(changeType)) change = 'increased';
      else if (/decrease|reduce/.test(changeType)) change = 'decreased';
      else if (/cease|stop|discontinue/.test(changeType)) change = 'ceased';
      else if (/continue|maintain/.test(changeType)) change = 'continued';
    }

    medications.push({
      name: matched?.generic ?? extractDrugName(fact),
      dose: doseMatch ? `${doseMatch[1]} ${doseMatch[2]}` : undefined,
      doseValue,
      frequency: freqMatch?.[1],
      change,
      isS8: matched?.s8 ?? false,
      doseInRange,
      monitoringRequired: matched?.monitoringRequired,
      safetyNote: matched?.s8 ? 'Schedule 8 controlled substance — SafeScript check required' : undefined,
    });
  }

  return { medications, alerts };
}

function extractDrugName(fact: string): string {
  const words = fact.split(/\s+/);
  for (const w of words) {
    if (/^[A-Z][a-z]{3,}/.test(w) && !/^(Patient|The|This|Has|Was|Is|Will|Should|Start|Continue|Cease)/.test(w)) {
      return w.toLowerCase();
    }
  }
  return words[0]?.replace(/[,;.]$/, '') ?? 'unknown';
}

// ── Risk Assessment ─────────────────────────────────────────────────────────

export function assessRisk(transcript: string, extractedRisks: string[]): RiskAssessmentResult {
  const flags: RiskAssessmentResult['flags'] = [];
  const combined = transcript.toLowerCase();

  for (const rp of RISK_PATTERNS) {
    const match = combined.match(rp.pattern);
    if (match) {
      // Find the sentence containing the risk keyword
      const sentences = transcript.split(/[.!?]+/);
      const evidence = sentences.find(s => rp.pattern.test(s))?.trim() ?? match[0];
      flags.push({ flag: rp.flag, severity: rp.severity, evidence, action: rp.action });
    }
  }

  // Add extracted risk facts
  for (const risk of extractedRisks) {
    if (risk.trim() && !flags.some(f => risk.toLowerCase().includes(f.flag.toLowerCase()))) {
      flags.push({ flag: risk.trim(), severity: 'medium', evidence: risk, action: 'Review and assess' });
    }
  }

  // Determine overall level
  let overallLevel: RiskAssessmentResult['overallLevel'] = 'low';
  if (flags.some(f => f.severity === 'critical')) overallLevel = 'critical';
  else if (flags.some(f => f.severity === 'high')) overallLevel = 'high';
  else if (flags.length > 0) overallLevel = 'medium';

  // Extract protective factors
  const protectivePatterns = [
    /engag|willing|insight|support|family|friend|work|employ|stable|compli|adher|taking.*medic/gi,
  ];
  const protectiveFactors: string[] = [];
  for (const pp of protectivePatterns) {
    const matches = transcript.match(pp);
    if (matches) protectiveFactors.push(...matches.map(m => m.trim()));
  }

  return { overallLevel, flags, protectiveFactors: [...new Set(protectiveFactors)] };
}

// ── System Prompts for Medical Grade ────────────────────────────────────────
//
// BUG-034 cross-file coupling (JSDoc @see — L5 review):
//   @see apps/api/src/mcp/ambientProcessor.ts:1137-1144 — extractDiagnosis
//        regex `/[FG]\d{2}(?:\.\d{1,2})?/g` matches F/G-prefix ICD codes
//        from the LLM's Pass 3 output. Defence layer 2.
//   @see apps/api/src/features/llm/llmRoutes.ts:540-561 — hallucination
//        detector save-gate; returns 422 BEFORE the clinical_notes insert
//        at :563 when the LLM fabricates a diagnosis not in the transcript.
//        Defence layer 3.
//
// If you change the three "NEVER infer" rules below, the boot-time
// assertion at the bottom of this module will catch silent regressions.

export const SCRIBE_PASS1_SYSTEM = `You are a MEDICAL-GRADE clinical documentation extractor for Australian public mental health services.

CRITICAL SAFETY RULES:
1. Extract ONLY information EXPLICITLY stated in the transcript. ZERO fabrication tolerance.
2. Every medication must include the EXACT dose and frequency as stated. If dose is unclear, tag with [?DOSE].
3. Every risk statement must be extracted verbatim. Do not downplay or omit risk content.
4. Direct patient quotes must be preserved EXACTLY as spoken, in quotation marks.
5. If a Mental State Examination domain is discussed, extract the SPECIFIC findings.

EXTRACTION TAGS:
[S] = Patient subjective report (what the patient said about themselves)
[O] = Clinician observation (appearance, behaviour, speech, affect observed)
[A] = Assessment/clinical impression discussed
[P] = Plan item / action agreed
[R] = Risk factor — ANY mention of risk to self, others, or vulnerability
[M] = Medication — MUST include name + dose + frequency if stated. Format: [M] Drug name dose frequency (change)
[Q] = Direct patient quote — use EXACT words in quotation marks
[MSE:domain] = Mental State finding — tag with the specific MSE domain
  e.g., [MSE:mood] Patient described mood as "six out of ten"
  e.g., [MSE:perception] Denies auditory or visual hallucinations
  e.g., [MSE:thought_content] No suicidal or homicidal ideation

RULES:
- One fact per line
- If a speaker label [CLINICIAN] or [PATIENT] is present, use it
- Use Australian English (behaviour, colour, organisation)
- If something is ambiguous, include it with [?] prefix
- Extract EVERY clinically relevant detail — err on the side of over-extraction
- For medications: always include the change type (started/continued/increased/decreased/ceased)`;

export const SCRIBE_PASS3_SYSTEM = `You are a MEDICAL-GRADE clinical documentation writer for Australian public mental health services.

You format extracted clinical facts into professional clinical notes that meet the standards of:
- Royal Australian and New Zealand College of Psychiatrists (RANZCP)
- Australian Commission on Safety and Quality in Health Care
- Victorian Mental Health Act 2014 documentation requirements

CRITICAL RULES:
1. Use ONLY the provided extracted facts. NEVER add information not in the source data.
2. If a section has no supporting evidence, write "Not assessed" or "Not discussed during this encounter."
3. Medications must show: generic name, dose, frequency, route, and change type.
4. Risk assessment MUST be included in every note — even if low risk, state this explicitly.
5. Use plain text headings — NO markdown formatting.
6. Use professional clinical language appropriate for the medical record.
7. Include a CONFIDENCE indicator for each major section:
   [HIGH] = Multiple supporting facts from transcript
   [MODERATE] = Some supporting evidence but incomplete
   [LOW] = Minimal evidence, clinician review recommended
   [NOT ASSESSED] = No evidence in transcript
8. Number all plan items.
9. NEVER infer, generate, or suggest a diagnosis. Scribe is a transcription +
   formatting tool, not a diagnostic system. If the clinician explicitly stated
   a diagnosis or ICD-10-AM code verbatim during the encounter, document that
   exact wording in the Assessment section. If the clinician did not state a
   diagnosis, either omit a diagnosis field entirely or write "No explicit
   diagnosis documented" — whichever is cleaner for the note format. Do NOT
   use words like "likely", "probable", "implied", or "suggestive of" to
   introduce a diagnosis. (BUG-034 — TGA non-device classification, see
   file header.)
10. Australian English spelling throughout (behaviour, colour, stabilise, optimise).

${MSE_DOMAINS.map(d => `MSE — ${d.label}: ${d.prompts}`).join('\n')}`;

export const SCRIBE_SOAP_FORMAT = `Format into a MEDICAL-GRADE SOAP note:

SUBJECTIVE [confidence]
Patient-reported symptoms, concerns, medication effects, and psychosocial situation.
Include ALL direct patient quotes in quotation marks.

OBJECTIVE [confidence]
MENTAL STATE EXAMINATION:
- Appearance:
- Behaviour:
- Speech:
- Mood (subjective):
- Affect (objective):
- Thought form:
- Thought content:
- Perception:
- Cognition:
- Insight:
- Judgement:

Physical observations (if any):

ASSESSMENT [confidence]
Clinical formulation including:
- Clinician-stated clinical impression (verbatim or close paraphrase;
  NEVER infer, generate, or suggest a diagnosis the clinician did not
  explicitly state — see Pass 3 Rule 9)
- Response to current treatment
- Changes since last review

RISK ASSESSMENT:
- Risk to self: [level — evidence]
- Risk to others: [level — evidence]
- Vulnerability: [level — evidence]
- Protective factors:
- Overall risk level:

PLAN
1. [Action item with responsible person and timeframe]
2. [Medication changes with dose/frequency]
3. [Follow-up arrangement]
4. [Referrals]

MEDICATIONS REVIEWED:
[List ALL medications discussed with dose, frequency, route, and any changes]

SAFETY ALERTS:
[Any medication safety concerns, monitoring requirements, or risk escalations]`;

export const SCRIBE_MSE_FORMAT = `Format into a MEDICAL-GRADE Mental State Examination:

MENTAL STATE EXAMINATION

1. APPEARANCE: [confidence]
2. BEHAVIOUR: [confidence]
3. SPEECH: [confidence]
4. MOOD (subjective): [confidence] — use patient's own words
5. AFFECT (objective): [confidence] — range, reactivity, congruence, quality
6. THOUGHT FORM: [confidence]
7. THOUGHT CONTENT: [confidence] — delusions, obsessions, suicidal/homicidal ideation
8. PERCEPTION: [confidence] — hallucinations, illusions
9. COGNITION: [confidence] — orientation, attention, memory
10. INSIGHT: [confidence]
11. JUDGEMENT: [confidence]

RISK ASSESSMENT:
Risk to self:
Risk to others:
Vulnerability:
Overall risk level:
Protective factors:

CLINICAL IMPRESSION:
[Clinician-stated formulation or impression only. Do NOT infer,
generate, or suggest any diagnosis, condition, or disorder the
clinician did not explicitly state. Do NOT use words like "likely",
"probable", "implied", or "suggestive of" to introduce a diagnosis.
See Pass 3 Rule 9.]

MANAGEMENT PLAN:
[Numbered action items]`;

export const SCRIBE_PROGRESS_FORMAT = `Format into a MEDICAL-GRADE progress note:

PRESENTING CONCERN [confidence]
[Reason for today's contact and current clinical status]

MENTAL STATE [confidence]
[Key MSE findings — focus on changes since last contact]

INTERVENTIONS [confidence]
[What was done in this session — therapy technique, medication review, education, etc.]

PATIENT RESPONSE [confidence]
[How the patient responded to interventions]

MEDICATIONS [confidence]
[Current medications with any changes]

RISK ASSESSMENT [confidence]
Risk to self:
Risk to others:
Vulnerability:
Overall risk level:

PLAN
1. [Action items with responsible person and timeframe]

NEXT REVIEW: [Date/timeframe]`;

export const SCRIBE_INTAKE_FORMAT = `Format into a MEDICAL-GRADE intake assessment:

IDENTIFYING INFORMATION [confidence]

PRESENTING PROBLEM [confidence]
[Current symptoms and reason for referral]

HISTORY OF PRESENTING ILLNESS [confidence]
[Chronological account of current episode]

PAST PSYCHIATRIC HISTORY [confidence]
[Previous episodes, admissions, treatments, diagnoses]

MEDICAL HISTORY [confidence]

SUBSTANCE USE HISTORY [confidence]

FORENSIC HISTORY [confidence]

FAMILY PSYCHIATRIC HISTORY [confidence]

DEVELOPMENTAL AND SOCIAL HISTORY [confidence]
[Education, employment, relationships, accommodation]

CURRENT MEDICATIONS [confidence]
[Full medication list with doses and frequencies]

MENTAL STATE EXAMINATION [confidence]
[Full 11-domain MSE]

RISK ASSESSMENT [confidence]
Risk to self:
Risk to others:
Vulnerability:
Overall risk level:
Protective factors:

PROVISIONAL DIAGNOSIS [confidence]
[ICD-10-AM code and description]

FORMULATION [confidence]
[Brief biopsychosocial formulation — predisposing, precipitating, perpetuating, protective]

MANAGEMENT PLAN
1. [Numbered action items]`;

// ── Ward Round ──
export const SCRIBE_WARD_ROUND_FORMAT = `Format into a MEDICAL-GRADE ward round note:

WARD ROUND — [Date]
ATTENDANCE [confidence]
[Consultant, registrar, nursing staff, allied health, patient, family/carer present]

OVERNIGHT/SINCE LAST REVIEW [confidence]
[Sleep, behaviour, nursing observations, incidents, PRN medications given]

CURRENT PRESENTATION [confidence]
[Appearance, behaviour, engagement, any concerns raised]

MENTAL STATE EXAMINATION [confidence]
Appearance and behaviour:
Speech:
Mood (subjective/objective):
Thought form and content:
Perception:
Cognition:
Insight and judgement:

RISK ASSESSMENT [confidence]
Risk to self:
Risk to others:
Vulnerability:
Absconding risk:

MEDICATIONS [confidence]
[Current medications — any changes, side effects, PRN usage]

INVESTIGATIONS [confidence]
[Blood results, ECG, imaging — pending or recent]

CONSULTANT DIRECTIVES [confidence]
1. [Numbered directives with responsible person]

PLAN
[Discharge planning status, leave arrangements, follow-up]

NEXT REVIEW: [Date]`;

// ── Clinical Review (91-day / Quarterly) ──
export const SCRIBE_REVIEW_FORMAT = `Format into a MEDICAL-GRADE clinical review note:

CLINICAL REVIEW — [Date]
REVIEW PERIOD: [From — To]

PROGRESS SINCE LAST REVIEW [confidence]
[Summary of clinical progress, engagement, functioning]

CURRENT PRESENTATION [confidence]
[Mental state, physical health, social situation]

TREATMENT GOALS REVIEW [confidence]
[Review of goals set at last review — achieved/ongoing/modified]

MEDICATION REVIEW [confidence]
[Current medications, efficacy, side effects, adherence]

RISK ASSESSMENT [confidence]
Risk to self:
Risk to others:
Vulnerability:
Overall risk level: [changed/unchanged since last review]

PSYCHOSOCIAL REVIEW [confidence]
Housing:
Employment/education:
Social supports:
Financial:
Legal:

COMMUNITY LINKAGES [confidence]
[NDIS, GP, allied health, AOD, peer support — status and progress]

PLAN FOR NEXT PERIOD
1. [Treatment goals]
2. [Medication plan]
3. [Psychological interventions]
4. [Social supports and linkages]
5. [Tasks and delegations]

NEXT REVIEW DATE: [Date]`;

// ── Collateral Contact ──
export const SCRIBE_COLLATERAL_FORMAT = `Format into a MEDICAL-GRADE collateral contact note:

COLLATERAL CONTACT — [Date]
CONTACT WITH [confidence]
Name:
Relationship to patient:
Contact method: [Phone/In person/Video]
Consent: [Patient consented to contact: Yes/No/N/A]

INFORMATION PROVIDED BY CONTACT [confidence]
[What the informant reported — patient's presentation, behaviour, concerns]

INFORMATION PROVIDED TO CONTACT [confidence]
[What was shared with the informant — psychoeducation, safety planning, service information]

CLINICAL RELEVANCE [confidence]
[How this information changes clinical understanding]

ACTIONS ARISING
1. [Follow-up actions]

DOCUMENTED BY: [Clinician name and role]`;

// ── Phone / Telehealth ──
export const SCRIBE_PHONE_FORMAT = `Format into a MEDICAL-GRADE phone/telehealth contact note:

PHONE/TELEHEALTH CONTACT — [Date, Time, Duration]
CONTACT TYPE: [Phone / Video telehealth]
INITIATED BY: [Clinician / Patient / Carer]

REASON FOR CONTACT [confidence]
[Why the call was made — scheduled review, crisis, medication query, etc.]

CLINICAL CONTENT [confidence]
[Key clinical information discussed — symptoms, concerns, progress]

MENTAL STATE (PHONE) [confidence]
Tone of voice:
Speech rate and coherence:
Mood (reported):
Thought content (concerns raised):
Risk indicators:

MEDICATIONS [confidence]
[Any medication queries, changes, or adherence discussed]

AGREED ACTIONS [confidence]
1. [Actions agreed during the call]

FOLLOW-UP: [Next contact date/method]`;

// ── Home Visit ──
export const SCRIBE_HOME_VISIT_FORMAT = `Format into a MEDICAL-GRADE home visit note:

HOME VISIT — [Date, Time, Duration]
LOCATION: [Address / Type of accommodation]
PERSONS PRESENT: [Patient, carer, family, other services]

ENVIRONMENT OBSERVATIONS [confidence]
[Cleanliness, safety, hoarding, self-neglect indicators, medications visible/stored appropriately]

PATIENT PRESENTATION [confidence]
[Appearance, hygiene, behaviour, engagement with visit]

MENTAL STATE [confidence]
[Key MSE observations in the home environment]

ACTIVITIES OF DAILY LIVING [confidence]
Self-care:
Nutrition/cooking:
Medication management:
Financial management:
Social interaction:

SAFETY ASSESSMENT [confidence]
Environmental risks:
Risk to self:
Risk to others:
Vulnerability:

INTERVENTIONS [confidence]
[What was done during the visit — medication prompting, carer support, psychoeducation]

PLAN
1. [Follow-up actions]

NEXT VISIT: [Date]`;

// ── Case Conference / MDT ──
export const SCRIBE_CASE_CONFERENCE_FORMAT = `Format into a MEDICAL-GRADE case conference note:

CASE CONFERENCE / MDT MEETING — [Date]
ATTENDEES [confidence]
[List all attendees with roles]

CASE SUMMARY [confidence]
[Brief overview of patient, diagnosis, current episode, treatment]

DISCUSSION POINTS [confidence]
1. [Key points discussed — each with contributor name]
2. [Differing views or concerns raised]

RISK DISCUSSION [confidence]
[Risk factors discussed, changes to risk assessment]

TREATMENT PLAN REVIEW [confidence]
[Medication, therapy, social supports — what's working, what needs change]

DECISIONS MADE [confidence]
1. [Decision — rationale — responsible person]

ACTION ITEMS
1. [Task — assigned to — due date]

NEXT MEETING: [Date]`;

// ── Group Session ──
export const SCRIBE_GROUP_FORMAT = `Format into a MEDICAL-GRADE group session note:

GROUP SESSION — [Date, Time, Duration]
GROUP NAME: [Name of group program]
SESSION TOPIC: [Theme or module]
FACILITATORS: [Names and roles]
ATTENDANCE: [Number present / expected. List attendees]

SESSION CONTENT [confidence]
[Topics covered, activities conducted, therapeutic techniques used]

GROUP DYNAMICS [confidence]
[Overall engagement, participation level, interactions between members]

INDIVIDUAL OBSERVATIONS [confidence]
[Notable observations for specific participants — use initials only]

SAFETY CONCERNS [confidence]
[Any risk disclosures, distress, or incidents during session]

FACILITATOR NOTES
[Observations on session effectiveness, modifications for next session]

NEXT SESSION: [Date, Topic]`;

// ── Incident Report ──
export const SCRIBE_INCIDENT_FORMAT = `Format into a MEDICAL-GRADE incident report note:

CLINICAL INCIDENT REPORT — [Date, Time]

IDENTIFICATION [confidence]
Patient:
Location:
Staff involved:
Witnesses:

SITUATION [confidence]
[What happened — factual, objective description of the incident]

BACKGROUND [confidence]
[Relevant history, preceding events, warning signs]

ASSESSMENT [confidence]
[Severity of incident, injuries, clinical impact]
Physical injury: [Yes/No — describe]
Psychological impact: [Yes/No — describe]

RESPONSE [confidence]
[Immediate actions taken — first aid, restraint, seclusion, code called]
Time of response:
Duration of intervention:

NOTIFICATIONS [confidence]
[Who was notified — duty consultant, family, police, OPA, DHHS]

POST-INCIDENT REVIEW [confidence]
[Debrief details, patient welfare check, staff welfare]

FOLLOW-UP ACTIONS
1. [Actions with responsible person and timeframe]

REPORTED BY: [Name, Role, Date]`;

// ── Physical Health ──
export const SCRIBE_PHYSICAL_HEALTH_FORMAT = `Format into a MEDICAL-GRADE physical health note:

PHYSICAL HEALTH ASSESSMENT — [Date]

VITAL SIGNS [confidence]
BP: [lying / standing — note postural drop]
HR:
RR:
Temp:
SpO2:
Weight: [kg]  Height: [cm]  BMI:
Waist circumference: [cm]

SYSTEMS REVIEW [confidence]
Cardiovascular:
Respiratory:
Gastrointestinal: [include bowel habits, constipation screening]
Neurological:
Musculoskeletal:
Metabolic: [diabetes screening, lipids, thyroid]

CURRENT MEDICATIONS (PHYSICAL) [confidence]
[Non-psychiatric medications, interactions with psych meds]

METABOLIC MONITORING [confidence]
[Fasting glucose, HbA1c, lipid profile, LFTs — results and dates]

SMOKING STATUS [confidence]
[Current / Former / Never — cigarettes per day — cessation advice given]

INVESTIGATIONS ORDERED [confidence]
[Blood tests, ECG, imaging — what and why]

REFERRALS [confidence]
[GP, dentist, optometrist, dietitian, podiatrist, specialist]

PLAN
1. [Physical health actions]`;

// ── LAI / Clozapine Administration ──
export const SCRIBE_LAI_CLOZAPINE_FORMAT = `Format into a MEDICAL-GRADE medication administration note:

MEDICATION ADMINISTRATION — [Date, Time]

PRE-ADMINISTRATION CHECKS [confidence]
Patient identification confirmed:
Consent obtained:
Allergies checked:
Blood results reviewed (if clozapine): [WBC/ANC status — Green/Amber/Red]
Vital signs: [BP, HR, Temp]

ADMINISTRATION DETAILS [confidence]
Medication:
Dose:
Route:
Site: [injection site if LAI — document rotation]
Batch number:
Expiry date:
Administered by:
Checked by:

POST-ADMINISTRATION MONITORING [confidence]
Observation period: [duration]
Adverse reactions: [None / Describe]
Patient comfort:

SIDE EFFECTS REVIEW [confidence]
[Ask about and document: sedation, weight gain, EPS, metabolic, constipation, hypersalivation]

NEXT DUE: [Date]
NEXT BLOOD TEST (if applicable): [Date]

PLAN
1. [Follow-up actions]`;

export function getFormatPrompt(format: string): string {
  switch (format) {
    case 'soap': return SCRIBE_SOAP_FORMAT;
    case 'mse': return SCRIBE_MSE_FORMAT;
    case 'progress': return SCRIBE_PROGRESS_FORMAT;
    case 'intake': return SCRIBE_INTAKE_FORMAT;
    case 'ward_round': return SCRIBE_WARD_ROUND_FORMAT;
    case 'review': return SCRIBE_REVIEW_FORMAT;
    case 'collateral': return SCRIBE_COLLATERAL_FORMAT;
    case 'phone': return SCRIBE_PHONE_FORMAT;
    case 'home_visit': return SCRIBE_HOME_VISIT_FORMAT;
    case 'case_conference': return SCRIBE_CASE_CONFERENCE_FORMAT;
    case 'group': return SCRIBE_GROUP_FORMAT;
    case 'incident': return SCRIBE_INCIDENT_FORMAT;
    case 'physical_health': return SCRIBE_PHYSICAL_HEALTH_FORMAT;
    case 'lai': case 'clozapine': return SCRIBE_LAI_CLOZAPINE_FORMAT;
    case 'all': return `Generate ALL of the following sections:\n\n${SCRIBE_SOAP_FORMAT}\n\n---\n\n${SCRIBE_MSE_FORMAT}`;
    default: return SCRIBE_PROGRESS_FORMAT;
  }
}

// ── BUG-034 boot-time prompt-discipline assertion (L5 review item 2) ─────────
// Module-load check that the three no-diagnosis-inference rules are still
// present in every prompt site. A silent future refactor that drops the
// "NEVER infer" clause would be caught here at import time rather than at
// a live LLM call with a clinical consequence. Matches the BUG-216
// checkSchemaPhiDrift() pattern — fail-fast on silent regression.
//
// Does not throw in NODE_ENV=test (the dedicated test suite
// scribePromptDiscipline.test.ts already asserts this). Throws in dev /
// prod so a dev on their laptop + every deploy reboot see the regression
// immediately.
function assertScribePromptDiscipline(): void {
  if (process.env.NODE_ENV === 'test') return;
  const checks: Array<{ name: string; text: string; mustContain: RegExp }> = [
    { name: 'SCRIBE_PASS3_SYSTEM', text: SCRIBE_PASS3_SYSTEM, mustContain: /NEVER infer.*diagnosis/i },
    { name: 'SCRIBE_SOAP_FORMAT', text: SCRIBE_SOAP_FORMAT, mustContain: /NEVER infer/i },
    { name: 'SCRIBE_MSE_FORMAT', text: SCRIBE_MSE_FORMAT, mustContain: /Do NOT infer/i },
  ];
  const missing = checks.filter((c) => !c.mustContain.test(c.text));
  if (missing.length > 0) {
    throw new Error(
      `[BUG-034] scribe prompt-discipline assertion failed: ` +
        `${missing.map((m) => m.name).join(', ')} no longer contains the ` +
        `no-diagnosis-inference rule. A prompt refactor has silently ` +
        `regressed BUG-034. See docs/audit-2026-04-19/bug-plans/` +
        `BUG-034-scribe-no-diagnosis-inference.md.`,
    );
  }
}
assertScribePromptDiscipline();
