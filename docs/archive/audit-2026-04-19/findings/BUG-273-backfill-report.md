# BUG-273 — Backfill report template

This file is appended to (not overwritten) by
`apps/api/scripts/backfill-clinical-notes-consent-id.ts` on every run.

Each section contains:

- The run's timestamp + parameters (window, chunk size, dry_run).
- Post-backfill counts (resolved / unresolved_ai_draft / legacy_not_ai_draft / total).
- Any AMBIGUOUS clinical_note IDs (notes with more than one candidate audit row in the time window — these are NOT auto-resolved and require manual triage).

## Acceptance criteria

- `unresolved_ai_draft / (resolved + unresolved_ai_draft)` SHOULD be near zero if `audit_log` is intact. A non-trivial fraction suggests either (a) audit rows were truncated pre-BUG-039 immutability, or (b) the 10-minute temporal window is too tight for historical workflow latency.
- `legacy_not_ai_draft` is EXPECTED to dominate — these are manually-authored notes that pre-date the ambient-note consent flow. They cannot be backfilled and will remain `consent_id IS NULL` until BUG-315 (NOT NULL enforcement with data-cleanup decision).
- Any `ambiguous` entries need human triage before ops runs `VALIDATE CONSTRAINT` in production.

## Runbook

```bash
# Dry-run first — emits report without UPDATEs.
cd apps/api
BACKFILL_DRY_RUN=true npx tsx scripts/backfill-clinical-notes-consent-id.ts

# Review this report; if ambiguous=0 and unresolved_ai_draft is acceptable:
unset BACKFILL_DRY_RUN
npx tsx scripts/backfill-clinical-notes-consent-id.ts

# Finally, validate the FK against all rows (brief lock, no table scan):
PGPASSWORD=… psql -h … -U signacare_owner -d signacaredb \
  -c "ALTER TABLE clinical_notes VALIDATE CONSTRAINT clinical_notes_consent_id_fk"
```

---

<!-- appended by backfill script — do not edit entries below manually -->
