# B4 BUG-575 Evidence — Notification Email Channel Fanout

- Date: 2026-05-13
- Lane: B4 (Scheduler and Alert Reliability Framework)
- Bug: `BUG-575`
- Scope: restore opt-in email channel support in `notificationService.emit` with deterministic tests and fail-visible behavior.

## Implementation Artifacts

- `apps/api/src/features/notifications/notificationService.ts`
- `apps/api/tests/unit/notificationService.channels.test.ts`
- `docs/quality/fix-registry.md`
- `docs/quality/bugs-remaining.md`
- `docs/quality/remediation/active-slice.md`

## Schema/Contract Decisions

1. Email is **opt-in** (`channels: ['email', ...]`) and not added to defaults to avoid inbox noise for non-critical notifications.
2. Email fanout is only valid for targeted staff recipients (`userId`/`userIds`), not clinic-wide broadcasts with no explicit recipient.
3. Enqueue failures are non-fatal; the emit path logs and continues so notification emission remains robust.

## Verification Commands

- `npm run lint:changed`  
  Result: PASS (`lint:changed (workspace) — linting 2 file(s)`)
- `npm run typecheck`  
  Result: PASS (root workspace typecheck chain exited 0)
- `npm run guard:claude-discipline:ci`  
  Result: PASS (all discipline + structural guards green)
- `cd apps/api && npx vitest run tests/unit/notificationService.channels.test.ts`  
  Result: PASS (`1/1` file, `4/4` tests)

## L5 Notes

1. BUG-575 is implementation-complete in-repo with deterministic L1-L4 evidence.
2. Rollout closure still requires canary + burn-in + post-burn-in verification evidence before final production closeout.
