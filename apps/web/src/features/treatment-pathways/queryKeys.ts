// apps/web/src/features/treatment-pathways/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for treatment pathways.
// Single source of truth for cache keys so mutation invalidations always
// match the corresponding queries (CLAUDE.md §4.1).
export const pathwayKeys = {
  all: ['pathways'] as const,
  lists: () => [...pathwayKeys.all, 'list'] as const,
  list: () => [...pathwayKeys.lists(), 'clinic'] as const,
  byPatient: (patientId: string) =>
    [...pathwayKeys.all, 'patient', patientId] as const,
  detail: (id: string) => [...pathwayKeys.all, 'detail', id] as const,
  digitalDetail: (id: string) =>
    [...pathwayKeys.detail(id), 'digital'] as const,
  stepCareRules: () => [...pathwayKeys.all, 'step-care', 'rules'] as const,
  researchRoot: () => [...pathwayKeys.all, 'research'] as const,
  researchSummary: (periodDays: number) =>
    [...pathwayKeys.researchRoot(), 'summary', periodDays] as const,
  wearablesRoot: () => [...pathwayKeys.all, 'wearables'] as const,
  wearableProviders: () => [...pathwayKeys.wearablesRoot(), 'providers'] as const,
  wearableSources: (patientId: string) =>
    [...pathwayKeys.wearablesRoot(), 'sources', patientId] as const,
  phenotypes: (patientId: string, limit: number) =>
    [...pathwayKeys.wearablesRoot(), 'phenotypes', patientId, limit] as const,
  behavioralRoot: () => [...pathwayKeys.all, 'behavioral'] as const,
  behaviorContracts: (patientId: string) =>
    [...pathwayKeys.behavioralRoot(), 'contracts', patientId] as const,
  routines: (patientId: string) =>
    [...pathwayKeys.behavioralRoot(), 'routines', patientId] as const,
  streaks: (patientId: string) =>
    [...pathwayKeys.behavioralRoot(), 'streaks', patientId] as const,
  friction: (patientId: string) =>
    [...pathwayKeys.behavioralRoot(), 'friction', patientId] as const,
  segment: (patientId: string) =>
    [...pathwayKeys.behavioralRoot(), 'segment', patientId] as const,
  slaBoard: () =>
    [...pathwayKeys.behavioralRoot(), 'sla-board'] as const,
  microLearningCards: () =>
    [...pathwayKeys.behavioralRoot(), 'micro-learning', 'cards'] as const,
  microLearningRules: () =>
    [...pathwayKeys.behavioralRoot(), 'micro-learning', 'rules'] as const,
  microLearningAssignments: (patientId: string) =>
    [...pathwayKeys.behavioralRoot(), 'micro-learning', 'assignments', patientId] as const,
  choiceArchitectureDefaults: () =>
    [...pathwayKeys.behavioralRoot(), 'choice-architecture', 'defaults'] as const,
} as const;
