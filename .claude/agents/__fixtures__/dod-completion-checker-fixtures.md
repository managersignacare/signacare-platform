# dod-completion-checker — Fixture Test Cases

**Purpose**: 5 synthetic input cases that exercise the agent's PASS/PARTIAL/BLOCK verdict mapping. Each fixture documents EXPECTED output. Invocation protocol identical to shortcut-detector fixtures.

---

## Fixture 1 — BLOCK on commit with unverified L1 + missing reviewer invocations

**Deliverable identifier**: "Phase 0b.1 — migration-driven type generation: deliverable claimed complete"

**Plan-file DoD lookup** (from `### 0b.1` block):
- [ ] All 240+ tables have generated types
- [ ] Hand-written equivalents that don't extend / annotate fail CI
- [ ] All Phase 0a DoD checks satisfied (which itself unfolds to ~15 sub-DoDs including L1 tsc x 3 + L3 + L5 + commit + push auth)

**Synthetic conversation context**: no `npx tsc --noEmit -p apps/api` invocation in recent messages; no `code-reviewer-general` agent result in conversation; commit message says "tests pass" but no command output shown.

**Expected verdict**: `[BLOCK]`

**Expected DoD status**:
| # | DoD Line | Artifact | Status |
|---|---|---|---|
| 1 | All 240+ tables have generated types | files at `apps/api/src/db/types/<table>.ts` | ✗ — not verified (Glob check needed) |
| 2 | Hand-written equivalents fail CI | NEW guard `check-no-hardcoded-column-lists.ts` exists + runs | ✗ — not verified |
| 3 | L1: tsc x 3 clean | tsc command output | ✗ — NOT VERIFIED, no output in conversation |
| 4 | L3 PASS | code-reviewer-general invocation in conversation | ✗ — not invoked |
| 5 | L5 PASS | architecture-reviewer invocation | ✗ — not invoked |
| 6 | Atomic commit landed | commit SHA | ✗ — no commit yet |
| 7 | User push authorization | conversation message | ✗ — not requested |

**Expected verdict reason**: 7 of 7 DoD lines unsatisfied → BLOCK.

**Rubric branches exercised**: BLOCK on most-DoD-lines-failing.

---

## Fixture 2 — PASS on fully-verified deliverable

**Deliverable identifier**: "Phase 0a.5 — discipline memory files"

**Plan-file DoD lookup** (from `### 0a.5` block):
- [ ] All 5 files written under `~/.claude/projects/.../memory/`
- [ ] Indexed in MEMORY.md
- [ ] Each contains specific actionable guidance + concrete trigger conditions

**Synthetic context**: Read tool confirms 5 files exist at the path; MEMORY.md has 5 new entries (lines 22-26 per Read); each file has YAML frontmatter + actionable guidance sections.

**Expected verdict**: `[PASS]`

**Expected DoD status**:
| # | DoD Line | Artifact | Status |
|---|---|---|---|
| 1 | All 5 files written | file existence (`feedback_audit_vs_walkthrough.md` + 4 others) | ✓ — verified via Read |
| 2 | Indexed in MEMORY.md | MEMORY.md content | ✓ — 5 new entries at lines 22-26 |
| 3 | Each contains actionable guidance | content review | ✓ — frontmatter + Why + How + Triggers sections per file |

**Expected verdict reason**: all 3 DoD lines ✓.

**Rubric branches exercised**: PASS on full DoD compliance.

---

## Fixture 3 — PARTIAL with explicit gap list

**Deliverable identifier**: "Phase 0a.1 — shortcut-detector agent (cycle-1)"

**Plan-file DoD lookup**:
- [ ] Agent file exists at the path with full prompt + capability list
- [ ] Agent invokable via `Agent` tool with subagent_type='shortcut-detector'
- [ ] 5 fixture test cases: agent flags shortcut on each
- [ ] Documented in CLAUDE.md §11 layering as "Layer 0a discipline check"
- [ ] L1-L5 PASS on the commit landing the agent

**Synthetic context**: file exists at `.claude/agents/shortcut-detector.md`; first invocation returned "Agent type not found" (registration gap); 5 fixture tests written but agent not yet invoked on them; CLAUDE.md §11 NOT updated; L3 + L5 invoked POST-commit and L3 returned REJECT.

**Expected verdict**: `[PARTIAL]`

**Expected DoD status**:
| # | DoD Line | Artifact | Status |
|---|---|---|---|
| 1 | Agent file exists | path verified | ✓ |
| 2 | Agent invokable | registration check | ✗ — registry-not-found error |
| 3 | 5 fixture tests | fixture file exists | ✓ — written; awaiting registration to execute |
| 4 | CLAUDE.md §11 updated | grep CLAUDE.md for "Layer 0a" | ✗ — not yet updated (cycle-2 absorb pending) |
| 5 | L1-L5 PASS | reviewer invocation | ⚠ — L1 N/A (markdown), L3 REJECTED (cycle-1), L5 PASS, cycle-2 absorb pending |

**Expected verdict reason**: 2 of 5 DoD lines satisfied; 3 incomplete with concrete reasons; PARTIAL with action list.

**Required actions**:
1. Resolve agent registration (BUG-SHORTCUT-DETECTOR-REGISTRATION)
2. Update CLAUDE.md §11
3. Cycle-2 absorb of L3 REJECT findings

**Rubric branches exercised**: PARTIAL with clear gap list (the canonical "in-progress with known gaps" state).

---

## Fixture 4 — BLOCK on missing commit SHA + missing push auth

**Deliverable identifier**: "Phase 0a.6 — DoD framework template"

**Plan-file DoD lookup**:
- [ ] Template file exists
- [ ] Adopted by every Phase 0b deliverable (the framework's adoption verifies once Phase 0b ships)
- [ ] Atomic commit landed (commit SHA: ___)
- [ ] User push authorization received

**Synthetic context**: file exists at `docs/quality/deliverable-dod-template.md`; commit message has "Commit SHA: pending" placeholder; push auth not yet requested (per `feedback_explicit_push_authorization.md`).

**Expected verdict**: `[BLOCK]`

**Expected DoD status**:
| # | DoD Line | Status |
|---|---|---|
| 1 | Template file exists | ✓ |
| 2 | Adopted by Phase 0b deliverables | N/A — premature (Phase 0b not yet started) |
| 3 | Commit SHA | ✗ — placeholder "pending"; no real SHA |
| 4 | User push authorization | ✗ — not requested |

**Expected verdict reason**: critical lines (commit + push) ✗ → BLOCK.

**Rubric branches exercised**: BLOCK on missing commit SHA + missing push auth (per "Common gaps that BLOCK" rubric).

---

## Fixture 5 — N/A handling for legitimate non-applicability

**Deliverable identifier**: "Phase 0a.5 — discipline memory files (markdown-only)"

**Plan-file DoD lookup** (after applying category-specific adaptations from DoD template):
- [ ] All 5 memory files exist
- [ ] MEMORY.md indexed
- [ ] Each has actionable guidance
- [ ] L1: tsc x 3 (N/A — markdown-only)
- [ ] L3 (code-reviewer-general): N/A or applies (pure docs may be sufficient with operator review)
- [ ] L4 (clinical-safety): N/A (not clinical surface)
- [ ] L5 (architecture-reviewer): applies (memory files affect Claude session behaviour)
- [ ] Commit SHA + push auth

**Synthetic context**: all files verified; MEMORY.md indexed; L5 invoked + PASS; L3 invoked + PASS; commit landed at `5c5427a` (combined with agents); push auth pending.

**Expected verdict**: `[PARTIAL]` (push auth pending) OR `[PASS]` if push auth received.

**Expected DoD status**:
| # | DoD Line | Status |
|---|---|---|
| 1 | 5 files exist | ✓ |
| 2 | MEMORY.md indexed | ✓ |
| 3 | Actionable guidance | ✓ |
| 4 | L1 tsc x 3 | N/A — markdown-only with rationale |
| 5 | L3 PASS | ✓ — REJECT-then-cycle-2 (this fixture set IS cycle-2 absorb) |
| 6 | L4 PASS | N/A — not clinical surface |
| 7 | L5 PASS | ✓ — architecture-reviewer PASS with non-blocking advisories |
| 8 | Commit SHA | ✓ — 5c5427a |
| 9 | Push auth | ✗ — pending (or ✓ once received) |

**Rubric branches exercised**: legitimate N/A handling per DoD template's category-specific notes; cycle-2 absorb integration with PARTIAL verdict.

---

## Fixture invocation protocol

Same as the other 2 agents — invoke once registration completes; manual review until then.

**Self-invocation gap**: tracked as `BUG-DOD-COMPLETION-CHECKER-REGISTRATION` (S2; sibling of BUG-SHORTCUT-DETECTOR-REGISTRATION).
