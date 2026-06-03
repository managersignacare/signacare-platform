// apps/web/src/features/templates/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the templates feature.
// Single source of truth for cache keys so mutation invalidations always
// match the corresponding queries (CLAUDE.md §4.1).
import type { TemplateStatus } from './types/templateTypes';

export const templateKeys = {
  all: ['templates'] as const,
  lists: () => [...templateKeys.all, 'list'] as const,
  list: (params?: { status?: TemplateStatus; category?: string }) =>
    [...templateKeys.lists(), params ?? {}] as const,
  listByFilter: (typeFilter: string, catFilter: string) =>
    [...templateKeys.lists(), { type: typeFilter, categoryId: catFilter }] as const,
  details: () => [...templateKeys.all, 'detail'] as const,
  detail: (id: string) => [...templateKeys.details(), id] as const,
} as const;

export const templateCategoryKeys = {
  all: ['template-categories'] as const,
  list: () => [...templateCategoryKeys.all, 'list'] as const,
} as const;
