# Plan — BUG-526: L4 reviewer checklist canonicalisation

[Plan agent invocation 2026-04-25 per PART 2 §B; first-principles per PART 6.1 #3. Phase A item 1 of approved plan `~/.claude/plans/sleepy-roaming-meteor.md`.]

**Severity:** S1 (structural prevention; doc-only).
**Class:** Process activation. Codifies the cascade-discovery pattern that surfaced BUG-521 (S0 fatality) during BUG-445's L4 review.

## §0. Drift summary

The L4 reviewer agent (`clinical-safety-reviewer` at `.claude/agents/clinical-safety-reviewer.md`) operates from 8 baked-in clinical rules + per-cycle context + user memory `feedback_audit_checklist.md`. There is NO canonical pinned checklist file capturing:
1. Silent-catch / lie-about-success / schema-fabrication classes (BUG-441/442/443/444/445/516/517/520/521 precedents)
2. The cascade-scan rule (the procedure that found BUG-521 during BUG-445's review)
3. PART 3 trigger discipline (no silent out-of-scope parking)

`ls docs/quality/` 2026-04-25: `bugs-remaining.md`, `deep-audit-scope.md`, `fix-build-rules.md`, `fix-registry.md`, `pre-deployment-checklist.md`. No `l4-reviewer-checklist.md` exists.

## §1. Verification (read-confirmed)

- `docs/quality/` inventory: confirmed no `l4-reviewer-checklist.md`.
- `feedback_audit_checklist.md`: 13-point principal-engineer audit, accessible.
- `clinical-safety-reviewer.md` subagent: 8 clinical rules + ADDITIONAL CHECKS; tools Read/Grep/Glob/Bash; opus.
- `findings-6a-silent-catch.md`: 34 [SILENT] + 6 frontend fabrications enumerated; canonical precedent map.
- `check-fix-registry.sh`: parser splits on `|` at field level (BUG-510 defect); patterns must contain no literal `|` characters.
- `feedback_no_silent_out_of_scope.md`: PART 3 findings must be filed as real BUG rows in sequence, not parked.
- `feedback_atomic_catalogue_flip.md`: bugs-remaining flip must be in the same atomic commit as code.

## §2. Fix shape

NEW file `docs/quality/l4-reviewer-checklist.md` with locked sections (acceptance test asserts these headers exist):

- **Header:** `# L4 reviewer checklist`
- **Front-matter:** purpose, reader contract, pin notice
- **§A — Silent-catch detection** (≤500 words; precedents: BUG-441/442/443/444/516/517/519/523)
- **§B — Lie-about-success detection** (≤500 words; precedents: BUG-445/446/520/521)
- **§C — Schema fabrication detection** (≤500 words; precedents: BUG-456/457/458/489/511/512)
- **§D — Cascade-scan rule** — 3-step procedure (same file ±200 lines, same feature directory, importer chain)
- **§E — PART 3 trigger** (file new shape BEFORE current commit lands)
- **§F — Severity escalation** (S0 fatality / S1 deploy-blocker / S2/S3 decision rules; defines safety-surface scope used by future BUGs incl. BUG-527)
- **§G — Fail-loud-but-non-blocking canonical pattern** (BUG-443 reference shape)
- **Footer:** "How to update this checklist" — same-commit update rule for new classes.

Plus updates: `fix-registry.md` (4 anchors), `bugs-remaining.md` (atomic BUG-526 flip), `CLAUDE.md` §3 cross-link sentence.

## §3. UNION-up-front

N/A — Markdown only.

## §4. §15 contract

N/A — no DB.

## §5. Test plan (mechanical structural test only)

**Pre-fix RED gate:** `test -f docs/quality/l4-reviewer-checklist.md` exits 1; `bash .github/scripts/check-fix-registry.sh` fails on the 4 new rows.

**Post-fix GREEN gate:**
- `test -f docs/quality/l4-reviewer-checklist.md` exits 0.
- 4 fix-registry rows pass.
- 7 section header presence check (one-shot shell):
  ```
  for h in 'A. Silent-catch detection' 'B. Lie-about-success detection' 'C. Schema fabrication detection' 'D. Cascade-scan rule' 'E. PART 3 trigger' 'F. Severity escalation' 'G. Fail-loud-but-non-blocking'; do
    git grep -F -q "$h" -- docs/quality/l4-reviewer-checklist.md || exit 1
  done
  ```
- BUG-ID coverage check: at least 7 of {441,442,443,444,445,456,521} referenced.
- L1 GREEN: tsc × 3 workspaces unchanged, all guards pass.

## §6. Fix-registry rows (4, all `present`, no `|` per BUG-510)

| ID | File | Type | Pattern |
|---|---|---|---|
| `R-FIX-BUG-526-CHECKLIST-EXISTS` | `docs/quality/l4-reviewer-checklist.md` | present | `^# L4 reviewer checklist` |
| `R-FIX-BUG-526-CASCADE-SCAN-RULE` | `docs/quality/l4-reviewer-checklist.md` | present | `Cascade-scan rule` |
| `R-FIX-BUG-526-SILENT-CATCH-CLASS` | `docs/quality/l4-reviewer-checklist.md` | present | `Silent-catch detection` |
| `R-FIX-BUG-526-LIE-ABOUT-SUCCESS-CLASS` | `docs/quality/l4-reviewer-checklist.md` | present | `Lie-about-success detection` |

## §7. Files to modify

| File | Change |
|---|---|
| `docs/quality/l4-reviewer-checklist.md` (NEW) | 7 sections A-G + front-matter + footer (~250-400 LOC) |
| `docs/quality/fix-registry.md` | 4 anchor rows |
| `docs/quality/bugs-remaining.md` | BUG-526 row added as `**fixed**` atomic with code commit |
| `CLAUDE.md` §3 | One-sentence cross-link to the new checklist |

## §8. PART 2 §H/§I trigger assessment

- **L3:** unconditional, FIRES.
- **L4:** does NOT fire (no clinical-safety code touched). Document no-fire in commit body.
- **L5:** FIRES per §I (touches `docs/quality/` + fix-registry). Per Phase A acceptance: "L5 PASS for BUG-526 to BUG-531".

## §9. Risks + follow-ups

- Staleness: §G footer mandates same-commit update for new classes.
- Token budget on agent prompt: each section ≤500 words; reviewer Reads file at review time, doesn't paste whole file.
- Drift vs 8 baked rules: new file ADDS classes (silent-catch / lie-about-success / fabrication / cascade); cross-refs 8 rules where applicable.
- Tribal knowledge: §D cites BUG-521 + BUG-445 as the canonical cascade example with file paths.

No new sibling BUGs surfaced during this cycle (doc-only, no code to cascade-scan).

## §10. Acceptance

- File exists at `docs/quality/l4-reviewer-checklist.md`.
- All 7 section headers (A-G) present per §5 structural test.
- At least 7 BUG IDs referenced.
- 4 fix-registry rows pass.
- L1 GREEN, L3 PASS, L4 not invoked, L5 PASS.
- Atomic catalogue flip: BUG-526 added as `**fixed**` in same commit as code (open-and-close in one step per `feedback_atomic_catalogue_flip.md`).
- Chore-SHA commit follows.
- Explicit user authorization before `git push`.

Per PART 6.1: doc-only; the structural fix IS the documentation. No abstraction wrapper, no hidden behavioural change.
