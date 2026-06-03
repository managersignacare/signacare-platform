# B4 — BUG-578-FOLLOWUP-UI-TIER-DISCRIMINATOR Evidence (2026-05-13)

## Scope
- BUG: `BUG-578-FOLLOWUP-UI-TIER-DISCRIMINATOR`
- Lane: `B4 — Scheduler + Alert Reliability`
- Objective: render escalation state from machine-readable payload tier instead of title parsing.

## Structural Changes
- Added helper module:
  - `apps/web/src/features/notifications/notificationTier.ts`
  - `getNotificationTierBadge(payload)` parses and validates `payload.tier`
  - suppression rule: no badge for tier `<=1`
  - tier rendering model:
    - tier `2` => `Escalation` (`error` tone)
    - tier `>=3` => `Escalation Tn` (`warning` tone)
- Updated UI renderer:
  - `apps/web/src/features/notifications/NotificationBell.tsx`
  - notification row primary line now includes a tier badge derived from payload tier
  - rendering no longer depends on `[ESCALATION]` title prefix parsing

## Regression Tests Added
- `apps/web/src/features/notifications/notificationTier.test.ts`
  - null payload => no badge
  - tier 1 => no badge
  - tier 2 numeric => `Escalation` + `error`
  - tier 3 string => `Escalation T3` + `warning`
  - invalid values rejected (`0`, negative, float, non-numeric string)

## Verification Executed
- `npx vitest run src/features/notifications/notificationTier.test.ts` (workdir `apps/web`) => PASS (5/5)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## Status
- Implementation landed (local lane work complete).
- Rollout closure pending canary + burn-in + post-burn-in verification.
