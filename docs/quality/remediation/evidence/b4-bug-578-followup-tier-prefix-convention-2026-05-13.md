# B4 — BUG-578-FOLLOWUP-TIER-PREFIX-CONVENTION Evidence (2026-05-13)

## Scope
- BUG: `BUG-578-FOLLOWUP-TIER-PREFIX-CONVENTION`
- Lane: `B4 — Scheduler + Alert Reliability`
- Objective: formalize escalation title convention and prevent semantic drift.

## Structural Changes
- Added documentation:
  - `docs/quality/remediation/notification-escalation-title-convention.md`
- Documented contract:
  - `payload.tier` is authoritative for escalation semantics.
  - Title prefixes are human-readable compatibility labels.
  - Tier mapping:
    - tier-2 => `[ESCALATION]`
    - tier-3 => `[CRITICAL ESCALATION]`
    - tier-4+ => `[REGULATORY]` (or signed equivalent)

## Why This Matters
- Preserves semantic consistency across emitters and UI consumers.
- Prevents hidden regressions when title copy changes.
- Aligns with BUG-578 UI discriminator implementation (`payload.tier` driven rendering).

## Verification Executed
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## Status
- Implementation landed (local lane work complete).
- Rollout closure pending canary + burn-in + post-burn-in verification.
