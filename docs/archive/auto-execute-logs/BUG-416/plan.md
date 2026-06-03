# Plan — BUG-416: useModuleVisibility fail-OPEN → fail-CLOSED

[Plan agent invocation 2026-04-26 per PART 2 §B; first-principles per PART 6.1 #3. Phase B item 1, Class B1.]

**Severity:** S1. **Mirror of:** BUG-444 (frontend variant). **L4 fires** (clinical access control).

## §0 — Drift summary

`apps/web/src/shared/hooks/useModuleVisibility.ts:70-80, 131-135` — `failOpen()` returns `() => true` predicates on upstream-fetch error, exposing specialty-gated clinical surfaces (ECT/TMS/MHA/legal/advance-directives/oncology/surgery/paeds/O&G/endocrinology/GIM) to clinicians without entitlement on transient network blips. Comment justifies fail-OPEN with false dichotomy ("blank UI vs show all"); shared helpers already provide third option (empty set ⇒ core+alwaysOn+unlisted visible, gated hidden).

## §1 — Verification (read-confirmed)

- Hook structure confirmed (failOpen at 70-80, isError trigger at 135).
- Shared helpers `isPatientTabVisible`/`isNavItemVisible` at `packages/shared/src/moduleRegistry.ts:419-448` honour `core: true` + `alwaysOn` + `unlisted=visible` semantics with empty visibleSpecialties set.
- 3 callers (Sidebar, PatientDetailLayout, MedicationsTab) — all use predicates as filter callbacks; no migration needed.
- Zero existing tests. Greenfield test file.
- BUG-444 reference: `apps/api/src/middleware/licenseMiddleware.ts:41-72, 84-122` — `FAIL_CLOSED_STATUS` constant.
- Cascade scan: `useTabConfig.ts:25-29` is sibling fail-OPEN class (lower harm — admin toggle not clinical entitlement) — file as BUG-547.

## §2 — Fix shape

### §2.1 Replace failOpen with failClosed
```ts
function failClosed(): UseModuleVisibilityResult {
  const empty: Set<SpecialtyType> = new Set();
  return {
    visibleSpecialties: empty,
    isLoading: false,
    isError: true,
    isTabVisible: (tabId) => isPatientTabVisible(tabId, empty),
    isNavVisible: (path) => isNavItemVisible(path, empty),
  };
}
```

Delegates to shared helpers; empty set = core+alwaysOn+unlisted visible, specialty-gated hidden. Mirror of BUG-444 fail-CLOSED shape.

### §2.2 Comment rewrite (mandatory)
Lines 131-135 + line 25-28 module-level note + line 62-63 result-interface JSDoc all rewritten to cite BUG-416 + BUG-444 mirror + spell out the canonical failClosed contract.

### §2.3 NO dev-mode hatch
Frontend doesn't need it (no equivalent of api-side missing license module). Justified explicitly so future contributor doesn't add one "by symmetry with BUG-444".

## §3 — UNION-up-front
N/A. Hook signature unchanged; isError preserved; predicates change behaviour on error only.

## §4 — CLAUDE.md update
NEW §6.5 "Frontend security gates fail CLOSED, not OPEN" — one-bullet section under §6 (SECURITY); cites BUG-416 + BUG-444 mirror; canonical fix-shape spelled out.

## §5 — Test plan (7 cases)

NEW `apps/web/src/shared/hooks/__tests__/useModuleVisibility.test.ts`. Vitest + `renderHook` from @testing-library/react.

| ID | Setup | Assertion | Pre-fix |
|---|---|---|---|
| MV-1 | success path | predicates work; mental_health visible | GREEN baseline |
| MV-2 | staff/me throws | gated tabs (ECT/TMS/MHA/legal/oncology/surgery/paeds/glucose) hidden | **PRE-FIX RED** |
| MV-3 | active-specialties throws (with patientId) | same fail-CLOSED behaviour | **PRE-FIX RED** |
| MV-4 | error + boundary | core tabs + unlisted UI visible (medications/pathology/problems/summary/episodes) | GREEN |
| MV-5 | error → state shape | visibleSpecialties.size===0, isError===true, isLoading===false | GREEN |
| MV-6 | source-text scan | `function failOpen` ABSENT, `function failClosed` PRESENT, no `isError ? () => true` | **PRE-FIX RED** |
| MV-7 | error + admin role | admin DOES NOT bypass fail-CLOSED | GREEN |

3× flake.

## §6 — Fix-registry anchors (5)

| ID | File | Type | Pattern |
|---|---|---|---|
| `R-FIX-BUG-416-FAIL-CLOSED-EXISTS` | `apps/web/src/shared/hooks/useModuleVisibility.ts` | present | `function failClosed\(\): UseModuleVisibilityResult` |
| `R-FIX-BUG-416-FAIL-OPEN-ABSENT` | `apps/web/src/shared/hooks/useModuleVisibility.ts` | absent | `function failOpen` |
| `R-FIX-BUG-416-NO-TRUE-PREDICATE-IN-ERROR` | `apps/web/src/shared/hooks/useModuleVisibility.ts` | absent | `isTabVisible: \(\) => true` |
| `R-FIX-BUG-416-COMMENT-CITES-MIRROR` | `apps/web/src/shared/hooks/useModuleVisibility.ts` | present | `BUG-416.*BUG-444` |
| `R-FIX-BUG-416-CLAUDE-MD-CITE` | `CLAUDE.md` | present | `^### 6\.5 Frontend security gates fail CLOSED` |

## §7 — Files to modify

| File | Action |
|---|---|
| apps/web/src/shared/hooks/useModuleVisibility.ts | EDIT (replace failOpen + rewrite comments) |
| apps/web/src/shared/hooks/__tests__/useModuleVisibility.test.ts | NEW (7 cases) |
| CLAUDE.md | EXTEND (§6.5) |
| docs/quality/fix-registry.md | EXTEND (5 anchors) |
| docs/quality/bugs-remaining.md | EXTEND (atomic flip BUG-416 + cascade BUG-547) |
| .github/safety-surfaces.txt | EXTEND (add useModuleVisibility.ts) |
| docs/quality/l4-reviewer-checklist.md | EXTEND (§F mirror) |

## §8 — Trigger assessment

- L3: FIRES.
- L4: **FIRES** — clinical access control surface; semantically gates ECT/TMS/MHA/legal/etc.
- L5: FIRES (CLAUDE.md + fix-registry + safety-surfaces.txt + l4-checklist edits).

## §9 — Risks

- **§9.1** UI-breaks-on-error: mitigated by `isError: true` preserved; consumer renders error banner.
- **§9.2** No callers depend on fail-OPEN; no migration needed.
- **§9.3** Cascade: BUG-547 (S2, useTabConfig.ts:25-29 sibling — admin-toggle fail-OPEN, lower harm class).

## §10 — Acceptance

- 5 fix-registry anchors GREEN.
- 7/7 ×3 GREEN; MV-2, MV-3, MV-6 PRE-FIX RED verified.
- L1 + L3 + L4 + L5 PASS.
- CLAUDE.md §6.5 + safety-surfaces.txt + l4-checklist updated atomically.
- BUG-416 → fixed; BUG-547 cascade filed.
- Explicit user push authorization.
