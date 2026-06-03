// apps/web/src/features/settings/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factories for the settings feature.
// Single source of truth for cache keys so mutation invalidations always
// match the corresponding queries (CLAUDE.md §4.1).
//
// The settings page is a multi-panel dashboard that touches several
// top-level namespaces. Cross-feature namespaces (`staff-settings`, `llm-*`,
// `clinic`) are preserved as literal string prefixes here — we never import
// another feature's factory.

export const settingsKeys = {
  all: ['settings'] as const,
  thresholds: () => [...settingsKeys.all, 'thresholds'] as const,
} as const;

export const mfaKeys = {
  all: ['mfa-status'] as const,
} as const;

export const outlookKeys = {
  all: ['outlook-status'] as const,
} as const;

export const licenseKeys = {
  all: ['license-status'] as const,
} as const;

export const cmiKeys = {
  all: ['cmi-status'] as const,
} as const;

export const workflowsKeys = {
  all: ['workflows'] as const,
} as const;

// Cross-feature namespace: 'clinic' belongs to the clinic feature.
export const clinicProfileKeys = {
  all: ['clinic', 'profile'] as const,
} as const;

// BUG-339 — eRx identity config (clinics.hpio / npds_conformance_id /
// erx_etp1_site_id). Same 'clinic' namespace so a PUT /clinics/:id
// from this panel invalidates clinicProfileKeys.all too.
export const erxConfigKeys = {
  all: ['clinic', 'erx-config'] as const,
  detail: (clinicId: string) => [...erxConfigKeys.all, clinicId] as const,
} as const;

// Cross-feature namespace: 'staff-settings' belongs to the staff-settings feature.
export const staffSettingsClinicalPoliciesKeys = {
  all: ['staff-settings', 'clinical-policies'] as const,
} as const;

export const staffSettingsAiContextKeys = {
  all: ['staff-settings', 'ai-context'] as const,
} as const;

// Cross-feature namespace: 'llm-*' belongs to the LLM feature.
export const llmModelfilesKeys = {
  all: ['llm-modelfiles'] as const,
} as const;

export const llmModelfileKeys = {
  all: ['llm-modelfile'] as const,
  detail: (action: string) => [...llmModelfileKeys.all, action] as const,
} as const;

export const llmTrainingStatsKeys = {
  all: ['llm-training-stats'] as const,
} as const;

export const llmTrainingAdaptersKeys = {
  all: ['llm-training-adapters'] as const,
} as const;

export const llmPromptProfilesKeys = {
  all: ['llm-prompt-profiles'] as const,
} as const;
