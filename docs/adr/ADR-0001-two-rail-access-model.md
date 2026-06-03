# ADR-0001: Two-rail access model (clinical rail + settings rail)

## Status
Accepted (shipped in Phase 0.5; commits 72ab65f, aa1db68, 24093fd).

## Context

Signacare's original RBAC model defined `BYPASS_ROLES = {superadmin, admin}` in `authConstants.ts`. Any staff with one of those roles skipped `requirePatientRelationship` — the clinical-data-access gate that for every other role checks episode / team / appointment relationship. That was a god-mode bypass applied to TWO distinct operational concerns:

- **Cross-clinic SETTINGS access** — legitimately needed by superadmin (the cross-tenant power-settings operator) and by each clinic's nominated admin (who configures module access, role assignments, team assignments).
- **Cross-tenant CLINICAL-DATA access** — should never apply to superadmin (who works on power settings, not patient care) and should apply only to a specific nominated admin per clinic (who has local clinical authority, not cross-clinic ambient access).

Conflating the two rails meant superadmin could browse every patient's record in every clinic with zero audit link to a clinical justification. A generic `admin` role — not necessarily the nominated clinical authority for their clinic — had the same capability.

## Decision
Two independent rails: (a) clinical access via `requirePatientRelationship` — episode / team / appointment relationship, or nominated/delegated admin for the patient's clinic; (b) settings access via `requireAccessSettingsAuthority` — superadmin OR nominated/delegated admin for the target clinic.

## Consequences
Closes ambient cross-clinic clinical access for superadmin. Requires per-clinic nomination before write access works. Retains superadmin for cross-clinic settings operations only.

## References
- Commits: 72ab65f, aa1db68, 24093fd (BUG-351 / BUG-354 / BUG-362 family)
- Fix registry: R-FIX-BUG-351-ACCESS-ADMIN-STAFF-JOIN, R-FIX-BUG-354-ACCESS-ADMIN-SLOT-INTEGRITY-TRIGGER, R-FIX-BUG-362-STALE-ADMIN-SLOT-RECONCILIATION
