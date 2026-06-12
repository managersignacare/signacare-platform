// @jsonb-extraction-exempt: this service aggregates JSONB-bearing columns
// (outcome_measures.items, clinical_notes.contact_meta, staff.recovery_codes)
// into the typed visualisation contract — NOT into a generic *ToResponse
// row mapper. Each JSONB column is extracted at the point it is needed:
// `contact_meta` is parsed via `parseContactMeta()` inline (clinician
// rating-scale flow), `items` is read but never re-emitted (we summarise
// it into a numeric rawScore), and `recovery_codes` is never selected.
// The response shape returned by the route is Zod-validated via
// MeasurementDashboardSummarySchema, satisfying CLAUDE.md §1.7's
// downstream goal (no raw JSONB leak into the HTTP response).
/**
 * Build a per-patient `MeasurementDashboardSummary` from three sources:
 *   1. outcome_measures (assigned_for_patient=false/null) — clinician-
 *      administered outcome measures, family=outcome_measure.
 *   2. clinical_notes signed assessment notes whose contactMeta.ratingScale
 *      carries respondentType='clinician' — family=clinician_rating_scale.
 *   3. outcome_measures (assigned_for_patient=true, status=completed) —
 *      patient-app self-rated submissions, family=self_rated_scale.
 *
 * Operator brief:
 *   - Each source is read with the EXACT same filter the per-tab endpoint
 *     uses, so the dashboard summary is consistent with the underlying
 *     tabs. No source is duplicated; none silently overlaps.
 *   - Instruments that do not resolve via the shared taxonomy are excluded
 *     with a typed `unsupported_instrument` warning — never silently
 *     rendered as an unknown line on the chart.
 *   - Different instruments are NEVER merged onto one trend axis. Each
 *     instrument has its own series; the cross-instrument timeline lists
 *     events chronologically but each event carries its own per-instrument
 *     max for tooltip rendering only.
 */
import type { Knex } from 'knex';
import {
  buildMeasurementSeries,
  getScoringMetadata,
  getSeverityBandForScore,
  resolveScaleByTemplateName,
  type MeasurementDashboardSummary,
  type MeasurementFamily,
  type MeasurementPoint,
  type MeasurementSeries,
  type MeasurementSource,
  type MeasurementWarning,
} from '@signacare/shared';

interface OutcomeMeasureRowMinimal {
  id: string;
  patient_id: string;
  episode_id: string | null;
  measure_type: string;
  template_name: string | null;
  collection_occasion: string | null;
  total_score: number | string | null;
  created_at: Date | string;
  completed_at?: Date | string | null;
  staff_id: string | null;
  assigned_for_patient: boolean | null;
  status?: string | null;
}

interface ClinicalNoteRowMinimal {
  id: string;
  patient_id: string;
  episode_id: string | null;
  contact_meta: unknown;
  signed_by_id: string | null;
  signed_at: Date | string | null;
  created_at: Date | string;
}

interface RatingScaleMetaInNote {
  templateName?: string;
  respondentType?: 'clinician' | 'self';
  totalScore?: number;
  severity?: string;
  itemCount?: number;
}

interface StaffNameRow {
  id: string;
  given_name: string | null;
  family_name: string | null;
}

function asIso(value: Date | string | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function asNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

function parseContactMeta(raw: unknown): { ratingScale?: RatingScaleMetaInNote } | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed as { ratingScale?: RatingScaleMetaInNote } : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') return raw as { ratingScale?: RatingScaleMetaInNote };
  return null;
}

function staffDisplayName(row: StaffNameRow | undefined): string | null {
  if (!row) return null;
  const parts = [row.given_name, row.family_name].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length > 0 ? parts.join(' ') : null;
}

function pushWarning(
  warnings: Map<string, MeasurementWarning>,
  warning: MeasurementWarning,
): void {
  const key = `${warning.code}:${warning.source}:${warning.instrumentSlug ?? '*'}`;
  const existing = warnings.get(key);
  if (existing) {
    warnings.set(key, { ...existing, count: existing.count + warning.count });
  } else {
    warnings.set(key, warning);
  }
}

interface BuildOptions {
  clinicId: string;
  patientId: string;
  episodeId?: string | null;
  /** Optional family filter; null = include all families. */
  family?: MeasurementFamily | null;
  /** Optional "since" cutoff (inclusive). ISO-8601. */
  since?: string | null;
}

export async function buildMeasurementSummaryForPatient(
  db: Knex,
  opts: BuildOptions,
): Promise<MeasurementDashboardSummary> {
  const warnings = new Map<string, MeasurementWarning>();
  const points: MeasurementPoint[] = [];

  // ── 1. Outcome measures (clinician-administered NOCC) ────────────────
  if (!opts.family || opts.family === 'outcome_measure') {
    const omSource: MeasurementSource = 'outcome_measure';
    const omQuery = db('outcome_measures')
      .where({ patient_id: opts.patientId, clinic_id: opts.clinicId })
      .whereNull('deleted_at')
      .where((b) => {
        b.where({ assigned_for_patient: false }).orWhereNull('assigned_for_patient');
      })
      .whereNotNull('total_score')
      .orderBy('created_at', 'asc');
    if (opts.episodeId) omQuery.where({ episode_id: opts.episodeId });
    if (opts.since) omQuery.where('created_at', '>=', opts.since);

    const rows = (await omQuery.select(
      'id',
      'patient_id',
      'episode_id',
      'measure_type',
      'template_name',
      'collection_occasion',
      'total_score',
      'created_at',
      'completed_at',
      'staff_id',
      'assigned_for_patient',
      'status',
    )) as OutcomeMeasureRowMinimal[];

    const staffIds = new Set<string>(
      rows.map((r) => r.staff_id).filter((id): id is string => Boolean(id)),
    );
    const staffRows = staffIds.size > 0
      ? (await db('staff')
          .whereIn('id', Array.from(staffIds))
          .where({ clinic_id: opts.clinicId })
          .select('id', 'given_name', 'family_name')) as StaffNameRow[]
      : [];
    const staffById = new Map(staffRows.map((s) => [s.id, s]));

    for (const row of rows) {
      const entry = resolveScaleByTemplateName(row.measure_type)
        ?? (row.template_name ? resolveScaleByTemplateName(row.template_name) : undefined);
      if (!entry || entry.family !== 'outcome_measure') {
        pushWarning(warnings, {
          code: 'unsupported_instrument',
          source: omSource,
          instrumentSlug: null,
          detail: `outcome_measures row ${row.id} measure_type='${row.measure_type}' did not resolve to an outcome_measure registry entry`,
          count: 1,
        });
        continue;
      }
      const rawScore = asNumber(row.total_score);
      if (rawScore === null) {
        pushWarning(warnings, {
          code: 'missing_score',
          source: omSource,
          instrumentSlug: entry.slug,
          detail: `outcome_measures row ${row.id} has no total_score`,
          count: 1,
        });
        continue;
      }
      const scoring = getScoringMetadata(entry.slug);
      const band = getSeverityBandForScore(entry.slug, rawScore);
      points.push({
        id: row.id,
        patientId: row.patient_id,
        episodeId: row.episode_id,
        instrumentSlug: entry.slug,
        instrumentDisplayName: entry.displayName,
        family: 'outcome_measure',
        raterType: 'clinician',
        source: omSource,
        rawScore,
        maxScore: scoring?.maxScore ?? null,
        minScore: scoring?.minScore ?? null,
        severityLabel: band?.label ?? null,
        severityColor: band?.color ?? null,
        completedAt: asIso(row.completed_at ?? row.created_at),
        collectionOccasion: row.collection_occasion ?? null,
        completedByStaffId: row.staff_id,
        completedByStaffName: staffDisplayName(staffById.get(row.staff_id ?? '')),
        submittedByPatient: false,
      });
    }
  }

  // ── 2. Clinician-rated rating scales (from clinical_notes) ───────────
  if (!opts.family || opts.family === 'clinician_rating_scale') {
    const cnSource: MeasurementSource = 'clinical_note_rating_scale';
    const cnQuery = db('clinical_notes')
      .where({ patient_id: opts.patientId, clinic_id: opts.clinicId })
      .whereIn('note_type', ['assessment', 'review', 'intake'])
      .where({ status: 'signed' })
      .whereNull('deleted_at')
      .whereNotNull('contact_meta')
      .orderBy('created_at', 'asc');
    if (opts.episodeId) cnQuery.where({ episode_id: opts.episodeId });
    if (opts.since) cnQuery.where('created_at', '>=', opts.since);

    const rows = (await cnQuery.select(
      'id',
      'patient_id',
      'episode_id',
      'contact_meta',
      'signed_by_id',
      'signed_at',
      'created_at',
    )) as ClinicalNoteRowMinimal[];

    const staffIds = new Set<string>(
      rows.map((r) => r.signed_by_id).filter((id): id is string => Boolean(id)),
    );
    const staffRows = staffIds.size > 0
      ? (await db('staff')
          .whereIn('id', Array.from(staffIds))
          .where({ clinic_id: opts.clinicId })
          .select('id', 'given_name', 'family_name')) as StaffNameRow[]
      : [];
    const staffById = new Map(staffRows.map((s) => [s.id, s]));

    for (const row of rows) {
      const meta = parseContactMeta(row.contact_meta);
      const rs = meta?.ratingScale;
      // Operator brief: "require meta.ratingScale.respondentType === 'clinician'"
      if (!rs || rs.respondentType !== 'clinician') continue;
      const templateName = rs.templateName?.trim();
      if (!templateName) continue;
      const entry = resolveScaleByTemplateName(templateName);
      // Operator brief: "require instrument resolves via shared taxonomy
      // as rating_scale".
      if (!entry || entry.family !== 'rating_scale' || entry.raterType !== 'clinician_rated') {
        pushWarning(warnings, {
          code: 'unsupported_instrument',
          source: cnSource,
          instrumentSlug: null,
          detail: `clinical_notes row ${row.id} templateName='${templateName}' did not resolve to a clinician-rated rating_scale`,
          count: 1,
        });
        continue;
      }
      const rawScore = typeof rs.totalScore === 'number' && Number.isFinite(rs.totalScore)
        ? rs.totalScore
        : null;
      if (rawScore === null) {
        pushWarning(warnings, {
          code: 'missing_score',
          source: cnSource,
          instrumentSlug: entry.slug,
          detail: `clinical_notes row ${row.id} (${entry.displayName}) is missing structured totalScore`,
          count: 1,
        });
        continue;
      }
      const scoring = getScoringMetadata(entry.slug);
      const band = getSeverityBandForScore(entry.slug, rawScore);
      points.push({
        id: row.id,
        patientId: row.patient_id,
        episodeId: row.episode_id,
        instrumentSlug: entry.slug,
        instrumentDisplayName: entry.displayName,
        family: 'clinician_rating_scale',
        raterType: 'clinician',
        source: cnSource,
        rawScore,
        maxScore: scoring?.maxScore ?? null,
        minScore: scoring?.minScore ?? null,
        severityLabel: band?.label ?? (rs.severity ?? null),
        severityColor: band?.color ?? null,
        completedAt: asIso(row.signed_at ?? row.created_at),
        collectionOccasion: null,
        completedByStaffId: row.signed_by_id,
        completedByStaffName: staffDisplayName(staffById.get(row.signed_by_id ?? '')),
        submittedByPatient: false,
      });
    }
  }

  // ── 3. Viva self-rated submissions (outcome_measures, assigned_for_patient) ─
  if (!opts.family || opts.family === 'self_rated_scale') {
    const vivaSource: MeasurementSource = 'viva_patient_app';
    const vivaQuery = db('outcome_measures')
      .where({ patient_id: opts.patientId, clinic_id: opts.clinicId, assigned_for_patient: true, status: 'completed' })
      .whereNull('deleted_at')
      .whereNotNull('total_score')
      .orderBy('created_at', 'asc');
    if (opts.episodeId) vivaQuery.where({ episode_id: opts.episodeId });
    if (opts.since) vivaQuery.where('created_at', '>=', opts.since);

    const rows = (await vivaQuery.select(
      'id',
      'patient_id',
      'episode_id',
      'measure_type',
      'template_name',
      'collection_occasion',
      'total_score',
      'created_at',
      'completed_at',
      'staff_id',
      'assigned_for_patient',
      'status',
    )) as OutcomeMeasureRowMinimal[];

    for (const row of rows) {
      // For Viva submissions, `measure_type` is the FREE-TEXT template name
      // (see patient-app assign route), so we resolve via the template-name
      // matcher. Fall back to `template_name` column if the row was created
      // before that column was populated.
      const entry = resolveScaleByTemplateName(row.measure_type)
        ?? (row.template_name ? resolveScaleByTemplateName(row.template_name) : undefined);
      if (!entry || entry.family !== 'rating_scale' || entry.raterType !== 'self_rated') {
        pushWarning(warnings, {
          code: 'unsupported_instrument',
          source: vivaSource,
          instrumentSlug: null,
          detail: `viva submission ${row.id} measure_type='${row.measure_type}' did not resolve to a self_rated rating_scale`,
          count: 1,
        });
        continue;
      }
      const rawScore = asNumber(row.total_score);
      if (rawScore === null) {
        pushWarning(warnings, {
          code: 'missing_score',
          source: vivaSource,
          instrumentSlug: entry.slug,
          detail: `viva submission ${row.id} (${entry.displayName}) has no total_score`,
          count: 1,
        });
        continue;
      }
      const scoring = getScoringMetadata(entry.slug);
      const band = getSeverityBandForScore(entry.slug, rawScore);
      points.push({
        id: row.id,
        patientId: row.patient_id,
        episodeId: row.episode_id,
        instrumentSlug: entry.slug,
        instrumentDisplayName: entry.displayName,
        family: 'self_rated_scale',
        raterType: 'patient',
        source: vivaSource,
        rawScore,
        maxScore: scoring?.maxScore ?? null,
        minScore: scoring?.minScore ?? null,
        severityLabel: band?.label ?? null,
        severityColor: band?.color ?? null,
        completedAt: asIso(row.completed_at ?? row.created_at),
        collectionOccasion: row.collection_occasion ?? null,
        completedByStaffId: null,
        completedByStaffName: null,
        submittedByPatient: true,
      });
    }
  }

  // ── Group into per-instrument series ─────────────────────────────────
  const groupKey = (p: MeasurementPoint) => `${p.family}:${p.instrumentSlug}`;
  const groups = new Map<string, MeasurementPoint[]>();
  for (const p of points) {
    const k = groupKey(p);
    const arr = groups.get(k) ?? [];
    arr.push(p);
    groups.set(k, arr);
  }

  const series: MeasurementSeries[] = [];
  for (const [, group] of groups) {
    const s = buildMeasurementSeries(group);
    if (s.points.length === 1) {
      pushWarning(warnings, {
        code: 'insufficient_history',
        source: s.source,
        instrumentSlug: s.instrumentSlug,
        detail: `Only one administration of ${s.displayName}; trend chart cannot render`,
        count: 1,
      });
    }
    series.push(s);
  }

  // Stable order: outcome_measure first, then clinician_rating_scale,
  // then self_rated_scale; within family, sort by displayName.
  const familyOrder: Record<MeasurementFamily, number> = {
    outcome_measure: 0,
    clinician_rating_scale: 1,
    self_rated_scale: 2,
  };
  series.sort((a, b) => {
    if (a.family !== b.family) return familyOrder[a.family] - familyOrder[b.family];
    return a.displayName.localeCompare(b.displayName);
  });

  // ── latestByFamily: pick one latest per (family, instrument). ────────
  const latestByFamily = {
    outcome_measure: [] as MeasurementPoint[],
    clinician_rating_scale: [] as MeasurementPoint[],
    self_rated_scale: [] as MeasurementPoint[],
  };
  for (const s of series) {
    if (s.latestPoint) latestByFamily[s.family].push(s.latestPoint);
  }

  // ── Cross-instrument timeline — chronological, all families. ─────────
  const timeline = points
    .map((p) => ({
      pointId: p.id,
      completedAt: p.completedAt,
      family: p.family,
      instrumentSlug: p.instrumentSlug,
      instrumentDisplayName: p.instrumentDisplayName,
      rawScore: p.rawScore,
      maxScore: p.maxScore,
      severityLabel: p.severityLabel,
      severityColor: p.severityColor,
      source: p.source,
    }))
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));

  return {
    patientId: opts.patientId,
    episodeId: opts.episodeId ?? null,
    generatedAt: new Date().toISOString(),
    latestByFamily,
    series,
    crossInstrumentTimeline: timeline,
    warnings: Array.from(warnings.values()),
  };
}
