// apps/web/src/features/ai-agent/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the AI agent page.
// Centralized so future mutations on llm-models / staff lookups / ai patient
// search invalidate the cache without literal-array drift (CLAUDE.md §4.1).
//
// Cross-feature notes:
//   - aiAgentKeys.staffLookup() is namespaced under ['staff', ...] so a staff
//     mutation that broad-invalidates ['staff'] also drops this lookup cache.
//   - aiAgentKeys.patientSearch(term) is namespaced under ['patients', ...]
//     for the same reason.
export const aiAgentKeys = {
  all: ['ai-agent'] as const,
  llmModels: () => ['llm-models'] as const,
  staffLookup: () => ['staff', 'lookup-agent'] as const,
  orgUnitTree: () => ['org-settings', 'units', 'tree', 'ai-agent'] as const,
  patientSearch: (term: string) => ['patients', 'search-ai', term] as const,
} as const;
