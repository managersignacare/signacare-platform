# Per-Deliverable Definition-of-Done Template

**Standard**: every deliverable in the multi-phase plan (`/Users/drprakashkamath/.claude/plans/sleepy-roaming-meteor.md`) carries a written Definition-of-Done block at the time it's planned. The DoD is mechanical (artifact-backed, verifiable) — no self-approve.

This template defines the standard DoD shape. Adapt per deliverable category (code / agent / docs / infra / migration). Honest "N/A" with rationale is acceptable for legitimately-not-applicable lines.

## Template (paste + adapt per deliverable)

```markdown
### Deliverable: <name>

**Description**: <1-2 sentences>

**Owner**: <agent / human>

**Category**: code | agent | docs | infra | migration | mixed

**Estimated effort**: <hours / days>

**DoD (every line must be TRUE before claiming complete)**:

#### Artifact existence
- [ ] File / artifact exists at <path>
- [ ] (Where applicable) Migration runs cleanly: `npm run migrate`
- [ ] (Where applicable) Generated code regenerates without diff: `tsx scripts/generate-types-from-migrations.ts && git diff --exit-code`

#### Local verification (commands + outputs)
- [ ] tsc x 3 workspaces clean: `npx tsc --noEmit -p apps/api && npx tsc --noEmit -p apps/web && npx tsc --noEmit -p packages/shared` (output: <ref>)
- [ ] Unit tests pass: `<command>` (output: <ref>)
- [ ] Integration tests pass (if applicable): `<command>` (output: <ref>)
- [ ] Guard runs locally: `<command>` (output: <ref>)
- [ ] Lint clean: `npm run lint` (output: <ref>)

#### Reviewer agents (L1-L5)
- [ ] L1 (mechanical guards) PASS — referenced commands + outputs above
- [ ] L3 (code-reviewer-general) PASS / REJECT-then-cycle-2-PASS — agent invocation reference: <message-id>
- [ ] L4 (clinical-safety-reviewer) PASS / N/A (rationale: <why>) — agent invocation: <ref>
- [ ] L5 (architecture-reviewer) PASS / NON-BLOCKING-ADVISORY — agent invocation: <ref>

#### Discipline agents (Layer 0a — when available)
- [ ] shortcut-detector PASS — agent invocation: <ref>
- [ ] confidence-label-enforcer PASS — agent invocation: <ref>
- [ ] dod-completion-checker PASS — agent invocation: <ref>

#### Atomic commit + registry + push
- [ ] Atomic commit landed (SHA: <hash>)
- [ ] Catalogue flip in same commit (if closing a BUG): `bugs-remaining.md` row flipped to **fixed** with cycle text
- [ ] Fix-registry anchor verified: `bash .github/scripts/check-fix-registry.sh` (output: anchor count + PASS)
- [ ] User push authorization received (conversation reference: <message>)
- [ ] Pushed to origin/main: `git push origin main` (commit range: <range>)

#### Cascade discoveries (atomic per `feedback_no_silent_out_of_scope.md`)
- [ ] Cascade BUGs filed atomically (if any) — list each: <BUG-ID>
- [ ] L4/L5 advisories absorbed inline OR filed as follow-up — list each: <BUG-ID + status>

#### Confidence label
- [ ] Self-confidence label assigned: HIGH / MEDIUM / LOW / UNKNOWN — rationale: <text>
- [ ] Label-evidence match verified by confidence-label-enforcer

---

**When claiming complete**:
1. Walk through every line above.
2. Tick `[x]` ONLY when the artifact exists / command was run / output was verified.
3. If ANY line is unchecked OR `N/A without rationale`, the deliverable is NOT complete.
4. Invoke `dod-completion-checker` to mechanically verify.
5. If PARTIAL: explicitly report "deliverable PARTIALLY complete: lines X, Y, Z still unchecked because [reason]" and ASK if scope is acceptable.

**Commit message includes the DoD checklist** with checkmarks. Operator reads commit message + verifies artifacts.
```

## Category-specific DoD adaptations

### Code deliverable (e.g., new feature, bug fix, refactor)

Standard template applies. Likely all 13+ lines apply.

### Agent deliverable (e.g., shortcut-detector.md)

- L1 (tsc): N/A (markdown-only)
- L3 (code-reviewer-general): N/A or applies for agent prompt review
- L4 (clinical-safety): N/A unless agent touches clinical surfaces
- L5 (architecture-reviewer): applies (agents are shared infra)
- Tests: 5 fixture test cases — invoke agent with synthetic input + verify output matches expected verdict

### Docs deliverable (e.g., this template, rules-coverage matrix)

- L1 (tsc): N/A
- L3/L4/L5: optional (operator review may be sufficient for docs-only changes)
- Tests: N/A (docs verify by reading, not running)
- Push auth: still required per push-authorization rule

### Infra deliverable (e.g., Bicep template, deploy script)

- L1 (tsc): N/A unless TS-based
- L4 (clinical-safety): N/A for infra-only
- L5 (architecture-reviewer): applies (deploy/ is shared infra)
- Tests: lint check on infra files (Bicep build, ShellCheck, etc.)
- Operator deploys to dev/test as part of verification

### Migration deliverable (e.g., new schema migration)

- L1 (tsc): applies
- L3/L5: applies
- Tests: snapshot regeneration + row-iface guard + code-columns guard all PASS
- Up + down rollback cycle test PASS
- Schema-snapshot diff committed in same PR

## Filing cascade BUGs atomically

Per `feedback_no_silent_out_of_scope.md`: any cascade discovery (sibling bug, structural issue, advisory) gets filed in the SAME commit that closes the parent. The DoD line "Cascade BUGs filed atomically (if any)" enforces this.

If the cycle-N reviewer (L3/L4/L5) raises an advisory and the agent decides to absorb inline (cycle-2 absorb) — that absorption is part of the same commit (no separate "fix later" commit).

## Push authorization

Per `feedback_explicit_push_authorization.md`: `git push origin main` requires explicit per-commit user authorization. The DoD line is "User push authorization received (conversation reference: <message>)". The reference is the user's message saying "push" / "ok" / "go ahead" / equivalent.

If push auth is NOT given, the DoD line is unchecked → deliverable is "complete-but-unpushed". Acceptable interim state. Push happens AFTER auth received.

## Phase boundary integration

Per `feedback_phase_boundary_signoff.md`: at every phase boundary (e.g., Phase 0a → 0b), the agent presents a phase-summary including the DoD-completion status of every deliverable in the closing phase. Operator approves the transition.

`dod-completion-checker` agent is the mechanical helper for this: invoke it per deliverable; verdict feeds into the phase-summary.

## Anti-patterns this template prevents

1. **"Looks done" self-approve** — every line is artifact-backed; can't claim without showing.
2. **Skip L4 because change is small** — L4 N/A requires explicit rationale, not silent skip.
3. **Tests pass without running** — DoD line requires command output reference.
4. **L5 advisory deferred silently** — "Cascade BUGs filed atomically" line forces atomic filing.
5. **Push without auth** — DoD line requires conversation reference.
6. **Partial complete claimed as complete** — "ANY unchecked line = NOT complete" rule.

## Versioning

Template version: 1.0 (2026-05-03 — initial Phase 0a.6).

Updates to the template require a meta-commit + L5 review (changes to a discipline framework affect all future deliverables).
