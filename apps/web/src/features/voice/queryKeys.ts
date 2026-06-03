// apps/web/src/features/voice/queryKeys.ts
// Phase 0.7 PR2 Class F — canonical factory location for voice.
// The factory is declared inline in ./hooks/useVoiceCalls.ts; re-export it
// here so the CI guard sees the feature has a root queryKeys.ts.
export { voiceKeys } from './hooks/useVoiceCalls';
