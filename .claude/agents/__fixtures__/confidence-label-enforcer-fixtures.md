# confidence-label-enforcer — Fixture Test Cases

**Purpose**: 5 synthetic input cases that exercise the agent's PASS/BLOCK rubric. Each fixture documents EXPECTED output. Invocation protocol identical to shortcut-detector fixtures.

---

## Fixture 1 — BLOCK on missing confidence column

**Input** (a bug-list document):
```
| BUG | Module | Notes |
| BUG-X1 | appointments | broken |
| BUG-X2 | patients | broken |
| BUG-X3 | clinic-onboarding | enabledSpecialties not saved |
```

**Expected verdict**: `[BLOCK]`

**Expected missing labels**:
- All 3 rows lack a Confidence column
- Header lacks "Confidence" label
- No tally summary at top

**Required changes**:
1. Add Confidence column to header
2. Assign HIGH/MEDIUM/LOW/UNKNOWN per row with rationale
3. Add tally line: "Total: 3 entries; HIGH: x, MEDIUM: y, LOW: z, UNKNOWN: w"
4. Document promotion mechanism

**Rubric branches exercised**: bug-list document missing confidence column (canonical Class A failure).

---

## Fixture 2 — BLOCK on unjustified LOW→HIGH promotion

**Input** (current version of the entry):
```
| BUG-X1 | HIGH | sibling of MenuItem bug |
```

**Prior version** (referenced in diff):
```
| BUG-X1 | LOW | sibling of MenuItem bug |
```

**Diff**: only the label changed; no new artifact added.

**Expected verdict**: `[BLOCK]`

**Expected unjustified promotion**: LOW → HIGH between prior version and current; no re-verification artifact.

**Required changes**:
- Add re-verification artifact: mechanical test output OR runtime evidence (DevTools capture, DB query result, integration test failure)
- OR revert label to LOW
- OR upgrade to MEDIUM only if static-trace + sibling-pattern + reviewer agent confidence (each requires its own artifact)

**Rubric branches exercised**: silent confidence-label promotion without artifact.

---

## Fixture 3 — PASS on properly-labeled list with promotion artifact

**Input**:
```
| BUG | Conf | Evidence | Module |
|---|---|---|---|
| BUG-X1 | HIGH | runtime-verified via DevTools 2026-05-04 (capture-001.har) + integration test `appointmentCreate.int.test.ts` failure | appointments |
| BUG-X2 | MEDIUM | static-trace + agent-verdict (shortcut-detector PASS); runtime path not exercised | patients |
| BUG-X3 | LOW | single-source: agent grep result | clinic-onboarding |
| BUG-X4 | UNKNOWN | catalogue-inherited; not re-verified this session | retention |

Tally: Total: 4 entries; HIGH: 1, MEDIUM: 1, LOW: 1, UNKNOWN: 1.
Promotion mechanism: Phase 1 mechanical sweep output supersedes; entries promote to HIGH after sweep failure confirms.
```

**Expected verdict**: `[PASS]`

**Expected missing labels**: NONE

**Expected unjustified promotions**: NONE (no diff context provided; assumed no promotion)

**Expected mismatches**: NONE (each label matches its evidence type)

**Why this passes**: per-row confidence + per-row evidence-type + tally + promotion-mechanism documentation.

**Rubric branches exercised**: gold-standard properly-labeled list pattern.

---

## Fixture 4 — BLOCK on label-evidence mismatch

**Input**:
```
| BUG-X1 | HIGH | sibling pattern matched via grep |
| BUG-X2 | HIGH | I traced the code chain end-to-end |
| BUG-X3 | HIGH | the agent reported it |
```

**Expected verdict**: `[BLOCK]`

**Expected label-evidence mismatches**:
- Entry X1 labeled HIGH but evidence is "sibling pattern matched via grep" → MEDIUM (sibling-pattern is corroborating, not verifying)
- Entry X2 labeled HIGH but evidence is "I traced the code" → MEDIUM (static-trace, not runtime)
- Entry X3 labeled HIGH but evidence is "agent reported" → MEDIUM (single-agent claim corroborated by humans is MEDIUM; only mechanical-test-failure or runtime-verification earns HIGH)

**Required changes**: downgrade all 3 to MEDIUM with rationale, OR add the runtime/mechanical artifact that earns HIGH.

**Rubric branches exercised**: label-evidence mismatch detection (per definition table in agent prompt).

---

## Fixture 5 — PASS on UNKNOWN entries from inherited catalogue

**Input**:
```
| BUG | Conf | Source |
|---|---|---|
| BUG-368 | UNKNOWN | bugs-remaining.md S0 row inherited; not re-verified this session |
| BUG-369 | UNKNOWN | bugs-remaining.md S0 row inherited; not re-verified this session |
| BUG-374 | UNKNOWN | bugs-remaining.md S1 row (3 sub-cycles); not re-verified this session |

Tally: Total: 3 entries; HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 3.
Promotion path: each entry will be re-verified during Phase 1 mechanical sweep OR via per-bug audit during fix execution. Until then, UNKNOWN is the honest label.
```

**Expected verdict**: `[PASS]`

**Why this passes**: UNKNOWN is the correct label for catalogue-inherited entries that haven't been re-verified this session. Explicit promotion path documented.

**Rubric branches exercised**: UNKNOWN label acceptance + promotion-path documentation.

---

## Fixture invocation protocol

Same as shortcut-detector — invoke `Agent({ subagent_type: 'confidence-label-enforcer', prompt: <input> })` once registration completes. Manual review fallback until then.

**Self-invocation gap**: same as shortcut-detector — agent file exists but not yet registered in Claude Agent registry. Tracked as `BUG-CONFIDENCE-LABEL-ENFORCER-REGISTRATION` (S2; sibling of BUG-SHORTCUT-DETECTOR-REGISTRATION).
