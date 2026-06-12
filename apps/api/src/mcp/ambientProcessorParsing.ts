export interface AmbientStructuredSections {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

export interface AmbientMentalStateExam {
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
}

export function parseSOAP(text: string): AmbientStructuredSections {
  const sections = { subjective: '', objective: '', assessment: '', plan: '' };
  const patterns: [keyof typeof sections, RegExp][] = [
    ['subjective', /(?:SUBJECTIVE|Subjective)[:\s]*\n?([\s\S]*?)(?=(?:OBJECTIVE|Objective|ASSESSMENT|Assessment|PLAN|Plan|PRESENTATION|MENTAL STATE|$))/i],
    ['objective', /(?:OBJECTIVE|Objective)[:\s]*\n?([\s\S]*?)(?=(?:ASSESSMENT|Assessment|PLAN|Plan|RISK ASSESSMENT|$))/i],
    ['assessment', /(?:ASSESSMENT|Assessment|CLINICAL IMPRESSION)[:\s]*\n?([\s\S]*?)(?=(?:PLAN|Plan|MANAGEMENT|RISK ASSESSMENT|$))/i],
    ['plan', /(?:PLAN|Plan|MANAGEMENT PLAN)[:\s]*\n?([\s\S]*?)(?=(?:MEDICATIONS|SAFETY|$))/i],
  ];

  for (const [key, re] of patterns) {
    const match = text.match(re);
    if (match?.[1]) sections[key] = stripMarkdown(match[1].trim());
  }

  if (!sections.subjective && !sections.objective) {
    sections.subjective = stripMarkdown(text.trim());
  }

  return sections;
}

export function buildMSEFromExtraction(
  formattedNote: string,
  mseFacts: Record<string, string>,
): AmbientMentalStateExam | undefined {
  const parsedMSE = parseMSE(formattedNote);
  const mse: AmbientMentalStateExam = {
    appearance: '',
    behaviour: '',
    speech: '',
    mood: '',
    affect: '',
    thoughtForm: '',
    thoughtContent: '',
    perception: '',
    cognition: '',
    insight: '',
    judgement: '',
  };

  if (parsedMSE) Object.assign(mse, parsedMSE);

  for (const [key, value] of Object.entries(mseFacts)) {
    if (value && isAmbientMseKey(key, mse)) {
      mse[key] = value;
    }
  }

  const hasFindings = Object.values(mse).some(v => v && v !== 'Not assessed' && v.length > 0);
  return hasFindings ? mse : undefined;
}

function isAmbientMseKey(
  key: string,
  mse: AmbientMentalStateExam,
): key is keyof AmbientMentalStateExam {
  return key in mse;
}

function parseMSE(text: string): AmbientMentalStateExam | undefined {
  const mseMatch = text.match(/(?:MENTAL STATE|MSE|Mental State Examination)[:\s]*\n?([\s\S]*?)(?=(?:RISK|Risk|DIAGNOSIS|Diagnosis|PLAN|Plan|MANAGEMENT|PROVISIONAL|CLINICAL IMPRESSION|SAFETY|$))/i);
  if (!mseMatch) return undefined;

  const mseText = mseMatch[1];
  const extract = (label: string) => {
    const re = new RegExp(`(?:${label})[:\\s]*([^\\n]+)`, 'i');
    return stripMarkdown(mseText.match(re)?.[1]?.trim() ?? '');
  };

  return {
    appearance: extract('Appearance'),
    behaviour: extract('Behaviour'),
    speech: extract('Speech'),
    mood: extract('Mood'),
    affect: extract('Affect'),
    thoughtForm: extract('Thought Form|Thought Process'),
    thoughtContent: extract('Thought Content'),
    perception: extract('Perception'),
    cognition: extract('Cognition'),
    insight: extract('Insight'),
    judgement: extract('Judgement|Judgment'),
  };
}

export function extractRiskFlags(
  llmOutput: string,
  transcript: string,
  passOneRisks: string[],
): string[] {
  const flags: string[] = [];

  for (const risk of passOneRisks) {
    if (risk.trim()) flags.push(risk.trim());
  }

  const combined = (llmOutput + ' ' + transcript).toLowerCase();
  const riskTerms: [string, string][] = [
    ['suicid', 'Suicide risk mentioned'],
    ['self.?harm', 'Self-harm risk mentioned'],
    ['overdose', 'Overdose risk mentioned'],
    ['homicid', 'Homicidal ideation mentioned'],
    ['violence|violent|aggress', 'Violence/aggression risk'],
    ['abscon', 'Absconding risk mentioned'],
    ['non.?compli|not taking|stopped.?taking|missed.*medica', 'Medication non-compliance'],
    ['substance|alcohol|cannabis|methamphetamine|heroin|drug use', 'Substance use concerns'],
    ['child.?protect|child.?safe|children.*risk', 'Child protection concerns'],
    ['command.?hallucination', 'Command hallucinations reported'],
    ['firearm|weapon|knife', 'Weapon access mentioned'],
  ];

  for (const [pattern, flag] of riskTerms) {
    if (new RegExp(pattern, 'i').test(combined) && !flags.includes(flag)) {
      flags.push(flag);
    }
  }

  return [...new Set(flags)];
}

export function extractDiagnosis(text: string): string[] {
  const diagnoses: string[] = [];
  const icdMatches = text.match(/[FG]\d{2}(?:\.\d{1,2})?/g);
  if (icdMatches) {
    diagnoses.push(...new Set(icdMatches));
  }
  return diagnoses;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6}\s*/g, '')
    .replace(/`{1,3}(.*?)`{1,3}/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '- ')
    .trim();
}
