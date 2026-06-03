import type {
  SummaryEpisodeRow,
  SummaryMedicationRow,
  SummaryNoteRow,
  SummaryPatientProfile,
} from './summaryTabDomain';
import { DEFAULT_CLINIC_TIME_ZONE } from '@signacare/shared';

export type LifeChartSymptomMode = 'bidirectional' | 'severity';
export type LifeChartDatePrecision = 'day' | 'month' | 'year' | 'unknown';
export type LifeChartDateCertainty = 'exact' | 'estimated' | 'unknown';
export type LifeChartRemissionStatus = 'remitted' | 'ongoing' | 'unclear';
export type LifeChartSymptomChannel =
  | 'mania_hypomania'
  | 'depression'
  | 'psychosis'
  | 'anxiety_trauma'
  | 'substance'
  | 'functioning'
  | 'general';

export interface LifeChartMedicationEntry {
  name: string;
  dose: string;
  route: string;
  startDate: string;
  endDate: string;
  regimenClass: 'maintenance' | 'acute' | 'adjunct' | 'other';
  sourceMedicationId: string;
}

export interface LifeChartRowProvenance {
  sourceTypes: Array<'episode' | 'note' | 'medication' | 'risk' | 'alert' | 'manual' | 'ai_inference'>;
  sourceIds: string[];
  evidenceAnchors: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface LifeChartSchemaRow {
  id: string;
  intervalLabel: string;
  symptomChannel: LifeChartSymptomChannel;
  startDate: string;
  startDatePrecision: LifeChartDatePrecision;
  endDate: string;
  endDatePrecision: LifeChartDatePrecision;
  dateCertainty: LifeChartDateCertainty;
  remissionStatus: LifeChartRemissionStatus;
  primaryState: string;
  primaryScore: number;
  medications: string;
  medicationsStructured: LifeChartMedicationEntry[];
  lifeEvents: string;
  triggers: string;
  interventions: string;
  interEpisodeFunctioning: string;
  substanceUse: string;
  hospitalization: string;
  notes: string;
  provenance: LifeChartRowProvenance;
}

export interface LifeChartSchemaDoc {
  version: '2.0';
  disorderLabel: string;
  primaryDomain: string;
  symptomMode: LifeChartSymptomMode;
  baselineLabel: string;
  clinicTimeZone: string;
  chronology: 'most_recent_first' | 'oldest_first';
  governance: {
    dateContract: 'clinic_local_civil_date';
    overlapPolicy: 'merge_same_channel_allow_cross_channel_overlap';
    medicationScale: 'categorical_not_mg';
    evidencePolicy: 'anchor_required';
  };
  privacy: {
    scope: 'clinic_only';
    containsSensitiveNarrative: boolean;
  };
  audit: {
    lineageId: string;
    revision: number;
    parentRevision: number | null;
    lastEditedAt: string;
    lastEditedByMode: 'ai' | 'heuristic' | 'manual';
    manualEditCount: number;
  };
  generatedBy: 'ai' | 'heuristic' | 'manual';
  updatedAt: string;
  rows: LifeChartSchemaRow[];
}

export const LIFECHART_SCHEMA_NOTE_TYPE = 'lifechart_schema';
export const LIFECHART_SCHEMA_NOTE_TITLE = 'Lifechart Schema (Editable Source)';
export const DAY_MS = 86_400_000;

export function createId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-4, Math.min(4, Math.round(value * 10) / 10));
}

export function isDateLike(value: string): value is `${number}-${number}-${number}` {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function normalizeDate(value: unknown): string {
  const text = asText(value).trim();
  if (isDateLike(text)) return text;
  const yearOnly = text.match(/^(\d{4})$/);
  if (yearOnly) return `${yearOnly[1]}-01-01`;
  const yearMonth = text.match(/^(\d{4})-(\d{2})$/);
  if (yearMonth) return `${yearMonth[1]}-${yearMonth[2]}-01`;
  const dt = new Date(text);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getUTCFullYear();
  const m = `${dt.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${dt.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function inferDatePrecision(value: unknown): LifeChartDatePrecision {
  const text = asText(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return 'day';
  if (/^\d{4}-\d{2}$/.test(text)) return 'month';
  if (/^\d{4}$/.test(text)) return 'year';
  if (!text) return 'unknown';
  const normalized = normalizeDate(text);
  return normalized ? 'day' : 'unknown';
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function pick(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

export function normalizeSymptomChannel(value: unknown): LifeChartSymptomChannel {
  const text = asText(value).trim().toLowerCase();
  if (!text) return 'general';
  if (/(mania|hypoman|elevated|activation)/.test(text)) return 'mania_hypomania';
  if (/(depress|mdd|low mood|dysthym)/.test(text)) return 'depression';
  if (/(psychosis|psychotic|delusion|hallucin|paranoi|schizo)/.test(text)) return 'psychosis';
  if (/(anxiety|panic|ptsd|trauma|ocd|obsess|compuls)/.test(text)) return 'anxiety_trauma';
  if (/(substance|alcohol|cannabis|meth|drug use)/.test(text)) return 'substance';
  if (/(function|social|occupational|residual|negative symptom)/.test(text)) return 'functioning';
  return 'general';
}

export function normalizeDateCertainty(value: unknown): LifeChartDateCertainty {
  const text = asText(value).trim().toLowerCase();
  if (text === 'exact' || text === 'estimated' || text === 'unknown') return text;
  if (/(approx|estimate|uncertain|inferred)/.test(text)) return 'estimated';
  if (!text) return 'unknown';
  return 'exact';
}

export function normalizeRemissionStatus(value: unknown, endDate: string): LifeChartRemissionStatus {
  const text = asText(value).trim().toLowerCase();
  if (text === 'remitted' || text === 'ongoing' || text === 'unclear') return text;
  if (!endDate) return 'ongoing';
  return 'remitted';
}

export function normalizeMedicationEntries(value: unknown): LifeChartMedicationEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const raw = asRecord(item);
      return {
        name: asText(pick(raw.name, raw.medicationName, raw.drug)),
        dose: asText(raw.dose),
        route: asText(raw.route),
        startDate: normalizeDate(pick(raw.startDate, raw.start)),
        endDate: normalizeDate(pick(raw.endDate, raw.end)),
        regimenClass: (['maintenance', 'acute', 'adjunct', 'other'] as const).includes(raw.regimenClass as never)
          ? (raw.regimenClass as 'maintenance' | 'acute' | 'adjunct' | 'other')
          : 'other',
        sourceMedicationId: asText(pick(raw.sourceMedicationId, raw.sourceId, raw.medicationId)),
      };
    })
    .filter((item) => item.name);
}

export function normalizeProvenance(value: unknown): LifeChartRowProvenance {
  const raw = asRecord(value);
  const sourceTypesRaw = Array.isArray(raw.sourceTypes) ? raw.sourceTypes : [];
  const sourceTypes = sourceTypesRaw
    .map((s) => asText(s).trim())
    .filter((s): s is LifeChartRowProvenance['sourceTypes'][number] =>
      ['episode', 'note', 'medication', 'risk', 'alert', 'manual', 'ai_inference'].includes(s),
    );
  const sourceIds = (Array.isArray(raw.sourceIds) ? raw.sourceIds : [])
    .map((s) => asText(s).trim())
    .filter(Boolean);
  const evidenceAnchors = (Array.isArray(raw.evidenceAnchors) ? raw.evidenceAnchors : [])
    .map((s) => asText(s).trim())
    .filter(Boolean)
    .slice(0, 12);
  const confidenceRaw = asText(raw.confidence).trim().toLowerCase();
  const confidence: 'high' | 'medium' | 'low' =
    confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
      ? confidenceRaw
      : 'low';
  return {
    sourceTypes: sourceTypes.length > 0 ? sourceTypes : ['manual'],
    sourceIds,
    evidenceAnchors,
    confidence,
  };
}

export function createEmptySchemaRow(seed?: Partial<LifeChartSchemaRow>): LifeChartSchemaRow {
  return {
    id: seed?.id ?? createId(),
    intervalLabel: seed?.intervalLabel ?? '',
    symptomChannel: seed?.symptomChannel ?? 'general',
    startDate: normalizeDate(seed?.startDate),
    startDatePrecision: seed?.startDatePrecision ?? inferDatePrecision(seed?.startDate),
    endDate: normalizeDate(seed?.endDate),
    endDatePrecision: seed?.endDatePrecision ?? inferDatePrecision(seed?.endDate),
    dateCertainty: seed?.dateCertainty ?? 'unknown',
    remissionStatus: seed?.remissionStatus ?? (seed?.endDate ? 'remitted' : 'ongoing'),
    primaryState: seed?.primaryState ?? 'Baseline / Euthymic',
    primaryScore: clampScore(asNumber(seed?.primaryScore, 0)),
    medications: seed?.medications ?? '',
    medicationsStructured: Array.isArray(seed?.medicationsStructured) ? seed.medicationsStructured.map((item) => ({
      name: asText(item.name),
      dose: asText(item.dose),
      route: asText(item.route),
      startDate: normalizeDate(item.startDate),
      endDate: normalizeDate(item.endDate),
      regimenClass: (['maintenance', 'acute', 'adjunct', 'other'] as const).includes(item.regimenClass)
        ? item.regimenClass
        : 'other',
      sourceMedicationId: asText(item.sourceMedicationId),
    })) : [],
    lifeEvents: seed?.lifeEvents ?? '',
    triggers: seed?.triggers ?? '',
    interventions: seed?.interventions ?? '',
    interEpisodeFunctioning: seed?.interEpisodeFunctioning ?? '',
    substanceUse: seed?.substanceUse ?? '',
    hospitalization: seed?.hospitalization ?? '',
    notes: seed?.notes ?? '',
    provenance: normalizeProvenance(seed?.provenance),
  };
}

export function createEmptySchemaDoc(seed?: Partial<LifeChartSchemaDoc>): LifeChartSchemaDoc {
  return {
    version: '2.0',
    disorderLabel: seed?.disorderLabel ?? 'Mood or psychiatric disorder',
    primaryDomain: seed?.primaryDomain ?? 'mood',
    symptomMode: seed?.symptomMode ?? 'bidirectional',
    baselineLabel: seed?.baselineLabel ?? 'Baseline / Euthymia',
    clinicTimeZone: seed?.clinicTimeZone ?? DEFAULT_CLINIC_TIME_ZONE,
    chronology: seed?.chronology ?? 'most_recent_first',
    governance: {
      dateContract: 'clinic_local_civil_date',
      overlapPolicy: 'merge_same_channel_allow_cross_channel_overlap',
      medicationScale: 'categorical_not_mg',
      evidencePolicy: 'anchor_required',
    },
    privacy: {
      scope: 'clinic_only',
      containsSensitiveNarrative: seed?.privacy?.containsSensitiveNarrative ?? true,
    },
    audit: {
      lineageId: seed?.audit?.lineageId ?? createId(),
      revision: seed?.audit?.revision ?? 1,
      parentRevision: seed?.audit?.parentRevision ?? null,
      lastEditedAt: seed?.audit?.lastEditedAt ?? new Date().toISOString(),
      lastEditedByMode: seed?.audit?.lastEditedByMode ?? (seed?.generatedBy ?? 'manual'),
      manualEditCount: seed?.audit?.manualEditCount ?? 0,
    },
    generatedBy: seed?.generatedBy ?? 'manual',
    updatedAt: seed?.updatedAt ?? new Date().toISOString(),
    rows: (seed?.rows ?? []).map((r) => createEmptySchemaRow(r)),
  };
}

export function normalizeSchemaRow(value: unknown): LifeChartSchemaRow {
  const row = asRecord(value);
  const startDateRaw = pick(row.startDate, row.start, row.from, row.intervalStart, row.symptomOnsetDate, row.onsetDate);
  const endDateRaw = pick(row.endDate, row.end, row.to, row.intervalEnd, row.symptomRemissionDate, row.remissionDate);
  const startDate = normalizeDate(startDateRaw);
  const endDate = normalizeDate(endDateRaw);
  const medications = asText(
    pick(
      row.medications,
      row.activeMedications,
      row.medication,
      row.medicationPlan,
    ),
  );
  return createEmptySchemaRow({
    id: asText(pick(row.id)),
    intervalLabel: asText(
      pick(
        row.intervalLabel,
        row.timeInterval,
        row.interval,
        row.period,
      ),
    ),
    symptomChannel: normalizeSymptomChannel(
      pick(
        row.symptomChannel,
        row.channel,
        row.primaryDomain,
        row.domain,
        row.primaryState,
      ),
    ),
    startDate,
    startDatePrecision: (['day', 'month', 'year', 'unknown'] as const).includes(row.startDatePrecision as never)
      ? (row.startDatePrecision as LifeChartDatePrecision)
      : inferDatePrecision(startDateRaw),
    endDate,
    endDatePrecision: (['day', 'month', 'year', 'unknown'] as const).includes(row.endDatePrecision as never)
      ? (row.endDatePrecision as LifeChartDatePrecision)
      : inferDatePrecision(endDateRaw),
    dateCertainty: normalizeDateCertainty(
      pick(row.dateCertainty, row.dateConfidence, row.dateCertaintyLevel),
    ),
    remissionStatus: normalizeRemissionStatus(pick(row.remissionStatus, row.status), endDate),
    primaryState: asText(
      pick(
        row.primaryState,
        row.state,
        row.symptomState,
        row.moodState,
        row.severityState,
      ),
    ),
    primaryScore: asNumber(
      pick(
        row.primaryScore,
        row.score,
        row.severityScore,
        row.moodScore,
      ),
      0,
    ),
    medications,
    medicationsStructured: normalizeMedicationEntries(
      pick(row.medicationsStructured, row.activeMedicationEntries, row.medicationItems),
    ),
    lifeEvents: asText(
      pick(
        row.lifeEvents,
        row.documentedLifeEvents,
        row.events,
        row.lifeEvent,
      ),
    ),
    triggers: asText(
      pick(
        row.triggers,
        row.trigger,
        row.precipitants,
      ),
    ),
    interventions: asText(
      pick(
        row.interventions,
        row.intervention,
        row.treatmentInterventions,
      ),
    ),
    interEpisodeFunctioning: asText(
      pick(
        row.interEpisodeFunctioning,
        row.functioning,
        row.interepisodeFunctioning,
      ),
    ),
    substanceUse: asText(
      pick(
        row.substanceUse,
        row.substanceUsePattern,
        row.substances,
      ),
    ),
    hospitalization: asText(
      pick(
        row.hospitalization,
        row.hospitalisation,
        row.hospitalizations,
        row.hospitalisations,
      ),
    ),
    notes: asText(pick(row.notes, row.commentary, row.comments)),
    provenance: normalizeProvenance(
      pick(row.provenance, row.evidence, row.sourceMetadata),
    ),
  });
}

export function parseDateMs(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function rowOverlapsByDate(a: LifeChartSchemaRow, b: LifeChartSchemaRow): boolean {
  const aStart = parseDateMs(a.startDate);
  const bStart = parseDateMs(b.startDate);
  if (aStart === null || bStart === null) return false;
  const aEnd = parseDateMs(a.endDate) ?? Number.POSITIVE_INFINITY;
  const bEnd = parseDateMs(b.endDate) ?? Number.POSITIVE_INFINITY;
  return aStart <= bEnd && bStart <= aEnd;
}

export function mergeRows(a: LifeChartSchemaRow, b: LifeChartSchemaRow): LifeChartSchemaRow {
  const aStart = parseDateMs(a.startDate);
  const bStart = parseDateMs(b.startDate);
  const aEnd = parseDateMs(a.endDate);
  const bEnd = parseDateMs(b.endDate);
  const minStart = [aStart, bStart].filter((v): v is number => v !== null).sort((x, y) => x - y)[0];
  const maxEnd = [aEnd, bEnd].filter((v): v is number => v !== null).sort((x, y) => y - x)[0] ?? null;
  return createEmptySchemaRow({
    ...a,
    intervalLabel: [a.intervalLabel, b.intervalLabel].filter(Boolean).join(' + '),
    primaryState: [a.primaryState, b.primaryState].filter(Boolean).join(' / '),
    primaryScore: (a.primaryScore + b.primaryScore) / 2,
    startDate: minStart !== undefined ? normalizeDate(new Date(minStart).toISOString()) : a.startDate,
    endDate: maxEnd !== null ? normalizeDate(new Date(maxEnd).toISOString()) : '',
    remissionStatus: maxEnd === null ? 'ongoing' : 'remitted',
    lifeEvents: [a.lifeEvents, b.lifeEvents].filter(Boolean).join(' | '),
    triggers: [a.triggers, b.triggers].filter(Boolean).join(' | '),
    interventions: [a.interventions, b.interventions].filter(Boolean).join(' | '),
    interEpisodeFunctioning: [a.interEpisodeFunctioning, b.interEpisodeFunctioning].filter(Boolean).join(' | '),
    substanceUse: [a.substanceUse, b.substanceUse].filter(Boolean).join(' | '),
    hospitalization: [a.hospitalization, b.hospitalization].filter(Boolean).join(' | '),
    notes: [a.notes, b.notes].filter(Boolean).join(' | '),
    medications: [a.medications, b.medications].filter(Boolean).join('; '),
    medicationsStructured: [...a.medicationsStructured, ...b.medicationsStructured].slice(0, 12),
    provenance: {
      sourceTypes: [...new Set([...a.provenance.sourceTypes, ...b.provenance.sourceTypes])],
      sourceIds: [...new Set([...a.provenance.sourceIds, ...b.provenance.sourceIds])].slice(0, 20),
      evidenceAnchors: [...new Set([...a.provenance.evidenceAnchors, ...b.provenance.evidenceAnchors])].slice(0, 12),
      confidence: a.provenance.confidence === 'high' || b.provenance.confidence === 'high'
        ? 'high'
        : (a.provenance.confidence === 'medium' || b.provenance.confidence === 'medium' ? 'medium' : 'low'),
    },
  });
}

export function collapseSameChannelOverlaps(rows: LifeChartSchemaRow[]): LifeChartSchemaRow[] {
  if (rows.length <= 1) return rows;
  const groups = new Map<LifeChartSymptomChannel, LifeChartSchemaRow[]>();
  rows.forEach((row) => {
    const channel = row.symptomChannel ?? 'general';
    const group = groups.get(channel) ?? [];
    group.push(row);
    groups.set(channel, group);
  });

  const merged: LifeChartSchemaRow[] = [];
  groups.forEach((groupRows) => {
    const sorted = [...groupRows].sort((a, b) => (parseDateMs(a.startDate) ?? 0) - (parseDateMs(b.startDate) ?? 0));
    const collapsed: LifeChartSchemaRow[] = [];
    sorted.forEach((row) => {
      const previous = collapsed[collapsed.length - 1];
      if (!previous) {
        collapsed.push(row);
        return;
      }
      if (rowOverlapsByDate(previous, row)) {
        collapsed[collapsed.length - 1] = mergeRows(previous, row);
      } else {
        collapsed.push(row);
      }
    });
    merged.push(...collapsed);
  });

  return merged.sort((a, b) => (parseDateMs(a.startDate) ?? 0) - (parseDateMs(b.startDate) ?? 0));
}

export function toIsoDate(ts: number): string {
  return normalizeDate(new Date(ts).toISOString());
}

export function asMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export type EpisodeSymptomPolarity = 'manic' | 'depressive' | 'psychotic' | 'anxious' | 'other';

export function episodeSymptomPolarity(episode: SummaryEpisodeRow): EpisodeSymptomPolarity {
  const type = `${episode.episodeType ?? ''} ${episode.primaryDiagnosis ?? ''}`.toLowerCase();
  if (/(mania|manic|hypoman|bipolar)/i.test(type)) return 'manic';
  if (/(depress|mdd|dysthym|low mood)/i.test(type)) return 'depressive';
  if (/(psychosis|psychotic|schizo|delusion|hallucin|paranoi)/i.test(type)) return 'psychotic';
  if (/(anxiety|panic|ptsd|trauma|ocd)/i.test(type)) return 'anxious';
  return 'other';
}

export function mapPolarityToChannel(polarity: EpisodeSymptomPolarity): LifeChartSymptomChannel {
  switch (polarity) {
    case 'manic':
      return 'mania_hypomania';
    case 'depressive':
      return 'depression';
    case 'psychotic':
      return 'psychosis';
    case 'anxious':
      return 'anxiety_trauma';
    default:
      return 'general';
  }
}

export function sortByDate<T>(items: T[], getDate: (item: T) => string | null | undefined): T[] {
  return [...items].sort((a, b) => {
    const ta = new Date(getDate(a) ?? '').getTime();
    const tb = new Date(getDate(b) ?? '').getTime();
    const aa = Number.isNaN(ta) ? 0 : ta;
    const bb = Number.isNaN(tb) ? 0 : tb;
    return aa - bb;
  });
}

export function inferDisorderLabel(episodes: SummaryEpisodeRow[]): string {
  const joined = episodes.map((e) => `${e.episodeType ?? ''} ${e.primaryDiagnosis ?? ''}`).join(' ').toLowerCase();
  if (joined.includes('bipolar')) return 'Bipolar disorder';
  if (joined.includes('schizo') || joined.includes('psychosis')) return 'Psychotic disorder';
  if (joined.includes('anxiety') || joined.includes('gad')) return 'Anxiety spectrum disorder';
  if (joined.includes('ptsd') || joined.includes('trauma')) return 'Trauma-related disorder';
  if (joined.includes('eating')) return 'Eating disorder';
  if (joined.includes('personality')) return 'Personality disorder';
  return 'Psychiatric disorder';
}

export function inferPrimaryDomain(disorderLabel: string): string {
  const d = disorderLabel.toLowerCase();
  if (d.includes('bipolar') || d.includes('mood')) return 'mood';
  if (d.includes('psychotic')) return 'psychotic_symptoms';
  if (d.includes('anxiety')) return 'anxiety';
  if (d.includes('trauma')) return 'trauma';
  if (d.includes('eating')) return 'eating_symptoms';
  return 'symptom_trajectory';
}

export function severityToScore(severity?: string | null): number {
  const s = (severity ?? '').toLowerCase();
  if (s.includes('severe') || s.includes('critical')) return 3.5;
  if (s.includes('high') || s.includes('moderate')) return 2.5;
  if (s.includes('mild') || s.includes('low')) return 1.5;
  return 2;
}

export function polarityFromEpisode(episode: SummaryEpisodeRow): 1 | -1 {
  const type = `${episode.episodeType ?? ''} ${episode.primaryDiagnosis ?? ''}`.toLowerCase();
  if (
    type.includes('depress') ||
    type.includes('mdd') ||
    type.includes('dysth')
  ) {
    return -1;
  }
  return 1;
}

export type {
  SummaryEpisodeRow,
  SummaryMedicationRow,
  SummaryNoteRow,
  SummaryPatientProfile,
};
