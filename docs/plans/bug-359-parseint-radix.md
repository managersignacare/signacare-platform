# Plan — BUG-359: add explicit radix to 10 parseInt() calls

## 1. Context

Pre-existing tech-debt flagged by `.github/scripts/check-naming-conventions.sh` Rule 4. 10 sites use `parseInt(x)` without the `10` radix arg. Per CLAUDE.md §3, the guard rejects any new parseInt without radix; historical sites have been grandfathered but need cleanup before the guard can run in FAIL mode without broad collateral.

Explicit radix is safer — `parseInt("012")` returns different values in different JS engines historically (octal vs decimal). All 10 sites here pass strings already in decimal form (form values, UUIDs-cast-to-string, etc.), so behaviour doesn't change but the lint guard gets cleaner.

## 2. Existing code to reuse

Not applicable — this is a pure syntactic tightening. Zero new utilities, zero new imports.

## 3. Change surface (grep-verified)

Per `check-naming-conventions.sh` output 2026-04-23:

- `apps/web/src/features/nursing/pages/NursingPage.tsx:333`  `parseInt(vals.respRate)` → `parseInt(vals.respRate, 10)`
- `apps/web/src/features/nursing/pages/NursingPage.tsx:335`  `parseInt(vals.o2Sat)`
- `apps/web/src/features/nursing/pages/NursingPage.tsx:338`  `parseInt(vals.systolicBp)`
- `apps/web/src/features/nursing/pages/NursingPage.tsx:340`  `parseInt(vals.pulse)`
- `apps/web/src/features/nursing/pages/NursingPage.tsx:393`  `parseInt(vals.age)`
- `apps/web/src/features/nursing/pages/NursingPage.tsx:454`  `parseInt(e.amount)`
- `apps/web/src/features/nursing/pages/NursingPage.tsx:455`  `parseInt(e.amount)`
- `apps/web/src/features/patients/components/detail/tabs/AssessmentsTab.tsx:447` x2 `parseInt(a)` + `parseInt(b)`
- `apps/web/src/features/reports/pages/ReportsPage.tsx:1197`  `parseInt(sampleSize)`

Three files, ten call-sites total.

## 4. Test plan

- No runtime behaviour change — all strings passed are already decimal.
- L2.5: the `check-naming-conventions.sh` guard transitions from FAIL to PASS — that IS the TDD evidence.
- Adjacent suites: no vitest impact (no behaviour changed).

## 5. Gate

Non-risky-class (FE-only, no shared/, no db/, no auth/, no migration). 10-check gate per PART 13.1:
- L1.1 tsc web: 0 errors
- L1.2 eslint on 3 touched files: 0 errors
- L1.3 all 17 guards: `check-naming-conventions` goes green (fixes one of the pre-existing 3 FAILs from prior commits); other 16 unchanged
- L1.4 fix-registry: new anchor `R-FIX-BUG-359-PARSEINT-RADIX` pinning the absence of the `parseInt([^,)]+)` pattern in the 3 affected files OR pinning the presence of ", 10)" on the new call sites
- L2.5: guard PASS is the proof
- L2.6: N/A (no tests affected)
- L2.7: N/A
- L3 code-reviewer: **SKIPPED** — not risky-class per PART 13.1 (FE-only, no S0/S1, no migration, no auth). Documented skip rationale in commit body.
- L4: **SKIPPED** — not clinical-code path
- L5: **SKIPPED** — not arch-affecting

## 6. Explicit non-goals

- Not adding a new CI guard that REQUIRES radix in new code — that's the existing `check-naming-conventions.sh` Rule 4 which already does this.
- Not changing any arithmetic or form-validation logic.
- Not touching the pre-existing `any` errors in AssessmentsTab.tsx or NursingPage.tsx.
