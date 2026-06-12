/**
 * Per-document-type context policy SSoT.
 *
 * Declares — for each ContextDocumentType — which fact domains are
 * required (Tier-A, never-droppable), recommended (Tier-B, windowed),
 * and optional (Tier-C, explicit opt-in). Also declares the default
 * lookback window, token budget, citation rules, and PHI class.
 *
 * The registry is DECLARATIVE: no live DB calls, no I/O. The builder
 * (slice 2) will read this registry to know what to fetch and what
 * to budget; the budgeter reads it to enforce the Tier-A floor.
 *
 * Drift between this registry and the ContextDocumentType enum in
 * @signacare/shared is mechanically caught by
 * `npm run guard:clinical-context-contract`.
 */
import type {
  ClinicalContextFact,
  ContextDocumentType,
  ContextPhiClass,
} from '@signacare/shared';

type FactDomain = ClinicalContextFact['domain'];

export interface ContextPolicy {
  readonly documentType: ContextDocumentType;
  readonly schemaVersion: '1.0.0';
  /** Tier-A — the budgeter NEVER drops these. Overflow surfaces as `budgetExceeded: true`. */
  readonly required: readonly FactDomain[];
  /** Tier-B — included up to budget; drop oldest-first within domain. */
  readonly recommended: readonly FactDomain[];
  /** Tier-C — included only when the caller explicitly opts in per build. */
  readonly optional: readonly FactDomain[];
  /** Default historical-lookback window in days. 0 means "current consult only". */
  readonly defaultLookbackDays: number;
  /** Per-call token budget (output context, not prompt overhead). */
  readonly defaultTokenBudget: number;
  /** Domains where Linked-Evidence citation is mandatory at render time. */
  readonly citationRequiredFor: readonly FactDomain[];
  /** Drives sanitizer behaviour + future model-router routing. */
  readonly defaultPhiClass: ContextPhiClass;
}

const SCRIBE_PASS2: ContextPolicy = {
  documentType: 'scribe-pass2',
  schemaVersion: '1.0.0',
  required: [
    'demographics',
    'active_episodes',
    'active_medications',
    'allergies',
    'risk_assessment',
    'safety_plan',
    'consent_state',
  ],
  recommended: ['recent_notes', 'recent_assessments', 'recent_review'],
  optional: [],
  defaultLookbackDays: 30,
  defaultTokenBudget: 4_000,
  citationRequiredFor: ['active_medications', 'risk_assessment', 'recent_notes'],
  defaultPhiClass: 'high',
};

const AVS: ContextPolicy = {
  documentType: 'avs',
  schemaVersion: '1.0.0',
  required: ['demographics', 'allergies'],
  recommended: ['active_medications', 'recent_appointments'],
  optional: ['preferred_language', 'reading_level'],
  defaultLookbackDays: 0,
  defaultTokenBudget: 1_000,
  citationRequiredFor: [],
  defaultPhiClass: 'medium',
};

const REFERRAL_LETTER: ContextPolicy = {
  documentType: 'referral-letter',
  schemaVersion: '1.0.0',
  required: [
    'demographics',
    'active_episodes',
    'active_medications',
    'allergies',
    'risk_assessment',
    'care_team',
  ],
  recommended: [
    'recent_notes',
    'recent_pathology',
    'recent_review',
    'treatment_pathway',
  ],
  optional: ['full_episode_arc'],
  defaultLookbackDays: 180,
  defaultTokenBudget: 6_000,
  citationRequiredFor: ['recent_notes', 'recent_review', 'active_medications'],
  defaultPhiClass: 'high',
};

const MHT_TREATMENT_ORDER: ContextPolicy = {
  documentType: 'mht-treatment-order',
  schemaVersion: '1.0.0',
  required: [
    'demographics',
    'active_episodes',
    'active_medications',
    'allergies',
    'risk_assessment',
    'care_team',
  ],
  recommended: [
    'recent_notes',
    'recent_review',
    'recent_correspondence',
    'full_episode_arc',
  ],
  optional: [],
  defaultLookbackDays: 365,
  defaultTokenBudget: 8_000,
  citationRequiredFor: [
    'active_medications',
    'risk_assessment',
    'recent_notes',
    'recent_review',
    'full_episode_arc',
  ],
  defaultPhiClass: 'high',
};

const NDIS_ACCESS_LETTER: ContextPolicy = {
  documentType: 'ndis-access-letter',
  schemaVersion: '1.0.0',
  required: [
    'demographics',
    'active_episodes',
    'active_medications',
    'allergies',
  ],
  recommended: [
    'recent_notes',
    'recent_assessments',
    'recent_review',
    'recent_appointments',
  ],
  optional: [],
  defaultLookbackDays: 365,
  defaultTokenBudget: 6_000,
  citationRequiredFor: ['recent_notes', 'recent_assessments', 'recent_review'],
  defaultPhiClass: 'high',
};

const NDIS_SUPPORTING_EVIDENCE: ContextPolicy = {
  documentType: 'ndis-supporting-evidence',
  schemaVersion: '1.0.0',
  required: [
    'demographics',
    'active_episodes',
    'active_medications',
    'allergies',
  ],
  recommended: [
    'recent_notes',
    'recent_assessments',
    'recent_review',
    'recent_appointments',
  ],
  optional: [],
  defaultLookbackDays: 365,
  defaultTokenBudget: 6_000,
  citationRequiredFor: ['recent_notes', 'recent_assessments', 'recent_review'],
  defaultPhiClass: 'high',
};

const GP_LETTER: ContextPolicy = {
  documentType: 'gp-letter',
  schemaVersion: '1.0.0',
  required: [
    'demographics',
    'active_episodes',
    'active_medications',
    'allergies',
    'care_team',
  ],
  recommended: ['recent_notes', 'recent_pathology', 'recent_review'],
  optional: [],
  defaultLookbackDays: 180,
  defaultTokenBudget: 4_000,
  citationRequiredFor: ['active_medications', 'recent_notes', 'recent_pathology'],
  defaultPhiClass: 'high',
};

const PHARMACY_LETTER: ContextPolicy = {
  documentType: 'pharmacy-letter',
  schemaVersion: '1.0.0',
  required: ['demographics', 'active_medications', 'allergies', 'care_team'],
  recommended: ['recent_pathology', 'recent_review'],
  optional: [],
  defaultLookbackDays: 180,
  defaultTokenBudget: 3_000,
  citationRequiredFor: ['active_medications'],
  defaultPhiClass: 'high',
};

const NDIS_SUPPORT_LETTER: ContextPolicy = {
  documentType: 'ndis-support-letter',
  schemaVersion: '1.0.0',
  required: [
    'demographics',
    'active_episodes',
    'active_medications',
    'allergies',
  ],
  recommended: [
    'recent_notes',
    'recent_assessments',
    'recent_review',
    'recent_appointments',
  ],
  optional: [],
  defaultLookbackDays: 365,
  defaultTokenBudget: 6_000,
  citationRequiredFor: ['recent_notes', 'recent_assessments', 'recent_review'],
  defaultPhiClass: 'high',
};

const NDIS_REVIEW_LETTER: ContextPolicy = {
  documentType: 'ndis-review-letter',
  schemaVersion: '1.0.0',
  required: [
    'demographics',
    'active_episodes',
    'active_medications',
    'allergies',
  ],
  recommended: [
    'recent_notes',
    'recent_assessments',
    'recent_review',
    'recent_appointments',
  ],
  optional: [],
  defaultLookbackDays: 365,
  defaultTokenBudget: 6_000,
  citationRequiredFor: ['recent_notes', 'recent_assessments', 'recent_review'],
  defaultPhiClass: 'high',
};

export const CONTEXT_POLICY_REGISTRY: Readonly<Record<ContextDocumentType, ContextPolicy>> = {
  'scribe-pass2': SCRIBE_PASS2,
  'avs': AVS,
  'referral-letter': REFERRAL_LETTER,
  'mht-treatment-order': MHT_TREATMENT_ORDER,
  'ndis-access-letter': NDIS_ACCESS_LETTER,
  'ndis-supporting-evidence': NDIS_SUPPORTING_EVIDENCE,
  'gp-letter': GP_LETTER,
  'pharmacy-letter': PHARMACY_LETTER,
  'ndis-support-letter': NDIS_SUPPORT_LETTER,
  'ndis-review-letter': NDIS_REVIEW_LETTER,
};

/**
 * Throws a plain Error on unknown documentType — programmer-misuse signal,
 * NOT a user-facing 4xx. Slice 2 will wrap with `Result.err(AppError(...))`
 * at the service boundary per CLAUDE.md §3.4 expected-vs-unexpected.
 */
export function getContextPolicy(documentType: ContextDocumentType): ContextPolicy {
  const policy = CONTEXT_POLICY_REGISTRY[documentType];
  if (!policy) {
    throw new Error(`No context policy registered for document type '${documentType}'`);
  }
  return policy;
}

/** Stable list of registered document types — used by the contract test + guard. */
export function listRegisteredDocumentTypes(): readonly ContextDocumentType[] {
  return Object.keys(CONTEXT_POLICY_REGISTRY) as ContextDocumentType[];
}
