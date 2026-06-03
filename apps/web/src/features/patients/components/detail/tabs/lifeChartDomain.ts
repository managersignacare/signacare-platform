import type { SummaryEpisodeRow, SummaryNoteRow } from './summaryTabDomain';

export function stripHtmlToText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getNoteNarrativeText(note: SummaryNoteRow): string {
  return [
    note.title ?? '',
    note.content ?? '',
    stripHtmlToText(note.assessmentHtml),
    stripHtmlToText(note.planHtml),
    stripHtmlToText(note.bodyHtml),
  ]
    .filter(Boolean)
    .join(' ')
    .trim();
}

export type MoodPolarity = 'manic' | 'depressive' | 'mixed' | 'neutral';

export interface MoodSignal {
  polarity: MoodPolarity;
  magnitude: number; // 0..1
}

export function deriveMoodSignalFromNote(note: SummaryNoteRow): MoodSignal {
  const text = getNoteNarrativeText(note).toLowerCase();
  if (!text) return { polarity: 'neutral', magnitude: 0 };

  const maniaPatterns = [
    /\bmania\b/, /\bmanic\b/, /\bhypoman/i, /\belevated mood\b/, /\bgrandios/i,
    /\bpressured speech\b/, /\bdecreased need for sleep\b/, /\bdisinhibit/i,
    /\bpsychomotor agitation\b/, /\bflight of ideas\b/,
  ];
  const depressionPatterns = [
    /\bdepress/i, /\blow mood\b/, /\banhedonia\b/, /\bhopeless/i, /\bworthless/i,
    /\bsuicid/i, /\bfatigue\b/, /\bhypersomnia\b/, /\bpsychomotor retard/i,
  ];
  const severePatterns = [/\bsevere\b/, /\bcrisis\b/, /\bhospitali[sz]/, /\bacute\b/];
  const moderatePatterns = [/\bmoderate\b/, /\bworsen/i, /\bdecompens/i];
  const mildPatterns = [/\bmild\b/, /\bstable\b/, /\bimprov/i, /\bpartial remission\b/];

  const maniaHits = maniaPatterns.reduce((acc, re) => acc + (re.test(text) ? 1 : 0), 0);
  const depressionHits = depressionPatterns.reduce((acc, re) => acc + (re.test(text) ? 1 : 0), 0);
  const severeHits = severePatterns.reduce((acc, re) => acc + (re.test(text) ? 1 : 0), 0);
  const moderateHits = moderatePatterns.reduce((acc, re) => acc + (re.test(text) ? 1 : 0), 0);
  const mildHits = mildPatterns.reduce((acc, re) => acc + (re.test(text) ? 1 : 0), 0);

  const featureHits = Math.max(maniaHits, depressionHits);
  if (featureHits === 0 && severeHits === 0 && moderateHits === 0 && mildHits === 0) {
    return { polarity: 'neutral', magnitude: 0 };
  }

  const polarity: MoodPolarity =
    maniaHits > depressionHits + 1
      ? 'manic'
      : depressionHits > maniaHits + 1
        ? 'depressive'
        : maniaHits > 0 && depressionHits > 0
          ? 'mixed'
          : maniaHits > 0
            ? 'manic'
            : depressionHits > 0
              ? 'depressive'
              : 'neutral';

  const severityBoost = severeHits > 0 ? 0.3 : moderateHits > 0 ? 0.2 : mildHits > 0 ? 0.1 : 0;
  const magnitude = Math.min(1, 0.2 + featureHits * 0.22 + severityBoost);
  return { polarity, magnitude };
}

export const RESIDUAL_KEYWORDS: { keyword: string; label: string; category: 'sleep' | 'substance' | 'anxiety' | 'psychotic' | 'functional' | 'somatic' }[] = [
  { keyword: 'insomnia', label: 'Insomnia', category: 'sleep' },
  { keyword: 'sleep disturbance', label: 'Sleep disturbance', category: 'sleep' },
  { keyword: 'poor sleep', label: 'Poor sleep', category: 'sleep' },
  { keyword: 'hypersomnia', label: 'Hypersomnia', category: 'sleep' },
  { keyword: 'nightmares', label: 'Nightmares', category: 'sleep' },
  { keyword: 'alcohol', label: 'Alcohol use', category: 'substance' },
  { keyword: 'cannabis', label: 'Cannabis use', category: 'substance' },
  { keyword: 'substance', label: 'Substance use', category: 'substance' },
  { keyword: 'methamphetamine', label: 'Methamphetamine', category: 'substance' },
  { keyword: 'anxiety', label: 'Anxiety', category: 'anxiety' },
  { keyword: 'panic', label: 'Panic symptoms', category: 'anxiety' },
  { keyword: 'rumination', label: 'Rumination', category: 'anxiety' },
  { keyword: 'paranoi', label: 'Paranoid ideation', category: 'psychotic' },
  { keyword: 'hallucin', label: 'Hallucinations', category: 'psychotic' },
  { keyword: 'delusion', label: 'Delusions', category: 'psychotic' },
  { keyword: 'disorganis', label: 'Disorganised thinking', category: 'psychotic' },
  { keyword: 'anhedonia', label: 'Anhedonia', category: 'functional' },
  { keyword: 'amotivation', label: 'Amotivation', category: 'functional' },
  { keyword: 'social withdrawal', label: 'Social withdrawal', category: 'functional' },
  { keyword: 'occupational', label: 'Occupational impairment', category: 'functional' },
  { keyword: 'fatigue', label: 'Fatigue', category: 'somatic' },
  { keyword: 'appetite', label: 'Appetite change', category: 'somatic' },
  { keyword: 'weight gain', label: 'Weight gain', category: 'somatic' },
  { keyword: 'akathisia', label: 'Akathisia', category: 'somatic' },
  { keyword: 'suicid', label: 'Suicidal ideation', category: 'functional' },
  { keyword: 'self.?harm', label: 'Self-harm', category: 'functional' },
];

export const RESIDUAL_COLORS: Record<string, string> = {
  sleep: '#5C6BC0',
  substance: '#E65100',
  anxiety: '#b8621a',
  psychotic: '#D32F2F',
  functional: '#7B1FA2',
  somatic: '#00838F',
};

export type LifeChartEventDirection = 'up' | 'down';
export interface LifeChartEventRule {
  label: string;
  pattern: RegExp;
  direction: LifeChartEventDirection;
  color: string;
  priority: number;
}

export const NOTE_LIFE_EVENT_RULES: LifeChartEventRule[] = [
  { label: 'Hospitalised', pattern: /\bhospitali[sz](ed|ation)?\b|\badmitted\b/i, direction: 'down', color: '#D32F2F', priority: 100 },
  { label: 'CTO / legal order', pattern: /\bcto\b|community treatment order|treatment authority|involuntary/i, direction: 'down', color: '#6D4C41', priority: 95 },
  { label: 'ACIS / crisis escalation', pattern: /\bacis\b|crisis team|acute community intervention|crisis assessment/i, direction: 'down', color: '#BF360C', priority: 92 },
  { label: 'Self-harm / suicidality', pattern: /\bself[-\s]?harm\b|\bsuicid\w*\b|\boverdose\b|\battempt\b/i, direction: 'down', color: '#C62828', priority: 95 },
  { label: 'Psychotic symptoms', pattern: /\bpsychosis\b|\bhallucin\w*\b|\bdelusion\w*\b|\bparanoi\w*\b/i, direction: 'down', color: '#8E24AA', priority: 88 },
  { label: 'Medication started/intensified', pattern: /\b(start(ed)?|commenc(ed)?|initiat(ed)?|increas(ed)?)\b.*\b(lithium|lamotrigine|valproate|quetiapine|olanzapine|aripiprazole|risperidone|ssri|antidepressant|antipsychotic)\b/i, direction: 'up', color: '#2E7D32', priority: 70 },
  { label: 'Medication reduced/stopped', pattern: /\b(reduc(ed)?|decreas(ed)?|ceas(ed)?|stop(ped)?)\b.*\b(lithium|lamotrigine|valproate|quetiapine|olanzapine|aripiprazole|risperidone|ssri|antidepressant|antipsychotic)\b/i, direction: 'down', color: '#F57C00', priority: 75 },
  { label: 'Bereavement', pattern: /\bbereavement\b|\bdeath of\b|\bpassed away\b|\bgrief\b/i, direction: 'up', color: '#455A64', priority: 72 },
  { label: 'Relationship stressor', pattern: /\bseparation\b|\bdivorce\b|\bbreak[-\s]?up\b|\bdomestic\b|\bconflict with partner\b/i, direction: 'up', color: '#455A64', priority: 68 },
  { label: 'Housing/financial stressor', pattern: /\bhomeless\w*\b|\beviction\b|\bfinancial\b|\bdebt\b|\bjob loss\b|\bunemploy\w*\b/i, direction: 'up', color: '#546E7A', priority: 66 },
  { label: 'Work/study milestone', pattern: /\breturned to work\b|\bpromotion\b|\bgraduat\w*\b|\bstudy resumed\b/i, direction: 'up', color: '#1E88E5', priority: 55 },
  { label: 'Pregnancy/perinatal event', pattern: /\bpregnan\w*\b|\bpostpartum\b|\bmiscarriage\b/i, direction: 'up', color: '#6A1B9A', priority: 74 },
  { label: 'Relapse warning', pattern: /\brelapse\b|\bearly warning\b|\bprodrom\w*\b/i, direction: 'up', color: '#607D8B', priority: 45 },
];

export function getPrimaryDomainDisplayLabel(primaryDomain: string | null | undefined): string {
  const d = String(primaryDomain ?? '').toLowerCase();
  if (d.includes('mood')) return 'Mood';
  if (d.includes('psychotic')) return 'Psychotic symptoms';
  if (d.includes('anxiety')) return 'Anxiety symptoms';
  if (d.includes('trauma')) return 'Trauma symptoms';
  if (d.includes('eating')) return 'Eating-disorder symptoms';
  if (d.includes('negative')) return 'Negative symptoms';
  if (d.includes('substance')) return 'Substance-use burden';
  return 'Primary symptom burden';
}

export function formatEpisodeDuration(startDate: string | null | undefined, endDate: string | null | undefined): string {
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  if (!start || Number.isNaN(start.getTime())) return '';
  const finish = !end || Number.isNaN(end.getTime()) ? new Date() : end;
  const days = Math.max(1, Math.round((finish.getTime() - start.getTime()) / 86400000));
  if (days < 14) return `${days}d`;
  if (days < 56) return `${Math.max(1, Math.round(days / 7))} wks`;
  if (days < 365) return `${Math.max(1, Math.round(days / 30.4))} mo`;
  return `${Math.max(1, Math.round(days / 365.25))} yr`;
}

export function classifyIllnessPattern(episodes: SummaryEpisodeRow[]): 'episodic_bipolar' | 'episodic_unipolar' | 'continuous' | 'mixed' {
  const types = episodes.map((e) => (e.episodeType ?? e.primaryDiagnosis ?? '').toLowerCase());
  const hasMania = types.some((t) => t.includes('mani') || t.includes('bipolar'));
  const hasDepression = types.some((t) => t.includes('depress') || t.includes('mdd'));
  const hasContinuous = types.some((t) => t.includes('schizo') || t.includes('gad') || t.includes('persistent') || t.includes('chronic') || t.includes('ptsd') || t.includes('personality'));
  if (hasMania) return 'episodic_bipolar';
  if (hasContinuous && !hasMania) return 'continuous';
  if (hasDepression && episodes.filter((e) => e.status === 'closed').length >= 2) return 'episodic_unipolar';
  return episodes.length <= 1 ? 'continuous' : 'mixed';
}

export function buildWavePath(points: { x: number; y: number }[], baselineY: number): string {
  if (points.length === 0) return '';
  const sorted = [...points].sort((a, b) => a.x - b.x);
  let d = `M ${sorted[0].x} ${baselineY}`;
  d += ` L ${sorted[0].x} ${sorted[0].y}`;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const cpx1 = prev.x + (curr.x - prev.x) * 0.4;
    const cpx2 = prev.x + (curr.x - prev.x) * 0.6;
    d += ` C ${cpx1} ${prev.y}, ${cpx2} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  d += ` L ${sorted[sorted.length - 1].x} ${baselineY}`;
  d += ' Z';
  return d;
}

export function buildContinuousLine(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  const sorted = [...points].sort((a, b) => a.x - b.x);
  let d = `M ${sorted[0].x} ${sorted[0].y}`;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const cpx1 = prev.x + (curr.x - prev.x) * 0.3;
    const cpx2 = prev.x + (curr.x - prev.x) * 0.7;
    d += ` C ${cpx1} ${prev.y}, ${cpx2} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  return d;
}
