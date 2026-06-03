## PR Checklist — Signacare EMR

### Before submitting, verify:

- [ ] `npm run test` passes (93+ tests)
- [ ] `npm run lint` passes
- [ ] No `console.log` with PHI (patient names, Medicare, IHI, DVA, phone)
- [ ] No `.returning('*')` on staff table (use SAFE_STAFF_COLUMNS)
- [ ] No `db.raw()` with string interpolation (use `?` placeholders)
- [ ] New routes have `authMiddleware` (or documented reason for public access)
- [ ] New tables with `clinic_id` have RLS policy
- [ ] New tables with `patient_id` have `clinic_id` column
- [ ] Database INSERT/UPDATE uses correct column names (not legacy camelCase)
- [ ] File uploads use multer with `fileFilter` allowlist
- [ ] Error responses use `next(err)` not `res.json({ error: err.message })`
- [ ] Stale items in touched surfaces removed (or explicitly logged in `docs/quality/bugs-remaining.md` with reason)

### For clinical features:
- [ ] Audit trigger exists on the table
- [ ] Zod validation on request body
- [ ] `parseRow()` used for response serialization (date coercion)
- [ ] PHI fields encrypted if applicable

### Type of change:
- [ ] Bug fix
- [ ] New feature
- [ ] Security fix
- [ ] Documentation

---

<!--
  Phase 0a.13 deliverable (2026-05-03).
  The 5 sections below are mandatory and mechanically verified by
  `scripts/guards/check-pr-template-compliance.ts` (CI merge-gate
  + local pre-check via `npm run guard:pr-template-compliance --
  --body-file <path>`). Skipping or removing a section header → CI FAILS.

  Inline opt-out for trivial PRs (typo-only, single-line doc fix):
    <!-- @pr-template-exempt: <non-empty reason> -->
  Use sparingly; allowlist via scripts/guards/check-pr-template-compliance.allowlist
  with `permanent: <reason>` rationale per Phase 0a.7 expiry policy.
-->

## DoD Status

<!--
  Reproduce the deliverable's DoD from the active plan file (path resolved
  from docs/quality/active-plan.md). For EACH DoD line, mark [x] (with
  artifact reference) or [ ] (with explicit "OPEN" reason).

  Example:
  - [x] File X exists at apps/api/src/foo.ts (47 LOC, in this PR's diff)
  - [x] Tests pass: $ npx vitest run foo.test.ts → 12/12 PASS [HIGH]
  - [ ] Push auth — NOT REQUESTED yet (gated on this PR landing)
-->

(per-DoD-line status here)

## Confidence Labels

<!--
  Per `feedback_confidence_labels.md` — every substantive claim in this PR
  body carries an explicit HIGH / MEDIUM / LOW / UNKNOWN label with
  rationale. In-flight items (reviewer agents pending) are labeled UNKNOWN.

  Example:
  - All guard PASS results: HIGH (mechanical command output)
  - Code correctness for new helper: HIGH (vitest 5/5 PASS — runtime observed)
  - L3 / L5 / discipline-agent verdicts: HIGH (directly observed mechanical
    invocations; verdicts quoted in commit message)
  - Push authorization: NOT REQUESTED — gated on this PR's review + merge auth
-->

(per-claim confidence labels here)

## Gold-Standard Compliance

<!--
  Per `feedback_absolute_gold_standard.md` — explicit statement that the
  gold-standard path was chosen for this PR. If a non-gold-standard
  approach was taken, cite operator authorization with operator-stated
  reasoning AND file the structural-fix follow-up BUG.

  Example:
  - This PR implements the gold-standard structural fix (single source of
    truth via `lib/X.ts` extraction). No band-aid framing. No
    grandfathering. No silent deferral.
  - L5 advisories tracked at explicit destinations (Phase N+1 DoD lines OR
    "already covered by X" rationale).
-->

(gold-standard compliance statement here)

## L3 / L4 / L5 References

<!--
  Quoted verdicts from reviewer agent invocations in this PR's preparation.
  Cite each agent that ran (PASS / REJECT / N/A with rationale).

  Example:
  - L3 (code-reviewer-general): PASS [HIGH — directly observed]
    Quoted verdict: "PASS - APPROVED FOR COMMIT. ..."
  - L4: N/A (rationale: discipline scaffold, no clinical-surface touch)
  - L5 (architecture-reviewer): PASS [HIGH — directly observed]
    Quoted verdict: "PASS — ARCHITECTURAL INTEGRITY PRESERVED. ..."
-->

(reviewer agent verdict references here)

## Atomic Commit List

<!--
  List the commits in this PR. Each should be atomic per
  `feedback_atomic_catalogue_flip.md` — one cohesive change per commit.
  Include SHAs once available.

  Example:
  - 8fc3547 — feat(phase-0a.11): active-plan pointer + SSoT extractions
  - 071a6bf — feat(phase-0a.12): claim-discipline guard for commit/PR text
-->

(atomic commit list here)
