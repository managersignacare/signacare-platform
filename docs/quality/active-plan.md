# Active plan pointer

**Phase 0a.11 deliverable** (2026-05-03). Single source of truth for "which plan file is currently active". Decouples discipline scaffold from any specific plan-file name so plan changes update ONE file rather than every Layer 0a agent + memory entry.

**Phase 0a.12 hardening** (2026-05-03; absorbs L5 0a.11 advisory #3): the active plan path is also captured in a machine-parseable HTML comment immediately below for unambiguous programmatic parsing. The prose `**Path**:` field below is operator-readable; the HTML comment is agent-readable. Both must agree (mechanically verified by `npm run guard:no-hardcoded-plan-path`).

<!-- active-plan-path: ~/.claude/plans/streamed-dazzling-shell.md -->

---

## Active plan

**Path**: `~/.claude/plans/streamed-dazzling-shell.md`

**Last updated**: 2026-05-08

**Reason for this plan choice**: the `streamed-dazzling-shell` plan is the canonical long-term architectural remediation v4 sequence (Phase 0a/0b/0c governance, then class-ordered execution: G1, A1, A2, B1, V1, V2, B2, D, C1/C2, E1-E5, S, F, P, G2). All Layer 0a agents (shortcut-detector / confidence-label-enforcer / dod-completion-checker / gold-standard-enforcer) read from this plan for DoD lookups and phase boundary checks. This update realigns enforcement pointers after execution drift so every next slice is validated against V4, not legacy sequencing.

---

## How agents and memory entries should reference the plan

Instead of:

```
Read `/Users/drprakashkamath/.claude/plans/streamed-dazzling-shell.md`
```

Use:

```
1. Read `docs/quality/active-plan.md` (this file).
2. Parse the `<!-- active-plan-path: <path> -->` HTML comment to extract the current active plan path.
3. Read that path for DoD lookups / phase definitions / etc.
```

The 2-step indirection makes plan changes a 1-file update. Mechanically enforced by `scripts/guards/check-no-hardcoded-plan-path.ts` (`npm run guard:no-hardcoded-plan-path`):
- Active-plan.md MUST contain exactly ONE `<!-- active-plan-path: ... -->` comment.
- The path inside the comment MUST exist OR be a valid `~/...` reference.
- The path inside the comment MUST agree with the prose `**Path**:` field above (no drift between human-readable + machine-readable forms).

---

## When to update this file

- **Active plan changes** (e.g., a new Phase R3 supersedes Phase 0a-0b): update `Path` field + `Last updated` field + `Reason for this plan choice` field. Atomic commit. The plan switch IS the deliverable that changes this file.
- **Phase boundaries within the same plan** (e.g., Phase 0a.10 → 0a.11 → 0a.12): do NOT update this file. The active plan stays the same; only the deliverable index inside the plan moves forward.

---

## Allowed exceptions to the no-hardcoded-plan-path rule

- This file itself (`docs/quality/active-plan.md`) — IS the canonical pointer; necessarily mentions the plan path.
- Memory entries that document the rule's HISTORY rather than runtime lookup (e.g., `feedback_explicit_push_authorization.md` cites where the push-authorization rule was first articulated). These are historical-reference uses, not runtime-lookup uses, and are exempted via the guard's allowlist with `permanent: doc-meta-historical-reference` rationale.
- Plan file itself (`~/.claude/plans/streamed-dazzling-shell.md`) — naturally self-references; out of scope for the guard (lives outside repo anyway).
