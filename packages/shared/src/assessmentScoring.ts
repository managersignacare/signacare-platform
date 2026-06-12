/**
 * Per-instrument scoring metadata (max / min raw score, severity bands).
 *
 * Operator brief (Phase 8 visualisation):
 *   - "If a scale is built-in and scorable, use registry/scoring metadata
 *     for max score/severity where available."
 *   - "If a completed clinician rating scale lacks structured score
 *     metadata, show it in history but mark 'not graphable: missing
 *     structured score'."
 *
 * This module is the SSoT for scoring metadata. Frontend chart components
 * and backend aggregation endpoint both read from it. There is NO
 * parallel scoring table in either layer.
 *
 * Coverage status:
 *   - Outcome measures (HoNOS / K10 / K10+ / LSP-16 / HoNOS65 / HoNOSCA):
 *     full max/min/severity bands.
 *   - Self-rated PHQ-9 / GAD-7 / WHO-5 / EPDS / K10 (Viva): full bands.
 *   - Clinician rating scales: max where standardly published; severity
 *     bands only for instruments whose bands are clinically agreed.
 *   - Anything missing here is reported via the visualisation contract
 *     as `not graphable: missing structured score` — never silently
 *     defaulted to a fake max.
 */

import type { ScaleFamily } from './assessmentTaxonomy';

/**
 * One severity band on an instrument. Bands are CLOSED intervals
 * [from, to] inclusive at both ends. Half-open shapes ([0, 5)) are
 * deliberately avoided so band lookup is mechanically unambiguous.
 */
export interface SeverityBand {
  /** Inclusive lower bound on raw score. */
  from: number;
  /** Inclusive upper bound on raw score. */
  to: number;
  /** Human-readable label (e.g. "Mild", "Moderately severe"). */
  label: string;
  /** Hex colour. Pairs with label; never used alone. */
  color: string;
}

/**
 * Per-instrument scoring metadata.
 *
 * `maxScore` and `minScore` are the theoretical bounds of the total
 * score. `severityBands` is optional — instruments without published
 * thresholds (e.g. SAS, AIMS items) carry an empty array and the UI
 * shows raw score without a severity chip.
 */
export interface ScoringMetadata {
  /** Canonical slug; must match an assessmentTaxonomy SCALE_REGISTRY entry. */
  slug: string;
  family: ScaleFamily;
  /** Theoretical max raw score. Null if instrument is open-ended (rare). */
  maxScore: number | null;
  /** Theoretical min raw score. Null if open-ended. */
  minScore: number | null;
  /** Sorted ascending by `from`. Empty if no published bands. */
  severityBands: SeverityBand[];
}

const SEVERITY_COLOR = {
  green: '#2E7D32',
  amber: '#b8621a',
  orange: '#E65100',
  red: '#C62828',
} as const;

/**
 * Scoring metadata table. Keyed by slug for O(1) lookup. Entries are
 * organised by family for code-search convenience.
 */
const SCORING_METADATA: Record<string, ScoringMetadata> = {
  // ── Outcome measures ──────────────────────────────────────────────────
  honos: {
    slug: 'honos',
    family: 'outcome_measure',
    maxScore: 48,
    minScore: 0,
    severityBands: [], // HoNOS subscale + total are domain scores; no published total-band thresholds.
  },
  honos65: {
    slug: 'honos65',
    family: 'outcome_measure',
    maxScore: 48,
    minScore: 0,
    severityBands: [],
  },
  honosca: {
    slug: 'honosca',
    family: 'outcome_measure',
    maxScore: 52,
    minScore: 0,
    severityBands: [],
  },
  k10: {
    slug: 'k10',
    family: 'outcome_measure',
    maxScore: 50,
    minScore: 10,
    severityBands: [
      { from: 10, to: 19, label: 'Likely to be well', color: SEVERITY_COLOR.green },
      { from: 20, to: 24, label: 'Mild distress', color: SEVERITY_COLOR.amber },
      { from: 25, to: 29, label: 'Moderate distress', color: SEVERITY_COLOR.orange },
      { from: 30, to: 50, label: 'Severe distress', color: SEVERITY_COLOR.red },
    ],
  },
  k10plus: {
    slug: 'k10plus',
    family: 'outcome_measure',
    maxScore: 70,
    minScore: 14,
    severityBands: [
      // K10+ adds 4 extra items; reuse K10 bands for the K10 subset (1-50)
      // and treat full-instrument totals above 50 as severe.
      { from: 14, to: 19, label: 'Likely to be well', color: SEVERITY_COLOR.green },
      { from: 20, to: 24, label: 'Mild distress', color: SEVERITY_COLOR.amber },
      { from: 25, to: 29, label: 'Moderate distress', color: SEVERITY_COLOR.orange },
      { from: 30, to: 70, label: 'Severe distress', color: SEVERITY_COLOR.red },
    ],
  },
  lsp16: {
    slug: 'lsp16',
    family: 'outcome_measure',
    maxScore: 48,
    minScore: 0,
    severityBands: [],
  },

  // ── Self-rated rating scales (Viva) ───────────────────────────────────
  phq9: {
    slug: 'phq9',
    family: 'rating_scale',
    maxScore: 27,
    minScore: 0,
    severityBands: [
      { from: 0, to: 4, label: 'Minimal', color: SEVERITY_COLOR.green },
      { from: 5, to: 9, label: 'Mild', color: SEVERITY_COLOR.amber },
      { from: 10, to: 14, label: 'Moderate', color: SEVERITY_COLOR.orange },
      { from: 15, to: 19, label: 'Moderately severe', color: SEVERITY_COLOR.orange },
      { from: 20, to: 27, label: 'Severe', color: SEVERITY_COLOR.red },
    ],
  },
  gad7: {
    slug: 'gad7',
    family: 'rating_scale',
    maxScore: 21,
    minScore: 0,
    severityBands: [
      { from: 0, to: 4, label: 'Minimal', color: SEVERITY_COLOR.green },
      { from: 5, to: 9, label: 'Mild', color: SEVERITY_COLOR.amber },
      { from: 10, to: 14, label: 'Moderate', color: SEVERITY_COLOR.orange },
      { from: 15, to: 21, label: 'Severe', color: SEVERITY_COLOR.red },
    ],
  },
  who5: {
    slug: 'who5',
    family: 'rating_scale',
    maxScore: 25,
    minScore: 0,
    severityBands: [
      // WHO-5 is reported as raw-score-x4 = wellbeing index 0-100.
      // Bands are interpreted on the raw 0-25 scale here; the UI may
      // present the x4 conversion separately.
      { from: 0, to: 12, label: 'Poor wellbeing', color: SEVERITY_COLOR.red },
      { from: 13, to: 17, label: 'Reduced wellbeing', color: SEVERITY_COLOR.amber },
      { from: 18, to: 25, label: 'Good wellbeing', color: SEVERITY_COLOR.green },
    ],
  },
  epds: {
    slug: 'epds',
    family: 'rating_scale',
    maxScore: 30,
    minScore: 0,
    severityBands: [
      { from: 0, to: 9, label: 'Low likelihood', color: SEVERITY_COLOR.green },
      { from: 10, to: 12, label: 'Possible depression', color: SEVERITY_COLOR.amber },
      { from: 13, to: 30, label: 'Likely depression — clinical review', color: SEVERITY_COLOR.red },
    ],
  },
  dass21: {
    slug: 'dass21',
    family: 'rating_scale',
    maxScore: 63,
    minScore: 0,
    severityBands: [], // 3 subscales (depression/anxiety/stress) carry the bands; the total is informational only.
  },
  pcl5: {
    slug: 'pcl5',
    family: 'rating_scale',
    maxScore: 80,
    minScore: 0,
    severityBands: [
      { from: 0, to: 30, label: 'Below provisional threshold', color: SEVERITY_COLOR.green },
      { from: 31, to: 33, label: 'Provisional PTSD diagnosis (military)', color: SEVERITY_COLOR.amber },
      { from: 34, to: 80, label: 'Provisional PTSD diagnosis (general)', color: SEVERITY_COLOR.red },
    ],
  },
  audit: {
    slug: 'audit',
    family: 'rating_scale',
    maxScore: 40,
    minScore: 0,
    severityBands: [
      { from: 0, to: 7, label: 'Low risk', color: SEVERITY_COLOR.green },
      { from: 8, to: 15, label: 'Hazardous use', color: SEVERITY_COLOR.amber },
      { from: 16, to: 19, label: 'Harmful use', color: SEVERITY_COLOR.orange },
      { from: 20, to: 40, label: 'Likely dependence', color: SEVERITY_COLOR.red },
    ],
  },
  dast10: {
    slug: 'dast10',
    family: 'rating_scale',
    maxScore: 10,
    minScore: 0,
    severityBands: [
      { from: 0, to: 0, label: 'No problems reported', color: SEVERITY_COLOR.green },
      { from: 1, to: 2, label: 'Low level', color: SEVERITY_COLOR.amber },
      { from: 3, to: 5, label: 'Moderate level', color: SEVERITY_COLOR.orange },
      { from: 6, to: 10, label: 'Severe level', color: SEVERITY_COLOR.red },
    ],
  },
  bdi2: {
    slug: 'bdi2',
    family: 'rating_scale',
    maxScore: 63,
    minScore: 0,
    severityBands: [
      { from: 0, to: 13, label: 'Minimal', color: SEVERITY_COLOR.green },
      { from: 14, to: 19, label: 'Mild', color: SEVERITY_COLOR.amber },
      { from: 20, to: 28, label: 'Moderate', color: SEVERITY_COLOR.orange },
      { from: 29, to: 63, label: 'Severe', color: SEVERITY_COLOR.red },
    ],
  },
  bai: {
    slug: 'bai',
    family: 'rating_scale',
    maxScore: 63,
    minScore: 0,
    severityBands: [
      { from: 0, to: 7, label: 'Minimal', color: SEVERITY_COLOR.green },
      { from: 8, to: 15, label: 'Mild', color: SEVERITY_COLOR.amber },
      { from: 16, to: 25, label: 'Moderate', color: SEVERITY_COLOR.orange },
      { from: 26, to: 63, label: 'Severe', color: SEVERITY_COLOR.red },
    ],
  },
  pss10: {
    slug: 'pss10',
    family: 'rating_scale',
    maxScore: 40,
    minScore: 0,
    severityBands: [
      { from: 0, to: 13, label: 'Low stress', color: SEVERITY_COLOR.green },
      { from: 14, to: 26, label: 'Moderate stress', color: SEVERITY_COLOR.amber },
      { from: 27, to: 40, label: 'High stress', color: SEVERITY_COLOR.red },
    ],
  },
  isi: {
    slug: 'isi',
    family: 'rating_scale',
    maxScore: 28,
    minScore: 0,
    severityBands: [
      { from: 0, to: 7, label: 'No insomnia', color: SEVERITY_COLOR.green },
      { from: 8, to: 14, label: 'Subthreshold', color: SEVERITY_COLOR.amber },
      { from: 15, to: 21, label: 'Moderate clinical', color: SEVERITY_COLOR.orange },
      { from: 22, to: 28, label: 'Severe clinical', color: SEVERITY_COLOR.red },
    ],
  },
  psqi: {
    slug: 'psqi',
    family: 'rating_scale',
    maxScore: 21,
    minScore: 0,
    severityBands: [
      { from: 0, to: 5, label: 'Good sleep quality', color: SEVERITY_COLOR.green },
      { from: 6, to: 21, label: 'Poor sleep quality', color: SEVERITY_COLOR.red },
    ],
  },
  sds: {
    slug: 'sds',
    family: 'rating_scale',
    maxScore: 30,
    minScore: 0,
    severityBands: [],
  },
  mdq: {
    slug: 'mdq',
    family: 'rating_scale',
    maxScore: 13,
    minScore: 0,
    severityBands: [
      { from: 0, to: 6, label: 'Negative screen', color: SEVERITY_COLOR.green },
      { from: 7, to: 13, label: 'Positive screen — assess further', color: SEVERITY_COLOR.red },
    ],
  },
  asrs: {
    slug: 'asrs',
    family: 'rating_scale',
    maxScore: 24,
    minScore: 0,
    severityBands: [],
  },
  ocir: {
    slug: 'ocir',
    family: 'rating_scale',
    maxScore: 72,
    minScore: 0,
    severityBands: [
      { from: 0, to: 20, label: 'Below clinical cut-off', color: SEVERITY_COLOR.green },
      { from: 21, to: 72, label: 'Likely OCD — assess further', color: SEVERITY_COLOR.red },
    ],
  },
  'ybocs-sr': {
    slug: 'ybocs-sr',
    family: 'rating_scale',
    maxScore: 40,
    minScore: 0,
    severityBands: [
      { from: 0, to: 7, label: 'Subclinical', color: SEVERITY_COLOR.green },
      { from: 8, to: 15, label: 'Mild', color: SEVERITY_COLOR.amber },
      { from: 16, to: 23, label: 'Moderate', color: SEVERITY_COLOR.orange },
      { from: 24, to: 31, label: 'Severe', color: SEVERITY_COLOR.red },
      { from: 32, to: 40, label: 'Extreme', color: SEVERITY_COLOR.red },
    ],
  },
  rcads25: {
    slug: 'rcads25',
    family: 'rating_scale',
    maxScore: 75,
    minScore: 0,
    severityBands: [],
  },

  // ── Clinician-rated rating scales ─────────────────────────────────────
  hamd17: {
    slug: 'hamd17',
    family: 'rating_scale',
    maxScore: 52,
    minScore: 0,
    severityBands: [
      { from: 0, to: 7, label: 'No depression', color: SEVERITY_COLOR.green },
      { from: 8, to: 13, label: 'Mild', color: SEVERITY_COLOR.amber },
      { from: 14, to: 18, label: 'Moderate', color: SEVERITY_COLOR.orange },
      { from: 19, to: 22, label: 'Severe', color: SEVERITY_COLOR.red },
      { from: 23, to: 52, label: 'Very severe', color: SEVERITY_COLOR.red },
    ],
  },
  madrs: {
    slug: 'madrs',
    family: 'rating_scale',
    maxScore: 60,
    minScore: 0,
    severityBands: [
      { from: 0, to: 6, label: 'Normal', color: SEVERITY_COLOR.green },
      { from: 7, to: 19, label: 'Mild', color: SEVERITY_COLOR.amber },
      { from: 20, to: 34, label: 'Moderate', color: SEVERITY_COLOR.orange },
      { from: 35, to: 60, label: 'Severe', color: SEVERITY_COLOR.red },
    ],
  },
  hama: {
    slug: 'hama',
    family: 'rating_scale',
    maxScore: 56,
    minScore: 0,
    severityBands: [
      { from: 0, to: 17, label: 'Mild', color: SEVERITY_COLOR.amber },
      { from: 18, to: 24, label: 'Mild to moderate', color: SEVERITY_COLOR.orange },
      { from: 25, to: 30, label: 'Moderate to severe', color: SEVERITY_COLOR.red },
      { from: 31, to: 56, label: 'Severe', color: SEVERITY_COLOR.red },
    ],
  },
  ymrs: {
    slug: 'ymrs',
    family: 'rating_scale',
    maxScore: 60,
    minScore: 0,
    severityBands: [],
  },
  bprs24: {
    slug: 'bprs24',
    family: 'rating_scale',
    maxScore: 168,
    minScore: 24,
    severityBands: [],
  },
  panss: {
    slug: 'panss',
    family: 'rating_scale',
    maxScore: 210,
    minScore: 30,
    severityBands: [],
  },
  aims: {
    slug: 'aims',
    family: 'rating_scale',
    maxScore: 28,
    minScore: 0,
    severityBands: [],
  },
  sas: {
    slug: 'sas',
    family: 'rating_scale',
    maxScore: 40,
    minScore: 0,
    severityBands: [],
  },
  cgi: {
    slug: 'cgi',
    family: 'rating_scale',
    maxScore: 7,
    minScore: 1,
    severityBands: [
      { from: 1, to: 1, label: 'Normal', color: SEVERITY_COLOR.green },
      { from: 2, to: 2, label: 'Borderline ill', color: SEVERITY_COLOR.green },
      { from: 3, to: 3, label: 'Mildly ill', color: SEVERITY_COLOR.amber },
      { from: 4, to: 4, label: 'Moderately ill', color: SEVERITY_COLOR.orange },
      { from: 5, to: 5, label: 'Markedly ill', color: SEVERITY_COLOR.orange },
      { from: 6, to: 6, label: 'Severely ill', color: SEVERITY_COLOR.red },
      { from: 7, to: 7, label: 'Among the most extremely ill', color: SEVERITY_COLOR.red },
    ],
  },
  gaf: {
    slug: 'gaf',
    family: 'rating_scale',
    maxScore: 100,
    minScore: 1,
    severityBands: [
      { from: 1, to: 10, label: 'Persistent danger / unable', color: SEVERITY_COLOR.red },
      { from: 11, to: 20, label: 'Some danger / gross impairment', color: SEVERITY_COLOR.red },
      { from: 21, to: 30, label: 'Inability to function in many areas', color: SEVERITY_COLOR.red },
      { from: 31, to: 40, label: 'Major impairment', color: SEVERITY_COLOR.orange },
      { from: 41, to: 50, label: 'Serious symptoms', color: SEVERITY_COLOR.orange },
      { from: 51, to: 60, label: 'Moderate symptoms', color: SEVERITY_COLOR.amber },
      { from: 61, to: 70, label: 'Mild symptoms', color: SEVERITY_COLOR.amber },
      { from: 71, to: 80, label: 'Transient symptoms', color: SEVERITY_COLOR.green },
      { from: 81, to: 90, label: 'Absent or minimal symptoms', color: SEVERITY_COLOR.green },
      { from: 91, to: 100, label: 'Superior functioning', color: SEVERITY_COLOR.green },
    ],
  },
  mmse: {
    slug: 'mmse',
    family: 'rating_scale',
    maxScore: 30,
    minScore: 0,
    severityBands: [
      { from: 0, to: 9, label: 'Severe impairment', color: SEVERITY_COLOR.red },
      { from: 10, to: 18, label: 'Moderate impairment', color: SEVERITY_COLOR.orange },
      { from: 19, to: 23, label: 'Mild impairment', color: SEVERITY_COLOR.amber },
      { from: 24, to: 30, label: 'Normal', color: SEVERITY_COLOR.green },
    ],
  },
  moca: {
    slug: 'moca',
    family: 'rating_scale',
    maxScore: 30,
    minScore: 0,
    severityBands: [
      { from: 0, to: 25, label: 'Below cognitive threshold', color: SEVERITY_COLOR.red },
      { from: 26, to: 30, label: 'Normal', color: SEVERITY_COLOR.green },
    ],
  },
};

/**
 * Lookup scoring metadata by slug. Returns undefined when the slug has
 * no published max/severity bands — the visualisation layer flags the
 * point as `not graphable: missing structured score` rather than
 * silently inventing a max.
 */
export function getScoringMetadata(slug: string): ScoringMetadata | undefined {
  return SCORING_METADATA[slug];
}

/**
 * Look up a severity band by raw score. Returns undefined when the
 * instrument has no published bands, or when the score lies outside
 * every band (which would itself indicate stale/corrupt data; the UI
 * shows the raw score without a chip).
 */
export function getSeverityBandForScore(
  slug: string,
  rawScore: number,
): SeverityBand | undefined {
  const meta = SCORING_METADATA[slug];
  if (!meta) return undefined;
  for (const band of meta.severityBands) {
    if (rawScore >= band.from && rawScore <= band.to) return band;
  }
  return undefined;
}

/**
 * The set of all slugs declared in the metadata table. Used by tests to
 * assert overlap with the assessmentTaxonomy registry.
 */
export const SCORING_METADATA_SLUGS: readonly string[] = Object.keys(SCORING_METADATA);
