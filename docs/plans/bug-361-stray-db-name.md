# Plan — BUG-361: stray-db-name guard WARN mode passes

## 1. Context

Pre-existing tech-debt flagged by `.github/scripts/check-no-stray-db-names.sh` Rule 1 WARN mode. The guard currently emits a warning for 3 doc files containing the historical `nous*` / `signacareemr` literals. Phase 0.5 PR 2 will flip this guard to FAIL mode — BUG-361 must clear it before that happens, otherwise the PR 2 merge fails CI.

Root cause inspection (grep output 2026-04-23) shows the "drift" is NOT real — all 3 flagged files legitimately contain the old names:

- **`docs/archive/phase-0.5-rename-runbook.md`** — the historical rename runbook preserved post-rename as permanent record. The old names appear as documented-procedure steps ("ALTER DATABASE signacaredb RENAME TO nousdev"). Cannot be rewritten — would falsify history. The whitelist already covered `docs/phase-0.5-rename-runbook.md` but the file was moved to `docs/archive/` without a matching whitelist update.
- **`docs/audit-2026-04-19/EXECUTION-PLAN-v3-FULL.md:661`** — references the nousdev-stray bug ticket itself ("`nousdev stray in archive doc`") as a catalogue line item. Meta-reference, not a new occurrence of drift.
- **`docs/audit-2026-04-19/bug-catalogue.md:227`** — same reason; references the ticket.

The correct fix is **extend the whitelist**, not rewrite history. All 3 paths are historical/catalogue documentation that legitimately contains the forbidden strings.

## 2. Existing code to reuse

- `.github/scripts/check-no-stray-db-names.sh` — the guard itself. Already has a whitelist mechanism via `grep -v` filter. Add 3 new `grep -v` entries.

## 3. Change surface

One file only: `.github/scripts/check-no-stray-db-names.sh`
- Extend the whitelist filter chain with 3 entries
- Extend the documentation header comment to explain why each new path is whitelisted (BUG-361 rationale inline)

## 4. Test plan

- L2.5: re-run the guard; WARN → PASS. That IS the TDD evidence.
- No production code touched; no adjacent suite impact.

## 5. Gate

Non-risky-class (CI guard script tweak, no production code). Per PART 13.1:
- L1.1 tsc: N/A (bash script)
- L1.2 eslint: N/A (bash script)
- L1.3 all 17 guards: `check-no-stray-db-names` transitions from WARN to PASS; closes the last of the 3 pre-existing FAIL/WARN items
- L1.4 fix-registry: new anchor `R-FIX-BUG-361-STRAY-DB-NAMES-WHITELIST` pinning the new whitelist entries
- L2.5: the guard-transition is the proof
- L2.6: N/A
- L2.7: N/A
- L3/L4/L5: SKIPPED per PART 13.1 — CI-guard-script tweak is not risky-class (no production code path, no auth, no DB, no clinical path). Skip rationale explicit in commit body.

## 6. Explicit non-goals

- Not rewriting the historical runbook (would falsify history).
- Not touching the EXECUTION-PLAN / bug-catalogue ticket references (they're meta-references).
- Not flipping the guard to FAIL mode — that's Phase 0.5 PR 2's job.
