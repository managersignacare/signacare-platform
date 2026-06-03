# BUG-369 — clinical-note writeAuditLog + CI guard — Plan

## Root cause (verified via code read)

`apps/api/src/features/clinical-notes/clinicalNote.service.ts` has 5 mutation methods (`create`, `update`, `sign`, `amend`, `softDelete`) that:
- Write to `clinical_note_versions` (the RESTORE mechanism — pre-edit snapshot) via `snapshotNoteVersion()`
- Do NOT call `writeAuditLog()` → no audit_log row
- Contrast with patientService, prescriptionService, referralService which DO write audit rows on every mutation

`clinical_note_versions` is a restore/undo ledger, NOT the forensic audit trail. HIPAA §164.312(b) requires the forensic trail to be separate (identifies WHO did WHAT to WHICH note WHEN). Missing audit rows mean a clinical-incident investigation has no answer.

## Gold-standard fix

1. Extend `AuditAction` union with 5 new literals: `NOTE_CREATE`, `NOTE_UPDATE`, `NOTE_SIGN`, `NOTE_AMEND`, `NOTE_SOFT_DELETE`
2. Add `writeAuditLog({ clinicId, actorId, tableName: 'clinical_notes', recordId, action, oldValues, newValues })` to the END of each mutation method, AFTER the repository write succeeds. Wrap in try/catch that logs but does NOT throw (per `writeAuditLog` contract — audit failure must not block clinical flow).
3. Add integration test seeding a note through each mutation path and asserting a matching `audit_log` row is written with the right action literal + record_id + staff_id + clinic_id.
4. Add CI guard `check-clinical-note-audit-log.ts` that scans `clinicalNote.service.ts` and asserts every mutation method body contains a `writeAuditLog(` call. Modelled on `check-trigger-has-audit-row.sh`.

## Files touched

- `apps/api/src/utils/audit.ts` — extend AuditAction union (+5 literals)
- `apps/api/src/features/clinical-notes/clinicalNote.service.ts` — 5 writeAuditLog calls
- `apps/api/tests/integration/bug369ClinicalNoteAuditLog.int.test.ts` — NEW integration test
- `scripts/guards/check-clinical-note-audit-log.ts` — NEW CI guard
- `package.json` — new `guard:clinical-note-audit-log` script
- `.github/workflows/ci.yml` — new CI job
- `docs/quality/fix-registry.md` — +3 rows (service-layer, guard-exists, union-extended)
- `docs/quality/bugs-remaining.md` — mark BUG-369 fixed

## Risk + scope

- Happy path: audit_log row written in addition to the existing clinical_note_versions row. No user-visible change.
- Audit failure path: logger.warn emits, clinical mutation still succeeds (per writeAuditLog's existing semantics).
- CI guard prevents future mutation methods from being added without audit.
- Pair with BUG-467 (AUDIT-ACTION-UNION-BYPASS): does NOT use the raw `db('audit_log').insert` bypass; goes through the typed `writeAuditLog` wrapper.

## L3/L4/L5 expected

- L3: yes
- L4: yes — `clinical-notes/` path + audit-log-write path (§13.5 semantic trigger)
- L5: yes — extends the AuditAction union (SSoT surface); adds new guard (architecture)

## Fix-registry

- `R-FIX-BUG-369-NOTE-AUDIT-CREATE` — present pattern asserting `writeAuditLog` is called in `create()`
- `R-FIX-BUG-369-NOTE-AUDIT-SIGN` — same for `sign()`
- `R-FIX-BUG-369-CI-GUARD-EXISTS` — present pattern for the new guard
- `R-FIX-BUG-369-UNION-EXTENDED` — present pattern asserting the 5 new literals exist in the union
