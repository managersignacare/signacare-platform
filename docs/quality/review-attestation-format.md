# Review-Attestation Artifact Format

**Status**: canonical (BUG-PRECOMMIT-REVIEW-CHAIN-FOR-S1 D3, 2026-05-06).
**Spec version**: 1.

## Purpose

The review-attestation artifact is a tree-hash-bound JSON record of which
reviewers ran against a specific staged-snapshot of the working tree, what
their verdicts were, and what the qualifying conditions for L4 N/A (if any)
were. The artifact is the structural answer to the cf3f567 failure mode —
where mechanical gates were green and the commit landed without the L1-L5
review chain having actually run for that diff.

The artifact is consumed by the commit-msg hook (D4) on trigger commits per
the criteria in `scripts/guards/lib/detectTriggerCommit.ts`. If the
artifact is absent, has the wrong tree-hash, or is missing required
verdicts, the commit-msg hook rejects the commit.

## Location

```
.git/signacare-review-attestation.json
```

The `.git/` directory is OUTSIDE the repo's tracked tree, so the artifact
cannot be accidentally committed. It lives per-clone (developer machine,
CI runner — though CI does not produce this artifact; it consumes only
mechanical gates). Each developer's artifact is private to their checkout.

## Schema (v1)

```jsonc
{
  // Schema version. Future schema migrations will bump this number.
  "version": 1,

  // Output of `git write-tree` at attestation time. Binds the artifact
  // to the EXACT staged-snapshot the reviewers ran against. If the
  // staged tree changes (further edits, re-stage), tree-hash changes
  // and the artifact becomes invalid for the new state.
  "treeHash": "0123456789abcdef0123456789abcdef01234567",

  // ISO 8601 timestamp of artifact creation. Informational only;
  // commit-msg hook does NOT enforce a staleness window per Q2
  // operator decision 2026-05-06 — tree-hash binding is sufficient.
  "createdAt": "2026-05-06T11:42:00.000Z",

  // Trigger kinds that fired against the staged-snapshot at attestation
  // time. Computed by `detectTriggerCommit` (D1). Informational; the
  // commit-msg hook re-runs detection on the about-to-be-committed
  // state and uses ITS result, not this field.
  "triggerKind": ["migrations", "bug-closure-s012"],

  // Reviewer verdicts. The required set depends on trigger criteria.
  // For ALL trigger commits, the cycle-1 quartet + L3 + L5 are required.
  // L4 is required IF clinical-data subject-matter applies per the rubric
  // in `feedback_l4_subject_matter_test.md`; else "N/A" with rationale.
  "reviewers": {
    "confidence-label-enforcer": { "verdict": "PASS", "cycle": 1 },
    "shortcut-detector":         { "verdict": "PASS", "cycle": 1 },
    "gold-standard-enforcer":    { "verdict": "PASS", "cycle": 2, "absorbedFrom": "PARTIAL" },
    "dod-completion-checker":    { "verdict": "PASS", "cycle": 1 },
    "L3":                        { "verdict": "PASS", "cycle": 1 },
    "L4":                        { "verdict": "N/A",  "rationale": "doc-only commit; no clinical-data tables touched; no patient-harm class" },
    "L5":                        { "verdict": "PASS", "cycle": 1 }
  }
}
```

### Field reference

| Field          | Type     | Required           | Notes                                                                                                           |
|----------------|----------|--------------------|-----------------------------------------------------------------------------------------------------------------|
| `version`      | integer  | YES                | Currently `1`. Bump on schema migration.                                                                        |
| `treeHash`     | string   | YES                | 40-char hex SHA-1 from `git write-tree` at attestation time.                                                    |
| `createdAt`    | string   | YES                | ISO 8601 UTC timestamp. Informational.                                                                          |
| `triggerKind`  | string[] | YES                | Subset of `migrations` / `features-3plus` / `bug-closure-s012`. May be empty if attestation is preemptive.       |
| `reviewers`    | object   | YES                | Keyed by reviewer name. See "Required reviewers" below.                                                         |

#### Reviewer entry

| Field          | Type   | Required when                       | Notes                                                                                                                |
|----------------|--------|-------------------------------------|----------------------------------------------------------------------------------------------------------------------|
| `verdict`      | enum   | always                              | One of `"PASS"` / `"PARTIAL"` / `"BLOCK"` / `"N/A"`. `"N/A"` is L4-only.                                              |
| `cycle`        | int    | required iff `verdict !== "N/A"`     | The cycle number (1, 2, 3, ...) at which the reviewer reached this verdict. Cycle 1 is initial run.                    |
| `absorbedFrom` | enum   | optional                            | If verdict was upgraded from `"PARTIAL"` or `"BLOCK"` via absorb cycle, names the prior verdict. Audit-trail only.    |
| `rationale`    | string | required iff `verdict === "N/A"`    | Free-text rationale for L4 N/A. Per Q5 operator decision 2026-05-06: free-text, not enum.                            |

### Verdict semantics

- `"PASS"` — reviewer reached PASS verdict.
- `"PARTIAL"` — reviewer found absorbable findings; agent absorbed inline + re-ran reviewer; final verdict is `"PASS"`. Recorded as `"PASS"` with `absorbedFrom: "PARTIAL"` for audit trail.
- `"BLOCK"` — reviewer found blocking violation. The artifact MUST NOT record `"BLOCK"` as the final verdict — block must be absorbed (becomes `"PASS"` with `absorbedFrom: "BLOCK"`) OR the closure scope changes (operator decision; new artifact for new diff).
- `"N/A"` — L4-only. Reviewer determined the change does not meet the clinical-safety subject-matter test. `rationale` field is required.

## Required reviewers

| Reviewer                       | Required when                                                      |
|--------------------------------|--------------------------------------------------------------------|
| `confidence-label-enforcer`    | Always (every trigger commit)                                      |
| `shortcut-detector`            | Always                                                             |
| `gold-standard-enforcer`       | Always                                                             |
| `dod-completion-checker`       | Always                                                             |
| `L3` (code-reviewer-general)   | Always                                                             |
| `L5` (architecture-reviewer)   | Always                                                             |
| `L4` (clinical-safety-reviewer)| Conditional: required iff subject-matter test fires (see below)    |

### When L4 is required

Per `feedback_l4_subject_matter_test.md` (memory entry, 2026-05-06), L4 is
required when the staged diff modifies code that stores or reads:

- diagnoses
- treatment decisions
- medication dosing
- performance scores (e.g., ECOG, MMSE, AIMS)
- clinical attributions (signed clinical notes, prescriber attribution, MDT roster)
- statutory triggers (MHA forms, escalation cascades, SLA timers)
- consent records
- AHPRA discipline-eligibility evidence

The closed-list regex enumeration in
`.claude/agents/clinical-safety-reviewer.md` is a HEURISTIC, not the rubric.
The subject-matter test above is the canonical rubric.

If L4 N/A is claimed, the `rationale` field MUST be free-text describing
WHY no subject-matter trigger applies. Examples of acceptable rationales:

- `"doc-only commit; no clinical-data tables touched; no patient-harm class"`
- `"scaffolding-only; no feature code touched; no clinical surface"`
- `"infrastructure (build / CI / lint); no runtime feature behavior"`
- `"test-helper refactor; tests-only; no production code path affected"`

Examples of UNACCEPTABLE rationales (rejected by reviewer-during-attestation):

- `"L4 doesn't apply"` (no rationale)
- `"too small"` (effort-based, not subject-matter)
- `"closed-list regex doesn't match"` (closed-list reading, not subject-matter)

## Production workflow (Q1: agent-driven, 2026-05-06)

The agent (Claude) is the artifact producer. There is NO wrapper-script
orchestrator — reviewer outputs ARE the agent's verdicts; a wrapper would
be a parallel orchestrator that drifts.

Workflow:

1. **Detect trigger.** Agent runs `detectTriggerCommit` (D1) against the
   current staged diff + drafted commit message. If `triggered === false`,
   no artifact is required; commit can proceed.

2. **Run cycle-1 quartet.** Agent invokes via the Agent tool, in any
   order:
   - `confidence-label-enforcer`
   - `shortcut-detector`
   - `gold-standard-enforcer`
   - `dod-completion-checker`

   Collect each verdict (PASS / PARTIAL / BLOCK).

3. **Run L3 + L5.** Agent invokes via the Agent tool:
   - `code-reviewer-general` (L3)
   - `architecture-reviewer` (L5)

   Collect each verdict.

4. **Run L4 IF subject-matter test fires.** Agent applies the subject-matter
   rubric above. If the diff touches any of the listed clinical-data classes,
   invoke `clinical-safety-reviewer` (L4) and collect verdict. Else record
   `verdict: "N/A"` + `rationale: "<free text>"`.

5. **Absorb cycles.** If any reviewer returned `"PARTIAL"` or `"BLOCK"`:
   - PARTIAL → absorb inline (apply suggested changes) + re-run reviewer.
   - BLOCK → surface to operator with options. After operator decision +
     absorbed changes, re-run reviewer.

   When all reviewers have reached PASS or N/A:
   - Record final verdict.
   - For PARTIAL/BLOCK absorbs, record `absorbedFrom` field.
   - Cycle counter increments per absorb iteration.

6. **Capture tree-hash.** Agent runs `git write-tree` and records output
   as `treeHash`. This MUST be done AFTER all absorbs are applied + staged
   (the artifact is bound to the FINAL pre-commit staged-snapshot).

7. **Write artifact.** Agent writes the JSON to
   `.git/signacare-review-attestation.json`.

8. **Attempt commit.** Agent runs `git commit`. The commit-msg hook (D4)
   reads the artifact, recomputes `git write-tree`, and validates per the
   rules below. If validation passes, commit proceeds.

## Verification rules (commit-msg hook, D4)

The commit-msg hook (`scripts/guards/check-review-attestation.ts`) applies
these rules in order. ANY failure rejects the commit with a clear error:

1. **Trigger detection** on the about-to-be-committed state. Compute trigger
   kinds via D1 against `git diff --cached --name-only` + the commit message
   currently in `.git/COMMIT_EDITMSG`. If no trigger fires → SKIP all
   subsequent rules; PASS.

2. **Artifact present.** Read `.git/signacare-review-attestation.json`. If
   absent → REJECT with: "Trigger commit detected (kinds: ...) but no review-
   attestation artifact present at .git/signacare-review-attestation.json.
   Run the reviewer chain first; see docs/quality/review-attestation-format.md
   for workflow."

3. **Schema valid.** Parse JSON. If invalid JSON or missing required fields →
   REJECT with field-specific error.

4. **Schema version supported.** `version === 1`. If not → REJECT with version-
   mismatch error.

5. **Tree-hash matches.** Run `git write-tree` (read-only; does not modify
   index). If `artifact.treeHash !== currentTreeHash` → REJECT with: "review-
   attestation artifact is for a different staged snapshot (artifact:
   <hash-prefix>; current: <hash-prefix>). Re-run reviewer chain on current
   diff."

6. **Required reviewers all present.** For each required reviewer (cycle-1
   quartet + L3 + L5 always; L4 conditional per #7) verify presence in
   `reviewers` object. If missing → REJECT with which reviewer is missing.

7. **L4 conditional.** If subject-matter test fires (heuristic: diff touches a
   clinical-data feature directory listed in
   `scripts/guards/lib/l4ClinicalFeatures.ts` — the canonical SSoT for the
   L4-required clinical-feature inventory), L4 is REQUIRED. The hook applies
   a CONSERVATIVE heuristic; the agent's rubric in
   `feedback_l4_subject_matter_test.md` is the canonical authority. If
   hook-heuristic fires + L4 absent → REJECT.

   The L4-feature SSoT is `scripts/guards/lib/l4ClinicalFeatures.ts`
   (export `L4_CLINICAL_FEATURES`). This document does NOT reproduce the
   list — reproducing would re-introduce the drift that L5 cycle-1 caught
   2026-05-06. To see the current list: read the module file.

   If L4 verdict is `"N/A"` + `rationale` field is empty → REJECT with: "L4
   N/A claim requires non-empty `rationale` field per Q5 operator decision
   2026-05-06."

8. **No final BLOCK or PARTIAL verdicts.** For each reviewer entry,
   `verdict` MUST NOT be `"BLOCK"` or `"PARTIAL"`. PARTIAL and BLOCK must
   be absorbed before the artifact is finalized — final verdict is
   recorded as `"PASS"` with `absorbedFrom` field carrying the audit
   trail. (L3 cycle-1 absorb #2 2026-05-06 added explicit PARTIAL
   rejection alongside BLOCK; pre-fix only BLOCK was rejected and final
   PARTIAL silently passed.)

If all rules pass → commit-msg hook PASSES; commit proceeds.

## Bypass posture

Per Q3 operator decision 2026-05-06: NO bypass mechanism in this hook.
`git commit --no-verify` is the OS-level escape hatch — visible in `git
log` forever, intentionally heavy, used for genuine emergencies only.

If the hook is wrong (e.g., heuristic L4 false-positive on a non-clinical
diff), the right path is to file a BUG against the heuristic + use
`--no-verify` once with a justifying commit-message paragraph stating
"used --no-verify because of <specific hook bug>; see BUG-XXX". The
operator vigilance + git history makes this auditable.

## Cross-references

- `feedback_l4_subject_matter_test.md` — canonical L4 rubric.
- `feedback_per_deliverable_dod.md` — DoD discipline (which feeds the
  artifact's existence requirement at trigger commits).
- `feedback_review_chain_required_for_s1.md` — the operator-discipline
  memory entry that this hook is the structural backstop for.
- `feedback_explicit_push_authorization.md` — push authorization is
  separately gated; the artifact does NOT authorize push.
- `~/.claude/plans/bug-precommit-review-chain-for-s1.md` — the plan
  document this artifact spec lives under.

## Schema migration policy

When schema needs to change (e.g., new required field):

1. Bump `version` to 2.
2. Update this document with the new schema + migration notes.
3. Update D4 hook to accept BOTH versions for a transition window (≥30 days)
   so existing artifacts during the transition are still valid.
4. Update D3 producer documentation.
5. After transition window, drop v1 support.

Schema changes are themselves trigger commits (modify the hook code +
this document) and require a fresh review-attestation artifact.
