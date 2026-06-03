import { DEFAULT_CLINIC_TIME_ZONE } from '@signacare/shared';
import {
  asBoolean,
  asNumber,
  asRecord,
  asText,
  clampScore,
  collapseSameChannelOverlaps,
  createEmptySchemaDoc,
  createEmptySchemaRow,
  createId,
  normalizeDate,
  normalizeDateCertainty,
  normalizeProvenance,
  normalizeRemissionStatus,
  normalizeSchemaRow,
  normalizeSymptomChannel,
  type LifeChartSchemaDoc,
  type LifeChartSymptomMode,
} from './lifeChartSchemaCore';

export function normalizeSchemaDoc(value: unknown, fallback?: Partial<LifeChartSchemaDoc>): LifeChartSchemaDoc | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const rowsRaw = Array.isArray(raw.rows) ? raw.rows : [];
  const rows = collapseSameChannelOverlaps(rowsRaw.map((r) => normalizeSchemaRow(r)));
  const modeRaw = asText(raw.symptomMode).toLowerCase();
  const symptomMode: LifeChartSymptomMode = modeRaw === 'severity' ? 'severity' : 'bidirectional';
  const rawRevision = asNumber(asRecord(raw.audit).revision, 0);
  const fallbackAudit = fallback?.audit;
  const privacyRaw = asRecord(raw.privacy);
  const generatedBy = (['ai', 'heuristic', 'manual'] as const).includes(raw.generatedBy as never)
    ? (raw.generatedBy as 'ai' | 'heuristic' | 'manual')
    : (fallback?.generatedBy ?? 'manual');

  return createEmptySchemaDoc({
    disorderLabel: asText(raw.disorderLabel) || fallback?.disorderLabel,
    primaryDomain: asText(raw.primaryDomain) || fallback?.primaryDomain,
    symptomMode,
    baselineLabel: asText(raw.baselineLabel) || fallback?.baselineLabel,
    clinicTimeZone: asText(raw.clinicTimeZone) || fallback?.clinicTimeZone || DEFAULT_CLINIC_TIME_ZONE,
    chronology: asText(raw.chronology) === 'oldest_first' ? 'oldest_first' : 'most_recent_first',
    privacy: {
      scope: 'clinic_only',
      containsSensitiveNarrative: asBoolean(
        privacyRaw.containsSensitiveNarrative,
        fallback?.privacy?.containsSensitiveNarrative ?? true,
      ),
    },
    audit: {
      lineageId: asText(asRecord(raw.audit).lineageId) || fallbackAudit?.lineageId || createId(),
      revision: rawRevision > 0 ? rawRevision : (fallbackAudit?.revision ?? 1),
      parentRevision: rawRevision > 1 ? rawRevision - 1 : (fallbackAudit?.parentRevision ?? null),
      lastEditedAt: asText(asRecord(raw.audit).lastEditedAt) || fallbackAudit?.lastEditedAt || new Date().toISOString(),
      lastEditedByMode: generatedBy,
      manualEditCount: asNumber(asRecord(raw.audit).manualEditCount, fallbackAudit?.manualEditCount ?? 0),
    },
    generatedBy,
    updatedAt: asText(raw.updatedAt) || fallback?.updatedAt,
    rows: rows.length > 0 ? rows : (fallback?.rows ?? []),
  });
}

export function extractJsonFromText(raw: string): unknown | null {
  const text = raw.trim();
  if (!text) return null;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenceMatch?.[1], text].filter((v): v is string => Boolean(v));
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const obj = trimmed.slice(start, end + 1);
        try {
          return JSON.parse(obj);
        } catch {
          // continue to next candidate
        }
      }
    }
  }
  return null;
}

export function parseSchemaDocFromLlm(raw: string, fallback?: Partial<LifeChartSchemaDoc>): LifeChartSchemaDoc | null {
  const parsed = extractJsonFromText(raw);
  if (!parsed) return null;
  const normalized = normalizeSchemaDoc(parsed, fallback);
  if (!normalized || normalized.rows.length === 0) return null;
  return normalized;
}

export function stringifySchemaDoc(doc: LifeChartSchemaDoc): string {
  const nowIso = new Date().toISOString();
  const normalizedRows = collapseSameChannelOverlaps(
    doc.rows.map((r) => createEmptySchemaRow({
      ...r,
      primaryScore: clampScore(r.primaryScore),
      startDate: normalizeDate(r.startDate),
      endDate: normalizeDate(r.endDate),
      remissionStatus: normalizeRemissionStatus(r.remissionStatus, r.endDate),
      dateCertainty: normalizeDateCertainty(r.dateCertainty),
      symptomChannel: normalizeSymptomChannel(r.symptomChannel || r.primaryState),
      provenance: normalizeProvenance(r.provenance),
    })),
  );
  const payload = {
    ...doc,
    version: '2.0' as const,
    clinicTimeZone: doc.clinicTimeZone || DEFAULT_CLINIC_TIME_ZONE,
    chronology: doc.chronology || 'most_recent_first',
    updatedAt: nowIso,
    audit: {
      ...doc.audit,
      revision: Math.max(1, doc.audit.revision) + 1,
      parentRevision: Math.max(1, doc.audit.revision),
      lastEditedAt: nowIso,
      lastEditedByMode: doc.generatedBy,
      manualEditCount: doc.audit.manualEditCount + (doc.generatedBy === 'manual' ? 1 : 0),
    },
    rows: normalizedRows,
  };
  return JSON.stringify(payload, null, 2);
}
