/**
 * Pure helpers for the measurement chart components. Kept dependency-free
 * (no React, no MUI) so they can be unit-tested independently and shared
 * with future surfaces (mobile Viva clinician view, export PDFs, etc.).
 */
import type {
  MeasurementFamily,
  MeasurementSeries,
  MeasurementSource,
  TrendDirection,
} from '@signacare/shared';

/**
 * Display label for the rater type + source combination, used in
 * provenance chips. Centralised so every surface uses the same wording.
 */
export function describeMeasurementProvenance(source: MeasurementSource): string {
  switch (source) {
    case 'outcome_measure': return 'Clinician — NOCC outcome';
    case 'clinical_note_rating_scale': return 'Clinician — rating scale';
    case 'viva_patient_app': return 'Patient — Viva app';
    default: return 'Unknown source';
  }
}

/**
 * Family display label. Used in section headings.
 */
export function describeMeasurementFamily(family: MeasurementFamily): string {
  switch (family) {
    case 'outcome_measure': return 'Outcome Measures';
    case 'clinician_rating_scale': return 'Clinician-Rated Rating Scales';
    case 'self_rated_scale': return 'Viva Self-Rated Measures';
    default: return 'Measurements';
  }
}

/**
 * Trend direction display label (paired with arrow + colour for visual).
 */
export function describeTrendDirection(direction: TrendDirection): {
  label: string;
  // Returns a tag the UI consumes; the actual colour mapping lives next to
  // each component's MUI palette usage.
  tone: 'positive' | 'negative' | 'neutral' | 'unknown';
  arrow: '↑' | '↓' | '→' | '…';
} {
  switch (direction) {
    case 'improved': return { label: 'Improved', tone: 'positive', arrow: '↓' };
    case 'worsened': return { label: 'Worsened', tone: 'negative', arrow: '↑' };
    case 'stable': return { label: 'Stable', tone: 'neutral', arrow: '→' };
    case 'insufficient_data': return { label: 'Trend unavailable', tone: 'unknown', arrow: '…' };
    default: return { label: 'Trend unavailable', tone: 'unknown', arrow: '…' };
  }
}

/**
 * Compute "X days ago" string from an ISO timestamp. Uses the same
 * rounding the Viva tab uses today (whole days; today → "today").
 */
export function describeRelativeAge(iso: string, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const days = Math.floor((now.getTime() - then.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

/**
 * "stale" marker per the operator brief — if the latest administration
 * was >= 90 days ago for a longitudinal series, the UI shows a stale chip
 * so the clinician knows not to rely on the chart as a current snapshot.
 */
export function isMeasurementStale(latestIso: string, now: Date = new Date()): boolean {
  if (!latestIso) return false;
  const then = new Date(latestIso);
  if (Number.isNaN(then.getTime())) return false;
  return now.getTime() - then.getTime() > 90 * 86400000;
}

/**
 * Sort key for series within a family — newest latest-point first, then
 * by displayName for a stable order when timestamps are equal.
 */
export function sortSeriesByRecency(a: MeasurementSeries, b: MeasurementSeries): number {
  const at = a.latestPoint?.completedAt ?? '';
  const bt = b.latestPoint?.completedAt ?? '';
  if (at !== bt) return bt.localeCompare(at);
  return a.displayName.localeCompare(b.displayName);
}
