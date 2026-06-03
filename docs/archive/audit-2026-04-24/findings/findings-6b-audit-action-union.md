# Findings 6b — AuditAction union enforcement

**Agent:** F-audit-action-union

## Summary

- **Union size:** 29 literal members in `AuditAction` (`apps/api/src/utils/audit.ts:4-98`)
- **`writeAuditLog` call sites:** ~85 across 28 files → **all 29 union members used, zero literals outside the union, zero DYNAMIC**
- **Raw bypass via `db('audit_log').insert(...)`:** 10 sites in 5 files → **10 literals NOT in the union**

The union is sound where `writeAuditLog` is the writer, but unenforced where code goes around it.

## The 29 union members (alphabetised)

`ACCESS, ADMIN_SLOT_CLEARED_BY_TRIGGER, ADMIN_SLOT_CLEARED_RECONCILIATION, AI_CHAT_CLASSIFIER_BLOCK, AMBIENT_NOTE_RECORDING_REVOKED, AMBIENT_NOTE_RECORDING_STARTED, CONTRAINDICATION_BLOCKED, CREATE, DELETE, HL7_DISPATCH_FAILURE, HL7_DISPATCH_HELD_UNCONFIGURED, HL7_DISPATCH_SUCCESS, HL7_INBOUND_INGESTED, HL7_INBOUND_ORDER_NOT_FOUND, LLM_ACCESS_BYPASS_ROLE, LLM_AUDIT_WRITE_FAILED, LOGIN, LOGOUT, MFA_VERIFY, READ, RESTORE, SESSION_REVOKED_BY_STATE_CHANGE, SESSION_REVOKED_BY_STATE_CHANGE_TRIGGER, SOFT_DELETE, TRAINING_EXPORT_APPROVED, TRAINING_EXPORT_DOWNLOADED, TRAINING_EXPORT_REJECTED, TRAINING_EXPORT_REQUESTED, UPDATE`

## 10 bypass call sites writing literals NOT in the union

| File:line | Literal |
|---|---|
| `middleware/forbiddenAccessAudit.ts:56` | `FORBIDDEN_ACCESS` |
| `middleware/patientAccessAudit.ts:179` | `READ_LIST` |
| `middleware/superadminGuard.ts:57` | `APPROVAL_EXECUTED` |
| `middleware/superadminGuard.ts:79` | `APPROVAL_REQUEST` |
| `features/llm/llmRoutes.ts:690` | `SCRIBE_HALLUCINATION_BLOCKED` |
| `features/auth/breakGlassRoutes.ts:202` | `BREAK_GLASS_REQUESTED` |
| `features/auth/breakGlassRoutes.ts:303` | `BREAK_GLASS_APPROVED` |
| `features/auth/breakGlassRoutes.ts:373` | `BREAK_GLASS_DENIED` |
| `features/auth/breakGlassRoutes.ts:424` | `BREAK_GLASS_REVOKED` |
| (+1 adminAlert variant below) | — |

## Semantic-drift — in-union but wrong

`features/patient-outreach/adminAlert.ts:46` uses `action: 'UPDATE'` with self-admitted comment:
> "closest existing enum until ADMIN_ALERT is added"

All admin-alert rows are indistinguishable from ordinary UPDATE rows → forensic signal lost.

## Gold-standard fix

1. Extend `AuditAction` in `apps/api/src/utils/audit.ts` with:
   - `FORBIDDEN_ACCESS`, `READ_LIST`, `APPROVAL_EXECUTED`, `APPROVAL_REQUEST`, `SCRIBE_HALLUCINATION_BLOCKED`, `BREAK_GLASS_REQUESTED`, `BREAK_GLASS_APPROVED`, `BREAK_GLASS_DENIED`, `BREAK_GLASS_REVOKED`, `ADMIN_ALERT`
2. Migrate the 5 bypass files to use `writeAuditLog(...)` instead of raw `db('audit_log').insert({action:...})`
3. Add CI guard `check-no-direct-audit-log-insert.ts` that rejects any `(db|dbAdmin)\('audit_log'\)\.insert` outside `apps/api/src/utils/audit.ts`
4. Update `adminAlert.ts:46` to use the new `ADMIN_ALERT` literal

## Related BUGs

- **BUG-467 (S1)** (new) — AUDIT-ACTION-UNION-BYPASS family: extend union + migrate 5 bypass files + add CI guard. Every break-glass / forbidden-access / approval-workflow / scribe-hallucination event today records as an audit row with an un-typed literal; migration adds compile-time safety and forensic clarity.
