# Plan — BUG-529: reverse-direction §15 guard

[Plan agent invocation 2026-04-25 per PART 2 §B; first-principles per PART 6.1 #3. Phase A item 4 of approved structural prevention block.]

**Severity:** S1 (structural prevention; CI guard).

## §0. Drift summary

Existing `scripts/guards/check-row-interface-matches-db.ts` enforces ONE direction of CLAUDE.md §15: every declared interface field must exist as a column in `apps/api/src/db/schema-snapshot.json[table]`. The REVERSE direction is unenforced — interfaces that omit real DB columns silently allow downstream code to fabricate `null/false` for those columns (BUG-458 root cause).

**Empirical verification during planning:** `AppointmentDb` declares 25 fields against a 38-column live `appointments` table → **13 reverse-drift columns** (one MORE than BUG-489's catalogue lists; cascade-discovery surfaced `staff_id` and `type`).

Class signature: "DB has the data; interface omits the column; downstream fabricates a literal." Closes the silent-drop class structurally, paired with the existing forward direction.

## §1. Verification (read-confirmed)

- Existing guard (`scripts/guards/check-row-interface-matches-db.ts:74-161`) is **regex-based** (not AST). Walks `apps/api/src/**/*.ts`; finds `export interface (\w+(?:Row|Db))`; checks for `@schema-drift-exempt (select-aliased|aggregation|response-shape)` JSDoc annotation up to 8 lines above; binds via `db<X>('t')` / `as X` / `extends Repository<X>` patterns.
- `schema-snapshot.json` is `{tables: Record<string, string[]>}` — flat column-name array per table. Already matches `SchemaSnapshot` interface.
- 40+ `Repository.ts` files contain `Db` interfaces. Sample: `AppointmentDb` 25/38 (13 drift), `AppointmentAttendeeDb` 10/10 (clean).
- Existing exemption: `@schema-drift-exempt` skips current direction. New direction needs complementary `partial-shape` exemption (asymmetric semantics — see §2).
- No existing `__tests__/` for this guard; BUG-528's `check-file-size.test.ts` is the precedent for TS guard testing.
- BUG-489 row at `bugs-remaining.md:148` (S2): "softer drift class but still risks future mapper author fabricating values".

## §2. Fix shape

### §2.1 Extend (not replace)
Refactor `main()` into exported `runCheck(rootDir, snapshotPath, allowlistPath)` returning `{exitCode, violations, exempt, scanned}` (mirrors BUG-528 testability shape). `main()` calls `runCheck()` then exits.

### §2.2 New direction logic
After existing forward check, add reverse check:
```ts
const realButUndeclared = dbCols.filter(col => !c.fields.includes(col));
```
Both checks emit independently with distinct violation prefixes. Either non-empty → CI fail.

### §2.3+§2.4 Two-tier exemption mechanism (DECISION: implement both)

**Tier 1 — interface-level annotation `@schema-drift-exempt: partial-shape`** (NEW reason). Asymmetric: skips reverse direction ONLY; forward direction still enforced (a sub-projection still must not declare phantom columns).

The existing 3 reasons (`select-aliased | aggregation | response-shape`) imply "this isn't a row at all" → skip BOTH directions. `partial-shape` says "IS a row, deliberate subset" → skip reverse only. Critical asymmetry — must document in CLAUDE.md §15.

**Tier 2 — per-column allowlist** (`scripts/guards/check-row-interface-matches-db.allowlist`). Format: `<table>.<column> # BUG-NNN — <reason>` per line. Empty header on first ship. For surgical cases where most columns should be declared but specific ones are deliberately excluded.

Operator UX: violation message names BOTH options so operator picks the right granularity (per-interface vs per-column).

## §3. UNION-up-front

N/A — static analysis only.

## §4. §15 contract update

CLAUDE.md §15 currently documents only the forward direction. Update needed:
- Bidirectional invariant statement.
- `@schema-drift-exempt: partial-shape` row with **asymmetry note** (skips reverse only; forward still enforced).
- Allowlist mechanism reference.

## §5. Test plan

NEW `scripts/guards/__tests__/check-row-interface-matches-db.test.ts` (vitest, BUG-528 precedent).

10 cases:

| ID | Setup | Expected |
|---|---|---|
| DR-1 | interface = DB | exit 0 |
| DR-2 | interface declares phantom column | exit 1 (forward violation, regression test) |
| DR-3 | interface OMITS DB column | exit 1 (NEW reverse violation; PRE-FIX RED) |
| DR-4 | DR-2 + `@schema-drift-exempt: select-aliased` | exit 0 (existing exemption regression) |
| DR-5 | DR-3 + `@schema-drift-exempt: partial-shape` | exit 0 (NEW exemption category) |
| DR-5b | DR-2-style + `partial-shape` | exit 1 (asymmetry: forward still enforced; PRE-FIX RED) |
| DR-6 | DR-3 + `t.c # BUG-NNN — reason` in allowlist | exit 0 (per-column exemption; PRE-FIX RED) |
| DR-6b | DR-3 with 2 missing cols, allowlist covers 1 | exit 1, only un-allowlisted column cited (PRE-FIX RED) |
| DR-7 | interface defined but no `db<X>('t')` binding | exit 0, unbound (no violation) |
| DR-8 | snapshot includes real `appointments` fixture; AppointmentDb mirrors current 25-field interface | exit 1, lists all 13 reverse-drift columns (PRE-FIX RED, empirical-impact sanity) |
| DR-9 | malformed allowlist line | exit 2 |
| DR-10 | allowlist references non-existent column | exit 2 (self-cleaning) |

Pre-fix RED: DR-3/5/5b/6/6b/8/9/10 fail before extension. DR-1/2/4/7 must continue passing post-fix (regression baseline). 3× flake.

## §6. Fix-registry rows (5)

| ID | File | Type | Pattern |
|---|---|---|---|
| `R-FIX-BUG-529-REVERSE-CHECK-EXISTS` | `scripts/guards/check-row-interface-matches-db.ts` | present | `^const realButUndeclared = dbCols\.filter` |
| `R-FIX-BUG-529-PARTIAL-SHAPE-EXEMPTION` | `scripts/guards/check-row-interface-matches-db.ts` | present | `partial-shape` |
| `R-FIX-BUG-529-ALLOWLIST-RECOGNIZED` | `scripts/guards/check-row-interface-matches-db.ts` | present | `^const ALLOWLIST_PATH = ` |
| `R-FIX-BUG-529-CLAUDE-MD-BIDIRECTIONAL` | `CLAUDE.md` | present | `BUG-529` |
| `R-FIX-BUG-529-NO-FORWARD-ONLY-COMMENT` | `scripts/guards/check-row-interface-matches-db.ts` | absent | `^// only checks declared` |

## §7. Files to modify

| File | Action |
|---|---|
| `scripts/guards/check-row-interface-matches-db.ts` | EXTEND |
| `scripts/guards/__tests__/check-row-interface-matches-db.test.ts` | NEW |
| `scripts/guards/check-row-interface-matches-db.allowlist` | NEW (empty + header) |
| `CLAUDE.md` §15 | EXTEND (bidirectional + partial-shape + allowlist) |
| `apps/api/tests/integration/schemaDrift.test.ts` | EXTEND (mirror reverse direction in live-DB sibling) |
| `docs/quality/fix-registry.md` | EXTEND (5 anchors) |
| `docs/quality/bugs-remaining.md` | EXTEND (atomic flip BUG-529 → fixed; update BUG-489 cite) |

## §8. PART 2 §H/§I trigger assessment

- **L3:** unconditional, FIRES.
- **L4:** does NOT fire. Static analysis, no clinical surface.
- **L5:** FIRES (3 stacked) — modifies critical CI guard, modifies CLAUDE.md §15 contract, modifies fix-registry.

## §9. Risks + transition strategy

### §9.1 Reverse check fires loudly on existing repositories — TRANSITION STRATEGY

Many existing `Db` interfaces are deliberate sub-projections. Without transition, this commit FAILS CI on landing.

**Mitigation:**
1. Run guard once during implementation. Capture full reverse-drift list.
2. **Bulk-grandfather via `@schema-drift-exempt: partial-shape` annotations applied IN THIS COMMIT** to every interface whose drift is NOT BUG-489 AppointmentDb scope.
3. Each annotation has inline comment: `/** @schema-drift-exempt: partial-shape — sub-projection: BUG-NNN cite */`. If no follow-up BUG exists, file via PART 3 cascade-discovery before commit.
4. **Do NOT silence AppointmentDb** — it is BUG-489's scope; guard MUST fire on it.
5. **Do NOT** run the actual drift-clearing sweep in this BUG (scope creep beyond Phase A).

### §9.2 Auto-generated columns
`created_at` / `updated_at` / `deleted_at` / `id` — covered by existing exemption shapes. Verify in DR-8.

### §9.3 BUG-489 disposition
**Leave BUG-489 OPEN as the work item.** Update its row to cite "BUG-529 guard now enforces; landing BUG-489 closes the drift". Add `staff_id` + `type` to BUG-489's column enumeration (cascade-discovery surface).

### §9.4 Cascade-discovery
The first live-tree guard run produces a complete reverse-drift report. Each new class NOT covered by BUG-489 must be filed as a new BUG before commit per BUG-526 §D. Budget: ~5-15 new BUG filings.

### §9.5 Snapshot-vs-live drift
Existing `check-snapshot-freshness.ts` covers staleness. Extend `apps/api/tests/integration/schemaDrift.test.ts` reverse direction so live-DB tripwire matches snapshot tripwire.

## §10. Acceptance

- 5 fix-registry rows pass.
- 10 test cases (DR-1..DR-10) GREEN ×3 flake.
- DR-3/5/5b/6/6b/8/9/10 demonstrably PRE-FIX RED.
- L1 GREEN, L3 PASS, L5 PASS, L4 not invoked.
- CLAUDE.md §15 updated.
- Atomic catalogue flip per Wave A-4/A-5 (BUG-527 hook validates).
- Live-tree run: clean OR known-finite drift list with `partial-shape` annotations + cascade-discovery follow-ups filed.
- BUG-489 row updated (no closure; work item remains).
- Explicit user authorization before push.

Per PART 6.1: structural prevention. No quick fix. No abstraction wrapper. Reverse direction is the structural completeness gap; closing it is the right shape.
