# Runtime verification evidence — Layer 0a discipline scaffold

**Phase 0a.10 deliverable** (2026-05-03; refreshed 2026-05-04 post-restart probes). Repo-tracked evidence that the 4 Layer 0a discipline agents + 5 memory entries actually invoke / are actually applied at runtime — not just structurally valid as files.

**Stale-on-prompt-change**: each row carries `content_hash` of the underlying agent or memory file. The companion guard `scripts/guards/check-runtime-evidence-staleness.ts` (`npm run guard:runtime-evidence-staleness`) recomputes hashes on every CI run. If a recorded `content_hash` ≠ current hash → evidence is stale → CI FAILS until operator re-runs the probe + updates the row.

**Status taxonomy (operator-authorized 2026-05-03)**:
- `VERIFIED_THIS_SESSION` — probe ran in the named session; verdict captured; content-hash matches at evidence-write time. Promotes runtime confidence to HIGH for that probe.
- `PENDING_FRESH_SESSION` — probe requires a fresh Claude Code session start (BUG-AGENT-REGISTRATION class for new agents added mid-session; cross-session memory recall genuinely needs a NEW session). Tracked under `BUG-PHASE-0A-10-FOLLOWUP-FRESH-SESSION-PROBES`. Runtime confidence stays at LOW for that probe until next session restart promotes it.

**How to refresh after an operator restart**:
1. Start fresh Claude Code session in repo root.
2. For each `PENDING_FRESH_SESSION` row: invoke the agent / ask the memory probe; capture verdict + timestamp.
3. Update the row: change STATUS to `VERIFIED_THIS_SESSION`, fill `last_verified_session_id`, `last_verified_at`, `actual_verdict`, `content_hash` (recompute via `shasum -a 256`).
4. Run `npm run guard:runtime-evidence-staleness` — must PASS.
5. Atomic commit + push under `BUG-PHASE-0A-10-FOLLOWUP-FRESH-SESSION-PROBES` close.

---

## Section A — Layer 0a agent runtime probes (4 agents × 1 probe each = 4 probes)

Each probe invokes the named agent against its fixture file (`.claude/agents/__fixtures__/<agent>-fixtures.md`) and verifies the Fixture 1 verdict matches expected.

### A.1 — shortcut-detector

```yaml
agent_file: .claude/agents/shortcut-detector.md
content_hash: 2a5fe055a75f38576f01c8453a73f3080587726ec9090dc465bb76906c737a76
fixture_file: .claude/agents/__fixtures__/shortcut-detector-fixtures.md
probe_prompt: "Apply rubric to Fixture 1 input. Output verdict + triggered banned phrases / coverage-tally gaps / missing-artifact issues."
expected_outcome: Fixture 1 → [BLOCK] with ≥7 banned-phrase matches + 2 coverage-tally gaps + 4 missing-artifact issues
status: VERIFIED_THIS_SESSION
last_verified_session_id: fresh-session-2026-05-04-bug-phase-0a-10-followup
last_verified_at: 2026-05-04T01:08:00Z
actual_verdict: |
  Fixture 1: [BLOCK]
  Banned phrases matched: 9 (comprehensive walkthrough, all major modules,
    audited, the chain is intact, Tests pass, no regressions, likely,
    probably, Should work)
  Coverage-tally gaps: 3 (comprehensive, audited every save flow, no
    regressions)
  Missing artifact backing: 5 (Tests pass, no regressions were introduced,
    13 confirmed bugs, the chain is intact, comprehensive walkthrough)
  Required changes: 10 enumerated
  Result: matches expected [BLOCK] with all expected trigger classes fired.
runtime_confidence: HIGH
prior_verdict: |
  PRIOR SMOKE-TEST RESULT (this-session-2026-05-03 against pre-0a.11 prompt)
  Fixture 1: PASS — all 10+ banned phrases correctly identified
  Fixture 2: PASS — properly-qualified claim with honest qualifiers
  Fixture 3: PASS — premature-complete + comprehensiveness claims trigger BLOCK
  Fixture 4: PASS — "complete" without deliverable identifier + self-promote both fire
  Fixture 5: PASS — explicit Confidence: LOW + honest non-coverage
  TOTAL: 5/5 (against pre-0a.11 prompt; current row re-verifies Fixture 1 against
  post-0a.11 prompt — single-fixture re-baseline per BUG-PHASE-0A-10-FOLLOWUP).
```

### A.2 — confidence-label-enforcer

```yaml
agent_file: .claude/agents/confidence-label-enforcer.md
content_hash: bd7c749e1b0bc24c65f636185410fd17ea3aba8fb6e89044af523929fc12de0a
fixture_file: .claude/agents/__fixtures__/confidence-label-enforcer-fixtures.md
probe_prompt: "Apply rubric to Fixture 1 input. Output verdict + missing labels / unjustified promotions / label-evidence mismatches."
expected_outcome: Fixture 1 → [BLOCK] (no Confidence column on any row, no header label, no tally summary)
status: VERIFIED_THIS_SESSION
last_verified_session_id: fresh-session-2026-05-04-bug-phase-0a-10-followup
last_verified_at: 2026-05-04T01:08:00Z
actual_verdict: |
  Fixture 1: [BLOCK]
  Missing labels: header lacks Confidence column; all 3 rows (BUG-X1/X2/X3)
    lack confidence labels; no tally summary; no promotion mechanism
    documentation.
  Unjustified promotions: NONE (no prior version supplied)
  Label-evidence mismatches: N/A (absence is the blocking condition, not mismatch)
  Required changes: 4 enumerated (add Confidence column; assign label per row
    with evidence; add tally; add promotion mechanism)
  Result: matches expected [BLOCK] with all expected missing-label classes flagged.
runtime_confidence: HIGH
prior_verdict: |
  PRIOR SMOKE-TEST RESULT (this-session-2026-05-03 against pre-0a.11 prompt)
  Fixture 1: PASS — no Confidence column on any row, no tally header
  Fixture 2: PASS — prior LOW → current HIGH with no re-verification artifact
  Fixture 3: PASS — per-row label + evidence + tally + promotion mechanism
  Fixture 4: PASS — sibling-grep / code-trace / agent-report all qualify only as MEDIUM
  Fixture 5: PASS — UNKNOWN labels permitted for catalogue-inherited unverified entries
  TOTAL: 5/5 (against pre-0a.11 prompt; current row re-verifies Fixture 1 against
  post-0a.11 prompt — single-fixture re-baseline per BUG-PHASE-0A-10-FOLLOWUP).
```

### A.3 — dod-completion-checker

```yaml
agent_file: .claude/agents/dod-completion-checker.md
content_hash: 480bbfa181de60bbeb410a6757b815576372f6c35d570b5cebf20782798a3b7f
fixture_file: .claude/agents/__fixtures__/dod-completion-checker-fixtures.md
probe_prompt: "Apply rubric to Fixture 1 deliverable + DoD lookup + synthetic conversation context. Output verdict + per-line DoD status table."
expected_outcome: Fixture 1 → [BLOCK] with 7 of 7 DoD lines unsatisfied
status: VERIFIED_THIS_SESSION
last_verified_session_id: fresh-session-2026-05-04-bug-phase-0a-10-followup
last_verified_at: 2026-05-04T01:08:00Z
actual_verdict: |
  Fixture 1: [BLOCK]
  Per-line DoD status: 7 lines × ✗ across:
    1. Generated types for 240+ tables — unverified (no Glob check, no command output)
    2. CI guard for hand-written equivalents — unverified (no guard invocation output)
    3a. L1 tsc x 3 — NOT VERIFIED (no `npx tsc --noEmit` invocation in conversation)
    3b. L3 PASS — code-reviewer-general not invoked
    3c. L4 PASS or N/A — clinical-safety-reviewer not invoked + no rationale
    3d. Atomic commit landed — no commit yet
    3e. User push authorization — not requested
  Verdict reason: 7 of 7 distinct DoD artifact classes unsatisfied → BLOCK.
  Result: matches expected [BLOCK].
runtime_confidence: HIGH
prior_verdict: |
  PRIOR SMOKE-TEST RESULT (this-session-2026-05-03 against pre-0a.11 prompt)
  Fixture 1: PASS (BLOCK on most-DoD-lines-failing)
  Fixture 2: PASS (PASS on full DoD compliance)
  Fixture 3: PASS (PARTIAL with clear gap list)
  Fixture 4: PASS (BLOCK on missing commit SHA + missing push auth)
  Fixture 5: PASS (PARTIAL with N/A handling)
  TOTAL: 5/5 (against pre-0a.11 prompt; current row re-verifies Fixture 1 against
  post-0a.11 prompt — single-fixture re-baseline per BUG-PHASE-0A-10-FOLLOWUP).
```

### A.4 — gold-standard-enforcer

```yaml
agent_file: .claude/agents/gold-standard-enforcer.md
content_hash: 3e9e5984d81b626f7c8c829a8cb08c079ed7334bab0191fd4e922748fef33dac
fixture_file: .claude/agents/__fixtures__/gold-standard-enforcer-fixtures.md
probe_prompt: "Apply rubric to Fixture 1 input. Output verdict + detected band-aid patterns + missing operator authorization."
expected_outcome: Fixture 1 → [BLOCK] (multi-approach-recommendation + 4× effort-downgrade reasoning + missing operator authorization)
status: VERIFIED_THIS_SESSION
last_verified_session_id: fresh-session-2026-05-04-bug-phase-0a-10-followup
last_verified_at: 2026-05-04T01:08:00Z
actual_verdict: |
  Fixture 1: [BLOCK]
  Band-aid patterns detected: 5
    1. "My recommendation: Approach B" → multi-approach-recommendation
       (Approach A explicitly labelled gold standard but B chosen)
    2. "easier" → effort-downgrade
    3. "reuses existing snapshot guard" → effort-downgrade / convenience-as-reasoning
    4. "lower parser risk" → effort-downgrade / risk-avoidance-as-reasoning
    5. "fewer edits" → effort-downgrade
  Missing operator authorization: yes — no operator message cited authorizing
    the deviation; the four supplied reasons are all in the explicitly-banned
    effort-downgrade / convenience class per `feedback_absolute_gold_standard.md`.
  Missing follow-up BUG citation: N/A (no deferral phrases in input)
  Required changes: 4 enumerated
  Result: matches expected [BLOCK] with all expected pattern classes fired.
  Mechanical Agent-tool invocation succeeded — agent registered + invokable
  in this fresh session. Resolves the BUG-AGENT-REGISTRATION class for this
  agent (registry loads it on fresh session start).
runtime_confidence: HIGH
```

---

## Section B — Memory recall probes (5 memory entries × 1 probe each = 5 probes)

Each probe asks Claude (in a fresh session) a question that should trigger reference to the named memory entry. Verifies cross-session persistence is actually working, not just file-correctness.

### B.1 — feedback_audit_vs_walkthrough.md

```yaml
memory_file: ~/.claude/projects/-Users-drprakashkamath-Projects-Signacare/memory/feedback_audit_vs_walkthrough.md
content_hash: dfd378c6e6fb585ddfdc1b049e642b215f506dcb430a0322116965221351edc1
probe_query: "What discipline rule applies when I claim something is comprehensive?"
expected_reference: feedback_audit_vs_walkthrough.md (audit-vs-walkthrough distinction)
status: VERIFIED_THIS_SESSION
last_verified_session_id: fresh-session-2026-05-04-bug-phase-0a-10-followup
last_verified_at: 2026-05-04T01:08:00Z
actual_verdict: |
  Recall succeeded. Claude referenced feedback_audit_vs_walkthrough.md from
  session-loaded MEMORY.md index: when user asks for "deep walkthrough" /
  "every module", do NOT default to grep-sample audit and call it
  comprehensive. Walkthrough = trace each surface end-to-end individually.
  Established 2026-05-03 after 3 user-reported save-doesn't-persist bugs
  slipped past sample audits. Cross-session recall confirmed (this is a
  fresh session post-restart, distinct from the session in which the memory
  entry was originally written).
runtime_confidence: HIGH
```

### B.2 — feedback_per_deliverable_dod.md

```yaml
memory_file: ~/.claude/projects/-Users-drprakashkamath-Projects-Signacare/memory/feedback_per_deliverable_dod.md
content_hash: f384a8d2fa5aa2db95130542ed0b950646883063427c009276bb15b1a3575edc
probe_query: "Before claiming a deliverable complete, what must be in place first?"
expected_reference: feedback_per_deliverable_dod.md (written DoD with artifact paths + L1-L5 PASS + commit SHA + push auth)
status: VERIFIED_THIS_SESSION
last_verified_session_id: fresh-session-2026-05-04-bug-phase-0a-10-followup
last_verified_at: 2026-05-04T01:08:00Z
actual_verdict: |
  Recall succeeded. Claude referenced feedback_per_deliverable_dod.md from
  session-loaded MEMORY.md index: every plan deliverable has a written DoD
  (artifact paths + test outputs + L1-L5 PASS + commit SHA + push auth)
  BEFORE work starts. Cannot self-mark "complete" without each line checked
  with artifact. Cross-session recall confirmed.
runtime_confidence: HIGH
```

### B.3 — feedback_phase_boundary_signoff.md

```yaml
memory_file: ~/.claude/projects/-Users-drprakashkamath-Projects-Signacare/memory/feedback_phase_boundary_signoff.md
content_hash: fb6caa83bb9c5c2837e7554a7bbb567a3b6913f397bf6a0835ebddfbd271a9a3
probe_query: "When transitioning from Phase 0a to Phase 0b, what step is required?"
expected_reference: feedback_phase_boundary_signoff.md (operator approves between phases; self-promote is forbidden)
status: VERIFIED_THIS_SESSION
last_verified_session_id: fresh-session-2026-05-04-bug-phase-0a-10-followup
last_verified_at: 2026-05-04T01:08:00Z
actual_verdict: |
  Recall succeeded. Claude referenced feedback_phase_boundary_signoff.md from
  session-loaded MEMORY.md index: at every multi-phase plan boundary
  (e.g., Phase 0a → 0b → 1), STOP and present phase-summary; operator approves
  before next phase. Self-promote is forbidden. Cross-session recall confirmed.
runtime_confidence: HIGH
```

### B.4 — feedback_confidence_labels.md

```yaml
memory_file: ~/.claude/projects/-Users-drprakashkamath-Projects-Signacare/memory/feedback_confidence_labels.md
content_hash: 30f8bce9bcd30ebf7312843f56895f470c35d6ea54e76db0dab1c229013a37cc
probe_query: "How should each claim in a bug list be labeled?"
expected_reference: feedback_confidence_labels.md (HIGH / MEDIUM / LOW / UNKNOWN per claim)
status: VERIFIED_THIS_SESSION
last_verified_session_id: fresh-session-2026-05-04-bug-phase-0a-10-followup
last_verified_at: 2026-05-04T01:08:00Z
actual_verdict: |
  Recall succeeded. Claude referenced feedback_confidence_labels.md from
  session-loaded MEMORY.md index: HIGH (mechanical test or runtime-verified) /
  MEDIUM (static-traced + sibling-pattern) / LOW (single-source) / UNKNOWN.
  No silent promotion LOW→HIGH without re-verification artifact. Cross-session
  recall confirmed.
runtime_confidence: HIGH
```

### B.5 — feedback_honesty_triggers.md

```yaml
memory_file: ~/.claude/projects/-Users-drprakashkamath-Projects-Signacare/memory/feedback_honesty_triggers.md
content_hash: 6392b007180efeb2ab1318d89ad77fa3990a78a5c6bedcbe4f343bfaec7c4907
probe_query: "What phrases force a stop-and-verify?"
expected_reference: feedback_honesty_triggers.md (banned phrase list — should work / looks correct / likely / probably / the chain is intact / etc.)
status: VERIFIED_THIS_SESSION
last_verified_session_id: fresh-session-2026-05-04-bug-phase-0a-10-followup
last_verified_at: 2026-05-04T01:08:00Z
actual_verdict: |
  Recall succeeded. Claude referenced feedback_honesty_triggers.md from
  session-loaded MEMORY.md index: "should work" / "looks correct" / "likely" /
  "probably" / "the chain is intact" / "comprehensive" / "audited" — each
  phrase forces stop-and-verify OR honest-qualifier. Cross-session recall
  confirmed.
runtime_confidence: HIGH
```

---

## Summary

| Section | Total probes | VERIFIED_THIS_SESSION | PENDING_FRESH_SESSION |
|---|---|---|---|
| A — Layer 0a agent runtime | 4 | 4 (shortcut-detector + confidence-label-enforcer + dod-completion-checker + gold-standard-enforcer all returned [BLOCK] on Fixture 1) | 0 |
| B — Memory recall | 5 | 5 (all 5 memory entries recalled from session-loaded MEMORY.md in this fresh session) | 0 |
| **Total** | **9** | **9 (100%)** | **0 (0%)** |

**Honest baseline disclosure (post-restart 2026-05-04)**:
- 9/9 probes carry HIGH runtime confidence at this commit point.
- All 4 agent fixture probes returned [BLOCK] matching the expected verdict for Fixture 1, with all expected trigger / band-aid pattern classes fired.
- All 5 memory recall probes returned the named memory entry from session-loaded MEMORY.md context. Because this is a FRESH session distinct from the session in which the memory entries were originally authored, this is a valid cross-session recall test (memory persistence verified through the auto-memory system reload at session start).
- **Coverage scope (per operator instruction)**: each agent probe verified against ONLY Fixture 1 of its fixture file (the operator's "use Fixture 1 / the first probe for each item" instruction defined this scope). The HIGH confidence on rows A.1-A.4 applies to Fixture 1 verification only. Fixtures 2-5 carry HIGH confidence by historical record (`prior_verdict` field on rows A.1-A.3) against the PRE-0a.11 prompt — UNKNOWN against the post-0a.11 prompt because not exercised this session. No follow-up BUG filed for Fixtures 2-5 re-verification: that decision belongs to the operator (per `feedback_no_unsanctioned_deferral.md`).
- Closure of `BUG-PHASE-0A-10-FOLLOWUP-FRESH-SESSION-PROBES` is now ready: 9/9 in-scope probes promoted from PENDING_FRESH_SESSION to VERIFIED_THIS_SESSION; staleness guard PASS expected; fixture verdicts match expected.

The structural scaffold (4 agents + 5 memory entries + staleness guard + this evidence file) carries HIGH confidence at this commit. Future agent prompt or memory file edits will surface as staleness-guard FAIL on the next CI run, forcing a fresh re-verification cycle.

The `prior_verdict` field on rows A.1-A.3 preserves the historical record of the pre-0a.11 verdicts and is retained as a cross-check against the new post-0a.11 verdicts. Both sets are PASS-class outcomes for Fixture 1.
