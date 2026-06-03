/**
 * Canonical module keys for the staff_module_access ABAC layer.
 *
 * Every call to requireModuleRead / requireModuleWrite should use
 * one of these constants rather than a raw string literal. Three
 * reasons:
 *
 *   1. Typo protection — a mis-spelt 'medical-scibe' would silently
 *      allow everyone through because the DB has no matching row.
 *      Importing the constant gives us a compile-time guarantee.
 *   2. Single source of truth — the backfill migrations and the
 *      clinic admin matrix UI both need to know the exact set of
 *      valid module keys.
 *   3. Refactoring discipline — renaming a module key becomes a
 *      find-and-replace on this file plus a data migration, rather
 *      than a whole-codebase grep.
 *
 * Two distinct naming conventions live in this file, deliberately:
 *
 *   - Legacy keys use `snake_case` with underscores. They were
 *     seeded by pre-existing onboarding scripts and the old
 *     AccessControlPanel, and the live database already stores
 *     rows with these exact spellings. Renaming them would be
 *     a schema migration + a data rewrite we don't need — the
 *     strings are opaque identifiers to the middleware.
 *   - Newer keys use `kebab-case` with hyphens. All new modules
 *     added from here on follow this convention.
 *
 * When adding a new module key:
 *   - Use kebab-case.
 *   - Add a backfill migration that seeds grants for any staff
 *     who already have de-facto access (CLAUDE.md §9.2 — no new
 *     gated feature without backfill).
 *   - Add a human-readable label to MODULE_LABELS in
 *     apps/web/src/features/staff-settings/components/
 *     ModuleAccessMatrix.tsx so the matrix column is readable.
 *   - Update docs/fix-registry.md with a MOD-<key> row asserting
 *     the constant is referenced from the file(s) that enforce it.
 */

// ── Legacy modules (snake_case, pre-dating this file) ──────────────────
// Every one of these keys exists in the live database today with
// access_level rows for staff seeded by older onboarding scripts. The
// module-access middleware reads them literally, so the string values
// must stay exact. Listed alphabetically for diff-friendliness.
const LEGACY = {
  ADVANCE_DIRECTIVES:  'advance_directives',
  APPOINTMENTS:        'appointments',
  AUDIT:               'audit',
  BEDS:                'beds',
  BILLING:             'billing',
  CARERS:              'carers',
  CLINICAL_NOTES:      'clinical_notes',
  CLOZAPINE:           'clozapine',
  CORRESPONDENCE:      'correspondence',
  ECT:                 'ect',
  EPISODES:            'episodes',
  ESCALATIONS:         'escalations',
  GROUP_THERAPY:       'group_therapy',
  LAI:                 'lai',
  LEGAL_ORDERS:        'legal_orders',
  MEDICATIONS:         'medications',
  MESSAGES:            'messages',
  NURSING_ASSESSMENTS: 'nursing_assessments',
  OUTCOMES:            'outcomes',
  PATHOLOGY:           'pathology',
  PATIENTS:            'patients',
  PRESCRIPTIONS:       'prescriptions',
  REFERRALS:           'referrals',
  REPORTS:             'reports',
  RISK_ASSESSMENTS:    'risk_assessments',
  SAFETY_PLANS:        'safety_plans',
  SETTINGS:            'settings',
  TASKS:               'tasks',
  TEMPLATES:           'templates',
  TMS:                 'tms',
  VOICE:               'voice',
} as const;

// ── New modules (kebab-case, enforced today) ───────────────────────────
// These four are the only module keys the middleware currently reads
// at request time. The legacy keys above are available for management
// in the admin matrix but their enforcement wires up per-route as a
// follow-up. See docs/fix-registry.md (MOD-<key> rows) for the
// authoritative list of what is actually enforced where.
const NEW = {
  IMPORTS:             'imports',
  PATIENT_ALLOCATIONS: 'patient-allocations',
  PATHWAYS:            'pathways',
  MEDICAL_SCRIBE:      'medical-scribe',
  AGENTIC_AI_SCRIBE:   'agentic-ai-scribe',
  AI:                  'ai',
  AI_AGENT:            'ai-agent',
  // Phase 8 — Oncology mCODE module
  ONCOLOGY:            'oncology',
  // Phase — Telehealth video (Jitsi embedded)
  TELEHEALTH:          'telehealth',
  // BI / compliance dashboard
  REPORTS_BI:          'reports-bi',
  // Phase 13 — per-clinician calendar with traffic-light availability
  CALENDAR:            'calendar',
  // Phase 0.7.2 — ECT + TMS psychiatry treatment modules
  ECT:                 'ect',
  TMS:                 'tms',
} as const;

export const MODULE_KEYS = {
  ...LEGACY,
  ...NEW,
} as const;

export type ModuleKey = (typeof MODULE_KEYS)[keyof typeof MODULE_KEYS];

/** All known module keys as a flat array — used by the matrix
 *  endpoint and the backfill migrations. Legacy keys come first so
 *  the matrix columns stay stable across releases. */
export const ALL_MODULE_KEYS: readonly ModuleKey[] = [
  ...Object.values(LEGACY),
  ...Object.values(NEW),
];

/** The subset of module keys that are actively enforced by the
 *  moduleAccessMiddleware today. Useful for tests and for the matrix
 *  UI to flag "this module has real teeth" vs "this module is
 *  management-only". */
export const ENFORCED_MODULE_KEYS: readonly ModuleKey[] = Object.values(NEW);

/**
 * Backward-compat aliases for historical module keys that were
 * emitted by older provisioning / Power Settings catalogs.
 *
 * Keep this map intentionally small and explicit — each alias must
 * point at a canonical MODULE_KEYS value.
 */
export const LEGACY_MODULE_KEY_ALIASES: Readonly<Record<string, ModuleKey>> = {
  ai_scribe: MODULE_KEYS.MEDICAL_SCRIBE,
  ai_agent: MODULE_KEYS.AI_AGENT,
};

export function canonicalizeModuleKey(moduleKey: string): string {
  const trimmed = moduleKey.trim();
  return LEGACY_MODULE_KEY_ALIASES[trimmed] ?? trimmed;
}
