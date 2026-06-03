# D26 S1 Closure — BUG-ARCH-NOTIFICATION-EVENT-CONVERGENCE

**Date:** 2026-05-28  
**Bug:** `BUG-ARCH-NOTIFICATION-EVENT-CONVERGENCE`  
**Scope:** Structural convergence of notification/event emission for critical transition surfaces.

## What Changed

1. Added explicit convergence contract:
   - `.github/notification-event-convergence-contract.json`
   - Pins critical event-emission targets and required signal-key patterns for:
     - appointments booking
     - referral offers
     - messaging new-message fan-out
     - outcomes suicide-risk trigger
     - patient-app suicide-risk trigger
     - prescription dispense signal
     - scheduler adapter (`conn: dbAdmin`)
     - integration-config drift warning signal

2. Added machine guard:
   - `scripts/guards/check-notification-event-convergence-contract.ts`
   - Validates contract shape and required source patterns across all targeted files.

3. Wired guard into discipline lane:
   - `package.json`
   - Added script `guard:notification-event-convergence-contract`
   - Added execution in `guard:claude-discipline` chain.

4. Preserved existing architectural bypass guard:
   - `guard:centralized-notification-emitter` remains authoritative for "no direct `notificationService.emit(...)` outside central emitter."
   - Together, the two guards enforce both:
     - no bypass
     - required critical-surface coverage

5. Added fix-registry anchors:
   - `R-FIX-BUG-ARCH-NOTIFICATION-CONVERGENCE-GUARD`
   - `R-FIX-BUG-ARCH-NOTIFICATION-CONVERGENCE-CONTRACT`

## Gate Evidence (local)

- `npm run -s guard:notification-event-convergence-contract` ✅
- `npm run -s guard:centralized-notification-emitter` ✅
- `npm run -s guard:claude-discipline:ci` ✅
- `bash .github/scripts/check-fix-registry.sh` ✅
- `npm run -s guard:bugs-remaining-uniqueness` ✅
- `npm run -s typecheck` ✅

## Closure Note

This closes the structural M1 convergence gap at enforcement level. Critical
transition surfaces are now contract-pinned to centralized signal emission, and
future drift is blocked automatically in guard lanes.
