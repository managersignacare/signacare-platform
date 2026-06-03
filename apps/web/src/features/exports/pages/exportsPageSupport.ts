export interface PatientDemographics {
  givenName?: string;
  familyName?: string;
  preferredName?: string;
  dateOfBirth?: string;
  gender?: string;
  pronouns?: string;
  emrNumber?: string;
  medicareNumber?: string;
  ihi?: string;
  atsiStatus?: string;
  interpreterRequired?: boolean;
  interpreterLanguage?: string;
  addressStreet?: string;
  addressSuburb?: string;
  addressState?: string;
  addressPostcode?: string;
  phoneMobile?: string;
  emailPrimary?: string;
  gpName?: string;
  gpPractice?: string;
  gpPhone?: string;
  nokName?: string;
  nokRelationship?: string;
  nokPhone?: string;
}

export interface EpisodeRow {
  startDate?: string;
  endDate?: string;
  episodeType?: string;
  title?: string;
  status?: string;
  primaryDiagnosis?: string;
  closureReason?: string;
}

export interface NoteRow {
  noteType?: string;
  createdAt?: string;
  authorName?: string;
  status?: string;
  title?: string;
  content?: string;
}

export interface MedicationRow {
  status?: string;
  medicationName?: string;
  dose?: string;
  frequency?: string;
  route?: string;
  indication?: string;
  isLai?: boolean;
  isClozapine?: boolean;
  ceasedReason?: string;
}

export interface AlertPlanRow {
  severity?: string;
  title?: string;
  isActive?: boolean;
  notes?: string;
}

export interface LegalOrderRow {
  orderTypeName?: string;
  orderType?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  tribunalDate?: string;
}

export interface PathologyRow {
  createdAt?: string;
  label?: string;
  testName?: string;
  value?: string | number;
  unit?: string;
  flag?: string;
}

export interface AppointmentRow {
  startTime?: string;
  appointmentType?: string;
  type?: string;
  status?: string;
  clinicianName?: string;
}

export interface LetterRow {
  letterType?: string;
  createdAt?: string;
  subject?: string;
  recipientName?: string;
  body?: string;
  content?: string;
}

export interface AssessmentRow {
  createdAt?: string;
  assessmentType?: string;
  status?: string;
  totalScore?: number;
}

export interface RiskAssessmentRow {
  createdAt?: string;
  riskSelf?: string;
  riskNarrative?: string;
  riskOthers?: string;
  riskVulnerability?: string;
  summary?: string;
}

export interface ReferralRow {
  createdAt?: string;
  referralType?: string;
  status?: string;
  referrerName?: string;
  reason?: string;
}

export interface ClinicalSafeOptions {
  includeDraftAiNotes: boolean;
  includeLongFreeText: boolean;
  longTextThreshold: number;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

export function readArrayPayload<T>(payload: unknown, keys: string[] = ['data']): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const rec = asRecord(payload);
  if (!rec) return [];
  for (const key of keys) {
    const value = rec[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

const CLINICAL_NOTE_MODULE_ID = 'notes';
const LONG_TEXT_FIELD_HINTS = [
  'content',
  'body',
  'notes',
  'summary',
  'narrative',
  'plan',
  'reason',
  'explanation',
  'foi',
  'transcript',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  );
}

function pathLooksLikeLongText(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return LONG_TEXT_FIELD_HINTS.some((hint) => lowerPath.includes(hint));
}

function isDraftAiNote(row: Record<string, unknown>): boolean {
  const status = typeof row.status === 'string' ? row.status.toLowerCase() : '';
  const noteType = typeof row.noteType === 'string' ? row.noteType.toLowerCase() : '';
  const isAiDraft = row.isAiDraft === true;
  const aiTyped = noteType.startsWith('ai_');
  return status === 'draft' && (isAiDraft || aiTyped);
}

function sanitizeValueForClinicalSafe(
  value: unknown,
  path: string,
  options: ClinicalSafeOptions,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (
      !options.includeLongFreeText
      && pathLooksLikeLongText(path)
      && value.trim().length > options.longTextThreshold
    ) {
      return `[REDACTED_LONG_TEXT_${value.length}_CHARS]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValueForClinicalSafe(item, `${path}[]`, options));
  }
  if (!isRecord(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    out[key] = sanitizeValueForClinicalSafe(nestedValue, nextPath, options);
  }
  return out;
}

export function applyClinicalSafeMode(
  moduleId: string,
  rows: unknown[],
  options: ClinicalSafeOptions,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (moduleId === CLINICAL_NOTE_MODULE_ID && !options.includeDraftAiNotes && isDraftAiNote(row)) {
      continue;
    }
    out.push(sanitizeValueForClinicalSafe(row, moduleId, options) as Record<string, unknown>);
  }
  return out;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function flattenRecordForCsv(
  value: unknown,
  parentKey = '',
  out: Record<string, string> = {},
): Record<string, string> {
  if (isPrimitive(value)) {
    if (parentKey) out[parentKey] = stringifyValue(value);
    return out;
  }

  if (Array.isArray(value)) {
    if (parentKey) {
      const allPrimitive = value.every((item) => isPrimitive(item));
      out[parentKey] = allPrimitive
        ? value.map((item) => stringifyValue(item)).join(' | ')
        : JSON.stringify(value);
    }
    return out;
  }

  if (!isRecord(value)) {
    if (parentKey) out[parentKey] = stringifyValue(value);
    return out;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextKey = parentKey ? `${parentKey}.${key}` : key;
    flattenRecordForCsv(nestedValue, nextKey, out);
  }
  return out;
}

export function toFlatCsv(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) return '';

  const preferred = ['patient', 'patientId', 'module', 'recordDate'] as const;
  const headerSet = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((k) => headerSet.add(k)));

  const ordered = [
    ...preferred.filter((key) => headerSet.has(key)),
    ...Array.from(headerSet)
      .filter((key) => !preferred.includes(key as typeof preferred[number]))
      .sort((a, b) => a.localeCompare(b)),
  ];

  const escape = (input: string): string => `"${input.replace(/"/g, '""')}"`;
  const lines = [
    ordered.map(escape).join(','),
    ...rows.map((row) => ordered.map((key) => escape(row[key] ?? '')).join(',')),
  ];
  return lines.join('\n');
}
