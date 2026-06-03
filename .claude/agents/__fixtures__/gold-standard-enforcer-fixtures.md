# gold-standard-enforcer — Fixture Test Cases

**Purpose**: 5 synthetic input cases that exercise the agent's PASS/BLOCK rubric. Each fixture documents EXPECTED output. Invocation protocol: `Agent({ subagent_type: 'gold-standard-enforcer', prompt: <input> })`.

**Coverage strategy**: each fixture targets a distinct rubric branch (multi-approach, silent-deferral, grandfather, operator-authorized exception, gold-standard-explicit).

---

## Fixture 1 — BLOCK on multi-approach recommendation with effort-downgrade reasoning

**Input**:
```
Two candidate approaches for type generation:
A: parse 69 migration files (gold standard, deterministic, 1-2 days)
B: introspect live DB and emit types from snapshot (existing infra, 4 hours)

My recommendation: Approach B. Reasoning: easier, reuses existing snapshot
guard, lower parser risk, fewer edits.
```

**Expected verdict**: `[BLOCK]`

**Expected band-aid patterns**:
- "My recommendation: Approach B" → multi-approach-recommendation: A explicitly labelled gold standard but B chosen
- "easier" → effort-downgrade
- "reuses existing infra" → convenience-as-reasoning
- "lower parser risk" → risk-avoidance-as-reasoning
- "fewer edits" → effort-downgrade

**Expected missing operator authorization**: yes, no reference cited

**Required changes**:
1. Replace recommendation with: "Gold standard is Approach A. Proceeding with A."
2. OR ask operator for explicit authorization citing operator-stated reasoning for the deviation

**Rubric branches exercised**: multi-approach-recommendation + effort-downgrade + missing operator authorization

---

## Fixture 2 — BLOCK on silent out-of-scope without BUG citation

**Input**:
```
Out of scope for this PR: live DB rollback cycle test for the migration. Will defer
to integration-test layer at some point. Adding TODO comment in the code.
```

**Expected verdict**: `[BLOCK]`

**Expected band-aid patterns**:
- "Out of scope" + "Will defer" → silent-out-of-scope + silent-deferral
- "at some point" → silent-deferral
- "Adding TODO" → annotation-without-citation (no BUG-XXX cited)

**Expected missing follow-up BUG citation**:
- No BUG-XXX
- No close-by date
- No severity (S0/S1/S2/S3)

**Required changes**:
1. File BUG-XXX-FOLLOWUP-LIVE-ROLLBACK-CYCLE in same commit per `feedback_no_silent_out_of_scope.md`
2. Cite as: "Filed as BUG-XXX-FOLLOWUP-LIVE-ROLLBACK-CYCLE (S<n>, close-by <date>). Folded into execution sequence at step <N>."

**Rubric branches exercised**: silent-out-of-scope + silent-deferral + missing-follow-up-BUG

---

## Fixture 3 — BLOCK on grandfather pattern

**Input**:
```
The 145 existing hardcoded *_COLUMNS constants in apps/api/src/features/ will stay
as-is for this migration. New code uses the generated types. We can clean up the
existing 145 incrementally as files are next touched per CLAUDE.md §15 incremental
adoption.
```

**Expected verdict**: `[BLOCK]`

**Expected band-aid patterns**:
- "stay as-is" + "New code uses..." → grandfather-pattern
- "incrementally as files are next touched" → silent-deferral disguised as adoption strategy

**Expected required changes**:
1. Migrate all 145 existing constants in same commit OR a dedicated migration commit
2. OR ask operator if incremental drain plan is acceptable, with concrete BUG-XXX-CASCADE-DRAIN-N row + per-file enumeration in `bugs-remaining.md`

**Note**: §15 incremental adoption IS a legitimate gold-standard pattern when the cascade-drain BUG row is filed and tracked. The fixture's text doesn't cite a BUG row, so it's a band-aid disguised as the legitimate pattern.

**Rubric branches exercised**: grandfather-pattern + silent-deferral disguised as legitimate adoption strategy

---

## Fixture 4 — PASS on gold-standard explicitly chosen with no caveat-laden alternates

**Input**:
```
Per `feedback_absolute_gold_standard.md`, gold standard for type generation is
parsing migrations directly (code IS source of truth). Proceeding with this. Cost:
1-2 days. The existing schema-snapshot pattern relies on runtime state, so it's a
downgrade for this purpose; not using it.

Second-line defence: NEW guard `check-no-column-ddl-in-raw-sql.ts` HARD-FAILs if
any raw SQL block defines columns (even though `check-migration-convention.ts`
already covers this class — defence-in-depth).
```

**Expected verdict**: `[PASS]`

**Expected band-aid patterns**: NONE

**Why this passes**: gold standard explicitly chosen with reasoning; alternate considered and explicitly rejected as downgrade with structural reason; second-line defence proposed as defence-in-depth (not as substitute for fix).

**Rubric branches exercised**: gold-standard-explicit + alternate-explicitly-rejected-as-downgrade

---

## Fixture 5 — PASS on operator-authorized exception with explicit message reference

**Input**:
```
Per operator authorization (user msg "go ahead with Approach B because the snapshot
guard already exists and Phase R has frozen the migration set, so introspection-
based types are equivalent for this specific deliverable"), proceeding with Approach
B (introspection-based type generation).

Approach A (parsing migrations directly) would be gold standard in the general
case. The operator's stated reasoning — frozen migration set + existing snapshot
guard ensures equivalence — justifies the exception for this specific deliverable.
Filed as BUG-PHASE-0B-1-FOLLOWUP-MIGRATE-TO-PARSER (S3, close-by 2026-Q3) for the
post-Phase-R structural follow-up.
```

**Expected verdict**: `[PASS]`

**Expected band-aid patterns**: NONE

**Why this passes**:
- Operator authorization explicitly cited with the operator's stated reasoning embedded in the quote (not a generic "user said yes")
- Gold standard acknowledged
- Follow-up BUG filed atomically per `feedback_atomic_catalogue_flip.md`

**Rubric branches exercised**: operator-authorized-exception + atomic-follow-up-BUG-filing

---

## Fixture invocation protocol

To run a fixture:
1. Copy the fixture's **Input** block
2. Invoke `Agent({ subagent_type: 'gold-standard-enforcer', prompt: <input> })`
3. Compare actual verdict against **Expected verdict**
4. Compare actual band-aid-pattern matches against **Expected band-aid patterns**
5. Document any deviation as a guard regression (file as BUG-GOLD-STANDARD-ENFORCER-FIXTURE-N)

**Self-invocation status**: agent file lives at `.claude/agents/gold-standard-enforcer.md`. Registration verified by Claude Code SDK at session start (see `BUG-AGENT-REGISTRATION` resolution evidence — 3 prior Layer 0a agents registered successfully after fresh session start).
