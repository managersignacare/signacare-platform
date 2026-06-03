// apps/web/src/features/llm/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the LLM feature.
// Centralized so any future mutations (e.g. model swaps, health resets)
// invalidate caches without literal-array drift (CLAUDE.md §4.1).
export const llmKeys = {
  all: ['llm'] as const,
  health: () => [...llmKeys.all, 'health'] as const,
} as const;
