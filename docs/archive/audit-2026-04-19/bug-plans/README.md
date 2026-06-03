# Bug Plan Docs — canonical per-bug final-plan record

One markdown file per catalogued BUG-NNN. Authored at the end of the
propose → review → execute cycle and co-committed with the fix.

## Purpose

Captures what the other artefacts don't:

- `bug-catalogue-v2.yaml` entry = outcome + state, not deliberation.
- Commit body = what-was-done, not trade-offs considered.
- `fix-registry.md` row = regression anchor, not rationale.
- `follow-up-on-cloud-deploy.md` = cross-cutting residuals, not per-bug.

This directory is the single authoritative record of **why this fix, not a
different one**, **what the reviewer pushed back on and how it was absorbed
or rebutted with evidence**, and **what was consciously deferred to a new
BUG row**. Useful for CAB sign-off, future-me audit, and onboarding.

## File naming

`BUG-NNN-short-slug.md` — slug is a lowercase-hyphenated keyword set
matching the catalogue title. Multi-BUG fixes use `BUG-NNN-MMM-slug.md`.

## Canonical section order

```
# BUG-NNN — <catalogue title>

## 1. Metadata
- Severity / Track / Wave / Change-class
- Commit SHA: <sha after landed>
- Fix-registry anchor: <name>
- Discovered: <date or pre-plan>
- Closed: <date>

## 2. Diagnosis
Root cause — one sentence, traced to file:line.
Classification — isolated | symptomatic | structural.
Other instances — grep pattern + result.

## 3. Approach
Gold-standard fix shape. Downstream impact (APIs, schema, consumers).
Existing pattern cited as file:line.

## 4. Alternatives considered + rejected
Each with rationale. Evidence cited for why rejected (file:line or constraint).

## 5. Reviewer refinement trail
Each round of review feedback. Per point: ACCEPTED / REBUTTED with citation.
This section documents why the final plan differs from the first proposal.

## 6. Implementation outline
Files touched (absolute paths). Key code shape — a few representative snippets,
not the full diff (the diff lives in git).

## 7. Tests
Red-first trace: pre-fix FAIL counts, post-fix PASS counts.
Unit tests: list with one-line purpose.
Integration tests: list with one-line purpose.

## 8. Verification trace
Enumerated scenarios per PART 3.7 VERIFICATION template.
Each scenario: expected result, result observed.

## 9. Residual risk
Honest enumeration. Each item paired with mitigation, follow-up document
reference, or newly filed BUG row.

## 10. CAB / change-control notes
- Catalogue amendments (old text → new text)
- New BUG rows filed (IDs, severity, owner)
- Scope changes
- Licence acceptance if new dep

## 11. QA agent verdicts
- L1 static: PASS / FAIL-with-pre-existing-outside-scope
- L2 narrative: PASS / N/A
- L3 code judgement: APPROVE / REQUEST_CHANGES / BLOCK
- L4 clinical safety: APPROVE / N/A
- L5 architecture: APPROVE / REQUEST_CHANGES / BLOCK
```

## Rule

Every landed bug fix has a matching plan doc here. No fix commits without
one (except the 5 backfilled, which were committed before this directory
existed — their plan docs are post-hoc and explicitly noted as such).

A plan doc that would only repeat the commit body word-for-word is a sign
the reviewer cycle produced no refinement — still write it, because the
audit trail matters.
