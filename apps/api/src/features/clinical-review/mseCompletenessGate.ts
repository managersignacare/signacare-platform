// apps/api/src/features/clinical-review/mseCompletenessGate.ts
//
// BUG-377 (2026-05-03) — Mental State Examination completeness gate.
//
// MSE consultations have 11 domains per `MentalStateExamSchema`:
//   appearance / behaviour / speech / mood / affect / thoughtForm /
//   thoughtContent / perception / cognition / insight / judgement
//
// A consultation transitioning to status='signed' (immutable forensic
// record) MUST have a meaningful MSE — sparse coverage (most domains
// blank or marked "not assessed") is a coronial / AHPRA Standard 1
// risk: the signed record is the legal artefact of the clinical
// encounter; an MSE with 9 out of 11 domains skipped is functionally
// "no MSE was performed" but presents as "consultation signed".
//
// Threshold (per catalogue text "block sign with ≥ 8/10 not_assessed"):
// ≥ 8 of 11 domains not assessed → reject. Conservative interpretation —
// the catalogue undercounted to 10; we apply the same absolute count
// (8) against the actual 11-domain schema, yielding ~73% threshold.
//
// What counts as "not assessed":
//   - null
//   - empty string
//   - whitespace-only string
//   - case-insensitive match against the canonical placeholders:
//       "not assessed", "not_assessed", "not-assessed", "n/a",
//       "na", "none", "nil", "—", "-", "?"
// Anything else (clinician's actual finding) counts as ASSESSED, even
// if very brief ("ok" / "WNL" / "intact" / etc.).
//
// The gate ONLY fires on status='signed' transition. Drafts may be
// arbitrarily incomplete during composition; signing locks the record.
//
// Sibling architectural pattern of CLAUDE.md §17.4 retention triple-
// lock: structural enforcement at the boundary, not a UI-only rail.

import { AppError } from '../../shared/errors';
import type { MentalStateExam } from '@signacare/shared';

/**
 * Canonical "not assessed" placeholder strings (case-insensitive +
 * whitespace-trimmed). A consultation with these values in an MSE
 * domain is treated identically to a null / empty entry.
 */
const NOT_ASSESSED_PLACEHOLDERS = new Set([
  'not assessed',
  'not_assessed',
  'not-assessed',
  'n/a',
  'na',
  'none',
  'nil',
  '—',
  '-',
  '?',
  '',
]);

/**
 * Number of domains that may be unassessed before a sign attempt is
 * rejected. Threshold per BUG-377 catalogue (8/10 → 8/11 absolute).
 */
export const MSE_MAX_NOT_ASSESSED_FOR_SIGN = 8;

/**
 * Total number of MSE domains in `MentalStateExamSchema`.
 */
export const MSE_DOMAIN_COUNT = 11;

/**
 * Decide whether a single MSE domain value counts as "assessed".
 * Exported for testability.
 */
export function isDomainAssessed(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const trimmed = value.trim().toLowerCase();
  if (NOT_ASSESSED_PLACEHOLDERS.has(trimmed)) return false;
  return true;
}

/**
 * Count assessed + not-assessed domains in an MSE.
 * Exported for testability + downstream observability.
 */
export function countMseDomains(mse: MentalStateExam | null | undefined): {
  assessed: number;
  notAssessed: number;
  domains: { name: keyof MentalStateExam; assessed: boolean }[];
} {
  const allDomains: (keyof MentalStateExam)[] = [
    'appearance', 'behaviour', 'speech', 'mood', 'affect',
    'thoughtForm', 'thoughtContent', 'perception', 'cognition',
    'insight', 'judgement',
  ];
  if (!mse) {
    return {
      assessed: 0,
      notAssessed: allDomains.length,
      domains: allDomains.map((name) => ({ name, assessed: false })),
    };
  }
  const domains = allDomains.map((name) => ({
    name,
    assessed: isDomainAssessed(mse[name]),
  }));
  const assessed = domains.filter((d) => d.assessed).length;
  return {
    assessed,
    notAssessed: domains.length - assessed,
    domains,
  };
}

/**
 * Boundary gate — call this at consultation create/update WHENEVER the
 * intended state is `status='signed'`. Throws AppError(422,
 * 'MSE_INCOMPLETE_FOR_SIGN') if the MSE has ≥ MSE_MAX_NOT_ASSESSED_FOR_SIGN
 * domains marked "not assessed" (per `isDomainAssessed`).
 *
 * No-ops if status is anything other than 'signed' (drafts are allowed
 * to be sparse during composition).
 *
 * No-ops if mse is `null` AND status is NOT 'signed' (drafts may have
 * no MSE attached). If status === 'signed' AND mse is null/undefined
 * the gate REJECTS — a signed consultation must have at least one MSE
 * domain populated.
 */
export function assertMseCompletenessOnSign(
  mse: MentalStateExam | null | undefined,
  status: string,
): void {
  if (status !== 'signed') return;
  const { notAssessed, assessed, domains } = countMseDomains(mse);
  if (notAssessed >= MSE_MAX_NOT_ASSESSED_FOR_SIGN) {
    const skipped = domains.filter((d) => !d.assessed).map((d) => d.name);
    throw new AppError(
      `Cannot sign consultation: only ${assessed} of ${MSE_DOMAIN_COUNT} MSE domains assessed. Sign requires at least ${MSE_DOMAIN_COUNT - MSE_MAX_NOT_ASSESSED_FOR_SIGN + 1} domains assessed.`,
      422,
      'MSE_INCOMPLETE_FOR_SIGN',
      { assessed, notAssessed, totalDomains: MSE_DOMAIN_COUNT, skippedDomains: skipped },
    );
  }
}
