# Plan — BUG-521: Silent drug-interaction-check failure (S0 fatality risk)

[Plan agent invocation 2026-04-25 per PART 2 §B; first-principles per PART 6.1 #3.]

**Severity:** S0 — clinical fatality risk. Surfaced by BUG-445 L4 review (audit gap; not in `findings-6a-silent-catch.md` enumeration).

## §0. Drift summary

`apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx`, `InteractionPanel` component (lines 168-274). Three concurrent false-negative paths converge on UI gate at lines 246-250 where `checked === true && !hasInteractions` renders "No interactions detected" when the check actually FAILED.

1. **Line 210-212 (outer catch):** RxNav throw → `setInteractions([]); setChecked(true);` → UI shows "No interactions detected".
2. **Line 187 (per-med RxCUI catch):** silent `/* skip */` drops failed meds from cross-check.
3. **Line 190 (zero-resolved early return):** if all RxCUI lookups failed → fabricates "no interactions" without distinguishing legitimate "<2 meds" from "couldn't resolve any".

**Clinical fatality scenario:** Clinician prescribing 3 meds. RxNav timeout. Catch fires. UI shows purple "No interactions detected". Prescription confirmed. Patient receives contraindicated combination.

## §1. Verification (read-confirmed)

- Component spans 168-274; 4 useState hooks at 169-172 are LOCAL (verified via grep — no external readers).
- `DrugInteraction` type declared locally at line 88-92.
- Zero existing tests for MedicationsTab.
- RxNav hit via raw `fetch()` (lines 183, 193) — no apiClient wrapper.
- vitest in `apps/web/` runs without jsdom — pure-helper extraction is the test path (BUG-445 precedent).

## §2. Fix shape

### §2.1 State shape — replace `checked` + `checking` with status enum

```ts
type InteractionCheckStatus = 'idle' | 'checking' | 'success' | 'partial' | 'failed';

const [status, setStatus] = useState<InteractionCheckStatus>('idle');
const [interactions, setInteractions] = useState<DrugInteraction[]>([]);
const [failureReason, setFailureReason] = useState<string | null>(null);
const [failedMedNames, setFailedMedNames] = useState<string[]>([]);
```

### §2.2-§2.6 Per-path fixes

- **Per-med catch (187):** accumulate `failedNames.push(med.medicationName)`; also accumulate on 200-with-no-rxnormId case.
- **Zero-resolved branch (190):** if `failedNames.length > 0` → `status='failed'`. If genuinely <2 active meds → `status='success'` with "Only 1 medication" message.
- **Outer catch (210):** `status='failed'` with `Drug interaction check failed: ${err}. Verify manually before prescribing.`
- **Success branch:** if any `failedNames` → `status='partial'`; else `status='success'`.

### §2.7 UI branching (replaces 246-250)

Branch on status:
- `'idle'` → Check button
- `'checking'` → loading
- `'success'` + interactions found → red banner "N interaction(s) found"
- `'success'` + no interactions → "No interactions detected" (legitimate clean) or "Only 1 medication — no pairs to check"
- `'partial'` → AMBER warning "Some checks could not complete — verify manually"
- `'failed'` → RED ERROR Alert "Drug interaction check FAILED — verify manually before prescribing" + Retry button

Border-color ternary updates: red on failed, amber on partial, red on interactions, purple only for clean idle/success-empty.

### §2.8 Helper extraction (testability seam, NOT abstraction wrapper)

Export `classifyInteractionResult({activeMedCount, rxcuiResolutionFailures, resolvedRxcuiCount, outerFetchThrew, outerErrorMessage, interactions}): {status, failureReason}` — pure function unit-testable without jsdom. Mirrors BUG-445 precedent.

## §3. UNION-up-front

Status enum is the new SSoT for InteractionPanel state. No backend touch.

## §4. §15

N/A — frontend only.

## §5. Test plan

NEW `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.test.ts`:

- DI-1: 3 meds, all resolved, 0 interactions → status='success'
- DI-2: 3 meds, all resolved, 2 interactions → status='success'
- DI-3: 3 meds, 1 RxCUI failed, 2 resolved → status='partial' (PRE-FIX RED — pre-fix silently drops the failed med)
- DI-4: 3 meds, all 3 RxCUI failed → status='failed' (PRE-FIX RED — pre-fix shows "No interactions detected")
- DI-5: 3 meds, RxCUI all resolved, interaction-list fetch threw → status='failed' (PRE-FIX RED — fatality-class)
- DI-6: 1 active med (legitimately too few) → status='success' (NOT failure)

3× flake check.

## §6. Fix-registry rows (4, all `^`-anchored)

| Row ID | File | Mode | Pattern |
|---|---|---|---|
| `R-FIX-BUG-521-NO-FABRICATED-NO-INTERACTIONS-ON-CATCH` | `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx` | absent | `setInteractions\(\[\]\); setChecked\(true\);` |
| `R-FIX-BUG-521-FAILED-STATUS-ON-FETCH-THROW` | `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx` | present | `setStatus\('failed'\)` |
| `R-FIX-BUG-521-VERIFY-MANUALLY-WARNING` | `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx` | present | `verify manually before prescribing` |
| `R-FIX-BUG-521-PARTIAL-STATUS-ON-PER-MED-FAILURE` | `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx` | present | `setStatus\('partial'\)` |

## §7. Files to modify

| File | Change |
|---|---|
| `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx` | Rewrite InteractionPanel per §2 |
| `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.test.ts` | NEW (6 tests) |
| `docs/quality/fix-registry.md` | 4 anchors |
| `docs/quality/bugs-remaining.md` | Atomic flip + file BUG-522/523 follow-ups |

## §8. PART 2 §H/§I

- **L4** (clinical-safety): FIRES — path AND semantic. `apps/web/src/features/patients/components/detail/tabs/` is in the §13.5 path list; fail-OPEN→fail-CLOSED transition; prescribing-safety surface; fatality risk.
- **L5** (architecture): touches fix-registry; FIRES.
- **L3**: unconditional.

## §9. Risks + follow-ups

- BUG-522 (S1): SafeScript Card at lines 222-232 doesn't query SafeScript registry — just shows S8 count.
- BUG-523 (S2): silent `.catch(() => null)` in `usePrintPrescription` (lines 286-288) — prescription print can show blank fields.
- State-shape change blast radius: NONE (local hooks).
- 200-with-no-rxnormId case: must be treated as resolution failure, not silent skip.

## §10. Acceptance

4 fix-registry pass; 6 unit tests ×3 GREEN; DI-3/4/5 PRE-FIX RED locked; tsc + lint clean; L1+L2+L3+L4+L5 PASS; atomic catalogue flip + BUG-522/523 follow-ups filed.

Per PART 6.1: no shortcut, no abstraction wrapper, fatality-class root-cause fix.
