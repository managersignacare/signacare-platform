# BUG-430 Implementation Plan — Fresh Replan

[Source: Plan agent invocation 2026-04-24, verbatim per runbook §B]

## 1. Pre-classification — 36 allowlist entries

12 drain in this commit (staff-auth scope):
- patientRepository.ts:164 — episodes whereExists subquery (`clinicId` in fn scope)
- patientRoutes.ts:674 — clinical_notes JOIN (qualified column)
- patientRoutes.ts:809 — patient_legal_orders SELECT JOIN (qualified)
- patientRoutes.ts:821 — auto-archive UPDATE same handler
- reallocationService.ts:323 — org_units (verify schema before edit)
- clinicalDecisionRoutes.ts:57 — patient_medications
- clinicalDecisionRoutes.ts:78 — pathology_results
- contactRecordRoutes.ts:325 — clinical_notes JOIN export
- correspondenceRoutes.ts:54 — patients lookup from letter
- episodeRoutes.ts:345 — clinical_notes context
- episodeRoutes.ts:346 — patients context
- episodeRoutes.ts:347 — patient_medications context

24 deferred to NEW BUG-430-PATIENT-APP (S1):
- 4 pre-auth lines (285/322/377/382 in patientAppRoutes.ts) — no req.clinicId yet
- 20 post-auth dbAdmin lines — req.params.patientId without ownership check
- RLS does NOT cover these (dbAdmin bypasses RLS) — prior "Layer-2" framing was wrong

## 2. TDD failing-test asset

`apps/api/tests/unit/clinicIdAllowlistInvariant.test.ts`:
- Reads allowlist file, counts non-comment non-blank lines
- Asserts count == 24 (= 36 − 12)
- Pre-drain: FAILS (36 ≠ 24); post-drain: PASSES

## 3. Fix-registry anchor

Single anchor row R-FIX-BUG-430-STAFF-AUTH-DRAINED:
- File: scripts/guards/check-query-has-clinic-id.allowlist.txt
- Type: present
- Pattern: `# OWNER: BUG-430-PATIENT-APP — 24 patient-app sites deferred`
- Description includes IDOR / dbAdmin / no-RLS-Layer-2 framing

## 4. bugs-remaining.md edits

- BUG-430 → marked fixed (anchor reference)
- NEW row BUG-430-PATIENT-APP at S1 with accurate dbAdmin/RLS distinction

## 5. Catalogue YAML

bug-catalogue-v2.yaml frozen at 2026-04-19 audit; no BUG-430 row exists. No YAML edit.

## 6. Schema snapshot

No migration. No regen.

## 7. Execution order (PART-2 §C-§O)

0. Pre-flight: clean tree + baseline guards
1. Step 1 (§C TDD red): write failing test
2. Step 2: verify entry #8 (org_units has clinic_id?)
3. Step 3 (§D + §E L1): apply 12 fixes + drain allowlist
4. Step 5 (§F L2): test passes; tsc clean; guard reports 24
5. Step 6 (§K): fix-registry anchor row
6. Step 7 (§M): bugs-remaining.md edits
7. Step 8 (§G/§H/§I): L3/L4/L5 agent gate (semantic trigger fires for L4 per §13.5; L5 fires per §2.I fix-registry edit)
8. Step 9 (§L): commit
9. Step 10 (§N): push (after user authorization)
10. Step 11 (§O): progress.md append

## 8. Critical no-band-aid invariants

- "RLS Layer-2" framing is incorrect for dbAdmin paths — corrected in BUG-430-PATIENT-APP description
- Patient-app severity is S1 not S2 (authenticated IDOR class)
- One anchor not 12 (count is the structural invariant, not the predicates themselves)
