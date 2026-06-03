# Plan — BUG-490: Patient-App Entry-ID-Keyed IDOR Closure

[Source: Plan agent invocation 2026-04-25 per runbook §B; condensed for executor reference.]

**Severity:** S1 deploy-blocker
**Sibling:** BUG-430-PATIENT-APP (shipped 358038d)
**Supersedes:** BUG-488 (filed earlier; same scope, BUG-490 is canonical aggregator)

## 1. Sites (3 — line numbers verified at HEAD)

| Current line | Route | Table | Pre-fix |
|---|---|---|---|
| 548 | PATCH /tracking/:entryId | patient_tracking | `where({ id: entryId }).update(...)` — no ownership, no clinic |
| 560 | DELETE /tracking/:entryId | patient_tracking | `where({ id: entryId }).delete()` — no ownership, no clinic |
| 666 | PATCH /appointment-response/:appointmentId | appointments | `where({ id: appointmentId }).update({ patient_response })` — no ownership, no clinic |

Both tables verified to have `patient_id` + `clinic_id` columns via schema-snapshot.json.

## 2. Fix shape — SELECT-then-helper-then-mutate

```typescript
// Before mutation:
const row = await dbAdmin('<table>').where({ id: req.params.<id> }).select('patient_id', 'clinic_id').first();
if (!row) { res.status(404).json({ error: '<entity> not found' }); return; }
await requirePatientOwnership(req, row.patient_id);  // dual-mode dispatch
// Then mutate with defence-in-depth clinic_id:
await dbAdmin('<table>').where({ id: req.params.<id>, clinic_id: req.clinicId }).update/delete(...);
```

Why SELECT-then-helper, not where-tightening: tightening (`where { id, patient_id }`) silently no-ops on IDOR probes (no audit). SELECT-first preserves audit-write-then-throw via the existing helper.

Trade-off: not-found returns 404 BEFORE helper (no audit). Wrong-owner returns 403 + audit. 404-vs-403 is a minor existence-leak; standard REST per OWASP IDOR guidance.

## 3. CI guard extension (option A)

Extend `scripts/guards/check-patient-app-ownership.ts` to scan ALL mutating routes (POST/PUT/PATCH/DELETE) on patientAppRoutes.ts, accepting:
1. `requirePatientOwnership(req, req.params.patientId)` — Class C (existing)
2. `requirePatientOwnership(req, <ident>.patient_id)` — Class E new (row-derived)
3. Class B own-JWT handlers — `req.user.patientId` direct, no `req.params.patientId`
4. `// @patient-app-ownership-exempt: <reason ≥10 chars>` annotation

## 4. TDD red — extend patientAppOwnership.int.test.ts

New `Class E` describe block:
- 3 IDOR negative tests (patient-A vs patient-B's tracking/appointment) → 403 + audit
- 1 staff-JWT no-relationship test → 403 with code != PATIENT_OWNERSHIP_MISMATCH
- 1 unknown-id test → 404 (not 403)
- 1 own-mutation positive test → 200

Pre-fix: 5/6 fail (3 IDOR get 200, not-found gets 200, staff-test passes vacuously). Post-fix: 6/6 green.

## 5. Fix-registry rows

- R-FIX-BUG-490-ENTRY-ID-IDOR-DRAINED (path: patientAppRoutes.ts; pattern: `BUG-490 — entry-id-keyed`)
- R-FIX-BUG-490-CI-GUARD-EXPANDED (path: check-patient-app-ownership.ts; pattern: row-derived helper detection)

## 6. bugs-remaining.md edits

- BUG-488: retired/duplicate, supersededby BUG-490
- BUG-490: fixed, anchor refs

## 7. PART 2 §A-§O

§A done. §B done (this file). §C TDD red → §D 3 site edits + guard extension → §E L1 → §F L2 (full integration per §13.9) → §G L3 → §H L4 (semantic trigger fires) → §I L5 (fix-registry + scripts/guards) → §K fix-registry → §L commit → §M bugs-remaining + yaml → §N push (after user auth) → §O progress.md.
