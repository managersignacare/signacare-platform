// apps/web/src/features/episodes/queryKeys.ts
// Phase 0.7 PR2 Class F — canonical factory location for the episodes
// feature. The factory is declared inline in ./hooks/useEpisodes.ts for
// historical reasons; re-export it here so the CI guard sees the feature
// has a root queryKeys.ts. Future refactor can move the declaration here.
export { episodeQueryKeys } from './hooks/useEpisodes';
