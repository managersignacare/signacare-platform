# BUG-273 — `clinical_notes.consent_id` FK to `scribe_consents`

**Metadata**

- Severity: S1
- Track / Wave: A / A-2
- State: fixed (migration + application INSERT landed; ops backfill + VALIDATE CONSTRAINT happen in the next maintenance window).
- Change class: risky
- Fix-registry anchor: `R-FIX-CLINICAL-NOTES-CONSENT-FK`
- Origin: BUG-035 L4 follow-up — referential-integrity upgrade to the consent audit trail.

## Diagnosis

Pre-fix the link from a `clinical_notes` row back to the `scribe_consents` row that authorised its recording lived only in `audit_log` rows (`operation='AMBIENT_NOTE_RECORDING_STARTED'`, `record_id=consentId`, `new_data->>'patientId'` matching the note's `patient_id`, `created_at` seconds before the note). Any forensic replay required a multi-column temporal JOIN — fragile, unenforceable at the DB layer, and opaque to ops.

**Schema reality correction during execution:** the initial plan assumed a `clinical_notes.audio_storage_key` column for the backfill join. That column doesn't exist on `clinical_notes` — `audioStorageKey` is only stored inside `audit_log.new_data`. Backfill redesigned to use **temporal proximity on `(clinic_id, patient_id, created_at)`** with `audit_log.new_data->>'patientId'` as the match. Simpler and more reliable than the JSONB-audio-key join.

## Fix — zero-downtime 5-step pattern

Absorbed from R3 pre-exec review: `NOT VALID` + separate `VALIDATE CONSTRAINT` keeps the FK addition non-blocking on a live 24/7 clinic.

| Step | Where | Action |
|---|---|---|
| 1 | Migration `20260701000028_clinical_notes_consent_fk.ts` | `ALTER TABLE clinical_notes ADD COLUMN consent_id uuid NULL` |
| 2 | Migration | `CREATE INDEX clinical_notes_consent_id_idx ON clinical_notes(consent_id) WHERE consent_id IS NOT NULL` (partial). Plain CREATE INDEX — not CONCURRENTLY — because Knex wraps migrations in a transaction. Partial index on UUID column → brief AccessShareLock, acceptable in maintenance window |
| 3 | Migration | `ADD CONSTRAINT clinical_notes_consent_id_fk FOREIGN KEY (consent_id) REFERENCES scribe_consents(id) ON DELETE RESTRICT NOT VALID` — existing NULL rows NOT scanned; new inserts/updates ARE checked |
| 4 | Ops-run script `apps/api/scripts/backfill-clinical-notes-consent-id.ts` | Chunked backfill OUTSIDE migration transaction. 1000 rows per tx, `SET LOCAL statement_timeout='5min'` + `work_mem='64MB'`. Preflight aborts if any note has >1 candidate audit row in the 10-minute window |
| 5 | Ops-run SQL | `ALTER TABLE clinical_notes VALIDATE CONSTRAINT clinical_notes_consent_id_fk` — brief ShareUpdateExclusiveLock; uses FK index, no table scan |

**Application write path:** `apps/api/src/features/llm/llmRoutes.ts` `/ambient-note` handler now passes `consent_id: dto.consentId` into the `clinical_notes.insert(...)`. `dto.consentId` is already Zod-validated as `z.string().uuid()` at the route entry and `verifyRecordingConsent` has passed before the INSERT runs; the FK `NOT VALID` still enforces on this new insert. Four-layer defence for the consent→note binding: Zod + `verifyRecordingConsent` + app INSERT + DB FK.

## Backfill script design

- **Temporal-proximity join:** `(cn.clinic_id = al.clinic_id) AND ((al.new_data->>'patientId')::uuid = cn.patient_id) AND (al.created_at <= cn.created_at) AND (al.created_at >= cn.created_at - 10 minutes)`.
- **Tie-break:** `DISTINCT ON (cn.id) ORDER BY cn.id, al.created_at DESC` — most recent audit row within the window wins.
- **Ambiguity preflight:** if ANY note has >1 candidate audit row in the window, ABORT. Emit CSV of ambiguous note IDs to the findings report. No silent guessing (OAIC wrong-binding would be worse than an unresolved NULL).
- **Report:** appended (not overwritten) to `docs/audit-2026-04-19/findings/BUG-273-backfill-report.md`. Counts: `resolved`, `unresolved_ai_draft`, `legacy_not_ai_draft`, `total`. Converts "best effort" to "measured effort" (R2 absorption).
- **Dry-run mode:** `BACKFILL_DRY_RUN=true` skips UPDATEs; emits report only. Ops must run dry-run first and review before enabling writes.

## Files changed

- NEW `apps/api/migrations/20260701000028_clinical_notes_consent_fk.ts` — migration (§12.4-annotated raw SQL).
- NEW `apps/api/scripts/backfill-clinical-notes-consent-id.ts` — ops-run backfill.
- NEW `apps/api/tests/integration/clinicalNotesConsentFK.int.test.ts` — 5 integration tests all PASS.
- NEW `docs/audit-2026-04-19/findings/BUG-273-backfill-report.md` — template + runbook.
- MOD `apps/api/src/features/llm/llmRoutes.ts` — `consent_id: dto.consentId` on INSERT.
- MOD `apps/api/src/db/schema-snapshot.json` — regenerated.
- MOD `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — state: fixed.
- MOD `docs/fix-registry.md` — `R-FIX-CLINICAL-NOTES-CONSENT-FK` anchor.

## Tests — 5 integration, all PASS

| # | Case |
|---|---|
| F1 | Migration up: column + FK exist; FK `convalidated=false` (NOT VALID, as expected). |
| F2 | INSERT with non-existent `consent_id` → 23503 FK violation. NOT VALID doesn't mean FK is ignored — it just skips the existing-rows scan at ADD time. New writes ARE enforced. |
| F3 | DELETE of a consent that a note references → 23503 RESTRICT. Proves consent forensics cannot be orphaned. |
| F4 | End-to-end POST `/ambient-note` → resulting clinical_notes row carries `consent_id` = dto.consentId directly (no audit-log join). |
| F5 | Backfill preflight SQL correctly flags a synthesised ambiguous scenario (2 audit rows for same patient in the 10-minute window). |

Regression runs green: BUG-035 (9 tests), BUG-275 (3 tests) — 17/17 combined.

## Guards (cluster-end)

- `check-migration-convention` — all raw() calls carry §12.4 taxonomy annotations.
- `check-row-interface-matches-db` — 92 interfaces verified against regenerated snapshot.
- `check-code-writes-real-columns` — all .insert/.update writes target real columns (new `consent_id` column surfaces here after snapshot regen).
- `check-snapshot-freshness` — snapshot `.json` mtime matches migration mtime.

## QA verdicts

- L3 code-reviewer-general: **PASS** (procedural note: fix-registry + catalogue yaml must land in this PR — done.)
- L4 clinical-safety-reviewer: **PASS** (ON DELETE RESTRICT protects forensics; 10-min window + abort-on-ambiguity is the safe posture; NULL-legacy deferral acceptable as data-hygiene not privacy risk; BUG-315 tracks NOT NULL enforcement).
- L5 architecture-reviewer: **PASS** (extends BUG-035 consent gate into the DB schema as a DB-guaranteed invariant; zero-downtime pattern textbook; reversibility clean).

## Non-goals

- Do NOT enforce `NOT NULL` in this PR — legacy manually-authored notes predate the consent flow and would fail. BUG-315 (S2 B-11) tracks NOT NULL enforcement after a data-cleanup decision.
- Do NOT auto-remediate ambiguous backfill matches — abort-and-triage is safer than a wrong-binding privacy error.
- Do NOT run VALIDATE CONSTRAINT in this PR — ops runs it after reviewing the backfill report in a maintenance window.

## Residual risk

- **NOT NULL deferral** — `consent_id` is NULLABLE indefinitely; `is_ai_draft=true` notes with NULL consent post-backfill need triage. BUG-315 tracks.
- **10-minute window tight for extended Whisper/LLM latency** — post-backfill `unresolved_ai_draft` count will indicate if window should widen.
- **Audit log append-only (BUG-039)** — test cleanup cannot remove audit rows; accumulation is expected and doesn't inflate ambiguity (preflight filter is narrowly scoped to same-patient-same-clinic within window).
- **Migration convention §12.1:** plain `CREATE INDEX` (not CONCURRENTLY) because Knex wraps migrations in a transaction. Brief lock in the maintenance window accepted.
