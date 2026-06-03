// apps/web/src/features/clinical-review/queryKeys.ts
// Phase 0.7 PR2 Class F — canonical factory location for clinical-review.
// The factory is declared inline in ./hooks/useClinicalReview.ts (historical
// pattern); re-export it here so the CI guard sees the feature has a root
// queryKeys.ts. Future refactor can move the declaration into this file.
export { clinicalReviewKeys } from './hooks/useClinicalReview';
