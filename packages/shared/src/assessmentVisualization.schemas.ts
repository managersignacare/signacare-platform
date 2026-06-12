/**
 * Shared scoring + visual contract for clinical measurement workflows.
 *
 * Operator brief (Phase 8 visualisation enhancement):
 *   - Outcome Measures, clinician-rated Rating Scales, and Viva self-rated
 *     assessments all surface measurements; each surface must show latest
 *     score + trend, and multi-instrument views must NEVER merge raw
 *     scores from different instruments onto one comparison axis.
 *   - This module is the SINGLE typed model that all three surfaces use,
 *     and the SINGLE shape the backend aggregation endpoint returns.
 *
 * Why this is a new schema instead of extending existing types:
 *   - `outcome.Schemas.ts` covers the WRITE path (validation of submitted
 *     items). This file covers the READ path (visualisation summaries).
 *   - The summary type is consumed by the API response AND by the React
 *     chart components. Co-locating it in `@signacare/shared` keeps a
 *     single source of truth and prevents drift between server-side
 *     mapping and client-side rendering.
 *
 * Cross-field invariants enforced by Zod refinements:
 *   - family === 'outcome_measure'           -> raterType MUST be 'clinician'
 *     (outcome measures are clinician-administered NOCC instruments)
 *   - family === 'clinician_rating_scale'    -> raterType MUST be 'clinician'
 *   - family === 'self_rated_scale'          -> raterType MUST be 'patient'
 *   - source === 'viva_patient_app'          -> family MUST be 'self_rated_scale'
 *   - source === 'clinical_note_rating_scale'-> family MUST be 'clinician_rating_scale'
 *   - source === 'outcome_measure'           -> family MUST be 'outcome_measure'
 *   - trendSummary.direction === 'insufficient_data' iff series has < 2 points
 *   - cross-instrument timeline does NOT carry a shared y-axis — points
 *     carry their own per-instrument max/min for tooltip rendering only.
 *
 * Operator brief explicit non-goals (enforced by refinement):
 *   - There is NO `normalizedScore` field. Cross-instrument normalisation
 *     would require a validated transform; the brief forbids inventing one.
 *   - There is NO `comparativeRank` field. Different instruments cannot be
 *     ranked against one another by raw total score.
 */
import { z } from 'zod';

// ── Family + rater + source ──────────────────────────────────────────────

/**
 * Top-level family for visualised measurements. Mirrors `ScaleFamily` from
 * `assessmentTaxonomy` but splits `rating_scale` by rater so the
 * visualisation layer can apply different defaults per surface.
 *
 *   - `outcome_measure`         — NOCC HoNOS/K10/K10+/LSP-16/HoNOS65/HoNOSCA
 *                                 (clinician-administered)
 *   - `clinician_rating_scale`  — BPRS-24/MADRS/HAM-D/PANSS/AIMS/etc.
 *                                 (clinician-administered, rating-scales page)
 *   - `self_rated_scale`        — PHQ-9/GAD-7/DASS-21/etc.
 *                                 (patient-administered, Viva tab)
 */
export const MeasurementFamilySchema = z.enum([
  'outcome_measure',
  'clinician_rating_scale',
  'self_rated_scale',
]);
export type MeasurementFamily = z.infer<typeof MeasurementFamilySchema>;

/**
 * Who actually filled in the items. `collateral` is reserved for future
 * collateral-history surfaces (NOK-completed scales such as a future LSP-16
 * carer-rated variant); no current entry uses it.
 */
export const MeasurementRaterTypeSchema = z.enum(['clinician', 'patient', 'collateral']);
export type MeasurementRaterType = z.infer<typeof MeasurementRaterTypeSchema>;

/**
 * The persistence surface the data point came from. Encoded so the UI can
 * surface provenance explicitly (operator brief: "Every visual point must
 * carry provenance: instrument, rater type, source, date, episode if
 * available, completedBy/submittedBy where available").
 */
export const MeasurementSourceSchema = z.enum([
  'outcome_measure',
  'clinical_note_rating_scale',
  'viva_patient_app',
]);
export type MeasurementSource = z.infer<typeof MeasurementSourceSchema>;

/**
 * Direction of change between earliest and latest administration. Strictly
 * computed from same-instrument points; never inferred across instruments.
 *
 *   - `improved`           — latest score moved toward the "better" pole
 *                            for the instrument (smaller for HoNOS, larger
 *                            for WHO-5 etc.; the helper that builds the
 *                            series declares the polarity).
 *   - `worsened`           — latest score moved toward the "worse" pole.
 *   - `stable`             — within +/- 1 raw unit of earliest.
 *   - `insufficient_data`  — fewer than 2 administrations.
 */
export const TrendDirectionSchema = z.enum([
  'improved',
  'worsened',
  'stable',
  'insufficient_data',
]);
export type TrendDirection = z.infer<typeof TrendDirectionSchema>;

/**
 * For instruments where a HIGHER raw score is "worse" (e.g. HoNOS, K10,
 * PHQ-9, GAD-7) polarity is `higher_is_worse`. For instruments where a
 * higher raw score is "better" (e.g. WHO-5 wellbeing, MoCA, MMSE)
 * polarity is `higher_is_better`. `unknown` short-circuits trend-direction
 * inference — the UI shows the raw delta with no improved/worsened label.
 */
export const InstrumentPolaritySchema = z.enum([
  'higher_is_worse',
  'higher_is_better',
  'unknown',
]);
export type InstrumentPolarity = z.infer<typeof InstrumentPolaritySchema>;

// ── MeasurementPoint ─────────────────────────────────────────────────────

/**
 * A single administration of a single instrument. The summary endpoint
 * emits an array of these per `MeasurementSeries`, AND a flat de-duplicated
 * array on the dashboard summary for the cross-instrument timeline.
 *
 * Provenance fields are required (not optional) when their source row
 * carries them — the brief mandates every visual point declare its
 * origin. The shape below tolerates legacy rows where a field is genuinely
 * unknown via explicit nulls (NOT undefined), so the wire shape stays
 * deterministic.
 */
const MeasurementPointShape = z.object({
  /** Stable id for React keys + audit cross-reference. */
  id: z.string().uuid(),
  /** Patient under measurement. */
  patientId: z.string().uuid(),
  /** Episode at time of administration, null if not linked. */
  episodeId: z.string().uuid().nullable(),

  /** Canonical slug (assessmentTaxonomy.SCALE_REGISTRY entry). */
  instrumentSlug: z.string().min(1),
  /** Display label as shown to clinicians. */
  instrumentDisplayName: z.string().min(1),

  family: MeasurementFamilySchema,
  raterType: MeasurementRaterTypeSchema,
  source: MeasurementSourceSchema,

  /** Raw total score. May be 0; never negative for current instruments. */
  rawScore: z.number(),
  /** Theoretical max for this instrument; null if instrument is open-ended. */
  maxScore: z.number().nullable(),
  /** Theoretical min for this instrument; null if instrument is open-ended. */
  minScore: z.number().nullable(),

  /** Human-readable severity band (e.g. "Mild distress", "Moderate"). */
  severityLabel: z.string().nullable(),
  /** Hex colour for the severity band; pairs with label, never alone. */
  severityColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),

  /** ISO-8601 timestamp the administration was completed. */
  completedAt: z.string().datetime(),

  /** Free-text occasion (admission, review, 91day, …). null if not recorded. */
  collectionOccasion: z.string().nullable(),

  // Provenance.
  /** Staff who completed (clinician/collateral) — null for patient-app. */
  completedByStaffId: z.string().uuid().nullable(),
  completedByStaffName: z.string().nullable(),
  /** Patient app submission marker — true ONLY when source = viva_patient_app. */
  submittedByPatient: z.boolean(),
});
export const MeasurementPointSchema = MeasurementPointShape.superRefine((point, ctx) => {
  // Source ↔ family invariants (operator brief: outcome measures stay in
  // their family; self-rated stays self-rated; clinician stays clinician).
  if (point.source === 'outcome_measure' && point.family !== 'outcome_measure') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['family'],
      message: 'source=outcome_measure REQUIRES family=outcome_measure',
    });
  }
  if (point.source === 'clinical_note_rating_scale' && point.family !== 'clinician_rating_scale') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['family'],
      message: 'source=clinical_note_rating_scale REQUIRES family=clinician_rating_scale',
    });
  }
  if (point.source === 'viva_patient_app' && point.family !== 'self_rated_scale') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['family'],
      message: 'source=viva_patient_app REQUIRES family=self_rated_scale',
    });
  }

  // Family ↔ rater invariants.
  if (point.family === 'self_rated_scale' && point.raterType !== 'patient') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['raterType'],
      message: 'family=self_rated_scale REQUIRES raterType=patient',
    });
  }
  if (point.family === 'clinician_rating_scale' && point.raterType !== 'clinician') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['raterType'],
      message: 'family=clinician_rating_scale REQUIRES raterType=clinician',
    });
  }
  if (point.family === 'outcome_measure' && point.raterType !== 'clinician') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['raterType'],
      message: 'family=outcome_measure REQUIRES raterType=clinician',
    });
  }

  // submittedByPatient marker must match source.
  if (point.source === 'viva_patient_app' && !point.submittedByPatient) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['submittedByPatient'],
      message: 'source=viva_patient_app REQUIRES submittedByPatient=true',
    });
  }
  if (point.source !== 'viva_patient_app' && point.submittedByPatient) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['submittedByPatient'],
      message: 'submittedByPatient=true is ONLY valid for source=viva_patient_app',
    });
  }

  // Severity label/colour must travel as a pair (operator brief: do not
  // rely on colour alone).
  if ((point.severityLabel === null) !== (point.severityColor === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['severityColor'],
      message: 'severityLabel and severityColor must both be present or both be null',
    });
  }
});
export type MeasurementPoint = z.infer<typeof MeasurementPointSchema>;

// ── Trend summary ────────────────────────────────────────────────────────

/**
 * Per-instrument trend descriptor. Computed by `buildMeasurementSeries`
 * (server side) so the UI never re-derives trend semantics from raw
 * deltas. Trend polarity uses the per-instrument polarity declaration.
 */
export const TrendSummarySchema = z.object({
  direction: TrendDirectionSchema,
  /** Raw delta latest - earliest. Sign is uninterpreted (use polarity). */
  rawDelta: z.number().nullable(),
  /** Days elapsed earliest -> latest. null if < 2 points. */
  spanDays: z.number().int().nonnegative().nullable(),
  /** Number of administrations contributing to the summary. */
  administrations: z.number().int().nonnegative(),
  /** Per-instrument polarity used for the direction decision. */
  polarity: InstrumentPolaritySchema,
}).superRefine((summary, ctx) => {
  // `insufficient_data` iff < 2 administrations.
  if (summary.administrations < 2 && summary.direction !== 'insufficient_data') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['direction'],
      message: 'fewer than 2 administrations REQUIRES direction=insufficient_data',
    });
  }
  if (summary.administrations >= 2 && summary.direction === 'insufficient_data') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['direction'],
      message: 'direction=insufficient_data is ONLY valid for < 2 administrations',
    });
  }
});
export type TrendSummary = z.infer<typeof TrendSummarySchema>;

// ── MeasurementSeries ────────────────────────────────────────────────────

/**
 * Grouping of all administrations for a single instrument on a single
 * patient. Surfaces one chart card per series in the UI.
 *
 * `latestPoint` is the single most-recent point (or null if `points` is
 * empty — which should never happen in practice because the route filters
 * before grouping, but the type permits it for defensive parsing).
 */
export const MeasurementSeriesSchema = z.object({
  instrumentSlug: z.string().min(1),
  displayName: z.string().min(1),
  family: MeasurementFamilySchema,
  raterType: MeasurementRaterTypeSchema,
  source: MeasurementSourceSchema,

  /** Sorted ascending by completedAt. */
  points: z.array(MeasurementPointSchema),
  latestPoint: MeasurementPointSchema.nullable(),

  trendSummary: TrendSummarySchema,
  /**
   * Short clinical hint for the UI. Examples:
   *   - "K10 score in moderate distress range; consider stepped care."
   *   - "PHQ-9 score above suicide-risk threshold; review safety plan."
   *
   * Optional + nullable: the hint is best-effort metadata that the UI
   * surfaces verbatim — never used for decisioning. `null` means no hint.
   */
  clinicalInterpretationHint: z.string().nullable(),
}).superRefine((series, ctx) => {
  if (series.latestPoint === null && series.points.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['latestPoint'],
      message: 'latestPoint null but points has entries — inconsistent series',
    });
  }
  // All points in a series MUST share family + slug.
  for (const p of series.points) {
    if (p.instrumentSlug !== series.instrumentSlug) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['points'],
        message: `point.instrumentSlug=${p.instrumentSlug} does not match series.instrumentSlug=${series.instrumentSlug}`,
      });
    }
    if (p.family !== series.family) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['points'],
        message: `point.family=${p.family} does not match series.family=${series.family}`,
      });
    }
  }
});
export type MeasurementSeries = z.infer<typeof MeasurementSeriesSchema>;

// ── Warnings ─────────────────────────────────────────────────────────────

/**
 * Typed warning surfaced by the measurement-summary endpoint when source
 * data is incomplete. The UI renders these as banner notices rather than
 * silently dropping data.
 *
 *   - `source_unavailable`     — a sub-source (notes / outcomes / viva)
 *                                returned an error or is feature-flag off.
 *   - `missing_score`          — rows existed but had no totalScore;
 *                                excluded from the chart.
 *   - `unsupported_instrument` — instrument name didn't resolve via the
 *                                shared taxonomy; the row was excluded.
 *   - `insufficient_history`   — only one administration exists; no trend.
 */
export const MeasurementWarningSchema = z.object({
  code: z.enum([
    'source_unavailable',
    'missing_score',
    'unsupported_instrument',
    'insufficient_history',
  ]),
  source: MeasurementSourceSchema,
  instrumentSlug: z.string().nullable(),
  detail: z.string(),
  count: z.number().int().nonnegative(),
});
export type MeasurementWarning = z.infer<typeof MeasurementWarningSchema>;

// ── Cross-instrument timeline ────────────────────────────────────────────

/**
 * A single chronological event on the cross-instrument timeline. Carries
 * the instrument slug + raw score + severity for tooltip / legend
 * rendering, but the timeline renderer must NOT plot raw scores on a
 * shared y-axis. The intended display is a date-keyed list with
 * instrument badges + severity chips.
 */
export const CrossInstrumentEventSchema = z.object({
  pointId: z.string().uuid(),
  completedAt: z.string().datetime(),
  family: MeasurementFamilySchema,
  instrumentSlug: z.string().min(1),
  instrumentDisplayName: z.string().min(1),
  rawScore: z.number(),
  maxScore: z.number().nullable(),
  severityLabel: z.string().nullable(),
  severityColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
  source: MeasurementSourceSchema,
}).superRefine((event, ctx) => {
  // Pair invariant — same as MeasurementPoint.
  if ((event.severityLabel === null) !== (event.severityColor === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['severityColor'],
      message: 'severityLabel and severityColor must both be present or both be null',
    });
  }
});
export type CrossInstrumentEvent = z.infer<typeof CrossInstrumentEventSchema>;

// ── Per-family "latest" snapshot ─────────────────────────────────────────

/**
 * The "latest cross-sectional score" the operator brief mandates. Keyed by
 * family so the dashboard can show one card per family without the
 * consumer having to scan every series.
 */
export const LatestByFamilySchema = z.object({
  outcome_measure: z.array(MeasurementPointSchema),
  clinician_rating_scale: z.array(MeasurementPointSchema),
  self_rated_scale: z.array(MeasurementPointSchema),
});
export type LatestByFamily = z.infer<typeof LatestByFamilySchema>;

// ── Dashboard summary (the endpoint payload) ─────────────────────────────

/**
 * Full payload returned by
 * `GET /api/v1/assessments/patient/:patientId/measurement-summary`.
 *
 * Per the operator brief, this single response covers all three surfaces
 * (Outcome Measures tab, Rating Scales tab, Viva tab) so each surface
 * filters the response client-side without re-querying — and so the
 * cross-instrument timeline can render with all three families present.
 */
export const MeasurementDashboardSummarySchema = z.object({
  patientId: z.string().uuid(),
  /** Optional episode filter; null = whole-patient summary. */
  episodeId: z.string().uuid().nullable(),
  /** ISO-8601 timestamp the summary was generated. */
  generatedAt: z.string().datetime(),
  latestByFamily: LatestByFamilySchema,
  series: z.array(MeasurementSeriesSchema),
  crossInstrumentTimeline: z.array(CrossInstrumentEventSchema),
  warnings: z.array(MeasurementWarningSchema),
}).superRefine((summary, ctx) => {
  // Cross-check: each `latestByFamily[fam]` point MUST appear in `series`
  // under the matching family + slug.
  const seriesIndex = new Map<string, MeasurementSeries>();
  for (const s of summary.series) {
    seriesIndex.set(`${s.family}:${s.instrumentSlug}`, s);
  }
  const allLatest = [
    ...summary.latestByFamily.outcome_measure,
    ...summary.latestByFamily.clinician_rating_scale,
    ...summary.latestByFamily.self_rated_scale,
  ];
  for (const p of allLatest) {
    const key = `${p.family}:${p.instrumentSlug}`;
    if (!seriesIndex.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['latestByFamily'],
        message: `latest point ${p.id} has no matching series for ${key}`,
      });
    }
  }
  // Cross-instrument timeline events must each refer to a series.
  for (const e of summary.crossInstrumentTimeline) {
    const key = `${e.family}:${e.instrumentSlug}`;
    if (!seriesIndex.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['crossInstrumentTimeline'],
        message: `timeline event ${e.pointId} has no matching series for ${key}`,
      });
    }
  }
});
export type MeasurementDashboardSummary = z.infer<typeof MeasurementDashboardSummarySchema>;

// ── Pure helpers (used by API + UI; must remain dependency-free) ─────────

/**
 * Per-instrument polarity declarations. Keyed by `instrumentSlug`. Unknown
 * polarity short-circuits trend direction inference. Source: each
 * instrument's clinical literature (HoNOS: lower is better; K10: lower is
 * better; PHQ-9: lower is better; WHO-5: higher is better; etc.).
 *
 * If a slug isn't listed here, `unknown` is the default — the UI shows
 * the raw delta with no improved/worsened label, which is the
 * fail-loud-but-readable behaviour the operator brief mandates.
 */
export const INSTRUMENT_POLARITY: Readonly<Record<string, InstrumentPolarity>> = {
  // Outcome measures.
  honos: 'higher_is_worse',
  honos65: 'higher_is_worse',
  honosca: 'higher_is_worse',
  k10: 'higher_is_worse',
  k10plus: 'higher_is_worse',
  lsp16: 'higher_is_worse',
  // Self-rated rating scales.
  phq9: 'higher_is_worse',
  gad7: 'higher_is_worse',
  dass21: 'higher_is_worse',
  pcl5: 'higher_is_worse',
  audit: 'higher_is_worse',
  dast10: 'higher_is_worse',
  bdi2: 'higher_is_worse',
  bai: 'higher_is_worse',
  epds: 'higher_is_worse',
  pss10: 'higher_is_worse',
  isi: 'higher_is_worse',
  psqi: 'higher_is_worse',
  who5: 'higher_is_better',
  sds: 'higher_is_worse',
  mdq: 'higher_is_worse',
  asrs: 'higher_is_worse',
  ocir: 'higher_is_worse',
  'ybocs-sr': 'higher_is_worse',
  rcads25: 'higher_is_worse',
  // Clinician-rated rating scales.
  hamd17: 'higher_is_worse',
  madrs: 'higher_is_worse',
  hama: 'higher_is_worse',
  ymrs: 'higher_is_worse',
  bprs24: 'higher_is_worse',
  panss: 'higher_is_worse',
  aims: 'higher_is_worse',
  sas: 'higher_is_worse',
  cgi: 'higher_is_worse',
  gaf: 'higher_is_better',
  mmse: 'higher_is_better',
  moca: 'higher_is_better',
} as const;

export function getInstrumentPolarity(slug: string): InstrumentPolarity {
  return INSTRUMENT_POLARITY[slug] ?? 'unknown';
}

/**
 * Compute trend direction from same-instrument points. Strictly:
 *   - < 2 points         -> 'insufficient_data'
 *   - polarity unknown   -> 'stable' (we have no clinical pole to compare
 *                          to, but we have data; the UI shows raw delta)
 *   - within +/- 1 unit  -> 'stable'
 *   - polarity = higher_is_worse and delta < 0 (or higher_is_better and
 *     delta > 0)       -> 'improved'
 *   - polarity opposite -> 'worsened'
 */
export function computeTrendDirection(
  rawDelta: number | null,
  polarity: InstrumentPolarity,
  administrations: number,
): TrendDirection {
  if (administrations < 2 || rawDelta === null) return 'insufficient_data';
  if (polarity === 'unknown') return 'stable';
  if (Math.abs(rawDelta) <= 1) return 'stable';
  if (polarity === 'higher_is_worse') return rawDelta < 0 ? 'improved' : 'worsened';
  return rawDelta > 0 ? 'improved' : 'worsened';
}

/**
 * Build a `MeasurementSeries` from a sorted-by-completedAt array of
 * `MeasurementPoint` objects. The caller MUST pass points that share
 * the same instrument slug + family. Throws if not.
 */
export function buildMeasurementSeries(
  points: readonly MeasurementPoint[],
  clinicalInterpretationHint: string | null = null,
): MeasurementSeries {
  if (points.length === 0) {
    throw new Error('buildMeasurementSeries: points must not be empty');
  }
  const head = points[0];
  for (const p of points) {
    if (p.instrumentSlug !== head.instrumentSlug) {
      throw new Error(
        `buildMeasurementSeries: mixed slugs (${head.instrumentSlug} vs ${p.instrumentSlug})`,
      );
    }
    if (p.family !== head.family) {
      throw new Error(
        `buildMeasurementSeries: mixed families (${head.family} vs ${p.family})`,
      );
    }
  }
  const sorted = [...points].sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  const earliest = sorted[0];
  const latest = sorted[sorted.length - 1];
  const polarity = getInstrumentPolarity(head.instrumentSlug);
  const rawDelta = sorted.length >= 2 ? latest.rawScore - earliest.rawScore : null;
  const spanDays = sorted.length >= 2
    ? Math.max(
        0,
        Math.floor(
          (new Date(latest.completedAt).getTime() - new Date(earliest.completedAt).getTime())
          / 86400000,
        ),
      )
    : null;
  return {
    instrumentSlug: head.instrumentSlug,
    displayName: head.instrumentDisplayName,
    family: head.family,
    raterType: head.raterType,
    source: head.source,
    points: sorted,
    latestPoint: latest,
    trendSummary: {
      direction: computeTrendDirection(rawDelta, polarity, sorted.length),
      rawDelta,
      spanDays,
      administrations: sorted.length,
      polarity,
    },
    clinicalInterpretationHint,
  };
}

/**
 * The set of fields the brief mandates be PRESENT on every point. Used
 * by the API test suite to assert provenance coverage.
 */
export const REQUIRED_PROVENANCE_FIELDS = [
  'patientId',
  'instrumentSlug',
  'instrumentDisplayName',
  'family',
  'raterType',
  'source',
  'completedAt',
  'submittedByPatient',
] as const;
