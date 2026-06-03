# BUG-467 — AUDIT-ACTION-UNION-BYPASS — Plan

## Verified state (2026-04-24)

10 `(db|dbAdmin)('audit_log').insert(...)` call sites bypass the typed `writeAuditLog` wrapper:

| File:line | Current action literal |
|---|---|
| `middleware/forbiddenAccessAudit.ts:52` | `FORBIDDEN_ACCESS` |
| `middleware/patientAccessAudit.ts:119` | `READ_LIST` (or similar per-row) |
| `middleware/patientAccessAudit.ts:175` | `READ_LIST` |
| `middleware/superadminGuard.ts:53` | `APPROVAL_EXECUTED` |
| `middleware/superadminGuard.ts:75` | `APPROVAL_REQUEST` |
| `features/llm/llmRoutes.ts:739` | `SCRIBE_HALLUCINATION_BLOCKED` |
| `features/auth/breakGlassRoutes.ts:199` | `BREAK_GLASS_REQUESTED` |
| `features/auth/breakGlassRoutes.ts:300` | `BREAK_GLASS_APPROVED` |
| `features/auth/breakGlassRoutes.ts:370` | `BREAK_GLASS_DENIED` |
| `features/auth/breakGlassRoutes.ts:421` | `BREAK_GLASS_REVOKED` |

Plus the `adminAlert.ts` semantic-drift case where `UPDATE` is used as a stand-in for `ADMIN_ALERT`.

## Gold-standard fix

1. Extend `AuditAction` union with 10 new literals (9 + `ADMIN_ALERT`):
   - `FORBIDDEN_ACCESS`, `READ_LIST`, `APPROVAL_EXECUTED`, `APPROVAL_REQUEST`,
   - `SCRIBE_HALLUCINATION_BLOCKED`,
   - `BREAK_GLASS_REQUESTED`, `BREAK_GLASS_APPROVED`, `BREAK_GLASS_DENIED`, `BREAK_GLASS_REVOKED`,
   - `ADMIN_ALERT`.

2. Migrate each bypass call to `writeAuditLog({ clinicId, actorId, tableName, recordId, action, oldData?, newData? })` — the typed wrapper provides the same shape + benefits of dual-write safety (BUG-283 outbox) + chronology preservation.

3. Fix `adminAlert.ts:46` to use `ADMIN_ALERT` literal instead of `UPDATE`.

4. New CI guard `scripts/guards/check-no-direct-audit-log-insert.ts` that rejects any `(db|dbAdmin)('audit_log').insert(...)` call OUTSIDE `apps/api/src/utils/audit.ts` and `apps/api/src/shared/auditOutbox.ts` (the two legitimate writer paths).

5. Tests: unit test for the guard (it flags + allows), integration test that the migrated break-glass audit row has `operation = 'BREAK_GLASS_REQUESTED'` (not raw).

## Files

- `apps/api/src/utils/audit.ts` — +10 literals
- `apps/api/src/middleware/forbiddenAccessAudit.ts` — migrate 1 site
- `apps/api/src/middleware/patientAccessAudit.ts` — migrate 2 sites
- `apps/api/src/middleware/superadminGuard.ts` — migrate 2 sites
- `apps/api/src/features/llm/llmRoutes.ts` — migrate 1 site
- `apps/api/src/features/auth/breakGlassRoutes.ts` — migrate 4 sites
- `apps/api/src/features/patient-outreach/adminAlert.ts` — switch literal
- `scripts/guards/check-no-direct-audit-log-insert.ts` — NEW
- `package.json` + `.github/workflows/ci.yml` — wire new guard
- `docs/quality/fix-registry.md` — 4 rows (union-extended, bypass-sites-migrated, guard-exists, adminAlert-literal)
- `docs/quality/bugs-remaining.md` — mark BUG-467 fixed

## Risk + scope

- Behaviour change: audit rows now carry richer context (via writeAuditLog's augmentedNewValues + _recordRef handling). Existing audit-log consumers must still parse by operation column — unchanged field.
- Dual-write safety: migrated calls inherit BUG-283 outbox behaviour — DB failure pushes to Redis instead of silent drop.
- Chronology: migrated calls inherit BUG-283 eventTime stamp.
- No schema change; no data migration.

## L3/L4/L5

- L3: yes
- L4: yes — audit-log write path + break-glass forensics (§13.5 semantic trigger)
- L5: yes — adds new CI guard + touches 7 files including middleware
