# Plan — BUG-443: authController login/logout audit-write swallow

[Plan agent invocation 2026-04-25 per `~/.claude/plans/sleepy-roaming-meteor.md` PART 2 §B; first-principles re-derivation per PART 6.1 #3.]

**Severity:** S1 deploy-blocker (AHPRA compliance regression)

## §0. Drift summary

Two empty `try { writeAuditLog(...) } catch { /* comment */ }` blocks in `apps/api/src/features/auth/authController.ts` swallow ANY error from the audit-row write with zero observability:

- Line 118: `} catch { /* audit must not block login */ }`
- Line 192: `} catch { /* audit must not block logout */ }`

The "must not block" intent is correct; the swallow implementation is wrong. AHPRA + APP 11 require operator-visible audit-trail degradation. The `check-no-silent-catches.sh` guard at `.github/scripts/check-no-silent-catches.sh:40-46` only matches `.catch(...)` arrow forms — the `try { } catch { }` empty-block shape bypasses it. (Filed as **BUG-516** follow-up.)

Cited by `docs/archive/audit-2026-04-24/findings/findings-6a-silent-catch.md:34-35`.

## §1. Verification (read-confirmed)

- Both sites exist exactly as cited (login at lines 107-118, logout at lines 181-193).
- `writeAuditLog` documents "Never throw" at `audit.ts:196` — practical fault path is dynamic-import failure or future regression. Either way, observability matters.
- `logger` imported at `authController.ts:15` — no new import needed.
- Canonical precedent at `apps/api/src/middleware/forbiddenAccessAudit.ts:72-79` and `apps/api/src/shared/writeLlmAccessBypassAudit.ts:90-95` — `catch (err) { logger.warn({err, ...}, 'msg') }` shape.

## §2. Fix shape

Replace both `catch { /* ... */ }` blocks with structured `catch (err) { logger.warn({err, action, staffId, clinicId, kind: 'audit_write_failure'}, 'BUG-443: <login|logout> audit write failed but proceeded — AHPRA requires this be visible') }`. Preserves "must not block" by NOT rethrowing. Adds `kind: 'audit_write_failure'` stable aggregator key for downstream alerting (matches `audit.ts:307,318` convention).

## §3. UNION-up-front review

N/A — no schema, shared type, or API contract touched.

## §4. §15 contract

N/A — no DB write, no row-interface change.

## §5. Test plan

NEW: `apps/api/tests/unit/authControllerAuditObservability.test.ts` (6 unit tests):
- AC-1: loginController returns 200 when writeAuditLog throws (must-not-block)
- AC-2: loginController triggers `logger.warn` with canonical shape when writeAuditLog throws (PRE-FIX RED)
- AC-3: loginController happy-path triggers no warn (negative)
- AC-4: logoutController returns 200 when writeAuditLog throws (must-not-block twin)
- AC-5: logoutController triggers `logger.warn` with `action: 'LOGOUT'` (PRE-FIX RED twin)
- AC-6: logoutController happy-path no warn (negative twin)

Mock shape mirrors `authTokens.test.ts:46-50`: `vi.mock('../../src/utils/audit')` + `vi.mock('../../src/utils/logger')`.

Pre-fix RED: AC-2 + AC-5 fail (no `logger.warn` invocation). Post-fix: 6/6 GREEN, 3× consecutive stability.

## §6. Fix-registry rows (5, all `^`-anchored)

| Row ID | File | Mode | Pattern |
|---|---|---|---|
| `R-FIX-BUG-443-LOGIN-AUDIT-NOT-SILENT` | `apps/api/src/features/auth/authController.ts` | absent | `^  \} catch \{ /\* audit must not block login \*/ \}$` |
| `R-FIX-BUG-443-LOGOUT-AUDIT-NOT-SILENT` | `apps/api/src/features/auth/authController.ts` | absent | `^    \} catch \{ /\* audit must not block logout \*/ \}$` |
| `R-FIX-BUG-443-LOGIN-AUDIT-OBSERVABLE` | `apps/api/src/features/auth/authController.ts` | present | `BUG-443: login audit write failed but login proceeded` |
| `R-FIX-BUG-443-LOGOUT-AUDIT-OBSERVABLE` | `apps/api/src/features/auth/authController.ts` | present | `BUG-443: logout audit write failed but logout proceeded` |
| `R-FIX-BUG-443-AUDIT-WRITE-FAILURE-KIND` | `apps/api/src/features/auth/authController.ts` | present | `kind: 'audit_write_failure'` |

## §7. Files to modify

| File | Change |
|---|---|
| `apps/api/src/features/auth/authController.ts` | Fix lines 118 + 192 (swallow → observable) |
| `apps/api/tests/unit/authControllerAuditObservability.test.ts` | NEW (6 tests) |
| `docs/quality/fix-registry.md` | 5 anchor rows |
| `docs/quality/bugs-remaining.md` | Atomic flip BUG-443 → fixed; file BUG-516 follow-up |

No migration, no shared schema, no frontend.

## §8. PART 2 §H/§I trigger assessment

- **L4** (clinical-safety): FIRES — touches `auth/` + audit-write path; AHPRA / APP 11 compliance surface.
- **L5** (architecture): FIRES — `auth/` + fix-registry modifications.
- **L3**: unconditional.

## §9. Risks + follow-ups

- **BUG-516** (S2): extend `check-no-silent-catches.sh` to detect `} catch { ... }` empty-block syntax (current regex only matches `.catch(...)` arrow forms).
- Sibling audit-swallow sites (findings-6a §53, 6 paths) NOT in BUG-443 scope — verify each has tracking; file new only if uncovered.
- PHI-in-err redaction — pino's `redactPhi` formatter handles this (`logger.ts:48`). No new exposure.
- Log-noise — durable audit DB outage emits one warn per login/logout. Correct signal; alerting is ops-layer.

## §10. Acceptance

5 fix-registry pass; 6 unit tests ×3 GREEN; tsc + lint clean; L1+L2+L3+L4+L5 PASS; atomic catalogue flip with BUG-516 follow-up filed.

Per PART 6.1: no shortcut, no abstraction wrapper, must-not-block semantic preserved.
