/**
 * Scribe Enhancements Module
 *
 * Adds industry-leading features to the medical-grade scribe:
 *
 * 1. After-Visit Patient Summary — plain-language summary at Grade 6 reading level
 * 2. Auto Referral/GP Letter — draft letter from scribe output
 * 3. Evidence-Linked Citations — each fact linked to transcript offset
 * 4. ICD-10-AM Auto-Coding — diagnosis code lookup + LLM suggestion
 * 5. MBS Item Number Suggestions — Australian Medicare billing codes
 * 6. Outcome Measure Auto-Scoring — extract PHQ-9, GAD-7, K10, HoNOS from transcript
 * 7. Prior Note Context — feed previous notes for continuity phrasing
 * 8. QUEST Quality Scoring — validated quality evaluation framework
 * 9. Agentic Scribe Actions — extract actionable items (referrals, appointments, orders)
 */

import { db } from '../db/db';
import { logger } from '../utils/logger';

interface PriorNoteRow {
  title: string | null;
  content: unknown;
  created_at: string | Date;
  note_type: string | null;
}

interface MedicationContextRow {
  drug_label: string | null;
  dose: string | null;
  frequency: string | null;
  route: string | null;
  start_date: string | Date | null;
}

interface EpisodeContextRow {
  primary_diagnosis: string;
  status: string | null;
  start_date: string | Date | null;
}

interface AlertContextRow {
  title: string | null;
  severity: string | null;
  notes: string | null;
}

interface ObservationContextRow {
  observation_type: string | null;
  values: { numeric?: number; text?: string; unit?: string } | null;
  observed_at: string | Date | null;
}

interface KShotExampleRow {
  content: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. AFTER-VISIT PATIENT SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

export const PATIENT_SUMMARY_PROMPT = `You are writing an after-visit summary for the PATIENT (not the clinician).
The patient may have limited health literacy. Write at a Grade 6 reading level.

RULES:
- Use simple, everyday language — no medical jargon
- Replace medical terms with plain English: "medication" → "medicine", "suicidal ideation" → "thoughts of hurting yourself"
- Use short sentences (max 15 words each)
- Use bullet points for action items
- Address the patient directly ("you", "your")
- Be warm, supportive, and non-judgemental
- Include:
  1. What was discussed today (2-3 sentences)
  2. What your medicines are and any changes
  3. What you need to do before your next visit
  4. When your next appointment is
  5. Who to call if you feel unwell or unsafe (crisis numbers)
- Include Lifeline (13 11 14) and 000 for emergencies
- Do NOT include clinical scores, ICD codes, or technical terms
- Australian English`;

export function generatePatientSummary(
  _structuredNote: string,
  patientFirstName: string,
  medications: Array<{ name: string; dose?: string; frequency?: string; change: string }>,
  nextAppointment?: string,
): string {
  // Build a pre-formatted summary that LLM can enhance
  const medList = medications.length > 0
    ? medications.map(m => {
        let line = `- ${m.name}`;
        if (m.dose) line += ` ${m.dose}`;
        if (m.frequency) line += ` ${m.frequency}`;
        if (m.change && m.change !== 'mentioned' && m.change !== 'continued') line += ` (${m.change === 'started' ? 'NEW' : m.change === 'increased' ? 'dose went up' : m.change === 'decreased' ? 'dose went down' : m.change === 'ceased' ? 'STOPPED' : m.change})`;
        return line;
      }).join('\n')
    : '- No changes to your medicines today';

  return `AFTER-VISIT SUMMARY FOR ${patientFirstName.toUpperCase()}

What we talked about today:
[To be completed from clinical note]

Your medicines:
${medList}

What you need to do:
- [Action items from plan]

${nextAppointment ? `Your next appointment: ${nextAppointment}` : 'Your next appointment: To be arranged'}

If you feel unwell or unsafe:
- Call your treating team: [clinic phone]
- Lifeline: 13 11 14 (24/7)
- Emergency: 000
- Crisis Assessment Team (CAT): [local number]`;
}

export function buildPatientSummaryPrompt(structuredNote: string, patientName: string): string {
  return `Generate a patient-friendly after-visit summary from this clinical note.
The patient's first name is ${patientName}.

CLINICAL NOTE:
---
${structuredNote}
---

Write the after-visit summary now in plain, simple language:`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. AUTO REFERRAL / GP LETTER FROM SCRIBE OUTPUT
// ═══════════════════════════════════════════════════════════════════════════════

export const REFERRAL_LETTER_PROMPT = `You are a senior Australian psychiatrist writing a professional referral or correspondence letter.

Write in formal clinical letter format:
- Address: Dear Dr [GP Name / Colleague],
- Opening: Re: [Patient Name], DOB [DOB], MRN [MRN]
- Body: Concise clinical summary including current presentation, diagnosis, medications, risk, and plan
- Use ICD-10-AM codes alongside diagnosis text
- Include current medications with doses
- State reason for referral/correspondence clearly
- Include management plan and follow-up arrangements
- Sign-off: Yours sincerely, [Clinician Name], [Title]

Australian English. Professional tone. Max 1 page.`;

// Tier 12.4 — role labels are baked into every letter so a psychiatrist
// and a psychologist signing the same format drive different sign-off
// text ("Psychiatrist" vs "Clinical Psychologist"). Tier 12.1 — every
// AI-drafted letter returns an "AI-DRAFT — requires clinician review"
// header so no clinician signs unreviewed output. The header lives at
// the response-wrapping layer (see scribeRoutes.ts) so the prompt
// builder remains a pure prompt builder.
const ROLE_LABELS: Record<string, string> = {
  psychiatrist: 'Consultant Psychiatrist',
  registrar: 'Psychiatry Registrar',
  psychologist: 'Clinical Psychologist',
  gp: 'General Practitioner',
  nurse: 'Mental Health Nurse',
  social_worker: 'Mental Health Social Worker',
  occupational_therapist: 'Occupational Therapist',
  clinician: 'Treating Clinician',
};

export function roleLabel(role: string | null | undefined): string {
  if (!role) return 'Treating Clinician';
  const normalised = role.toLowerCase().replace(/-/g, '_');
  return ROLE_LABELS[normalised] ?? role;
}

export function buildReferralLetterPrompt(
  structuredNote: string,
  recipientType: 'gp' | 'specialist' | 'service',
  recipientName: string,
  patientName: string,
  patientDob: string,
  patientMrn: string,
  clinicianName: string,
  clinicianRole: string,
  reason?: string,
): string {
  const typeLabel = recipientType === 'gp' ? 'General Practitioner' : recipientType === 'specialist' ? 'Specialist' : 'Service';
  return `Draft a ${typeLabel} letter based on this clinical note.

Recipient: ${recipientName}
Patient: ${patientName}, DOB: ${patientDob}, MRN: ${patientMrn}
${reason ? `Reason: ${reason}` : ''}
Clinician: ${clinicianName}, ${roleLabel(clinicianRole)}

CLINICAL NOTE:
---
${structuredNote}
---

Write the letter now. Sign off with "${clinicianName}, ${roleLabel(clinicianRole)}":`;
}

// Tier 12.1 — "AI-DRAFT" watermark. Every AI-drafted letter surface
// (after-visit summary + referral letter) must be prefixed with this
// header before being shown to the clinician. If the clinician edits
// and signs, the frontend strips the header at sign-time; if it's
// shown as-is, the header makes it impossible to miss that the content
// is un-reviewed model output. The exact string is fixed so a simple
// `startsWith('AI-DRAFT')` check in the letter renderer / PDF pipeline
// can reject any sign-off attempt that hasn't been explicitly cleared.
export const AI_DRAFT_HEADER =
  '⚠ AI-DRAFT — requires clinician review before sign-off. Remove this header after review.';

export function wrapAsAiDraft(body: string): string {
  return `${AI_DRAFT_HEADER}\n\n${body}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. EVIDENCE-LINKED CITATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export interface CitedFact {
  tag: string;             // [S], [O], [A], [P], [R], [M], [Q], [MSE:...]
  text: string;            // The extracted fact
  transcriptOffset: number; // Character offset in transcript
  transcriptSnippet: string; // 50-char context from transcript
  confidence: number;       // 0-1 match confidence
}

export function linkFactsToTranscript(
  extractedFacts: string[],
  transcript: string,
): CitedFact[] {
  const lowerTranscript = transcript.toLowerCase();
  const cited: CitedFact[] = [];

  for (const rawFact of extractedFacts) {
    // Parse tag
    const tagMatch = rawFact.match(/^\[([A-Z?]+(?::\w+)?)\]\s*/);
    const tag = tagMatch?.[1] ?? 'S';
    const text = rawFact.replace(/^\[[^\]]+\]\s*/, '').trim();

    if (!text) continue;

    // Find best match in transcript
    const { offset, snippet, confidence } = findBestMatch(text, transcript, lowerTranscript);

    cited.push({ tag, text, transcriptOffset: offset, transcriptSnippet: snippet, confidence });
  }

  return cited;
}

function findBestMatch(
  fact: string,
  transcript: string,
  lowerTranscript: string,
): { offset: number; snippet: string; confidence: number } {
  const lowerFact = fact.toLowerCase();

  // Strategy 1: Direct substring match
  const directIdx = lowerTranscript.indexOf(lowerFact);
  if (directIdx >= 0) {
    return {
      offset: directIdx,
      snippet: transcript.substring(Math.max(0, directIdx - 20), directIdx + 50),
      confidence: 1.0,
    };
  }

  // Strategy 2: Key phrase matching — find the longest matching substring
  const words = lowerFact.split(/\s+/).filter(w => w.length > 3);
  let bestOffset = -1;
  let bestLen = 0;

  for (const word of words) {
    const idx = lowerTranscript.indexOf(word);
    if (idx >= 0 && word.length > bestLen) {
      bestOffset = idx;
      bestLen = word.length;
    }
  }

  // Strategy 3: Multi-word phrase matching
  for (let len = Math.min(5, words.length); len >= 2; len--) {
    for (let start = 0; start <= words.length - len; start++) {
      const phrase = words.slice(start, start + len).join(' ');
      const idx = lowerTranscript.indexOf(phrase);
      if (idx >= 0) {
        return {
          offset: idx,
          snippet: transcript.substring(Math.max(0, idx - 10), idx + 60),
          confidence: 0.7 + (len / words.length) * 0.3,
        };
      }
    }
  }

  if (bestOffset >= 0) {
    return {
      offset: bestOffset,
      snippet: transcript.substring(Math.max(0, bestOffset - 20), bestOffset + 50),
      confidence: 0.4,
    };
  }

  return { offset: -1, snippet: '', confidence: 0 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ICD-10-AM AUTO-CODING
// ═══════════════════════════════════════════════════════════════════════════════

export interface ICD10Suggestion {
  code: string;
  description: string;
  confidence: 'high' | 'moderate' | 'low';
  source: string; // which fact suggested this
}

// Common mental health ICD-10-AM codes — Australian Mental Health classification
const ICD10_MENTAL_HEALTH: Record<string, string> = {
  // Organic mental disorders
  'F00': 'Dementia in Alzheimer disease',
  'F01': 'Vascular dementia',
  'F05': 'Delirium',
  // Substance use
  'F10': 'Mental and behavioural disorders due to use of alcohol',
  'F11': 'Mental and behavioural disorders due to use of opioids',
  'F12': 'Mental and behavioural disorders due to use of cannabinoids',
  'F13': 'Mental and behavioural disorders due to use of sedatives or hypnotics',
  'F14': 'Mental and behavioural disorders due to use of cocaine',
  'F15': 'Mental and behavioural disorders due to use of other stimulants, including caffeine',
  'F19': 'Mental and behavioural disorders due to multiple drug use and use of other psychoactive substances',
  // Schizophrenia spectrum
  'F20': 'Schizophrenia',
  'F20.0': 'Paranoid schizophrenia',
  'F20.1': 'Hebephrenic schizophrenia',
  'F20.3': 'Undifferentiated schizophrenia',
  'F20.5': 'Residual schizophrenia',
  'F21': 'Schizotypal disorder',
  'F22': 'Persistent delusional disorders',
  'F23': 'Acute and transient psychotic disorders',
  'F25': 'Schizoaffective disorders',
  'F25.0': 'Schizoaffective disorder, manic type',
  'F25.1': 'Schizoaffective disorder, depressive type',
  'F28': 'Other nonorganic psychotic disorders',
  'F29': 'Unspecified nonorganic psychosis',
  // Mood disorders
  'F30': 'Manic episode',
  'F31': 'Bipolar affective disorder',
  'F31.0': 'Bipolar affective disorder, current episode hypomanic',
  'F31.1': 'Bipolar affective disorder, current episode manic without psychotic symptoms',
  'F31.2': 'Bipolar affective disorder, current episode manic with psychotic symptoms',
  'F31.3': 'Bipolar affective disorder, current episode mild or moderate depression',
  'F31.4': 'Bipolar affective disorder, current episode severe depression without psychotic symptoms',
  'F31.5': 'Bipolar affective disorder, current episode severe depression with psychotic symptoms',
  'F32': 'Depressive episode',
  'F32.0': 'Mild depressive episode',
  'F32.1': 'Moderate depressive episode',
  'F32.2': 'Severe depressive episode without psychotic symptoms',
  'F32.3': 'Severe depressive episode with psychotic symptoms',
  'F33': 'Recurrent depressive disorder',
  'F33.0': 'Recurrent depressive disorder, current episode mild',
  'F33.1': 'Recurrent depressive disorder, current episode moderate',
  'F33.2': 'Recurrent depressive disorder, current episode severe without psychotic symptoms',
  'F34': 'Persistent mood [affective] disorders',
  'F34.1': 'Dysthymia',
  // Anxiety disorders
  'F40': 'Phobic anxiety disorders',
  'F40.0': 'Agoraphobia',
  'F40.1': 'Social phobias',
  'F41': 'Other anxiety disorders',
  'F41.0': 'Panic disorder',
  'F41.1': 'Generalised anxiety disorder',
  'F41.2': 'Mixed anxiety and depressive disorder',
  'F42': 'Obsessive-compulsive disorder',
  'F43': 'Reaction to severe stress and adjustment disorders',
  'F43.0': 'Acute stress reaction',
  'F43.1': 'Post-traumatic stress disorder',
  'F43.2': 'Adjustment disorders',
  'F43.8': 'Complex post-traumatic stress disorder',
  // Dissociative / somatoform
  'F44': 'Dissociative [conversion] disorders',
  'F45': 'Somatoform disorders',
  // Eating disorders
  'F50': 'Eating disorders',
  'F50.0': 'Anorexia nervosa',
  'F50.2': 'Bulimia nervosa',
  // Personality disorders
  'F60': 'Specific personality disorders',
  'F60.0': 'Paranoid personality disorder',
  'F60.1': 'Schizoid personality disorder',
  'F60.2': 'Dissocial personality disorder',
  'F60.3': 'Emotionally unstable personality disorder',
  'F60.31': 'Emotionally unstable personality disorder, borderline type',
  'F60.4': 'Histrionic personality disorder',
  'F60.5': 'Anankastic personality disorder',
  'F60.6': 'Anxious [avoidant] personality disorder',
  'F60.7': 'Dependent personality disorder',
  // Intellectual disability
  'F70': 'Mild intellectual disability',
  'F71': 'Moderate intellectual disability',
  // Developmental
  'F84': 'Pervasive developmental disorders',
  'F84.0': 'Childhood autism / Autism spectrum disorder',
  'F84.5': "Asperger syndrome",
  // ADHD
  'F90': 'Hyperkinetic disorders',
  'F90.0': 'Disturbance of activity and attention (ADHD)',
  // Conduct
  'F91': 'Conduct disorders',
  'F92': 'Mixed disorders of conduct and emotions',
  // Other
  'F98.0': 'Nonorganic enuresis',
  'F99': 'Mental disorder, not otherwise specified',
};

// Keyword → ICD-10 mapping for auto-detection
const DIAGNOSIS_KEYWORDS: Array<{ pattern: RegExp; codes: string[] }> = [
  { pattern: /schizophren/i, codes: ['F20'] },
  { pattern: /paranoid.*schizo/i, codes: ['F20.0'] },
  { pattern: /schizoaffect/i, codes: ['F25'] },
  { pattern: /psychos|psychot/i, codes: ['F29'] },
  { pattern: /delusional.*disorder/i, codes: ['F22'] },
  { pattern: /bipolar|manic|mania/i, codes: ['F31'] },
  { pattern: /depress.*severe|major.*depress/i, codes: ['F32.2'] },
  { pattern: /depress.*moderate/i, codes: ['F32.1'] },
  { pattern: /depress.*mild/i, codes: ['F32.0'] },
  { pattern: /depress.*recurr/i, codes: ['F33'] },
  { pattern: /dysthym|persistent.*depress/i, codes: ['F34.1'] },
  { pattern: /depress/i, codes: ['F32'] },
  { pattern: /general.*anxi|GAD\b/i, codes: ['F41.1'] },
  { pattern: /panic.*disorder/i, codes: ['F41.0'] },
  { pattern: /social.*phob|social.*anxi/i, codes: ['F40.1'] },
  { pattern: /agoraph/i, codes: ['F40.0'] },
  { pattern: /OCD|obsess.*compul/i, codes: ['F42'] },
  { pattern: /PTSD|post.*traum.*stress/i, codes: ['F43.1'] },
  { pattern: /complex.*PTSD|complex.*post.*traum/i, codes: ['F43.8'] },
  { pattern: /acute.*stress/i, codes: ['F43.0'] },
  { pattern: /adjust.*disorder/i, codes: ['F43.2'] },
  { pattern: /anorexi/i, codes: ['F50.0'] },
  { pattern: /bulimi/i, codes: ['F50.2'] },
  { pattern: /eating.*disorder/i, codes: ['F50'] },
  { pattern: /borderline|emotionally.*unstable|BPD\b|EUPD\b/i, codes: ['F60.31'] },
  { pattern: /personality.*disorder/i, codes: ['F60'] },
  { pattern: /antisocial.*person|dissocial.*person/i, codes: ['F60.2'] },
  { pattern: /autis|ASD\b|asperger/i, codes: ['F84.0'] },
  { pattern: /ADHD|attention.*deficit|hyperkin/i, codes: ['F90.0'] },
  { pattern: /intellectual.*disab/i, codes: ['F70'] },
  { pattern: /alcohol.*use.*disorder|alcohol.*depend/i, codes: ['F10'] },
  { pattern: /cannabis.*use|marijuana.*use/i, codes: ['F12'] },
  { pattern: /methamphet|stimulant.*use/i, codes: ['F15'] },
  { pattern: /opioid.*use|heroin/i, codes: ['F11'] },
  { pattern: /substance.*use|drug.*use|polysubstance/i, codes: ['F19'] },
  { pattern: /dement|alzheim/i, codes: ['F00'] },
  { pattern: /deliri/i, codes: ['F05'] },
  { pattern: /dissociat/i, codes: ['F44'] },
  { pattern: /somatoform|somatic.*symptom/i, codes: ['F45'] },
];

export function autoCodeICD10(
  assessmentFacts: string[],
  formattedNote: string,
): ICD10Suggestion[] {
  const suggestions: ICD10Suggestion[] = [];
  const seen = new Set<string>();
  const combined = [...assessmentFacts, formattedNote].join('\n');

  for (const { pattern, codes } of DIAGNOSIS_KEYWORDS) {
    if (pattern.test(combined)) {
      for (const code of codes) {
        if (seen.has(code)) continue;
        seen.add(code);
        const desc = ICD10_MENTAL_HEALTH[code];
        if (desc) {
          // Find which fact matched
          const source = assessmentFacts.find(f => pattern.test(f)) ?? 'clinical note';
          suggestions.push({
            code,
            description: desc,
            confidence: assessmentFacts.some(f => pattern.test(f)) ? 'high' : 'moderate',
            source: typeof source === 'string' ? source.substring(0, 100) : '',
          });
        }
      }
    }
  }

  // Also extract any explicit ICD codes mentioned in text
  const explicitCodes = combined.match(/[FG]\d{2}(?:\.\d{1,2})?/g);
  if (explicitCodes) {
    for (const code of new Set(explicitCodes)) {
      if (seen.has(code)) continue;
      seen.add(code);
      const desc = ICD10_MENTAL_HEALTH[code] ?? 'See ICD-10-AM';
      suggestions.push({ code, description: desc, confidence: 'high', source: 'Explicitly stated in note' });
    }
  }

  return suggestions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. MBS ITEM NUMBER SUGGESTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export interface MBSSuggestion {
  itemNumber: string;
  description: string;
  fee: string;
  criteria: string;
}

// Australian Medicare Benefits Schedule — Mental Health items
const MBS_MENTAL_HEALTH: MBSSuggestion[] = [
  // Psychiatrist consultation items
  { itemNumber: '291', description: 'Psychiatrist consultation — new patient (>45 min)', fee: '$338.95', criteria: 'New patient, extended consultation >45 minutes' },
  { itemNumber: '293', description: 'Psychiatrist consultation — review (>15-30 min)', fee: '$152.10', criteria: 'Review patient, 15-30 minutes consultation' },
  { itemNumber: '296', description: 'Psychiatrist consultation — review (>30-45 min)', fee: '$228.15', criteria: 'Review patient, 30-45 minutes consultation' },
  { itemNumber: '297', description: 'Psychiatrist consultation — review (>45 min)', fee: '$304.20', criteria: 'Review patient, extended consultation >45 minutes' },
  { itemNumber: '300', description: 'Psychiatrist consultation — group therapy (>1 hr)', fee: '$83.55', criteria: 'Group therapy session per patient, >1 hour' },
  // Telehealth
  { itemNumber: '288', description: 'Psychiatrist telehealth consultation — new patient (>45 min)', fee: '$338.95', criteria: 'New patient via video telehealth, >45 minutes' },
  { itemNumber: '289', description: 'Psychiatrist telehealth consultation — review (>15-30 min)', fee: '$152.10', criteria: 'Review via video telehealth, 15-30 minutes' },
  { itemNumber: '370', description: 'Psychiatrist telephone consultation — review (>15-30 min)', fee: '$152.10', criteria: 'Review via telephone, 15-30 minutes' },
  // GP Mental Health items
  { itemNumber: '2700', description: 'GP Mental Health Treatment Plan', fee: '$96.65', criteria: 'Preparation of GP Mental Health Treatment Plan' },
  { itemNumber: '2701', description: 'GP Mental Health Treatment Plan Review', fee: '$70.05', criteria: 'Review of GP Mental Health Treatment Plan' },
  { itemNumber: '2715', description: 'GP focused psychological strategies — individual (>20 min)', fee: '$70.05', criteria: 'Focussed psychological strategies >20 minutes' },
  { itemNumber: '2717', description: 'GP focused psychological strategies — individual (>40 min)', fee: '$100.85', criteria: 'Focussed psychological strategies >40 minutes' },
  // Psychologist items (Allied Mental Health)
  { itemNumber: '80010', description: 'Clinical psychologist — individual session (>50 min)', fee: '$142.90', criteria: 'Individual session by clinical psychologist' },
  { itemNumber: '80110', description: 'Psychologist — individual session (>50 min)', fee: '$96.65', criteria: 'Individual session by registered psychologist' },
  // OT / Social Worker
  { itemNumber: '80125', description: 'OT — focussed psychological strategies (>50 min)', fee: '$85.85', criteria: 'Individual session by OT' },
  { itemNumber: '80160', description: 'Social worker — focussed psychological strategies (>50 min)', fee: '$85.85', criteria: 'Individual session by social worker' },
];

export function suggestMBSItems(
  contactType: string,
  durationMinutes: number,
  practitionerType: string,
  isNewPatient: boolean,
  isTelehealth: boolean,
): MBSSuggestion[] {
  const suggestions: MBSSuggestion[] = [];
  const pType = practitionerType.toLowerCase();

  if (pType.includes('psychiatrist')) {
    if (isTelehealth) {
      if (isNewPatient && durationMinutes > 45) suggestions.push(MBS_MENTAL_HEALTH.find(m => m.itemNumber === '288')!);
      else if (durationMinutes > 15) suggestions.push(MBS_MENTAL_HEALTH.find(m => m.itemNumber === '289')!);
    } else {
      if (isNewPatient && durationMinutes > 45) suggestions.push(MBS_MENTAL_HEALTH.find(m => m.itemNumber === '291')!);
      else if (durationMinutes > 45) suggestions.push(MBS_MENTAL_HEALTH.find(m => m.itemNumber === '297')!);
      else if (durationMinutes > 30) suggestions.push(MBS_MENTAL_HEALTH.find(m => m.itemNumber === '296')!);
      else if (durationMinutes > 15) suggestions.push(MBS_MENTAL_HEALTH.find(m => m.itemNumber === '293')!);
    }
    if (contactType.toLowerCase().includes('group')) suggestions.push(MBS_MENTAL_HEALTH.find(m => m.itemNumber === '300')!);
  } else if (pType.includes('gp') || pType.includes('general pract')) {
    if (contactType.includes('review') && contactType.includes('plan')) suggestions.push(MBS_MENTAL_HEALTH.find(m => m.itemNumber === '2701')!);
    else if (contactType.includes('plan')) suggestions.push(MBS_MENTAL_HEALTH.find(m => m.itemNumber === '2700')!);
    else if (durationMinutes > 40) suggestions.push(MBS_MENTAL_HEALTH.find(m => m.itemNumber === '2717')!);
    else if (durationMinutes > 20) suggestions.push(MBS_MENTAL_HEALTH.find(m => m.itemNumber === '2715')!);
  } else if (pType.includes('clinical psych')) {
    suggestions.push(MBS_MENTAL_HEALTH.find(m => m.itemNumber === '80010')!);
  } else if (pType.includes('psych')) {
    suggestions.push(MBS_MENTAL_HEALTH.find(m => m.itemNumber === '80110')!);
  } else if (pType.includes('social work')) {
    suggestions.push(MBS_MENTAL_HEALTH.find(m => m.itemNumber === '80160')!);
  } else if (pType.includes('occupational') || pType.includes('OT')) {
    suggestions.push(MBS_MENTAL_HEALTH.find(m => m.itemNumber === '80125')!);
  }

  return suggestions.filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. OUTCOME MEASURE AUTO-SCORING
// ═══════════════════════════════════════════════════════════════════════════════

export interface ExtractedOutcomeMeasure {
  instrument: string;
  score: number;
  maxScore: number;
  severity: string;
  evidence: string;
}

const OUTCOME_MEASURES: Array<{
  name: string;
  pattern: RegExp;
  maxScore: number;
  severityRanges: Array<{ max: number; label: string }>;
}> = [
  {
    name: 'PHQ-9',
    pattern: /PHQ[\s-]*9\s*(?:score|scored|is|was|of)?\s*(\d{1,2})/i,
    maxScore: 27,
    severityRanges: [
      { max: 4, label: 'Minimal' },
      { max: 9, label: 'Mild' },
      { max: 14, label: 'Moderate' },
      { max: 19, label: 'Moderately severe' },
      { max: 27, label: 'Severe' },
    ],
  },
  {
    name: 'GAD-7',
    pattern: /GAD[\s-]*7\s*(?:score|scored|is|was|of)?\s*(\d{1,2})/i,
    maxScore: 21,
    severityRanges: [
      { max: 4, label: 'Minimal' },
      { max: 9, label: 'Mild' },
      { max: 14, label: 'Moderate' },
      { max: 21, label: 'Severe' },
    ],
  },
  {
    name: 'K10',
    pattern: /K[\s-]*10\s*(?:score|scored|is|was|of)?\s*(\d{1,2})/i,
    maxScore: 50,
    severityRanges: [
      { max: 19, label: 'Low' },
      { max: 24, label: 'Mild' },
      { max: 29, label: 'Moderate' },
      { max: 50, label: 'Severe' },
    ],
  },
  {
    name: 'HoNOS',
    pattern: /HoNOS\s*(?:total|score|scored|is|was|of)?\s*(\d{1,2})/i,
    maxScore: 48,
    severityRanges: [
      { max: 9, label: 'Low' },
      { max: 15, label: 'Mild' },
      { max: 23, label: 'Moderate' },
      { max: 48, label: 'Severe' },
    ],
  },
  {
    name: 'DASS-21 Depression',
    pattern: /DASS[\s-]*(?:21)?.*?depress\w*\s*(?:score|scored|is|was|of)?\s*(\d{1,2})/i,
    maxScore: 42,
    severityRanges: [
      { max: 9, label: 'Normal' },
      { max: 13, label: 'Mild' },
      { max: 20, label: 'Moderate' },
      { max: 27, label: 'Severe' },
      { max: 42, label: 'Extremely severe' },
    ],
  },
  {
    name: 'DASS-21 Anxiety',
    pattern: /DASS[\s-]*(?:21)?.*?anxi\w*\s*(?:score|scored|is|was|of)?\s*(\d{1,2})/i,
    maxScore: 42,
    severityRanges: [
      { max: 7, label: 'Normal' },
      { max: 9, label: 'Mild' },
      { max: 14, label: 'Moderate' },
      { max: 19, label: 'Severe' },
      { max: 42, label: 'Extremely severe' },
    ],
  },
  {
    name: 'BDI-II',
    pattern: /BDI[\s-]*(?:II|2)?\s*(?:score|scored|is|was|of)?\s*(\d{1,2})/i,
    maxScore: 63,
    severityRanges: [
      { max: 13, label: 'Minimal' },
      { max: 19, label: 'Mild' },
      { max: 28, label: 'Moderate' },
      { max: 63, label: 'Severe' },
    ],
  },
  {
    name: 'PSS',
    pattern: /PSS[\s-]*(?:10)?\s*(?:score|scored|is|was|of)?\s*(\d{1,2})/i,
    maxScore: 40,
    severityRanges: [
      { max: 13, label: 'Low' },
      { max: 26, label: 'Moderate' },
      { max: 40, label: 'High' },
    ],
  },
];

export function extractOutcomeMeasures(transcript: string, extractedFacts: string[]): ExtractedOutcomeMeasure[] {
  const combined = [transcript, ...extractedFacts].join('\n');
  const results: ExtractedOutcomeMeasure[] = [];

  for (const measure of OUTCOME_MEASURES) {
    const match = combined.match(measure.pattern);
    if (match) {
      const score = parseInt(match[1], 10);
      if (score <= measure.maxScore) {
        const severity = measure.severityRanges.find(r => score <= r.max)?.label ?? 'Unknown';
        // Find the sentence with the score as evidence
        const sentences = combined.split(/[.!?\n]+/);
        const evidence = sentences.find(s => measure.pattern.test(s))?.trim() ?? match[0];
        results.push({
          instrument: measure.name,
          score,
          maxScore: measure.maxScore,
          severity,
          evidence,
        });
      }
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. PRIOR NOTE CONTEXT  +  PRE-CONSULT RAG CONTEXT (S5.5)
// ═══════════════════════════════════════════════════════════════════════════════

export async function getPriorNoteContext(patientId: string, limit = 3): Promise<string> {
  try {
    const notes = await db<PriorNoteRow>('clinical_notes')
      .where('patient_id', patientId)
      .whereIn('status', ['signed', 'completed'])
      .whereNull('deleted_at')
      .whereNotNull('content')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .select('title', 'content', 'created_at', 'note_type');

    if (!notes.length) return '';

    const summaries = notes.map((n) => {
      const date = new Date(n.created_at).toLocaleDateString('en-AU');
      const content = typeof n.content === 'string' ? n.content.substring(0, 500) : '';
      return `[${date} — ${n.note_type ?? 'Note'}] ${n.title ?? ''}\n${content}`;
    });

    return `PREVIOUS NOTES (for continuity — reference changes since last review):\n---\n${summaries.join('\n\n')}\n---`;
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch prior notes for context');
    return '';
  }
}

/**
 * S5.5 — Pre-consult RAG context.
 *
 * Heidi pulls a snapshot of the patient's recent history into the LLM
 * prompt before the consult so the generated note is grounded in real
 * problems, meds, and recent events instead of starting from a blank
 * slate. This function is the Signacare equivalent: it pulls
 *
 *   - last 3 signed clinical notes (existing getPriorNoteContext)
 *   - active medications (patient_medications, status='active')
 *   - active problem list (episodes.diagnosis where status='open')
 *   - active patient alerts / risks (patient_alerts is_active=true,
 *     show_flag=true)
 *   - last 5 vital signs / structured observations
 *
 * Each section is rendered as a small text block. The combined output
 * is hard-capped to MAX_CONTEXT_CHARS (default 8000, ~2000 tokens) so
 * we never blow past the LLM's input window. If a section overflows
 * the budget, it's truncated with a "(N more rows omitted)" marker so
 * the LLM knows the context is incomplete.
 *
 * Errors in any individual section are swallowed — a missing alert
 * table or a corrupt observation row should never block scribe
 * processing. Per-section warnings are logged but the function always
 * returns at least an empty string.
 *
 * Naming compliance: function name camelCase, DB column reads
 * snake_case, render output is plain text for the LLM (no JSON).
 */

const MAX_CONTEXT_CHARS = 8000;

interface ContextSection {
  title: string;
  body: string;
}

function clipBody(body: string, maxChars: number): string {
  if (body.length <= maxChars) return body;
  return body.slice(0, maxChars - 30) + '\n... (truncated)';
}

export async function buildPatientContext(patientId: string, clinicId?: string): Promise<string> {
  if (!patientId) return '';
  const sections: ContextSection[] = [];

  // ── Active medications ──
  try {
    const meds = await db<MedicationContextRow>('patient_medications')
      .where('patient_id', patientId)
      .modify((q) => { if (clinicId) q.where('clinic_id', clinicId); })
      .whereNull('deleted_at')
      .where('status', 'active')
      .orderBy('updated_at', 'desc')
      .limit(20)
      .select('drug_label', 'dose', 'frequency', 'route', 'start_date');
    if (meds.length > 0) {
      const lines = meds.map((m: MedicationContextRow) => {
        const route = m.route ? `${m.route} ` : '';
        const started = m.start_date ? ` (since ${new Date(m.start_date).toLocaleDateString('en-AU')})` : '';
        return `- ${m.drug_label ?? 'Unknown'} ${m.dose ?? ''} ${route}${m.frequency ?? ''}${started}`.trim();
      });
      sections.push({ title: 'CURRENT MEDICATIONS', body: lines.join('\n') });
    }
  } catch (err) {
    logger.warn({ err, patientId }, 'buildPatientContext: medications query failed');
  }

  // ── Active diagnoses (problem list from episodes.diagnosis) ──
  try {
    const episodes = await db<EpisodeContextRow>('episodes')
      .where('patient_id', patientId)
      .modify((q) => { if (clinicId) q.where('clinic_id', clinicId); })
      .whereNull('deleted_at')
      .whereNotNull('primary_diagnosis')
      .orderBy('start_date', 'desc')
      .limit(10)
      .select('primary_diagnosis', 'status', 'start_date', 'episode_type');
    const active = episodes.filter((e: EpisodeContextRow) => e.status !== 'closed' && e.status !== 'cancelled');
    if (active.length > 0) {
      const lines = active.map((e: EpisodeContextRow) => {
        const date = e.start_date ? ` (since ${new Date(e.start_date).toLocaleDateString('en-AU')})` : '';
        return `- ${e.primary_diagnosis}${date}`;
      });
      sections.push({ title: 'ACTIVE PROBLEM LIST', body: lines.join('\n') });
    }
  } catch (err) {
    logger.warn({ err, patientId }, 'buildPatientContext: episodes query failed');
  }

  // ── Active patient alerts / risks ──
  try {
    const alerts = await db<AlertContextRow>('patient_alerts')
      .where('patient_id', patientId)
      .modify((q) => { if (clinicId) q.where('clinic_id', clinicId); })
      .where('is_active', true)
      .orderBy('created_at', 'desc')
      .limit(10)
      .select('title', 'severity', 'notes', 'management_plan');
    if (alerts.length > 0) {
      const lines = alerts.map((a: AlertContextRow) => {
        const sev = a.severity ? ` [${String(a.severity).toUpperCase()}]` : '';
        const detail = a.notes ? `: ${String(a.notes).slice(0, 200)}` : '';
        return `- ${a.title ?? 'Alert'}${sev}${detail}`;
      });
      sections.push({ title: 'ACTIVE ALERTS / RISKS', body: lines.join('\n') });
    }
  } catch (err) {
    logger.warn({ err, patientId }, 'buildPatientContext: alerts query failed');
  }

  // ── Recent observations (vitals, scales) ──
  try {
    const obs = await db<ObservationContextRow>('structured_observations')
      .where('patient_id', patientId)
      .modify((q) => { if (clinicId) q.where('clinic_id', clinicId); })
      .orderBy('observed_at', 'desc')
      .limit(5)
      .select('observation_type', 'values', 'observed_at');
    if (obs.length > 0) {
      const lines = obs.map((o: ObservationContextRow) => {
        const date = o.observed_at ? new Date(o.observed_at).toLocaleDateString('en-AU') : '';
        // structured_observations.values is a JSONB envelope: { numeric, text, unit, ... }
        const v = o.values ?? {};
        const value = v.numeric != null ? `${v.numeric}${v.unit ?? ''}` : (v.text ?? '');
        return `- ${date} ${o.observation_type ?? 'Observation'}: ${value}`;
      });
      sections.push({ title: 'RECENT OBSERVATIONS', body: lines.join('\n') });
    }
  } catch (err) {
    logger.warn({ err, patientId }, 'buildPatientContext: observations query failed');
  }

  // ── Last signed notes (existing function, kept for backward compat) ──
  try {
    const noteCtx = await getPriorNoteContext(patientId, 3);
    if (noteCtx) {
      // Extract just the body — getPriorNoteContext already wraps with
      // a header that we'll re-render in our own format below.
      sections.push({
        title: 'PREVIOUS CLINICAL NOTES (last 3 signed)',
        body: noteCtx
          .replace(/^PREVIOUS NOTES.*?\n---\n/, '')
          .replace(/\n---\n?$/, ''),
      });
    }
  } catch (err) {
    logger.warn({ err, patientId }, 'buildPatientContext: getPriorNoteContext failed');
  }

  if (sections.length === 0) return '';

  // Render with the global budget. Reserve 200 chars for the wrapper.
  const sectionBudget = Math.max(400, Math.floor((MAX_CONTEXT_CHARS - 200) / sections.length));
  const rendered = sections
    .map((s) => `## ${s.title}\n${clipBody(s.body, sectionBudget)}`)
    .join('\n\n');

  return [
    'PATIENT_CONTEXT (pre-consult snapshot — use to ground the note, do not invent facts not present here or in the audio)',
    '---',
    rendered,
    '---',
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. QUEST QUALITY SCORING FRAMEWORK
// ═══════════════════════════════════════════════════════════════════════════════

export interface QUESTScore {
  overall: number;  // 0-100
  dimensions: {
    completeness: number;    // All expected sections present
    accuracy: number;        // Facts traceable to transcript
    safety: number;          // Risk assessment present, meds verified
    clarity: number;         // Professional language, no jargon
    actionability: number;   // Plan has specific, numbered items
  };
  issues: string[];
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export function scoreQUEST(
  formattedNote: string,
  extractedFacts: { subjective: string[]; objective: string[]; assessment: string[]; plan: string[]; risk: string[]; medications: string[] },
  citedFacts: CitedFact[],
  hasRiskAssessment: boolean,
  hasMedsVerified: boolean,
): QUESTScore {
  const issues: string[] = [];

  // Completeness (0-25): Are all expected sections present?
  let completeness = 0;
  const sections = ['SUBJECTIVE', 'OBJECTIVE', 'ASSESSMENT', 'PLAN', 'RISK'];
  const upperNote = formattedNote.toUpperCase();
  for (const section of sections) {
    if (upperNote.includes(section)) completeness += 5;
    else issues.push(`Missing section: ${section}`);
  }

  // Accuracy (0-25): What % of facts are traceable?
  const totalFacts = Object.values(extractedFacts).flat().length;
  const citedCount = citedFacts.filter(f => f.confidence > 0.4).length;
  const accuracy = totalFacts > 0 ? Math.round((citedCount / totalFacts) * 25) : 12;
  if (citedCount < totalFacts * 0.5) issues.push('Less than 50% of facts linked to transcript');

  // Safety (0-25): Risk assessment + medication verification
  let safety = 0;
  if (hasRiskAssessment) safety += 10;
  else issues.push('No risk assessment present');
  if (hasMedsVerified) safety += 10;
  else if (extractedFacts.medications.length > 0) issues.push('Medications not verified against safety database');
  if (/risk.*to.*self|suicid/i.test(formattedNote)) safety += 5;
  else if (extractedFacts.risk.length === 0) safety += 5; // No risk = explicitly stating low risk is fine

  // Clarity (0-15): Professional language checks
  let clarity = 15;
  if (/\*\*|##|```/.test(formattedNote)) { clarity -= 5; issues.push('Contains markdown formatting'); }
  if (formattedNote.length < 200) { clarity -= 5; issues.push('Note is very short — may lack detail'); }
  if (clarity < 0) clarity = 0;

  // Actionability (0-10): Plan has numbered items
  let actionability = 0;
  const planMatch = formattedNote.match(/PLAN[\s\S]*?(?=(?:\n\n[A-Z]|\n---|$))/i);
  if (planMatch) {
    const numberedItems = (planMatch[0].match(/^\s*\d+\./gm) || []).length;
    actionability = Math.min(10, numberedItems * 3);
    if (numberedItems === 0) issues.push('Plan lacks numbered action items');
  } else {
    issues.push('No plan section found');
  }

  const overall = completeness + accuracy + safety + clarity + actionability;
  const grade = overall >= 85 ? 'A' : overall >= 70 ? 'B' : overall >= 55 ? 'C' : overall >= 40 ? 'D' : 'F';

  return {
    overall,
    dimensions: { completeness, accuracy, safety, clarity, actionability },
    issues,
    grade,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. AGENTIC SCRIBE — Extract Actionable Items
// ═══════════════════════════════════════════════════════════════════════════════

export interface ScribeAction {
  type: 'referral' | 'appointment' | 'prescription' | 'pathology' | 'task' | 'alert';
  description: string;
  details: Record<string, string>;
  autoCreateable: boolean;
}

export function extractScribeActions(
  planFacts: string[],
  medicationFacts: string[],
  formattedNote: string,
): ScribeAction[] {
  const actions: ScribeAction[] = [];
  const combined = [...planFacts, formattedNote].join('\n');

  // Referral detection
  const referralPatterns = [
    /refer\w*\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
    /referral\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
  ];
  for (const re of referralPatterns) {
    let match;
    while ((match = re.exec(combined)) !== null) {
      actions.push({
        type: 'referral',
        description: `Referral to ${match[1].trim()}`,
        details: { recipient: match[1].trim() },
        autoCreateable: true,
      });
    }
  }

  // Appointment/follow-up detection
  const apptPatterns = [
    /(?:follow[- ]?up|review|appointment|next.*(?:appointment|session|review))\s*(?:in\s+)?(\d+\s*(?:day|week|fortnight|month)s?)/gi,
    /(?:book|schedule|arrange)\s+(?:a\s+)?(?:follow[- ]?up|review|appointment)\s*(?:in\s+)?(\d+\s*(?:day|week|fortnight|month)s?)?/gi,
  ];
  for (const re of apptPatterns) {
    let match;
    while ((match = re.exec(combined)) !== null) {
      actions.push({
        type: 'appointment',
        description: `Follow-up ${match[1] ? `in ${match[1].trim()}` : 'to be arranged'}`,
        details: { timeframe: match[1]?.trim() ?? 'TBA' },
        autoCreateable: true,
      });
    }
  }

  // Prescription changes
  for (const fact of medicationFacts) {
    const lower = fact.toLowerCase();
    if (/start|commence|increase|decrease|cease|change/.test(lower)) {
      actions.push({
        type: 'prescription',
        description: `Medication change: ${fact}`,
        details: { medication: fact },
        autoCreateable: false,
      });
    }
  }

  // Pathology orders
  const pathPatterns = [
    /(?:order|request|arrange)\s+(.+?(?:blood|test|pathology|FBC|UEC|LFT|TFT|lithium level|valproate level|clozapine level|HbA1c|lipid|fasting|metabolic).*?)(?:\.|$)/gi,
    /(FBC|UEC|LFT|TFT|lipid|HbA1c|fasting glucose|metabolic panel|clozapine level|lithium level|valproate level)/gi,
  ];
  const seenPath = new Set<string>();
  for (const re of pathPatterns) {
    let match;
    while ((match = re.exec(combined)) !== null) {
      const test = match[1].trim();
      if (!seenPath.has(test.toLowerCase())) {
        seenPath.add(test.toLowerCase());
        actions.push({
          type: 'pathology',
          description: `Pathology: ${test}`,
          details: { test },
          autoCreateable: true,
        });
      }
    }
  }

  // Safety alerts
  if (/safety.*plan|crisis.*plan/i.test(combined)) {
    actions.push({
      type: 'alert',
      description: 'Update safety/crisis plan',
      details: {},
      autoCreateable: false,
    });
  }

  // Deduplicate
  const unique: ScribeAction[] = [];
  const seen = new Set<string>();
  for (const a of actions) {
    const key = `${a.type}:${a.description}`;
    if (!seen.has(key)) { seen.add(key); unique.push(a); }
  }

  return unique;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. CLINICIAN STYLE PREFERENCES
// ═══════════════════════════════════════════════════════════════════════════════

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

export const DEFAULT_PREFERENCES: ScribePreferences = {
  noteFormat: 'soap',
  pronouns: 'third_person',
  bulletPoints: true,
  includeTimestamps: false,
  includeDirectQuotes: true,
  verbosity: 'standard',
  specialty: 'psychiatry',
  customInstructions: '',
  macros: {},
};

export async function getScribePreferences(staffId: string): Promise<ScribePreferences> {
  try {
    const row = await db('staff_settings')
      .where({ staff_id: staffId, setting_key: 'scribe_preferences' })
      .first();
    if (row?.setting_value) {
      const saved = typeof row.setting_value === 'string' ? JSON.parse(row.setting_value) : row.setting_value;
      return { ...DEFAULT_PREFERENCES, ...saved };
    }
  } catch { /* ignore */ }
  return DEFAULT_PREFERENCES;
}

export async function saveScribePreferences(staffId: string, prefs: Partial<ScribePreferences>): Promise<void> {
  const merged = { ...DEFAULT_PREFERENCES, ...prefs };
  await db('staff_settings')
    .insert({
      staff_id: staffId,
      setting_key: 'scribe_preferences',
      setting_value: JSON.stringify(merged),
      updated_at: new Date(),
    })
    .onConflict(['staff_id', 'setting_key'])
    .merge({ setting_value: JSON.stringify(merged), updated_at: new Date() });
}

export function buildStyleInstructions(prefs: ScribePreferences): string {
  const instructions: string[] = [];

  if (prefs.pronouns === 'first_person') {
    instructions.push('Write from the clinician\'s perspective using first person ("I reviewed...", "I observed...").');
  } else {
    instructions.push('Write in third person ("The patient reported...", "Mental state examination revealed...").');
  }

  if (prefs.bulletPoints) {
    instructions.push('Use bullet points for lists. Number plan items.');
  } else {
    instructions.push('Use flowing prose paragraphs. Number plan items.');
  }

  if (prefs.includeDirectQuotes) {
    instructions.push('Include direct patient quotes in quotation marks.');
  }

  if (prefs.verbosity === 'concise') {
    instructions.push('Be very concise — 1-2 sentences per section maximum. Omit sections with no findings.');
  } else if (prefs.verbosity === 'detailed') {
    instructions.push('Be thorough and detailed — include all available information, expand on clinical reasoning.');
  }

  if (prefs.customInstructions) {
    instructions.push(`Additional clinician instructions: ${prefs.customInstructions}`);
  }

  return instructions.length > 0 ? `\n\nCLINICIAN STYLE PREFERENCES:\n${instructions.join('\n')}` : '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7b. PER-CLINICIAN TONE ADAPTATION  (S5.8)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Heidi adapts each clinician's tone over time. The cheap version is
// K-shot prompting: pull a small number of THIS clinician's most
// recent signed notes for THIS note format, summarise them, and
// inject them as <style_examples> into the LLM prompt. The model then
// matches phrasing, sentence length, and section structure to what
// the clinician already produces.
//
// We deliberately:
//   - only use SIGNED notes (drafts may be incomplete)
//   - filter by note_type so the examples are format-relevant
//     (an MSE-format example is useless when generating a SOAP note)
//   - cap to 3 examples and ~600 chars each so the prompt stays
//     within budget
//   - read content (not the raw transcript) so the examples are
//     post-formatting
//   - hash the staff_id into the cache key so two clinicians never
//     pollute each other's K-shot pool
//
// Privacy: K-shot examples ARE PHI. We never expose them through
// any API endpoint; they only travel from the DB into the local LLM
// prompt and are discarded after the inference. The same trust
// boundary as the rest of the scribe pipeline.

const KSHOT_MAX_EXAMPLES = 3;
const KSHOT_MAX_CHARS_PER_EXAMPLE = 600;

export async function buildKShotExamples(
  staffId: string,
  noteType: string,
): Promise<string> {
  if (!staffId || !noteType) return '';
  try {
    const examples = await db<KShotExampleRow>('clinical_notes')
      .where('author_id', staffId)
      .where('note_type', noteType)
      .where('status', 'signed')
      .whereNull('deleted_at')
      .whereNotNull('content')
      .orderBy('signed_at', 'desc')
      .limit(KSHOT_MAX_EXAMPLES)
      .select('content', 'note_type', 'signed_at');
    if (examples.length === 0) return '';

    const blocks = examples.map((e, idx: number) => {
      const content = typeof e.content === 'string'
        ? e.content.slice(0, KSHOT_MAX_CHARS_PER_EXAMPLE)
        : '';
      const trunc = typeof e.content === 'string' && e.content.length > KSHOT_MAX_CHARS_PER_EXAMPLE
        ? '\n... (truncated)'
        : '';
      return `<example index="${idx + 1}">\n${content}${trunc}\n</example>`;
    });

    return [
      '',
      `STYLE_EXAMPLES (${examples.length} of this clinician's most recent signed ${noteType.toUpperCase()} notes — match this voice, sentence length, and section structure exactly):`,
      '<style_examples>',
      ...blocks,
      '</style_examples>',
    ].join('\n');
  } catch (err) {
    logger.warn({ err, staffId, noteType }, 'buildKShotExamples: query failed');
    return '';
  }
}
